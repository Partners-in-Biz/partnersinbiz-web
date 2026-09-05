import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MessageBubble from '@/components/chat/MessageBubble'
import {
  CONVERSATION_RUN_RECOVERING_LEGACY_USER_ERROR,
  CONVERSATION_RUN_RECOVERING_USER_ERROR,
} from '@/lib/conversations/run-policy'
import { WORKSPACE_PANEL_EVENT } from '@/lib/hermes/workspace-panels'

const mermaidRender = jest.fn(async (_id: string, source: string) => ({
  svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${source.includes('Client request') ? 'Client request' : 'diagram'}</text></svg>`,
}))

jest.mock('mermaid', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(),
    render: (id: string, source: string) => mermaidRender(id, source),
  },
}))

function closestMessageGroup(element: Element): HTMLElement | null {
  let node: Element | null = element
  while (node) {
    if (node instanceof HTMLElement && node.className.includes('group/message')) return node
    node = node.parentElement
  }
  return null
}

describe('MessageBubble', () => {
  it('renders a generated workspace panel as a safe preview and requests its own pane', () => {
    const listener = jest.fn()
    window.addEventListener(WORKSPACE_PANEL_EVENT, listener)
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-panel', conversationId: 'conv-1', role: 'assistant', content: 'I built the panel.',
          authorKind: 'agent', authorId: 'pip', authorDisplayName: 'Pip', status: 'completed',
          richParts: [{ type: 'workspace_panel', id: 'pipeline', title: 'Pipeline cockpit', metrics: [{ label: 'Qualified', value: '18' }], sections: [] }],
        }}
      />,
    )

    expect(screen.getByText('Pipeline cockpit')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open in workspace pane' }))
    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ id: 'pipeline', title: 'Pipeline cockpit' })
    window.removeEventListener(WORKSPACE_PANEL_EVENT, listener)
  })

  it('keeps long mobile chat text inside the viewport instead of forcing horizontal scroll', () => {
    const longToken = 'https://example.com/' + 'unbroken-mobile-overflow-token-'.repeat(12)

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: longToken,
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    const messageText = screen.getByText(longToken)
    expect(messageText).toHaveClass('max-w-full', 'overflow-hidden', 'break-words', '[overflow-wrap:anywhere]')
    expect(closestMessageGroup(messageText)).toHaveClass('min-w-0')
  })

  it('explains lingering [redacted-url] placeholders instead of implying a recoverable link', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-redacted-url',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Signed upload: [redacted-url] — ask for a public link if you need it.',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    const marker = screen.getByTitle(/Sensitive or private URL removed/i)
    expect(marker).toHaveTextContent('[redacted-url]')
    expect(marker.tagName).toBe('ABBR')
  })

  it('keeps the user bubble clamped for long pasted mobile text', () => {
    const longToken = 'Attachment:' + 'VeryLongScreenshotFilenameWithoutNaturalBreaks'.repeat(8)

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'user',
          content: longToken,
          authorKind: 'user',
          authorId: 'user-1',
          authorDisplayName: 'Peet',
          status: 'completed',
        }}
      />,
    )

    const messageText = screen.getByText(longToken)
    expect(messageText).toHaveClass('max-w-full', 'overflow-hidden', 'break-words', '[overflow-wrap:anywhere]')
    expect(closestMessageGroup(messageText)).toHaveClass('min-w-0')
  })

  it('offers read-aloud controls for assistant messages', () => {
    const speak = jest.fn()
    const cancel = jest.fn()
    class FakeSpeechSynthesisUtterance {
      text: string
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) {
        this.text = text
      }
    }
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak, cancel },
    })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FakeSpeechSynthesisUtterance,
    })
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FakeSpeechSynthesisUtterance,
    })

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Read this response back to me.',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Read aloud/i }))

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(speak).toHaveBeenCalledTimes(1)
    expect(speak.mock.calls[0][0]).toMatchObject({ text: 'Read this response back to me.' })

    fireEvent.click(screen.getByRole('button', { name: /Stop read aloud/i }))
    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it('renders image attachments as clickable previews', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'user',
          content: 'image',
          authorKind: 'user',
          authorId: 'user-1',
          authorDisplayName: 'Peet',
          status: 'completed',
          attachments: [
            {
              id: 'att-1',
              name: 'Screenshot 2026-05-19.png',
              url: 'https://cdn.example.com/screenshot.png',
              contentType: 'image/png',
              sizeBytes: 287436,
            },
          ],
        }}
      />,
    )

    const preview = screen.getByRole('button', { name: /open Screenshot 2026-05-19\.png/i })
    expect(preview).toBeInTheDocument()
    expect(screen.getByAltText('Screenshot 2026-05-19.png')).toHaveAttribute('src', 'https://cdn.example.com/screenshot.png')

    fireEvent.click(preview)

    expect(screen.getByRole('dialog', { name: /Screenshot 2026-05-19\.png/i })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Screenshot 2026-05-19.png' }).at(-1)).toHaveAttribute('src', 'https://cdn.example.com/screenshot.png')
  })

  it('renders direct mp4 and webm rich video parts inline with mobile-safe controls and open fallbacks', () => {
    const { container } = render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Generated videos are ready.',
          authorKind: 'agent',
          authorId: 'maya',
          authorDisplayName: 'Maya',
          status: 'completed',
          richParts: [
            { type: 'video', url: 'https://cdn.example.com/higgsfield-output.mp4', name: 'Higgsfield MP4 output', mimeType: 'video/mp4' },
            { type: 'video', url: 'https://firebasestorage.googleapis.com/v0/b/pib/o/render.webm?alt=media&token=abc', name: 'Firebase WebM output', mimeType: 'video/webm' },
          ],
        }}
      />,
    )

    const videos = Array.from(container.querySelectorAll('video'))
    expect(videos).toHaveLength(2)
    expect(videos[0]).toHaveAttribute('src', 'https://cdn.example.com/higgsfield-output.mp4')
    expect(videos[0]).toHaveAttribute('playsinline')
    expect(videos[1]).toHaveAttribute('src', 'https://firebasestorage.googleapis.com/v0/b/pib/o/render.webm?alt=media&token=abc')
    expect(videos[1]).toHaveAttribute('playsinline')
    expect(screen.getByRole('link', { name: /open Higgsfield MP4 output/i })).toHaveAttribute('href', 'https://cdn.example.com/higgsfield-output.mp4')
    expect(screen.getByRole('link', { name: /open Firebase WebM output/i })).toHaveAttribute('href', 'https://firebasestorage.googleapis.com/v0/b/pib/o/render.webm?alt=media&token=abc')
  })

  it('uses an explicit browser fallback instead of embedding non-direct Google Drive video links', () => {
    const { container } = render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Generated Drive video is ready.',
          authorKind: 'agent',
          authorId: 'maya',
          authorDisplayName: 'Maya',
          status: 'completed',
          richParts: [
            { type: 'video', url: 'https://drive.google.com/file/d/abc123/view?usp=drive_link', name: 'Higgsfield Drive output', mimeType: 'video/mp4' },
          ],
        }}
      />,
    )

    expect(container.querySelector('video')).not.toBeInTheDocument()
    expect(screen.getByText(/This generated video link cannot be previewed safely inline/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open Higgsfield Drive output in browser/i })).toHaveAttribute('href', 'https://drive.google.com/file/d/abc123/view?usp=drive_link')
  })

  it('turns bare URLs in chat text into clickable links with image previews', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Here is the page https://partnersinbiz.online and the image https://cdn.example.com/output.png',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    expect(screen.getByRole('link', { name: 'https://partnersinbiz.online' })).toHaveAttribute('href', 'https://partnersinbiz.online')
    expect(screen.getByRole('link', { name: 'https://cdn.example.com/output.png' })).toHaveAttribute('href', 'https://cdn.example.com/output.png')
    expect(screen.getByRole('img', { name: 'https://cdn.example.com/output.png' })).toHaveAttribute('src', 'https://cdn.example.com/output.png')
  })


  it('standardises device-login instructions into a mobile-friendly auth card with separate URL and code copy actions', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    const authUrl = 'https://auth.higgsfield.ai/device'
    const code = 'HF-24K9-ZQ7P'

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-auth',
          conversationId: 'conv-1',
          role: 'assistant',
          content: `Higgsfield needs device login. Visit ${authUrl} and enter code ${code}. This code expires in 15 minutes. Full link: https://auth.higgsfield.ai/device?user_code=${code}&client_id=${'x'.repeat(120)}`,
          authorKind: 'agent',
          authorId: 'maya',
          authorDisplayName: 'Maya',
          status: 'completed',
        }}
      />,
    )

    const card = screen.getByLabelText('Device login instructions')
    expect(card).toHaveClass('max-w-full', 'overflow-hidden')
    expect(screen.getByText('Higgsfield device login')).toBeInTheDocument()
    expect(screen.getByText(authUrl)).toHaveClass('break-words', '[overflow-wrap:anywhere]')
    expect(screen.getByText(code)).toBeInTheDocument()
    expect(screen.getByText(/expires in 15 minutes/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy auth URL' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy auth code' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(authUrl)
      expect(writeText).toHaveBeenCalledWith(code)
    })
    expect(screen.getByRole('link', { name: /open full auth link/i })).toHaveAttribute('href', expect.stringContaining('user_code=HF-24K9-ZQ7P'))
  })

  it('renders device auth cards for Hermes/Higgsfield tool output and keeps long full links from overflowing', () => {
    const fullLink = `https://login.example.com/activate?user_code=CODE-7788&state=${'state-token-'.repeat(30)}`

    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-tool-auth',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Waiting on tool login.',
          authorKind: 'agent',
          authorId: 'maya',
          authorDisplayName: 'Maya',
          status: 'completed',
          richParts: [
            {
              type: 'tool_output',
              tool: 'higgsfield',
              stdout: `To authenticate, open ${fullLink} and enter code CODE-7788. Status: pending, expires at 2026-06-20T12:30:00Z`,
            },
          ],
        }}
      />,
    )

    const card = screen.getByLabelText('Device login instructions')
    expect(card).toHaveClass('max-w-full', 'overflow-hidden')
    expect(screen.getByText('https://login.example.com/activate')).toBeInTheDocument()
    expect(screen.getByText('CODE-7788')).toBeInTheDocument()
    expect(screen.getByText(/status: pending/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open full auth link/i })).toHaveClass('max-w-full', 'truncate')
    expect(screen.queryByText(fullLink)).not.toBeInTheDocument()
  })

  it('shows a full inline command console for agent tool events', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Done.',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          events: [
            {
              event: 'tool.started',
              tool: 'terminal',
              input: 'npm test -- --runInBand',
              timestamp: 1_770_000_000,
            },
            {
              event: 'tool.completed',
              tool: 'terminal',
              input: 'npm test -- --runInBand',
              stdout: 'PASS __tests__/components/chat/MessageBubble.test.tsx',
              exitCode: 0,
              durationMs: 842,
              timestamp: 1_770_000_002,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Inline command console')).toBeInTheDocument()
    expect(screen.getAllByText('terminal').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText((content) => content.includes('$ npm test -- --runInBand')).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText((content) => content.includes('PASS __tests__/components/chat/MessageBubble.test.tsx'))).toBeInTheDocument()
    expect(screen.getByText(/exit 0/)).toBeInTheDocument()
  })

  it('keeps a collapsed thought stream beside completed agent replies', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-thinking',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Project is back on track.',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          thinking: {
            summary: 'Checked the project API and summarised the open tasks.',
            steps: [
              { kind: 'tool', label: 'terminal', status: 'completed' },
              { kind: 'tool', label: 'skill_view', status: 'completed' },
            ],
            toolCount: 2,
            durationMs: 18_000,
          },
        }}
      />,
    )

    const disclosure = screen.getByTestId('message-thinking-disclosure')
    expect(disclosure.querySelector('details')).not.toHaveAttribute('open')
    expect(screen.getByText(/Thought for 18s/i)).toBeInTheDocument()
    expect(screen.getByText('Checked the project API and summarised the open tasks.')).toBeInTheDocument()
  })

  it('streams live reasoning into an open Thought disclosure while pending', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        liveEvents={[
          { event: 'reasoning.delta', delta: 'I will load the Hermes skill first.', timestamp: Date.now() / 1000 },
          { event: 'tool.started', tool: 'skill_view', timestamp: Date.now() / 1000 },
        ]}
        message={{
          id: 'msg-live-thought',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'pending',
          runId: 'run_live',
        }}
      />,
    )

    expect(screen.getByText(/^Thought$/i)).toBeInTheDocument()
    expect(screen.getByTestId('message-thinking-disclosure')).toHaveTextContent(
      'I will load the Hermes skill first.',
    )
    expect(screen.queryByText('Current activity')).not.toBeInTheDocument()
    expect(screen.getByText(/Read 1 file/i)).toBeInTheDocument()
  })

  it('keeps a persisted reasoning summary available after the final response arrives', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-persisted-reasoning',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'The requested change is ready.',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          events: [
            {
              event: 'reasoning.summary',
              text: 'I checked the completed run and preserved its safe summary.',
              timestamp: 1_770_000_000,
            },
            {
              event: 'run.completed',
              timestamp: 1_770_000_005,
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('The requested change is ready.')).toBeInTheDocument()
    expect(screen.getByText(/Thought for/i)).toBeInTheDocument()
    expect(screen.getByText('I checked the completed run and preserved its safe summary.')).toBeInTheDocument()
  })

  it('renders assistant markdown, mermaid-style diagrams, and inline SVG visually instead of as raw prose', async () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: [
            '### Visual options',
            '',
            '- Plain copy',
            '- **Structured** content',
            '',
            'flowchart TD',
            'A[Client request] --> B[Pip resolves org/client]',
            'B --> C[Specialist agent handles work]',
            '',
            '<svg width="120" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="40" fill="#fff"/><text x="8" y="24">SVG card</text></svg>',
          ].join('\n'),
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Visual options' })).toBeInTheDocument()
    expect(screen.getByText('Plain copy').closest('li')).toBeInTheDocument()
    expect(screen.getByText('Structured')).toHaveClass('font-medium')
    expect(await screen.findByTestId('mermaid-part')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument()
    expect(await screen.findByText('Client request')).toBeInTheDocument()
    expect(mermaidRender).toHaveBeenCalled()
    expect(screen.queryByText(/flowchart TD/)).not.toBeInTheDocument()
    expect(screen.getByText('SVG card')).toBeInTheDocument()
    expect(screen.queryByText(/<svg width/)).not.toBeInTheDocument()
  })

  it('renders inline <!--pib-part:N--> placeholders in order', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-inline-parts',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Intro\n<!--pib-part:0-->\nMiddle\n<!--pib-part:1-->\nEnd',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          richParts: [
            { type: 'html_artifact', title: 'First artifact', html: '<p>Alpha</p>', height: 200 },
            { type: 'html_artifact', title: 'Second artifact', html: '<p>Beta</p>', height: 200 },
          ],
        }}
      />,
    )

    expect(screen.getByText('Intro')).toBeInTheDocument()
    expect(screen.getByText('Middle')).toBeInTheDocument()
    expect(screen.getByText('End')).toBeInTheDocument()
    const artifacts = screen.getAllByTestId('html-artifact-part')
    expect(artifacts).toHaveLength(2)
    expect(artifacts[0]).toHaveTextContent('First artifact')
    expect(artifacts[1]).toHaveTextContent('Second artifact')
    expect(artifacts[0].compareDocumentPosition(artifacts[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Intro').compareDocumentPosition(artifacts[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(artifacts[1].compareDocumentPosition(screen.getByText('End')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders GitHub-style Markdown tables as responsive tables, including spaced rows', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-markdown-table',
          conversationId: 'conv-1',
          role: 'assistant',
          content: [
            'Phase 1 items to prepare',
            '',
            '| Need | What to give me | Notes |',
            '| --- | :---: | ---: |',
            '| Staging Postgres | Confirm **DATABASE_URL** | New empty CRM DB |',
            '',
            '| SSL flag | Prefer true | Confirm with provider |',
            '',
            'Do not send yet.',
          ].join('\n'),
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    const table = screen.getByRole('table')
    expect(table.parentElement).toHaveClass('overflow-x-auto')
    expect(screen.getByRole('columnheader', { name: 'Need' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'What to give me' })).toHaveStyle({ textAlign: 'center' })
    expect(screen.getByRole('columnheader', { name: 'Notes' })).toHaveStyle({ textAlign: 'right' })
    expect(screen.getByText('Staging Postgres').closest('td')).toBeInTheDocument()
    expect(screen.getByText('DATABASE_URL')).toHaveClass('font-medium')
    expect(screen.getByText('SSL flag').closest('td')).toBeInTheDocument()
    expect(screen.getByText('Do not send yet.')).toBeInTheDocument()
  })

  it('renders chat mention tokens as styled chips and tooltips', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-mention',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Hi @user:client-9, please ask @agent:maya for approval before sending.',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          mentions: [
            { type: 'user', id: 'client-9', raw: '@user:client-9' },
            { type: 'agent', id: 'maya', raw: '@agent:maya' },
          ],
        }}
      />,
    )

    expect(screen.getByTitle('@user mention (client-9)')).toHaveTextContent('@user:client-9')
    expect(screen.getByTitle('@agent mention (maya)')).toHaveTextContent('@agent:maya')
  })

  it('renders a device badge chip after the agent name when deviceBadge is present', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-badge',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Draft is ready.',
          authorKind: 'agent',
          authorId: 'maya',
          authorDisplayName: 'Maya',
          status: 'completed',
          deviceBadge: { deviceId: 'device-a', label: "Peet's Mac" },
        }}
      />,
    )

    expect(screen.getByTestId('message-device-badge')).toHaveTextContent("Peet's Mac")
  })

  it('renders structured rich parts and dispatches UI actions from the message payload', () => {
    const handleAction = jest.fn()
    const Bubble = MessageBubble as any

    render(
      <Bubble
        currentUserUid="user-1"
        onUiAction={handleAction}
        message={{
          id: 'msg-1',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Fallback text',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          richParts: [
            { type: 'markdown', content: '### Launch plan\n- **Approve** final copy' },
            { type: 'code', language: 'ts', code: 'const ready = true' },
            {
              type: 'table',
              caption: 'Channel mix',
              columns: ['Channel', 'Status'],
              rows: [['Email', 'Ready'], ['LinkedIn', 'Draft']],
            },
            { type: 'image', url: 'https://cdn.example.com/ad.png', alt: 'Ad preview', caption: 'Primary ad' },
            { type: 'file', url: 'https://cdn.example.com/brief.pdf', name: 'Launch brief.pdf', sizeBytes: 2048 },
            { type: 'status', title: 'Checks passed', status: 'completed', body: 'All assets are ready.' },
            { type: 'approval', actionId: 'approval-1', title: 'Approve publish?', choices: ['once', 'deny'] },
            {
              type: 'approval_card',
              title: 'CMP proposal follow-up',
              body: 'Proposal and CRM notes are ready for a CEO decision.',
              statusLabel: 'Needs CEO decision',
              evidence: ['Deal is in active proposal stage', 'Follow-up copy is drafted but not sent'],
              dataSkill: 'crm-sales:gather-deal-context',
              analysisQuestion: 'Which follow-up has the highest chance of moving CMP to a meeting?',
              decisions: [
                { label: 'Approve WhatsApp follow-up', required: true },
                'Ask Pip to revise the tone',
              ],
              recommendation: 'Approve the WhatsApp follow-up and ask for a meeting window.',
              replyTemplate: 'Approved: send the CMP WhatsApp follow-up with a meeting-window ask.',
              safetyNote: 'No external message is sent until this approval is posted in chat.',
            },
            { type: 'clarify', actionId: 'clarify-tone', question: 'Which tone should I use?', choices: ['Direct', 'Warm'] },
            {
              type: 'model_picker',
              actionId: 'model-depth',
              title: 'Choose model depth',
              models: [{ id: 'deep', label: 'Deep review' }],
            },
          ],
          uiActions: [
            { id: 'approve-once', actionId: 'approval-1', type: 'approve', label: 'Allow once', value: 'once' },
            { id: 'choose-direct', actionId: 'clarify-tone', type: 'choose', label: 'Direct', value: 'Direct' },
            { id: 'open-brief', type: 'open', label: 'Open brief', url: 'https://cdn.example.com/brief.pdf' },
          ],
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Launch plan' })).toBeInTheDocument()
    expect(screen.getByText('const ready = true')).toBeInTheDocument()
    expect(screen.getByText('Channel mix')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Channel' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Ad preview' })).toHaveAttribute('src', 'https://cdn.example.com/ad.png')
    expect(screen.getByRole('link', { name: /Launch brief\.pdf/i })).toHaveAttribute('href', 'https://cdn.example.com/brief.pdf')
    expect(screen.getByText('Checks passed')).toBeInTheDocument()
    expect(screen.getByText('Approve publish?')).toBeInTheDocument()
    expect(screen.getByLabelText('CMP proposal follow-up')).toBeInTheDocument()
    expect(screen.getByText('Needs CEO decision')).toBeInTheDocument()
    expect(screen.getByText('Deal is in active proposal stage')).toBeInTheDocument()
    expect(screen.getByText('crm-sales:gather-deal-context')).toBeInTheDocument()
    expect(screen.getByText('Approve WhatsApp follow-up')).toBeInTheDocument()
    expect(screen.getByText('Approved: send the CMP WhatsApp follow-up with a meeting-window ask.')).toBeInTheDocument()
    expect(screen.getByText('Which tone should I use?')).toBeInTheDocument()
    expect(screen.getByText('Choose model depth')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(handleAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'msg-1' }),
      expect.objectContaining({ id: 'approve-once', type: 'approve', value: 'once' }),
    )
  })

  it('lets approval-card decisions and reply templates be added to the chat composer', () => {
    const handleQuote = jest.fn()
    const Bubble = MessageBubble as any

    render(
      <Bubble
        currentUserUid="user-1"
        onQuoteSelection={handleQuote}
        message={{
          id: 'msg-approval',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          richParts: [
            {
              type: 'approval_card',
              title: 'Publish Hunt and Gun document',
              decisions: [
                { label: 'Approve publish/share with client', required: true },
                'Keep as internal draft for edits',
              ],
              replyTemplate: 'Approved: publish the Hunt and Gun document and give me the client share link.',
            },
          ],
        }}
      />,
    )

    const approveRadio = screen.getByRole('radio', { name: /Approve publish\/share with client \(required\)/i })
    const draftRadio = screen.getByRole('radio', { name: /Keep as internal draft for edits/i })

    expect(approveRadio).not.toBeChecked()
    expect(draftRadio).not.toBeChecked()

    fireEvent.click(draftRadio)

    expect(draftRadio).toBeChecked()
    expect(approveRadio).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: /Add selected decision to chat/i }))
    expect(handleQuote).toHaveBeenCalledWith('Keep as internal draft for edits')

    fireEvent.click(screen.getByRole('button', { name: /Add reply to chat/i }))
    expect(handleQuote).toHaveBeenCalledWith('Approved: publish the Hunt and Gun document and give me the client share link.')
  })

  it('renders a project task proposal with routing and one create action', () => {
    const handleAction = jest.fn()
    const Bubble = MessageBubble as any

    render(
      <Bubble
        currentUserUid="user-1"
        onUiAction={handleAction}
        message={{
          id: 'proposal-message',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          runId: 'run-1',
          richParts: [{
            type: 'project_task_proposal',
            title: 'Proposed launch chain',
            projectId: 'project-1',
            bundleId: 'bundle-1',
            tasks: [
              { title: 'Draft campaign copy', assigneeAgentId: 'maya', modelPolicy: 'Auto', dependencySequence: [] },
              { title: 'Build email automation', assigneeAgentId: 'theo', modelPolicy: 'Auto', dependencySequence: [0], reviewerAgentId: 'qa-release' },
            ],
          }],
          uiActions: [{ id: 'create-chain', type: 'custom', label: 'Create tasks', actionId: 'create-chain', variant: 'primary' }],
        }}
      />,
    )

    expect(screen.getByLabelText('Proposed launch chain')).toBeInTheDocument()
    expect(screen.getByText('Draft campaign copy')).toBeInTheDocument()
    expect(screen.getByText('Build email automation')).toBeInTheDocument()
    expect(screen.getByText(/maya/i)).toBeInTheDocument()
    expect(screen.getByText(/after task 1/i)).toBeInTheDocument()
    expect(screen.getByText(/review: qa-release/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create tasks' }))
    expect(handleAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proposal-message' }),
      expect.objectContaining({ id: 'create-chain', type: 'custom' }),
    )
  })

  it('renders a rich JSON content envelope instead of showing raw JSON text', async () => {
    const handleAction = jest.fn()
    const Bubble = MessageBubble as any
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: jest.fn(() => true),
    })
    const richJsonText = JSON.stringify({
      rich_parts: [
        { type: 'markdown', content: '### PiB Rich Chat Contract Smoke Test\nThis should render as markdown.' },
        {
          type: 'status_card',
          title: 'Rich chat contract smoke test',
          status: 'ready_for_review',
          body: 'No external action was performed.',
        },
      ],
      ui_actions: [
        { id: 'copy-summary', type: 'copy', label: 'Copy summary', value: 'PIB rich chat smoke test' },
      ],
    }, null, 2)

    render(
      <Bubble
        currentUserUid="user-1"
        onUiAction={handleAction}
        message={{
          id: 'msg-json',
          conversationId: 'conv-1',
          role: 'assistant',
          content: richJsonText,
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'PiB Rich Chat Contract Smoke Test' })).toBeInTheDocument()
    expect(screen.getByText('Rich chat contract smoke test')).toBeInTheDocument()
    expect(screen.getByText('No external action was performed.')).toBeInTheDocument()
    expect(screen.queryByText(/"rich_parts"/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }))
    await waitFor(() => {
      expect(handleAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'msg-json' }),
        expect.objectContaining({ id: 'copy-summary', type: 'copy', value: 'PIB rich chat smoke test' }),
      )
    })
  })

  it('hides incomplete streamed rich JSON envelopes instead of printing raw fragments', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-streaming-json',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '{\n  "rich_parts": [\n    { "type": "markdown", "content": "### Streaming',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'streaming',
        }}
      />,
    )

    expect(screen.queryByText(/"rich_parts"/)).not.toBeInTheDocument()
    expect(screen.getByText('Waiting for agent activity...')).toBeInTheDocument()
  })

  it('does not claim to poll Hermes before a run id exists', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'tmp-assistant-submit',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pending',
          authorDisplayName: 'Agent',
          status: 'pending',
        }}
      />,
    )

    expect(screen.getByText('Starting agent')).toBeInTheDocument()
    expect(screen.getByText('Waiting for the server to create a run...')).toBeInTheDocument()
    expect(screen.queryByText('Still polling run...')).not.toBeInTheDocument()
  })

  it('rehydrates Studio artifacts by stable ID instead of rendering stale snapshots', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      data: {
        artifacts: [{
          id: 'marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE', studioKind: 'marketing_studio',
          resourceType: 'canvas', resourceId: 'canvas-1', title: 'Current campaign', artifactKind: 'canvas',
          state: 'ready', statusLabel: 'Current status', href: '/canvas/current', actions: [],
        }],
      },
    }), { status: 200 }))

    render(<MessageBubble currentUserUid="user-1" message={{
      id: 'artifact-message', conversationId: 'conv-1', role: 'assistant', content: '', authorKind: 'agent',
      authorId: 'pip', authorDisplayName: 'Pip', status: 'completed',
      richParts: [{ type: 'studio_artifact', artifactId: 'marketing_studio:org:b3JnLTE:canvas:Y2FudmFzLTE', title: 'Stale campaign' }],
    }} />)

    expect(await screen.findByText('Current campaign')).toBeInTheDocument()
    expect(screen.queryByText('Stale campaign')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/chat-context/studio_artifact/marketing_studio%3Aorg%3Ab3JnLTE%3Acanvas%3AY2FudmFzLTE'))
    fetchMock.mockRestore()
  })

  it('rehydrates child artifacts through their authoritative parents, including mixed bundles', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { artifacts: [{
        id: 'video_editor:render:render-1', studioKind: 'video_editor', resourceType: 'render', resourceId: 'render-1',
        title: 'Current render', artifactKind: 'video', state: 'complete', statusLabel: 'Rendered', href: '/video', actions: [],
      }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { artifacts: [{
        id: 'book_studio:cover_pdf:book-1:0', studioKind: 'book_studio', resourceType: 'cover_pdf', resourceId: 'book-1:cover_pdf:0',
        title: 'Current cover', artifactKind: 'document', state: 'ready', statusLabel: 'Generated', href: '/book', actions: [],
      }] } }), { status: 200 }))

    render(<MessageBubble currentUserUid="user-1" message={{
      id: 'child-artifacts', conversationId: 'conv-1', role: 'assistant', content: '', authorKind: 'agent',
      authorId: 'pip', authorDisplayName: 'Pip', status: 'completed', richParts: [{
        type: 'studio_artifact_bundle', artifacts: [
          { id: 'video_editor:render:render-1', contextId: 'video_editor:project:project-1', title: 'Stale render' },
          { id: 'book_studio:cover_pdf:book-1:0', contextId: 'book_studio:project:book-1', title: 'Stale cover' },
        ],
      }],
    }} />)

    expect(await screen.findByText('Current render')).toBeInTheDocument()
    expect(await screen.findByText('Current cover')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chat-context/studio_artifact/video_editor%3Aproject%3Aproject-1?artifactId=video_editor%3Arender%3Arender-1')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chat-context/studio_artifact/book_studio%3Aproject%3Abook-1?artifactId=book_studio%3Acover_pdf%3Abook-1%3A0')
    fetchMock.mockRestore()
  })

  it('renders trailing rich_parts JSON as an approval card and keeps prose', () => {
    const prose = 'Bark sequence is ready. Human approval is required before any outbound communication.'
    const envelope = {
      rich_parts: [{
        type: 'approval_card',
        title: 'Approve Isaac follow-up sequence',
        body: 'Five-step sequence is ready.',
        statusLabel: 'Needs approval before sending',
        evidence: ['CRM contact created'],
        decisions: [{ label: 'Approve activation', required: true }],
        recommendation: 'Confirm consent first.',
      }],
    }
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-mixed-rich',
          conversationId: 'conv-1',
          role: 'assistant',
          content: `${prose}\n\n${JSON.stringify(envelope)}`,
          authorKind: 'agent',
          authorId: 'silas',
          authorDisplayName: 'Silas',
          status: 'completed',
        }}
      />,
    )

    expect(screen.getByText(/Bark sequence is ready/i)).toBeInTheDocument()
    expect(screen.getByText('Approve Isaac follow-up sequence')).toBeInTheDocument()
    expect(screen.getByText('Needs approval before sending')).toBeInTheDocument()
    expect(screen.queryByText(/"rich_parts"/)).not.toBeInTheDocument()
  })

  it('renders unsupported content when a canvas part fails validation', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-bad-chart',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Chart follows.',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'completed',
          richParts: [{ type: 'chart', data: [{ y: 1 }], series: [{ key: 'y' }] }],
        }}
      />,
    )
    expect(screen.getByText('Unsupported content')).toBeInTheDocument()
  })

  it('uses Paper-safe danger styles on a failed agent bubble', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-failed',
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'The agent hit a temporary computer/gateway interruption. Partners in Biz is retrying automatically — leave this chat open.',
          authorKind: 'agent',
          authorId: 'blake',
          authorDisplayName: 'Blake',
          status: 'failed',
          error: 'gateway_draining',
        }}
      />,
    )
    const bubble = screen.getByText(/computer dropped this run/i)
    expect(bubble).toHaveClass('pib-chat-danger-banner')
    expect(bubble.className).not.toMatch(/(?:text|bg|border)-red-/)
    expect(screen.queryByText(/retrying automatically/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/leave this chat open/i)).not.toBeInTheDocument()
  })

  it('humanizes a stored legacy recovery essay even when no error code is attached', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-failed-legacy',
          conversationId: 'conv-1',
          role: 'assistant',
          content: CONVERSATION_RUN_RECOVERING_LEGACY_USER_ERROR,
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'failed',
        }}
      />,
    )
    expect(screen.getByText(CONVERSATION_RUN_RECOVERING_USER_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(/gateway interruption/i)).not.toBeInTheDocument()
  })

  it('names the offline computer instead of a recovering banner when Local Hermes is unreachable', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-failed-mac-offline',
          conversationId: 'conv-1',
          role: 'assistant',
          content: CONVERSATION_RUN_RECOVERING_LEGACY_USER_ERROR,
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'failed',
          error: 'Agent run could not be started on the gateway. (GET https://hermes-api.partnersinbiz.online/local-profiles/pip/v1/health → 502)',
          dispatchRuntimeKind: 'linked-computer',
          dispatchRuntimeLabel: 'peets-mac-mini',
        }}
      />,
    )
    const bubble = screen.getByText('peets-mac-mini offline — Local Hermes unreachable. Send the message again once it reconnects.')
    expect(bubble).toHaveClass('pib-chat-danger-banner')
    expect(bubble.className).not.toMatch(/(?:text|bg|border)-red-/)
    expect(screen.queryByText(CONVERSATION_RUN_RECOVERING_USER_ERROR)).not.toBeInTheDocument()
    expect(screen.queryByText(/retrying automatically|leave this chat open/i)).not.toBeInTheDocument()
  })

  it('humanizes a raw gateway failure stored only on message.error', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-failed-raw',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'failed',
          error: 'ClientConnectorError: Connection refused',
        }}
      />,
    )
    expect(screen.getByText(CONVERSATION_RUN_RECOVERING_USER_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(/connection refused/i)).not.toBeInTheDocument()
  })

  it('does not surface a live-stream fallback as a status lecture', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        liveEvents={[
          {
            event: 'stream.unavailable',
            activity: 'Live event stream unavailable; final response polling will continue.',
            timestamp: Date.now() / 1000,
          },
        ]}
        message={{
          id: 'msg-stream',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'pending',
          runId: 'run-stream',
        }}
      />,
    )
    expect(screen.queryByText(/Live event stream unavailable/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/final response polling will continue/i)).not.toBeInTheDocument()
  })

  it('renders a durable linked-computer queue with elapsed state and Stop', () => {
    const stop = jest.fn()
    render(
      <MessageBubble
        currentUserUid="user-1"
        onStopRun={stop}
        message={{
          id: 'msg-queued',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'queued',
          queuedReason: 'gateway_draining',
          runId: 'linked-run-1',
          dispatchRuntimeLabel: "Peet's Mac",
          createdAt: { seconds: Math.floor(Date.now() / 1000) - 12 },
        }}
      />,
    )

    expect(screen.getByText("Queued on Peet's Mac")).toBeInTheDocument()
    expect(screen.getByText(/gateway is draining/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Stop/i }))
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('does not call a newly accepted linked run a capacity queue', () => {
    render(
      <MessageBubble
        currentUserUid="user-1"
        message={{
          id: 'msg-starting',
          conversationId: 'conv-1',
          role: 'assistant',
          content: '',
          authorKind: 'agent',
          authorId: 'pip',
          authorDisplayName: 'Pip',
          status: 'queued',
          runId: 'linked-run-2',
          dispatchRuntimeLabel: "Peet's Mac",
        }}
      />,
    )

    expect(screen.getByText(/waiting for the linked computer to start it automatically/i)).toBeInTheDocument()
    expect(screen.getByText('Waiting for the linked computer to start…')).toBeInTheDocument()
    expect(screen.queryByText(/capacity is available/i)).not.toBeInTheDocument()
  })

})
