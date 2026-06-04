import { readFileSync } from 'fs'
import path from 'path'

function routeSource(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('integrations route shared workspace standard', () => {
  it('keeps portal and admin org integration routes on the shared workspace surface', () => {
    const adminSource = routeSource('app/(admin)/admin/org/[slug]/integrations/page.tsx')
    const portalSource = routeSource('app/(portal)/portal/integrations/page.tsx')

    expect(adminSource).toContain('@/components/integrations/IntegrationsWorkspace')
    expect(portalSource).toContain('@/components/integrations/IntegrationsWorkspace')
    expect(adminSource).not.toContain('function ProviderTile')
    expect(portalSource).not.toContain('function ProviderTile')
    expect(adminSource).not.toContain('function IntegrationCard')
    expect(portalSource).not.toContain('function IntegrationCard')
    expect(adminSource).not.toContain('confirm(')
    expect(portalSource).not.toContain('confirm(')
  })
})
