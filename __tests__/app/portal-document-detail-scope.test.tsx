import { act, render, screen } from '@testing-library/react'

import PortalDocumentDetail from '@/app/(portal)/portal/documents/[id]/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('next/link', () => {
  return function MockLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
    return <a href={href} className={className}>{children}</a>
  }
})

jest.mock('@/components/client-documents/DocumentRenderer', () => ({
  DocumentRenderer: () => <div>Document rendered</div>,
}))

jest.mock('@/components/client-documents/DocumentReviewRail', () => ({
  DocumentReviewRail: () => <aside>Review rail rendered</aside>,
}))

jest.mock('@/components/inline-comments/CommentComposer', () => ({
  CommentComposer: () => <div>Comment composer rendered</div>,
}))

describe('portal document detail scoped routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
  })

  it('keeps the back link scoped when opened from a CRM company workspace', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/client-documents/doc-lumen') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              id: 'doc-lumen',
              orgId: 'lumen-org',
              title: 'Lumen proposal',
              type: 'sales_proposal',
              status: 'client_review',
              currentVersionId: 'version-1',
              approvalMode: 'none',
              linked: {},
              clientPermissions: {
                canComment: false,
                canApprove: false,
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/client-documents/doc-lumen/versions') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [{ id: 'version-1', documentId: 'doc-lumen', status: 'published', blocks: [] }],
          }),
        } as Response)
      }
      if (url === '/api/v1/client-documents/doc-lumen/comments') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    await act(async () => {
      render(<PortalDocumentDetail params={Promise.resolve({ id: 'doc-lumen' })} />)
    })

    expect(await screen.findByText('Document rendered')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Documents' })).toHaveAttribute(
      'href',
      '/portal/documents?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(screen.queryByRole('link', { name: 'arrow_back Back to Documents' })).not.toBeInTheDocument()
  })

  it('keeps the not-found document handoff scoped with a clean command name', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    global.fetch = jest.fn(() => Promise.reject(new Error('not found'))) as jest.Mock

    await act(async () => {
      render(<PortalDocumentDetail params={Promise.resolve({ id: 'missing-doc' })} />)
    })

    expect(await screen.findByText('Document not found.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Documents' })).toHaveAttribute(
      'href',
      '/portal/documents?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
    expect(screen.queryByRole('link', { name: 'arrow_back Back to Documents' })).not.toBeInTheDocument()
  })
})
