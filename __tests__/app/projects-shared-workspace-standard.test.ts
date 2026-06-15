import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('projects admin and portal workspace boundary', () => {
  it('keeps admin org projects on governance while portal projects use the client workspace', () => {
    const adminRoute = read('app/(admin)/admin/org/[slug]/projects/page.tsx')
    const portalRoute = read('app/(portal)/portal/projects/page.tsx')

    expect(adminRoute).toContain("import { AdminProjectsGovernanceWorkspace } from '@/components/projects/AdminProjectsGovernanceWorkspace'")
    expect(adminRoute).toContain('<AdminProjectsGovernanceWorkspace')
    expect(adminRoute).toContain('orgSlug={slug}')
    expect(adminRoute).not.toContain('ProjectsWorkspace')

    expect(portalRoute).toContain("import { ProjectsWorkspace } from '@/components/projects/ProjectsWorkspace'")
    expect(portalRoute).toContain("import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'")
    expect(portalRoute).toContain('<ProjectsWorkspace')
    expect(portalRoute).toContain('mode="portal"')
    expect(portalRoute).toContain('orgScope={orgScope}')
  })

  it('prevents project list routes from reintroducing duplicate local project-browser logic', () => {
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

  it('keeps the admin governance surface about permissions, project types, and deletion policy', () => {
    const governance = read('components/projects/AdminProjectsGovernanceWorkspace.tsx')

    expect(governance).toContain('Project governance')
    expect(governance).toContain('Who can use projects in the client portal')
    expect(governance).toContain('Project deletion stays here')
    expect(governance).toContain('Default types plus organisation custom types')
    expect(governance).toContain('What each project owner controls inside a project')
  })

  it('keeps portal company project scope in the shared workspace links and API paths', () => {
    const workspace = read('components/projects/ProjectsWorkspace.tsx')

    expect(workspace).toContain('scopedApiPath')
    expect(workspace).toContain('scopedPortalPath')
    expect(workspace).toContain('canRolePerformModuleAction')
    expect(workspace).toContain("'projects', 'create'")
    expect(workspace).toContain('projectHrefBase')
    expect(workspace).toContain('buildProjectHref')
    expect(workspace).toContain('buildProjectHref={buildProjectHref}')
  })
})
