import fs from 'fs'
import path from 'path'

const root = process.cwd()

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('admin project and agent operator surfaces', () => {
  it('keeps the org agent route on the operator task-bus instead of the client-style messages workspace', () => {
    const route = read('app/(admin)/admin/org/[slug]/agent/page.tsx')

    expect(route).toContain('/agent/board')
    expect(route).toContain('Redirecting to Agent Board')
    expect(route).not.toContain('/messages')
    expect(route).not.toContain('Messages')
  })

  it('labels admin project task creation as operator task-bus work and keeps portal request copy separate', () => {
    const workspace = read('components/projects/ProjectsWorkspace.tsx')
    const detail = read('components/projects/ProjectDetailWorkspace.tsx')
    const composer = read('components/kanban/TaskComposer.tsx')

    expect(workspace).toContain('Admin task bus / Projects')
    expect(workspace).toContain('Create operator project')
    expect(workspace).toContain('Request project')
    expect(detail).toContain('surface={isAdmin ? \'admin\' : \'portal\'}')
    expect(composer).toContain('New operator task')
    expect(composer).toContain('Operator task title')
    expect(composer).toContain('Operator assignment')
    expect(composer).toContain('Admin context')
    expect(composer).toContain('Project task title')
  })

  it('labels admin agent assignment, comments, and project context links as internal operator controls', () => {
    const detailPanel = read('components/kanban/TaskDetailPanel.tsx')
    const modal = read('components/agent-board/TaskDetailModal.tsx')
    const board = read('app/(admin)/admin/org/[slug]/agent/board/page.tsx')

    expect(board).toContain('Agent task-bus board')
    expect(detailPanel).toContain('Operator comments')
    expect(detailPanel).toContain('Operator assignment')
    expect(detailPanel).toContain('Internal admin note')
    expect(detailPanel).toContain('Admin context')
    expect(modal).toContain('Admin project context')
    expect(modal).toContain('Operator retry')
  })
})
