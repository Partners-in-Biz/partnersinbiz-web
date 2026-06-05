import { render, screen } from '@testing-library/react'
import PortalWikiPage from '@/app/(portal)/portal/wiki/page'

let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/components/knowledge/KnowledgeBrowser', () => ({
  KnowledgeBrowser: ({ apiPath, title }: { apiPath?: string; title: string }) => (
    <div data-testid="knowledge-browser" data-api-path={apiPath}>
      {title}
    </div>
  ),
}))

describe('PortalWikiPage company workspace scope', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
  })

  it('passes the CRM company organisation scope to the portal knowledge API', () => {
    render(<PortalWikiPage />)

    expect(screen.getByTestId('knowledge-browser')).toHaveAttribute(
      'data-api-path',
      '/api/v1/portal/knowledge?orgId=lumen-org',
    )
  })
})
