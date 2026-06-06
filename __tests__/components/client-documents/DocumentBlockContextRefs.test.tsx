import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocumentBlock } from '@/lib/client-documents/types'
import type { ContextReference } from '@/lib/context-references/types'
import { DocumentBlockEditor } from '@/components/client-documents/DocumentBlockEditor'
import { DocumentRenderer } from '@/components/client-documents/DocumentRenderer'

jest.mock('@/components/client-documents/blocks', () => ({
  getEditor: () => ({ block }: { block: DocumentBlock }) => <div>Editing {block.title}</div>,
  getRenderer: () => ({ block }: { block: DocumentBlock }) => (
    <section id={`block-${block.id}`} data-testid={`block-${block.id}`}>
      <h2>{block.title}</h2>
      <p>{String(block.content)}</p>
    </section>
  ),
}))

jest.mock('@/components/client-documents/motion/useReveal', () => ({ useReveal: jest.fn() }))
jest.mock('@/components/client-documents/motion/useCounter', () => ({ useCounter: jest.fn() }))
jest.mock('@/components/inline-comments/SelectionPopover', () => ({ SelectionPopover: () => null }))
jest.mock('@/lib/client-documents/inlineMarkers', () => ({
  applyInlineMarkers: jest.fn(),
  clearInlineMarkers: jest.fn(),
  findBlockIdForNode: jest.fn(() => null),
}))

const crmRef: ContextReference = {
  type: 'company',
  id: 'company-1',
  orgId: 'org-1',
  label: 'Acme CRM',
  origin: 'manual',
}

const baseBlock: DocumentBlock = {
  id: 'summary',
  type: 'summary',
  title: 'Summary',
  content: 'Client-safe copy',
  required: true,
  display: {},
}

beforeAll(() => {
  class MockIntersectionObserver {
    observe = jest.fn()
    disconnect = jest.fn()
    unobserve = jest.fn()
    takeRecords = jest.fn(() => [])
  }

  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: MockIntersectionObserver,
  })
  Object.defineProperty(global, 'IntersectionObserver', {
    writable: true,
    configurable: true,
    value: MockIntersectionObserver,
  })
})

const document = {
  id: 'doc-1',
  orgId: 'org-1',
  title: 'Proposal',
  type: 'sales_proposal',
  templateId: 'sales_proposal',
  status: 'internal_draft',
  linked: {},
  currentVersionId: 'version-1',
  approvalMode: 'operational',
  clientPermissions: { canComment: true, canSuggest: true, canDirectEdit: false, canApprove: true },
  assumptions: [],
  shareToken: '',
  shareEnabled: false,
  editShareEnabled: false,
  createdBy: 'user-1',
  createdByType: 'user',
  updatedBy: 'user-1',
  updatedByType: 'user',
  deleted: false,
} as const

function version(blocks: DocumentBlock[]) {
  return {
    id: 'version-1',
    documentId: 'doc-1',
    versionNumber: 1,
    status: 'draft' as const,
    blocks,
    theme: { palette: { bg: '#000', text: '#fff', accent: '#f5a623' }, typography: { heading: 'Inter', body: 'Inter' } },
    createdBy: 'user-1',
    createdByType: 'user' as const,
  }
}

describe('document block context refs', () => {
  it('lets the admin block toolbar attach CRM context to a block', async () => {
    const onChange = jest.fn()
    global.fetch = jest.fn().mockResolvedValue({
      json: async () => ({ data: { refs: [crmRef] } }),
    }) as jest.Mock

    render(<DocumentBlockEditor block={baseBlock} onChange={onChange} orgId="org-1" />)

    fireEvent.change(screen.getByLabelText('Link CRM context to Summary'), { target: { value: '@companies:acme' } })
    await screen.findByRole('button', { name: 'Attach Acme CRM' })
    fireEvent.click(screen.getByRole('button', { name: 'Attach Acme CRM' }))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ contextRefs: [crmRef] }))
    })
  })

  it('shows internal context chips only in internal preview mode and never injects @company copy', () => {
    const block = { ...baseBlock, contextRefs: [crmRef] }

    const { rerender, queryByText } = render(
      <DocumentRenderer document={document} version={version([block])} showInternalContextRefs />,
    )

    expect(screen.getByText('Acme CRM')).toBeInTheDocument()
    expect(queryByText('@company Acme CRM')).not.toBeInTheDocument()

    rerender(<DocumentRenderer document={document} version={version([block])} />)

    expect(screen.queryByText('Acme CRM')).not.toBeInTheDocument()
  })

  it('hides hidden and internal-only blocks from client rendering', () => {
    render(
      <DocumentRenderer
        document={document}
        version={version([
          { ...baseBlock, id: 'visible', title: 'Visible', content: 'Visible content', visibility: 'client-visible' },
          { ...baseBlock, id: 'internal', title: 'Internal', content: 'Internal only', visibility: 'internal-only' },
          { ...baseBlock, id: 'hidden', title: 'Hidden', content: 'Hidden copy', visibility: 'hidden' },
        ])}
      />,
    )

    expect(screen.getByText('Visible content')).toBeInTheDocument()
    expect(screen.queryByText('Internal only')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden copy')).not.toBeInTheDocument()
  })
})
