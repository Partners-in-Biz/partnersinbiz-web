import { readFileSync } from 'node:fs'
import path from 'node:path'

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('portal marketing child scope standard', () => {
  it('keeps brand, capture, sender-domain, comms, and contact workspaces scoped from CRM company routes', () => {
    const branding = source('app/(portal)/portal/branding/page.tsx')
    const captureSources = source('app/(portal)/portal/capture-sources/page.tsx')
    const captureImport = source('app/(portal)/portal/capture-sources/import/page.tsx')
    const emailDomains = source('app/(portal)/portal/email-domains/page.tsx')
    const emailDomainsWorkspace = source('components/email-domains/EmailDomainsWorkspace.tsx')
    const emailAnalytics = source('app/(portal)/portal/email-analytics/page.tsx')
    const emailAnalyticsDashboard = source('components/email-analytics/EmailAnalyticsDashboard.tsx')
    const sequences = source('app/(portal)/portal/settings/sequences/page.tsx')
    const sequencesWorkspace = source('components/crm/SequencesWorkspace.tsx')
    const automations = source('app/(portal)/portal/settings/automations/page.tsx')
    const communications = source('app/(portal)/portal/communications/page.tsx')
    const contacts = source('app/(portal)/portal/contacts/page.tsx')
    const contactsWorkspace = source('components/crm/ContactsWorkspace.tsx')

    expect(branding).toContain('scopeFromSearchParams')
    expect(branding).toContain("scopedApiPath('/api/v1/portal/brand-profile'")
    expect(branding).toContain("scopedApiPath('/api/v1/portal/brand-profile/upload'")

    expect(captureSources).toContain('scopeFromSearchParams')
    expect(captureSources).toContain('orgId={orgScope.orgId ?? undefined}')
    expect(captureSources).toContain("scopedPortalPath('/portal/capture-sources/import'")
    expect(captureSources).toContain("scopedPortalPath('/portal/settings/sequences/new'")

    expect(captureImport).toContain('scopeFromSearchParams')
    expect(captureImport).toContain("scopedApiPath('/api/v1/crm/capture-sources'")
    expect(captureImport).toContain("scopedApiPath('/api/v1/crm/contacts/import'")
    expect(captureImport).toContain("scopedPortalPath('/portal/capture-sources'")

    expect(emailDomains).toContain('scopeFromSearchParams')
    expect(emailDomains).toContain('orgId={orgScope.orgId ?? undefined}')
    expect(emailDomainsWorkspace).toContain('domainEndpoint=')
    expect(emailDomainsWorkspace).toContain('fetch(domainEndpoint(domain.id)')

    expect(emailAnalytics).toContain('canUsePortalOrg')
    expect(emailAnalytics).toContain('searchParams')
    expect(emailAnalytics).toContain('@/components/email-analytics/EmailAnalyticsDashboard')
    expect(emailAnalytics).toContain('surface="portal"')
    expect(emailAnalytics).toContain("orgScope={{ orgId: user.orgId, orgSlug: params?.orgSlug }}")
    expect(emailAnalyticsDashboard).toContain('scopedApiPath')
    expect(emailAnalyticsDashboard).toContain('scopedPortalPath')

    expect(sequences).toContain('scopeFromSearchParams')
    expect(sequences).toContain('@/components/crm/SequencesWorkspace')
    expect(sequences).toContain('surface="portal"')
    expect(sequencesWorkspace).toContain("sequenceEndpoint('/api/v1/crm/sequences'")
    expect(sequencesWorkspace).toContain('sequenceHref(sequenceNewPath(surface))')

    expect(automations).toContain('scopeFromSearchParams')
    expect(automations).toContain("automationEndpoint('/api/v1/crm/automations'")
    expect(automations).toContain("automationHref('/portal/settings/automations/new'")

    expect(communications).toContain('scopeFromSearchParams')
    expect(communications).toContain('initialOrgId={orgScope.orgId ??')
    expect(communications).toContain('initialOrgSlug={orgScope.orgSlug ??')
    expect(communications).toContain('sourceCompanyId={orgScope.sourceCompanyId ??')
    expect(communications).toContain('sourceCompanyName={orgScope.sourceCompanyName ??')

    expect(contacts).toContain('scopeFromSearchParams')
    expect(contacts).toContain('orgScope={orgScope}')
    expect(contactsWorkspace).toContain('scopedApiPath')
    expect(contactsWorkspace).toContain('scopedPortalPath')
  })
})
