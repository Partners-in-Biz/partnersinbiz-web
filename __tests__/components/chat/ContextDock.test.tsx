import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContextDock } from '@/components/chat/context/ContextDock'
import type { RuntimeExecution } from '@/components/messages/hermes/RuntimeInspectorRail'

jest.mock('@/lib/firebase/client', () => ({
  db: {},
}))

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({ path: 'client_documents/mock' })),
  onSnapshot: jest.fn(() => jest.fn()),
}))

const model = {
  context: { kind: 'studio' as const, id: 's1', orgId: 'o1', label: 'Marketing Studio', icon: 'campaign' },
  pulse: { label: 'Marketing Studio', metrics: [] },
  groups: [{ id: 'empty', label: 'Empty', items: [] }], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-07-13T00:00:00Z',
}

const activeExecution: RuntimeExecution = {
  activeMessage: {
    id: 'msg-run', conversationId: 'conv-1', role: 'assistant', content: '', authorKind: 'agent',
    authorId: 'pip', authorDisplayName: 'Pip', status: 'streaming', runId: 'run-123',
    model: 'openai/gpt-5.5', provider: 'openai',
  },
  events: [{ event: 'tool_call', tool: 'terminal', preview: 'npm test' }],
  selectedRuntime: null,
  catalog: null,
}

const originalMatchMedia = window.matchMedia

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
})

it('is an accessible adaptive dock, omits empty sections, closes on Escape, and restores focus', () => {
  const close = jest.fn()
  const { rerender } = render(<><button>Open context</button><ContextDock model={model} open={false} onClose={close} /></>)
  screen.getByRole('button', { name: 'Open context' }).focus()
  rerender(<><button>Open context</button><ContextDock model={model} open onClose={close} compact /></>)
  expect(screen.getByRole('dialog', { name: 'Marketing Studio context' })).toHaveAttribute('data-presentation', 'sheet')
  expect(screen.queryByText('Empty')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Close context dock' })).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Close context dock' })).toHaveClass('focus-visible:ring-2')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).toHaveBeenCalled()
  rerender(<><button>Open context</button><ContextDock model={model} open={false} onClose={close} /></>)
  expect(screen.getByRole('button', { name: 'Open context' })).toHaveFocus()
})

it('routes attention actions through the shared action handler instead of navigating to an API URL', () => {
  const onAction = jest.fn()
  const action = { id: 'retry', label: 'Retry', href: '/api/retry', method: 'PUT' as const }
  render(<ContextDock model={{ ...model, attention: [{ id: 'failed', label: 'Failed', state: 'blocked', actions: [action] }] }} open onClose={jest.fn()} onAction={onAction} />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(onAction).toHaveBeenCalledWith(action)
  expect(screen.queryByRole('link', { name: 'Retry' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry' })).toHaveClass('min-h-11', 'xl:min-h-0')
})

it.each(['company', 'contact', 'task'] as const)('renders a safe rich %s canvas projection with relationships, activity, actions, and canonical workspace link', (kind) => {
  const onAction = jest.fn()
  const action = { id: `follow-up-${kind}`, label: 'Follow up', href: `/api/${kind}/follow-up`, method: 'POST' as const }
  const richModel = {
    ...model,
    context: { kind, id: `${kind}-1`, orgId: 'o1', label: `${kind} record`, icon: 'category', href: `/admin/${kind}/${kind}-1` },
    preview: { kind: 'summary' as const, text: 'status: active | Safe canonical summary', status: 'active' },
    groups: [{ id: 'overview', label: 'Overview', items: [{ id: `${kind}-1`, label: `${kind} record`, state: 'ready' as const, detail: 'Safe canonical summary', updatedAt: '2026-07-20T08:00:00.000Z', actions: [action] }] }],
    relationships: [{ kind: 'company' as const, id: 'company-related', label: 'Related company', relation: 'Company', href: '/admin/crm/companies/company-related' }],
    activity: [{ id: 'activity-1', type: 'pickup' as const, label: 'Record opened', occurredAt: '2026-07-20T09:00:00.000Z' }],
  }
  render(<ContextDock model={richModel} open compact onClose={jest.fn()} onAction={onAction} />)

  expect(screen.getByRole('region', { name: 'Context overview' })).toHaveTextContent('active')
  expect(screen.getByRole('region', { name: 'Related context' })).toHaveTextContent('Related company')
  expect(screen.getByRole('region', { name: 'Recent activity' })).toHaveTextContent('Record opened')
  expect(screen.getByRole('link', { name: 'Open Related company' })).toHaveAttribute('href', '/admin/crm/companies/company-related')
  expect(screen.getByRole('link', { name: /Open full workspace/i })).toHaveAttribute('href', `/admin/${kind}/${kind}-1`)
  fireEvent.click(screen.getByRole('button', { name: `Show summary for ${kind} record` }))
  fireEvent.click(screen.getByRole('button', { name: 'Follow up' }))
  expect(onAction).toHaveBeenCalledWith(action)
})

it('shows an explicit empty recent-activity state for rich generic records', () => {
  render(<ContextDock model={{ ...model, context: { kind: 'contact', id: 'contact-1', orgId: 'o1', label: 'A contact', icon: 'person' } }} open compact onClose={jest.fn()} />)
  expect(screen.getByRole('region', { name: 'Recent activity' })).toHaveTextContent('No recent activity is available for this record yet.')
})

it('keeps workspace links touch-sized until the xl desktop breakpoint', () => {
  render(<ContextDock model={{ ...model, context: { ...model.context, href: '/portal/studios/s1' } }} open compact onClose={jest.fn()} />)
  expect(screen.getByRole('link', { name: /Open full workspace/i })).toHaveClass('min-h-11', 'xl:min-h-9')
  expect(screen.getByRole('link', { name: /Open full workspace/i })).not.toHaveClass('sm:h-9', 'md:h-9', 'lg:h-9')
})

it('renders the email context composer instead of the generic overview for email drafts', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/accounts')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            accounts: [{
              id: 'acct-1',
              emailAddress: 'me@example.com',
              status: 'connected',
              isDefault: true,
              orgId: 'o1',
              uid: 'u1',
              profileId: 'o1_u1',
              provider: 'google',
              displayName: 'Me',
              hasSmtp: false,
              hasImap: false,
              hasGoogleOAuth: true,
              lastSyncAt: null,
              createdAt: null,
              updatedAt: null,
            }],
          },
        }),
      } as Response
    }
    return {
      ok: true,
      json: async () => ({
        data: {
          message: {
            id: 'email-1',
            orgId: 'o1',
            uid: 'u1',
            profileId: 'o1_u1',
            accountId: 'acct-1',
            accountEmail: 'me@example.com',
            folder: 'drafts',
            direction: 'draft',
            status: 'draft',
            read: true,
            starred: false,
            from: 'me@example.com',
            to: ['lead@example.com'],
            cc: [],
            bcc: [],
            subject: 'Follow up',
            bodyText: 'Hello',
            attachments: [],
            snippet: 'Hello',
            createdAt: null,
            updatedAt: null,
          },
        },
      }),
    } as Response
  }) as jest.Mock

  render(<ContextDock
    model={{
      ...model,
      context: { kind: 'email', id: 'email-1', orgId: 'o1', label: 'Follow up', icon: 'mail' },
      preview: { kind: 'email', text: 'status: draft', status: 'draft' },
    }}
    open
    compact
    onClose={jest.fn()}
  />)

  expect(await screen.findByTestId('context-email-composer')).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Context overview' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Subject')).toHaveValue('Follow up')
})

it('renders campaign platform previews in the context dock', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/assets')) {
      return {
        ok: true,
        json: async () => ({
          data: {
            social: [{
              id: 's1',
              platforms: ['linkedin'],
              content: { text: 'LinkedIn launch post' },
              status: 'pending_approval',
            }],
            blogs: [],
            videos: [],
            meta: { totals: { social: 1, blogs: 0, videos: 0 }, byStatus: {} },
          },
        }),
      } as Response
    }
    return {
      ok: true,
      json: async () => ({
        data: {
          id: 'camp-1',
          name: 'July Growth',
          brandIdentity: {
            palette: { bg: '#111', accent: '#0A66C2', alert: '#F59E0B', text: '#fff' },
          },
        },
      }),
    } as Response
  }) as jest.Mock

  render(<ContextDock
    model={{
      ...model,
      context: { kind: 'campaign', id: 'camp-1', orgId: 'o1', label: 'July Growth', icon: 'ads_click', href: '/portal/campaigns/camp-1' },
      preview: { kind: 'campaign', status: 'in_review' },
    }}
    open
    compact
    onClose={jest.fn()}
  />)

  expect(await screen.findByTestId('context-campaign-preview')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Campaign platform previews' })).toHaveTextContent('LinkedIn launch post')
  expect(screen.queryByRole('region', { name: 'Context overview' })).not.toBeInTheDocument()
})

it('renders a social platform preview card in the context dock', async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      data: {
        id: 'post-1',
        platforms: ['instagram'],
        content: { text: 'Carousel drop this Friday' },
        status: 'draft',
        media: [{ type: 'image', url: 'https://cdn.example.com/post.jpg' }],
      },
    }),
  })) as jest.Mock

  render(<ContextDock
    model={{
      ...model,
      context: { kind: 'social', id: 'post-1', orgId: 'o1', label: 'Carousel drop', icon: 'campaign' },
      preview: { kind: 'social', status: 'draft' },
    }}
    open
    compact
    onClose={jest.fn()}
  />)

  expect(await screen.findByTestId('context-social-preview')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Social platform preview' })).toHaveTextContent('Carousel drop this Friday')
  expect(screen.queryByRole('region', { name: 'Context overview' })).not.toBeInTheDocument()
})

it.each([
  ['invoice', 'context-invoice-preview', 'Invoice document preview', '/api/v1/invoices/inv-1/html', 'INV-100', '/api/v1/invoices/inv-1'],
  ['quote', 'context-quote-preview', 'Quote document preview', '/api/v1/quotes/quote-1/html', 'Q-200', '/api/v1/quotes/quote-1'],
] as const)('renders %s HTML preview with download and send actions', async (kind, testId, label, path, number, metaPath) => {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    expect(url).toContain('orgId=o1')
    expect((init?.headers as Record<string, string>)?.['X-Org-Id']).toBe('o1')
    if (url.includes(path)) {
      return {
        ok: true,
        text: async () => `<!DOCTYPE html><html><body><div class="invoice-number">${number}</div></body></html>`,
      } as Response
    }
    if (url.includes('/pdf')) {
      return {
        ok: true,
        blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
      } as Response
    }
    if (url.includes(metaPath) && !url.includes('/html') && !url.includes('/pdf') && !url.includes('/send')) {
      return {
        ok: true,
        json: async () => ({
          data: kind === 'invoice'
            ? { invoiceNumber: number, status: 'draft', clientDetails: { email: 'client@example.com', name: 'Client' } }
            : { quote: { quoteNumber: number, status: 'draft', clientDetails: { email: 'client@example.com', name: 'Client' } } },
        }),
      } as Response
    }
    throw new Error(`Unexpected fetch ${url}`)
  }) as jest.Mock

  render(<ContextDock
    model={{
      ...model,
      context: {
        kind,
        id: kind === 'invoice' ? 'inv-1' : 'quote-1',
        orgId: 'o1',
        label: number,
        icon: kind === 'invoice' ? 'receipt_long' : 'request_quote',
        href: kind === 'invoice' ? '/admin/invoices/inv-1' : '/admin/quotes/quote-1',
      },
      preview: { kind: 'summary', text: `status: draft | ${number}`, status: 'draft' },
    }}
    open
    compact
    onClose={jest.fn()}
  />)

  expect(await screen.findByTestId(testId)).toBeInTheDocument()
  expect(screen.getByRole('region', { name: label })).toBeInTheDocument()
  expect(screen.getByTitle(`${kind === 'invoice' ? 'Invoice' : 'Quote'} preview`)).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Context overview' })).not.toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Send email' })).toBeInTheDocument()
})

it('uses a genuinely modal bottom sheet in compact chat and marks the active artifact accessibly', () => {
  const artifact = { id: 'a1', studioKind: 'video_editor' as const, resourceType: 'video', resourceId: 'v1', title: 'Launch cut', artifactKind: 'video' as const, state: 'review' as const, statusLabel: 'In review', href: '/videos/v1', actions: [] }
  render(<ContextDock model={{ ...model, artifacts: [artifact] }} open compact activeArtifactId="a1" onClose={jest.fn()} />)
  const dialog = screen.getByRole('dialog', { name: 'Marketing Studio context' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(dialog).toHaveAttribute('data-presentation', 'sheet')
  expect(screen.getByRole('button', { name: 'Inspect Launch cut' })).toHaveAttribute('aria-current', 'true')
})

it('uses a modal sheet in normal Messages on a mobile viewport and traps focus', () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
  render(<ContextDock model={model} open onClose={jest.fn()} />)
  const dialog = screen.getByRole('dialog', { name: 'Marketing Studio context' })
  expect(dialog).toHaveAttribute('data-presentation', 'sheet')
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(dialog).toHaveClass('fixed', 'inset-0')
  expect(dialog).toHaveClass('pl-[env(safe-area-inset-left)]', 'pr-[env(safe-area-inset-right)]')
  expect(dialog).not.toHaveClass('sm:top-[8%]', 'sm:bottom-3')
  expect(screen.getByTestId('context-dock-header')).toHaveClass('pt-[max(.5rem,env(safe-area-inset-top))]')
  expect(screen.getByTestId('context-dock-scroll-body')).toHaveClass('pb-[max(.75rem,env(safe-area-inset-bottom))]')
  expect(screen.getByRole('button', { name: 'Close context dock' })).toHaveTextContent('Back to chat')
  const close = screen.getByRole('button', { name: 'Close context dock' })
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(close).toHaveFocus()
})

it('switches between primary and secondary context as one tablet landscape surface', async () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() })),
  })
  const secondaryContext = { kind: 'document' as const, id: 'd1', label: 'Launch brief', summary: 'Ready for review' }
  const secondaryModel = {
    ...model,
    context: { kind: 'document' as const, id: 'd1', orgId: 'o1', label: 'Launch brief', icon: 'description' },
    pulse: { label: 'Launch brief', headline: 'Ready for review', metrics: [] },
    groups: [{ id: 'details', label: 'Document details', items: [{ id: 'status', label: 'Ready for review' }] }],
  }
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: secondaryModel }) })) as jest.Mock

  render(<ContextDock model={model} open mode="dual" onClose={jest.fn()} secondaryContext={secondaryContext} secondaryOptions={[secondaryContext]} />)

  const dialog = screen.getByRole('dialog', { name: 'Marketing Studio context' })
  expect(dialog).toHaveAttribute('data-presentation', 'canvas')
  expect(screen.queryByRole('button', { name: 'Use dual context canvas' })).not.toBeInTheDocument()
  const primary = screen.getByRole('tab', { name: 'Marketing Studio' })
  const secondary = screen.getByRole('tab', { name: 'Launch brief' })
  expect(primary).toHaveAttribute('aria-selected', 'true')
  expect(secondary).toHaveAttribute('aria-selected', 'false')
  expect(primary).toHaveClass('min-h-11')

  primary.focus()
  fireEvent.keyDown(primary, { key: 'ArrowRight' })

  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Launch brief context' })).toBeInTheDocument())
  expect(secondary).toHaveAttribute('aria-selected', 'true')
  expect(secondary).toHaveFocus()
  expect(await screen.findByText('Document details')).toBeInTheDocument()
  expect(screen.queryByText('Related context')).not.toBeInTheDocument()
  expect(global.fetch).toHaveBeenCalledWith('/api/v1/chat-context/document/d1', expect.objectContaining({ signal: expect.any(AbortSignal) }))

  fireEvent.click(primary)
  expect(screen.getByRole('dialog', { name: 'Marketing Studio context' })).toBeInTheDocument()
  expect(primary).toHaveAttribute('aria-selected', 'true')
})

it('keeps keyboard canvas resizing within the 420 to 960 pixel desktop bounds', () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: query.includes('min-width: 1280px'), addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
  const onCanvasWidthChange = jest.fn()
  const { rerender } = render(<ContextDock model={model} open canvasWidth={960} onCanvasWidthChange={onCanvasWidthChange} onClose={jest.fn()} />)

  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize context canvas' }), { key: 'ArrowLeft' })
  expect(onCanvasWidthChange).toHaveBeenLastCalledWith(960)

  rerender(<ContextDock model={model} open canvasWidth={420} onCanvasWidthChange={onCanvasWidthChange} onClose={jest.fn()} />)
  fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize context canvas' }), { key: 'ArrowRight' })
  expect(onCanvasWidthChange).toHaveBeenLastCalledWith(420)
})

it('sits flush to the top of the chat surface and centers the header icon', () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: query.includes('min-width: 1280px'), addEventListener: jest.fn(), removeEventListener: jest.fn() })) })
  render(<ContextDock model={model} open onClose={jest.fn()} />)
  const dialog = screen.getByRole('dialog', { name: 'Marketing Studio context' })
  expect(dialog).toHaveClass('inset-y-0', 'right-0')
  expect(dialog).not.toHaveClass('top-[72px]')
  expect(screen.getByTestId('context-dock-icon')).toHaveClass('inline-flex', 'items-center', 'justify-center')
  expect(screen.getByRole('separator', { name: 'Resize context canvas' })).toHaveAttribute('aria-valuemax', '960')
})

it('shows active execution inside the same context dock with events and stop permission', () => {
  const onStop = jest.fn()
  render(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, canStop: true, onStop }} />)

  expect(screen.getByRole('region', { name: 'Execution' })).toBeInTheDocument()
  expect(screen.queryByTestId('runtime-inspector-rail')).not.toBeInTheDocument()
  expect(screen.getByText('terminal')).toBeInTheDocument()
  expect(screen.getByText('npm test')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
  expect(onStop).toHaveBeenCalledTimes(1)
})

it('keeps completed execution collapsed until inspection is requested', () => {
  render(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, activeMessage: { ...activeExecution.activeMessage!, status: 'complete' } }} />)

  expect(screen.getByRole('button', { name: 'Expand execution' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('terminal')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Expand execution' }))
  expect(screen.getByText('terminal')).toBeInTheDocument()
})

it('collapses execution when an active run transitions to completed', () => {
  const { rerender } = render(<ContextDock model={model} open onClose={jest.fn()} execution={activeExecution} />)
  expect(screen.getByRole('button', { name: 'Collapse execution' })).toHaveAttribute('aria-expanded', 'true')
  rerender(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, activeMessage: { ...activeExecution.activeMessage!, status: 'completed' } }} />)
  expect(screen.getByRole('button', { name: 'Expand execution' })).toHaveAttribute('aria-expanded', 'false')
})

it('emphasizes and expands an execution waiting for approval', () => {
  render(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, activeMessage: { ...activeExecution.activeMessage!, status: 'waiting_approval' } }} />)
  expect(screen.getByRole('region', { name: 'Execution' })).toHaveAttribute('data-emphasized', 'true')
  expect(screen.getByRole('button', { name: 'Collapse execution' })).toHaveAttribute('aria-expanded', 'true')
})

it('only renders retry when the caller grants retry permission', () => {
  const onRetry = jest.fn()
  const { rerender } = render(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, activeMessage: { ...activeExecution.activeMessage!, status: 'failed' }, onRetry }} />)
  expect(screen.queryByRole('button', { name: 'Retry run' })).not.toBeInTheDocument()
  rerender(<ContextDock model={model} open onClose={jest.fn()} execution={{ ...activeExecution, activeMessage: { ...activeExecution.activeMessage!, status: 'failed' }, canRetry: true, onRetry }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry run' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
})

it('uses the same bottom sheet for execution in compact Briefings chat', () => {
  render(<ContextDock model={model} open compact onClose={jest.fn()} execution={activeExecution} />)
  expect(screen.getByRole('dialog', { name: 'Marketing Studio context' })).toHaveAttribute('data-presentation', 'sheet')
  expect(screen.getByRole('region', { name: 'Execution' })).toBeInTheDocument()
})
