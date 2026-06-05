import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CockpitClient } from '@/app/(portal)/portal/campaigns/[id]/cockpit-client'

const refresh = jest.fn()
const replace = jest.fn()
let searchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace }),
  useSearchParams: () => searchParams,
}))

describe('Portal campaign cockpit client', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    searchParams = new URLSearchParams()
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/campaigns/campaign-1/approve-all' && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
      }
      if (url === '/api/v1/campaigns/campaign-1/assets') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              blogs: [],
              videos: [],
              social: [],
              meta: { byStatus: { pending_approval: 0 } },
            },
          }),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    }) as jest.Mock
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('uses an in-page confirmation and durable feedback when approving all campaign assets', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false)
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)

    render(
      <CockpitClient
        campaignId="campaign-1"
        campaign={{
          description: 'June campaign for high-value leads',
          research: { taglines: { master: 'Make every lead count' } },
        }}
        assets={{
          blogs: [],
          videos: [],
          social: [],
          meta: { byStatus: { pending_approval: 3 } },
        }}
        brand={undefined}
        orgName="Acme Growth"
        monthLabel="June 2026"
        shareEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve all awaiting assets (3)' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Approve 3 campaign assets?' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'This approves every pending asset in the campaign preview and moves the work out of client review for publishing.',
      ),
    ).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve 3 campaign assets' }))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/v1/campaigns/campaign-1/approve-all', { method: 'POST' })
    })
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('All campaign assets are approved and ready for publishing.')
    })
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog', { name: 'Approve 3 campaign assets?' })).not.toBeInTheDocument()

    confirmSpy.mockRestore()
    alertSpy.mockRestore()
  })

  it('preserves CRM company scope on cockpit back and tab links', () => {
    searchParams = new URLSearchParams('orgId=lumen-org&orgSlug=lumen-speeds')

    render(
      <CockpitClient
        campaignId="campaign-1"
        campaign={{
          description: 'June campaign for high-value leads',
          research: { taglines: { master: 'Make every lead count' } },
        }}
        assets={{
          blogs: [
            {
              id: 'blog-1',
              title: 'Lumen launch blog',
              status: 'review',
              draft: { body: 'Draft body', wordCount: 220 },
            },
          ],
          videos: [],
          social: [],
          meta: { byStatus: { pending_approval: 0 } },
        }}
        brand={undefined}
        orgName="Lumen"
        monthLabel="June 2026"
        shareEnabled={false}
      />,
    )

    expect(screen.getByRole('link', { name: /Campaigns/i })).toHaveAttribute(
      'href',
      '/portal/campaigns?orgId=lumen-org&orgSlug=lumen-speeds',
    )

    fireEvent.click(screen.getByRole('tab', { name: /Blog Posts/ }))

    expect(replace).toHaveBeenCalledTimes(1)
    const tabUrl = new URL(replace.mock.calls[0][0], 'https://partnersinbiz.test')
    expect(tabUrl.pathname).toBe('/portal/campaigns/campaign-1')
    expect(tabUrl.searchParams.get('tab')).toBe('blogs')
    expect(tabUrl.searchParams.get('orgId')).toBe('lumen-org')
    expect(tabUrl.searchParams.get('orgSlug')).toBe('lumen-speeds')
  })

  it('exposes generic Social and Videos tabs as shared cockpit destinations', () => {
    render(
      <CockpitClient
        campaignId="campaign-1"
        campaign={{
          description: 'June campaign for high-value leads',
          research: { taglines: { master: 'Make every lead count' } },
        }}
        assets={{
          blogs: [],
          videos: [
            {
              id: 'video-1',
              title: 'Campaign overview video',
              status: 'review',
              platform: 'youtube',
              media: [{ type: 'video', urlYoutube: 'https://example.com/video.mp4' }],
            },
          ],
          social: [
            {
              id: 'social-1',
              status: 'review',
              platform: 'linkedin',
              content: 'Launch update',
              media: [],
            },
          ],
          meta: { byStatus: { pending_approval: 0 } },
        }}
        brand={undefined}
        orgName="Lumen"
        monthLabel="June 2026"
        shareEnabled={false}
      />,
    )

    fireEvent.click(screen.getByRole('tab', { name: /^Social\b/i }))
    expect(replace).toHaveBeenCalledTimes(1)
    let tabUrl = new URL(replace.mock.calls[0][0], 'https://partnersinbiz.test')
    expect(tabUrl.pathname).toBe('/portal/campaigns/campaign-1')
    expect(tabUrl.searchParams.get('tab')).toBe('social')

    replace.mockClear()

    fireEvent.click(screen.getByRole('tab', { name: /^Videos\b/i }))
    expect(replace).toHaveBeenCalledTimes(1)
    tabUrl = new URL(replace.mock.calls[0][0], 'https://partnersinbiz.test')
    expect(tabUrl.pathname).toBe('/portal/campaigns/campaign-1')
    expect(tabUrl.searchParams.get('tab')).toBe('videos')
  })

  it('preserves CRM company scope on cockpit blog deep links', () => {
    searchParams = new URLSearchParams('orgId=lumen-org&orgSlug=lumen-speeds&tab=blogs')

    render(
      <CockpitClient
        campaignId="campaign-1"
        campaign={{
          description: 'June campaign for high-value leads',
          research: { taglines: { master: 'Make every lead count' } },
        }}
        assets={{
          blogs: [
            {
              id: 'blog-1',
              title: 'Lumen launch blog',
              status: 'review',
              draft: { body: 'Draft body', wordCount: 220 },
            },
          ],
          videos: [],
          social: [],
          meta: { byStatus: { pending_approval: 0 } },
        }}
        brand={undefined}
        orgName="Lumen"
        monthLabel="June 2026"
        shareEnabled={false}
      />,
    )

    expect(screen.getByRole('link', { name: /Lumen launch blog/i })).toHaveAttribute(
      'href',
      '/portal/campaigns/campaign-1/blog/blog-1?orgId=lumen-org&orgSlug=lumen-speeds',
    )
  })
})
