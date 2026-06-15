import { buildMarketingHubProps } from '@/components/navigation/marketingHubConfig'

function actionMap(sections: ReturnType<typeof buildMarketingHubProps>['sections']) {
  return new Map(sections.flatMap((section) => section.actions.map((action) => [action.label, action.href])))
}

describe('marketing hub config', () => {
  it('keeps portal marketing client-facing and selected-org admin marketing governance-focused', () => {
    const portal = buildMarketingHubProps({ surface: 'portal' })
    const workspace = buildMarketingHubProps({ surface: 'admin-org', slug: 'lumen-speeds' })

    expect(portal.sections.map((section) => section.title)).toEqual([
      'Brand and campaigns',
      'Social media',
      'Email and capture',
      'Audience and setup',
    ])
    expect(workspace.title).toBe('Marketing governance')
    expect(workspace.eyebrow).toBe('Workspace / Marketing')
    expect(workspace.description).toContain('Control which marketing modules')
    expect(workspace.sections.map((section) => section.title)).toEqual([
      'Module access and creation rights',
      'Social publishing controls',
      'Email and capture controls',
      'Audience and systems controls',
    ])
  })

  it('keeps selected-org marketing governance actions scoped to the selected organisation when child routes exist', () => {
    const workspace = buildMarketingHubProps({ surface: 'admin-org', slug: 'lumen-speeds' })
    const hrefs = actionMap(workspace.sections)

    expect(hrefs.get('Brand governance')).toBe('/admin/org/lumen-speeds/brand')
    expect(hrefs.get('Campaign permissions')).toBe('/admin/org/lumen-speeds/campaigns')
    expect(hrefs.get('Paid media permissions')).toBe('/admin/org/lumen-speeds/ads/campaigns')
    expect(hrefs.get('SEO permissions')).toBe('/admin/org/lumen-speeds/seo')
    expect(hrefs.get('GEO SEO permissions')).toBe('/admin/org/lumen-speeds/geo-seo')
    expect(hrefs.get('Social visibility')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Capture source access')).toBe('/admin/org/lumen-speeds/capture-sources')
    expect(hrefs.get('Sender-domain control')).toBe('/admin/org/lumen-speeds/email-domains')
    expect(hrefs.get('Marketing integrations')).toBe('/admin/org/lumen-speeds/integrations')
  })

  it('carries the selected organisation into global admin marketing tools', () => {
    const workspace = buildMarketingHubProps({ surface: 'admin-org', slug: 'lumen-speeds' })
    const hrefs = actionMap(workspace.sections)

    expect(workspace.primaryAction?.href).toBe('/admin/org/lumen-speeds/settings')
    expect(hrefs.get('Post creation')).toBe('/admin/org/lumen-speeds/social/standalone')
    expect(hrefs.get('Scheduling rules')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('History and archive')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Approval queues')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Account connections')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Profile links')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Email permissions')).toBe('/admin/org/lumen-speeds/messages')
    expect(hrefs.get('Email analytics access')).toBe('/admin/org/lumen-speeds/messages')
    expect(hrefs.get('Sequence rules')).toBe('/admin/org/lumen-speeds/capture-sources')
    expect(hrefs.get('Audience access')).toBe('/admin/org/lumen-speeds/capture-sources')

    const actions = workspace.sections.flatMap((section) => section.actions)
    expect(workspace.eyebrow).toBe('Workspace / Marketing')
    expect(workspace.description).toContain('child workspaces')
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
