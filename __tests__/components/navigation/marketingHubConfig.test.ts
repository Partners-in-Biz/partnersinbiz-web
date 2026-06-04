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
    expect(hrefs.get('Social overview')).toBe('/admin/org/lumen-speeds/social')
    expect(hrefs.get('Capture sources')).toBe('/admin/org/lumen-speeds/capture-sources')
    expect(hrefs.get('Email domains')).toBe('/admin/org/lumen-speeds/email-domains')
    expect(hrefs.get('Integrations')).toBe('/admin/org/lumen-speeds/integrations')
  })
})
