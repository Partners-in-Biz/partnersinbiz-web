import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('project detail shared workspace standard', () => {
  it('keeps admin and portal project detail routes as adapters around the shared workspace', () => {
    const adminRoute = read('app/(admin)/admin/org/[slug]/projects/[projectId]/page.tsx')
    const portalRoute = read('app/(portal)/portal/projects/[projectId]/page.tsx')

    expect(adminRoute).toContain("import { ProjectDetailWorkspace } from '@/components/projects/ProjectDetailWorkspace'")
    expect(adminRoute).toContain('<ProjectDetailWorkspace')
    expect(adminRoute).toContain('mode="admin"')
    expect(adminRoute).toContain('orgSlug={slug}')
    expect(adminRoute).toContain('projectId={projectId}')

    expect(portalRoute).toContain("import { ProjectDetailWorkspace } from '@/components/projects/ProjectDetailWorkspace'")
    expect(portalRoute).toContain("import { scopeFromSearchParams } from '@/lib/portal/scoped-routing'")
    expect(portalRoute).toContain('<ProjectDetailWorkspace')
    expect(portalRoute).toContain('mode="portal"')
    expect(portalRoute).toContain('orgScope={orgScope}')
    expect(portalRoute).toContain('projectId={projectId}')
  })

  it('prevents project detail routes from reintroducing duplicate board, docs, and settings logic', () => {
    const routes = [
      read('app/(admin)/admin/org/[slug]/projects/[projectId]/page.tsx'),
      read('app/(portal)/portal/projects/[projectId]/page.tsx'),
    ]

    for (const route of routes) {
      expect(route).not.toContain('function mergeLiveTasks')
      expect(route).not.toContain('const PROJECT_TABS')
      expect(route).not.toContain('KanbanBoard')
      expect(route).not.toContain('TaskDetailPanel')
      expect(route).not.toContain('TaskComposer')
      expect(route).not.toContain('ProjectDocsPanel')
      expect(route).not.toContain('ProjectSettingsPanel')
      expect(route).not.toContain('ProjectSuitePanel')
      expect(route).not.toContain('ProjectPeopleAccessPanel')
    }
  })

  it('keeps portal project detail navigation scoped inside the shared workspace', () => {
    const workspace = read('components/projects/ProjectDetailWorkspace.tsx')

    expect(workspace).toContain('scopedPortalPath')
    expect(workspace).toContain('backHref')
    expect(workspace).toContain('hideAgentSection={mode ===')
    expect(workspace).toContain("mode === 'admin'")
  })
})
