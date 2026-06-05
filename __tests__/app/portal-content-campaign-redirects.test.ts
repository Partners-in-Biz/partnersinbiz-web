const mockRedirect = jest.fn((url: string) => {
  throw new Error(`redirect:${url}`)
})

jest.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))

async function expectRedirect(action: () => unknown, expected: string) {
  try {
    await action()
  } catch (error) {
    expect(error).toEqual(new Error(`redirect:${expected}`))
    return
  }
  throw new Error('Expected route to redirect')
}

describe('portal legacy content campaign redirects', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('preserves linked company workspace scope on the legacy list redirect', async () => {
    const { default: LegacyContentCampaignsRedirect } = await import('@/app/(portal)/portal/content-campaigns/page')

    await expectRedirect(
      () => LegacyContentCampaignsRedirect({
        searchParams: Promise.resolve({
          orgId: 'lumen-org',
          orgSlug: 'lumen-speeds',
          sourceCompanyId: 'company-1',
          sourceCompanyName: 'Lumen',
        }),
      }),
      '/portal/campaigns?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
  })

  it('preserves linked company workspace scope on the legacy detail redirect', async () => {
    const { default: LegacyContentCampaignRedirect } = await import('@/app/(portal)/portal/content-campaigns/[id]/page')

    await expectRedirect(
      () => LegacyContentCampaignRedirect({
        params: Promise.resolve({ id: 'campaign-1' }),
        searchParams: Promise.resolve({
          orgId: 'lumen-org',
          orgSlug: 'lumen-speeds',
          sourceCompanyId: 'company-1',
          sourceCompanyName: 'Lumen',
        }),
      }),
      '/portal/campaigns/campaign-1?orgId=lumen-org&orgSlug=lumen-speeds&sourceCompanyId=company-1&sourceCompanyName=Lumen',
    )
  })
})
