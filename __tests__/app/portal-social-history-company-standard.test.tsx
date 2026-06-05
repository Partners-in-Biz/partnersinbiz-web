import { render } from '@testing-library/react'
import PortalPostHistory from '@/app/(portal)/portal/social/history/page'

let mockSearchParams = new URLSearchParams()
let mockHistoryProps: Record<string, unknown> | null = null

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}))

jest.mock('@/components/social/SocialHistoryWorkspace', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockHistoryProps = props
    return null
  },
}))

describe('PortalPostHistory company workspace standard', () => {
  beforeEach(() => {
    mockHistoryProps = null
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
  })

  it('exposes shared history filtering while preserving company scoped API paths', () => {
    render(<PortalPostHistory />)

    expect(mockHistoryProps).toEqual(expect.objectContaining({
      limit: 200,
      showPlatformFilter: true,
      statusOptions: ['all', 'published', 'scheduled', 'draft', 'failed', 'cancelled'],
    }))

    const buildApiPath = mockHistoryProps?.buildApiPath as ((path: string) => string) | undefined
    expect(buildApiPath?.('/api/v1/social/posts?limit=200')).toBe('/api/v1/social/posts?limit=200&orgId=lumen-org')
  })
})
