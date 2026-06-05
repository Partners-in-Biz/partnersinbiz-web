import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('projects shared workspace standard', () => {
  it('keeps admin org and portal projects routes as adapters around the shared workspace', () => {
    const adminRoute = read('app/(admin)/admin/org/[slug]/projects/page.tsx')
    const portalRoute = read('app/(portal)/portal/projects/page.tsx')

    expect(adminRoute).toContain("import { ProjectsWorkspace } from '@/components/projects/ProjectsWorkspace'")
    expect(adminRoute).toContain('<ProjectsWorkspace')
    expect(adminRoute).toContain('mode="admin"')
    expect(adminRoute).toContain('orgSlug={slug}')

    expect(portalRoute).toContain("import { ProjectsWorkspace } from '@/components/projects/ProjectsWorkspace'")
    expect(portalRoute).toContain("import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'")
    expect(portalRoute).toContain('<ProjectsWorkspace')
    expect(portalRoute).toContain('mode="portal"')
    expect(portalRoute).toContain('orgScope={orgScope}')
  })

  it('prevents project list routes from reintroducing duplicate local workspace logic', () => {
    const routes = [
      read('app/(admin)/admin/org/[slug]/projects/page.tsx'),
      read('app/(portal)/portal/projects/page.tsx'),
    ]

    for (const route of routes) {
      expect(route).not.toContain('function receivedProjectsUrl')
      expect(route).not.toContain('function projectReportingUrl')
      expect(route).not.toContain('function mergeLiveTasks')
      expect(route).not.toContain('const PROJECT_STAGE_TABS')
      expect(route).not.toContain('handleCreateProject')
      expect(route).not.toContain('CrossProjectBoard')
      expect(route).not.toContain('ProjectListCard')
      expect(route).not.toContain('ProjectPortfolioReportPanel')
    }
  })

  it('keeps portal company project scope in the shared workspace links and API paths', () => {
    const workspace = read('components/projects/ProjectsWorkspace.tsx')

    expect(workspace).toContain('scopedApiPath')
    expect(workspace).toContain('scopedPortalPath')
    expect(workspace).toContain('projectHrefBase')
    expect(workspace).toContain('buildProjectHref')
  })
})
