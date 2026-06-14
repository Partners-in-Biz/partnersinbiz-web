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

    expect(workspace.primaryAction?.href).toBe('/admin/org/lumen-speeds/social/standalone')
    expect(hrefs.get('Compose')).toBe('/admin/org/lumen-speeds/social/standalone')
    expect(hrefs.get('Calendar')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('History')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Queue')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Accounts')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Links')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Email')).toBe('/admin/org/lumen-speeds/messages')
    expect(hrefs.get('Email analytics')).toBe('/admin/org/lumen-speeds/messages')
    expect(hrefs.get('Sequences')).toBe('/admin/org/lumen-speeds/capture-sources')
    expect(hrefs.get('Contacts')).toBe('/admin/org/lumen-speeds/capture-sources')

    const actions = workspace.sections.flatMap((section) => section.actions)
    expect(workspace.eyebrow).toBe('Internal operator surface')
    expect(workspace.description).toContain('admin routes')
    for (const action of actions) {
      expect(action.href).not.toContain('/portal/')
      expect(action.href).toMatch(/^\/admin\/org\/lumen-speeds\//)
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
