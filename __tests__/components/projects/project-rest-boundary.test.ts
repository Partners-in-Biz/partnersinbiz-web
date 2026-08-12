import fs from 'node:fs'
import path from 'node:path'

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('project browser REST boundary', () => {
  const listWorkspace = read('components/projects/ProjectsWorkspace.tsx')
  const detailWorkspace = read('components/projects/ProjectDetailWorkspace.tsx')

  it.each([
    ['project list', listWorkspace],
    ['project detail', detailWorkspace],
  ])('does not read raw Firestore documents from the %s workspace', (_label, source) => {
    expect(source).not.toContain("from 'firebase/firestore'")
    expect(source).not.toContain('getClientDb')
    expect(source).not.toContain('onSnapshot')
    expect(source).not.toContain("collection(getClientDb(), 'projects'")
  })

  it('refreshes public project and task views through relationship-aware APIs every 60 seconds', () => {
    expect(listWorkspace).toContain('const PROJECT_REFRESH_INTERVAL_MS = 60_000')
    expect(listWorkspace).toContain("'/api/v1/projects'")
    expect(listWorkspace).toContain('`/api/v1/projects/${project.id}/tasks?view=board`')
    expect(detailWorkspace).toContain('const TASK_REFRESH_INTERVAL_MS = 60_000')
    expect(detailWorkspace).toContain('`/api/v1/projects/${projectId}/tasks?view=board`')
  })
})
