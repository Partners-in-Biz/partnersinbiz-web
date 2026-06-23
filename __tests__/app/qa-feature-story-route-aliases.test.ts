import nextConfig from '@/next.config'

function redirectMap() {
  const redirects = nextConfig.redirects
  if (typeof redirects !== 'function') throw new Error('redirects is not configured')
  return redirects()
}

async function findRedirect(source: string) {
  const redirects = await redirectMap()
  return redirects.find((redirect) => redirect.source === source)
}

describe('QA feature-story route aliases', () => {
  it('maps CRM namespace story routes to the implemented portal workspaces', async () => {
    await expect(findRedirect('/portal/crm/contacts')).resolves.toMatchObject({
      destination: '/portal/contacts',
    })
    await expect(findRedirect('/portal/crm/contacts/:path*')).resolves.toMatchObject({
      destination: '/portal/contacts/:path*',
    })
    await expect(findRedirect('/portal/crm/capture-sources')).resolves.toMatchObject({
      destination: '/portal/capture-sources',
    })
    await expect(findRedirect('/portal/crm/capture-sources/:path*')).resolves.toMatchObject({
      destination: '/portal/capture-sources/:path*',
    })
    await expect(findRedirect('/portal/crm/pipeline')).resolves.toMatchObject({
      destination: '/portal/deals',
    })
    await expect(findRedirect('/portal/crm/pipeline/:path*')).resolves.toMatchObject({
      destination: '/portal/deals/:path*',
    })
  })

  it('checks the specific new-organisation alias before the dynamic organisation alias', async () => {
    const redirects = await redirectMap()
    const newAlias = redirects.findIndex((redirect) => redirect.source === '/admin/organisations/new')
    const dynamicAlias = redirects.findIndex((redirect) => redirect.source === '/admin/organisations/:orgId')

    expect(newAlias).toBeGreaterThanOrEqual(0)
    expect(dynamicAlias).toBeGreaterThanOrEqual(0)
    expect(newAlias).toBeLessThan(dynamicAlias)
    expect(redirects[newAlias]).toMatchObject({
      destination: '/admin/organizations/new',
    })
  })
})
