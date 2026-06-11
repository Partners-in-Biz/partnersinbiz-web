import { buildMarketingHubProps } from '@/components/navigation/marketingHubConfig'

function actionMap(sections: ReturnType<typeof buildMarketingHubProps>['sections']) {
  return new Map(sections.flatMap((section) => section.actions.map((action) => [action.label, action.href])))
}

describe('marketing hub config', () => {
  it('keeps portal and client workspace marketing hubs on the same section standard', () => {
    const portal = buildMarketingHubProps({ surface: 'portal' })
    const workspace = buildMarketingHubProps({ surface: 'admin-org', slug: 'lumen-speeds' })

    expect(portal.sections.map((section) => section.title)).toEqual([
      'Brand and campaigns',
      'Social media',
      'Email and capture',
      'Audience and setup',
    ])
    expect(workspace.sections.map((section) => section.title)).toEqual(
      portal.sections.map((section) => section.title),
    )
  })

  it('keeps client workspace marketing actions scoped to the selected organisation when org routes exist', () => {
    const workspace = buildMarketingHubProps({ surface: 'admin-org', slug: 'lumen-speeds' })
    const hrefs = actionMap(workspace.sections)

    expect(hrefs.get('Branding')).toBe('/admin/org/lumen-speeds/brand')
    expect(hrefs.get('Campaigns')).toBe('/admin/org/lumen-speeds/campaigns')
    expect(hrefs.get('Ads')).toBe('/admin/org/lumen-speeds/ads/campaigns')
    expect(hrefs.get('SEO')).toBe('/admin/org/lumen-speeds/seo')
    expect(hrefs.get('GEO SEO')).toBe('/admin/org/lumen-speeds/geo-seo')
    expect(hrefs.get('Social overview')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Capture sources')).toBe('/admin/org/lumen-speeds/capture-sources')
    expect(hrefs.get('Email domains')).toBe('/admin/org/lumen-speeds/email-domains')
    expect(hrefs.get('Integrations')).toBe('/admin/org/lumen-speeds/integrations')
  })

  it('carries the selected organisation into global admin marketing tools', () => {
    const workspace = buildMarketingHubProps({ surface: 'admin-org', slug: 'lumen-speeds' })
    const hrefs = actionMap(workspace.sections)

    expect(workspace.primaryAction?.href).toBe('/portal/social/compose?org=lumen-speeds')
    expect(hrefs.get('Compose')).toBe('/portal/social/compose?org=lumen-speeds')
    expect(hrefs.get('Calendar')).toBe('/portal/social/calendar?org=lumen-speeds')
    expect(hrefs.get('History')).toBe('/portal/social/history?org=lumen-speeds')
    expect(hrefs.get('Queue')).toBe('/portal/social/queue?org=lumen-speeds')
    expect(hrefs.get('Accounts')).toBe('/portal/social/accounts?org=lumen-speeds')
    expect(hrefs.get('Links')).toBe('/portal/social/links?org=lumen-speeds')
    expect(hrefs.get('Email')).toBe('/portal/email?org=lumen-speeds')
    expect(hrefs.get('Email analytics')).toBe('/portal/email-analytics?org=lumen-speeds')
    expect(hrefs.get('Sequences')).toBe('/portal/sequences?org=lumen-speeds')
    expect(hrefs.get('Contacts')).toBe('/portal/contacts?org=lumen-speeds')

    const actions = workspace.sections.flatMap((section) => section.actions)
    for (const action of actions) {
      expect(action.href).not.toBe('/portal/marketing')
      if (action.href.startsWith('/admin/') && !action.href.startsWith('/admin/org/lumen-speeds/')) {
        expect(action.href).toContain('?org=lumen-speeds')
      }
    }
  })

  it('keeps portal marketing hub actions scoped when opened from a CRM company workspace', () => {
    const portal = buildMarketingHubProps({
      surface: 'portal',
      orgId: 'client-org',
      orgSlug: 'lumen-speeds',
      sourceCompanyId: 'company-1',
      sourceCompanyName: 'Lumen',
    })
    const hrefs = actionMap(portal.sections)
    const sourceSuffix = '&sourceCompanyId=company-1&sourceCompanyName=Lumen'

    expect(portal.sourceContext).toEqual({ sourceCompanyName: 'Lumen', targetWorkspaceName: 'lumen-speeds' })
    expect(portal.primaryAction?.href).toBe(`/portal/social?orgId=client-org&orgSlug=lumen-speeds${sourceSuffix}`)
    expect(hrefs.get('Campaigns')).toBe(`/portal/campaigns?orgId=client-org&orgSlug=lumen-speeds${sourceSuffix}`)
    expect(hrefs.get('SEO')).toBe(`/portal/seo?orgId=client-org&orgSlug=lumen-speeds${sourceSuffix}`)
    expect(hrefs.get('GEO SEO')).toBe(`/portal/geo-seo?orgId=client-org&orgSlug=lumen-speeds${sourceSuffix}`)
    expect(hrefs.get('Capture sources')).toBe(`/portal/capture-sources?orgId=client-org&orgSlug=lumen-speeds${sourceSuffix}`)

    for (const href of hrefs.values()) {
      expect(href).toContain('orgId=client-org')
      expect(href).toContain('orgSlug=lumen-speeds')
      expect(href).toContain('sourceCompanyId=company-1')
      expect(href).toContain('sourceCompanyName=Lumen')
    }
  })
})
