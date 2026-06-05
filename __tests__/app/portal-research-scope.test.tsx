import React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'fs'
import path from 'path'
import PortalResearchPage from '@/app/(portal)/portal/research/page'

const root = process.cwd()
let mockSearchParams = new URLSearchParams()

function source(file: string) {
  return readFileSync(path.join(root, file), 'utf8')
}

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('PortalResearchPage company workspace scope', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/v1/portal/research?orgId=lumen-org') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: 'research-1',
                orgId: 'lumen-org',
                title: 'Lumen competitor scan',
                slug: 'lumen-competitor-scan',
                kind: 'competitor',
                status: 'verified',
                visibility: 'client_visible',
                summary: 'Competitor evidence for Lumen.',
                notesMarkdown: '',
                tags: [],
                linked: {},
                findings: [],
                recommendations: [],
                obsidian: { exported: false },
                createdBy: 'user-1',
                updatedBy: 'user-1',
                deleted: false,
                updatedAt: '2026-06-05T10:00:00.000Z',
              },
            ],
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)
    }) as jest.Mock
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('loads and links research within the CRM company organisation scope', async () => {
    await act(async () => {
      render(<PortalResearchPage />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(await screen.findByText('Lumen competitor scan')).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/research?orgId=lumen-org')
    })
    expect(screen.getByText('Lumen competitor scan').closest('a')).toHaveAttribute(
      'href',
      '/portal/research/research-1?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
  })

  it('keeps portal research detail APIs and back links scoped to the company workspace', () => {
    const route = source('app/(portal)/portal/research/[id]/page.tsx')
    const client = source('components/research/ResearchDetailClient.tsx')

    expect(route).toContain('searchParams')
    expect(route).toContain("scopedPortalPath('/portal/research'")
    expect(route).toContain('orgId={scope.orgId')
    expect(client).toContain('scopedApiPath')
    expect(client).toContain('portalApiPath(`/api/v1/portal/research/${id}`)')
    expect(client).toContain('portalApiPath(`/api/v1/portal/research/${id}/comments`)')
  })
})
