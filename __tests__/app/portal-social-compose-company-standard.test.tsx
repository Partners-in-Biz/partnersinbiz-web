import { render } from '@testing-library/react'
import PortalComposePage from '@/app/(portal)/portal/social/compose/page'

let mockSearchParams = new URLSearchParams()
let mockComposerProps: Record<string, unknown> | null = null

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/components/social/SocialPostComposer', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockComposerProps = props
    return null
  },
}))

describe('PortalSocialComposePage company workspace standard', () => {
  beforeEach(() => {
    mockComposerProps = null
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
      scheduledAt: '2026-06-15T10:30',
    })
  })

  it('uses the shared admin-grade composer capabilities while preserving company scope', () => {
    render(<PortalComposePage />)

    expect(mockComposerProps).toEqual(expect.objectContaining({
      orgId: 'lumen-org',
      accountsHref:
        '/portal/social/accounts?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
      afterSaveHref:
        '/portal/social?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
      afterPublishHref:
        '/portal/social/history?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
      advanced: true,
      queryPrefill: true,
      accountFilter: 'connected',
      previewMode: 'toggle',
    }))
  })
})
