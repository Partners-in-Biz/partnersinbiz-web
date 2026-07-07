import { render, waitFor } from '@testing-library/react'
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
    jest.clearAllMocks()
    mockHistoryProps = null
    mockSearchParams = new URLSearchParams({
      orgId: 'lumen-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: async () => ({ org: { id: 'pib-platform-owner' } }),
    } as Response)) as jest.Mock
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

  it('resolves the active portal org before building history API paths when only orgSlug is present', async () => {
    mockSearchParams = new URLSearchParams({
      orgSlug: 'partners-in-biz',
    })

    render(<PortalPostHistory />)

    expect(mockHistoryProps).toBeNull()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/portal/org')
      expect(mockHistoryProps).toEqual(expect.objectContaining({
        limit: 200,
        showPlatformFilter: true,
      }))
    })

    const buildApiPath = mockHistoryProps?.buildApiPath as ((path: string) => string) | undefined
    expect(buildApiPath?.('/api/v1/social/posts?limit=200')).toBe('/api/v1/social/posts?limit=200&orgId=pib-platform-owner')
  })
})
