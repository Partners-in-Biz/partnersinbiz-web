import { act, render, screen } from '@testing-library/react'

import PortalDocumentDetail from '@/app/(portal)/portal/documents/[id]/page'
import { clientDocumentApiPath } from '@/lib/portal/scoped-routing'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: { uid: string; email: string } | null) => void) => {
    cb({ uid: 'user-1', email: 'peet@example.com' })
    return jest.fn()
  },
}))

jest.mock('@/lib/firebase/client', () => ({
  auth: {},
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

jest.mock('@/components/client-documents/DocumentPresence', () => ({
  DocumentPresence: () => <div>Presence rendered</div>,
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
      if (url === '/api/v1/client-documents/doc-lumen/access-log') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { events: [] } }),
        } as Response)
      }
      if (url === '/api/v1/portal/org?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: { id: 'lumen-org', name: 'Lumen Speeds', modulePolicies: {} },
            user: { role: 'client', memberRole: 'member' },
          }),
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

  it('hides document approval when the active organisation policy denies member review approval', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
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
              approvalMode: 'operational',
              linked: {},
              clientPermissions: {
                canComment: false,
                canApprove: true,
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
      if (url === '/api/v1/client-documents/doc-lumen/access-log') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { events: [] } }),
        } as Response)
      }
      if (url === '/api/v1/portal/org?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: {
              id: 'lumen-org',
              name: 'Lumen Speeds',
              modulePolicies: {
                documents: {
                  actions: {
                    reviewApproval: { owner: true, admin: true, member: false },
                  },
                },
              },
            },
            user: { role: 'client', memberRole: 'member' },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    await act(async () => {
      render(<PortalDocumentDetail params={Promise.resolve({ id: 'doc-lumen' })} />)
    })

    expect(await screen.findByText('Document rendered')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Approve Document/i })).not.toBeInTheDocument()
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

  it('treats a 403 document GET as not-found instead of flattening the error payload', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'client-org',
      orgSlug: 'saaiman-stays',
    })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/v1/client-documents/doc-pib')) {
        return Promise.resolve({
          ok: false,
          status: 403,
          json: async () => ({ error: 'Document grant does not permit this action' }),
        } as Response)
      }
      if (url === '/api/v1/portal/org?orgId=client-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: { id: 'client-org', name: 'Saaiman Stays', modulePolicies: {} },
            user: { role: 'client', memberRole: 'member' },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    await act(async () => {
      render(<PortalDocumentDetail params={Promise.resolve({ id: 'doc-pib' })} />)
    })

    expect(await screen.findByText('Document not found.')).toBeInTheDocument()
    expect(screen.queryByText('Document rendered')).not.toBeInTheDocument()
  })

  it('renders a pib-platform-owner document linked to the active client org', async () => {
    mockSearchParams = new URLSearchParams({
      orgId: 'client-org',
      orgSlug: 'saaiman-stays',
    })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/client-documents/doc-pib?orgId=client-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              id: 'doc-pib',
              orgId: 'pib-platform-owner',
              title: 'Saaiman proposal',
              type: 'sales_proposal',
              status: 'client_review',
              currentVersionId: 'version-1',
              approvalMode: 'none',
              linked: { clientOrgId: 'client-org' },
              clientPermissions: {
                canComment: false,
                canApprove: true,
              },
            },
          }),
        } as Response)
      }
      if (url === '/api/v1/client-documents/doc-pib/versions?orgId=client-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [{ id: 'version-1', documentId: 'doc-pib', status: 'published', blocks: [] }],
          }),
        } as Response)
      }
      if (url === '/api/v1/client-documents/doc-pib/comments?orgId=client-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        } as Response)
      }
      if (url === '/api/v1/client-documents/doc-pib/access-log?orgId=client-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { events: [] } }),
        } as Response)
      }
      if (url === '/api/v1/portal/org?orgId=client-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            org: { id: 'client-org', name: 'Saaiman Stays', modulePolicies: {} },
            user: { role: 'client', memberRole: 'member' },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock

    await act(async () => {
      render(<PortalDocumentDetail params={Promise.resolve({ id: 'doc-pib' })} />)
    })

    expect(await screen.findByText('Document rendered')).toBeInTheDocument()
    expect(screen.queryByText('Document not found.')).not.toBeInTheDocument()
  })
})

describe('clientDocumentApiPath', () => {
  it('never attaches a workspace orgId to document resource URLs', () => {
    expect(clientDocumentApiPath('68lOER4Q2lF12yqBP3rx')).toBe(
      '/api/v1/client-documents/68lOER4Q2lF12yqBP3rx',
    )
    expect(clientDocumentApiPath('68lOER4Q2lF12yqBP3rx', '/versions')).toBe(
      '/api/v1/client-documents/68lOER4Q2lF12yqBP3rx/versions',
    )
  })
})
