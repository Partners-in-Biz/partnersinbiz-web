import type { ChatEvent } from '@/lib/hermes/types'
import {
  buildWorkbenchBrowserTargets,
  buildWorkbenchChanges,
  buildWorkbenchFileTree,
  buildWorkbenchTerminalEntries,
} from '@/lib/messages/workbench/from-events'

const event = (value: Partial<ChatEvent>): ChatEvent => ({ event: 'tool.completed', ...value })

describe('Messages workbench event derivation', () => {
  it('groups a command start and completion into one terminal transcript row', () => {
    const rows = buildWorkbenchTerminalEntries([
      event({ event: 'tool.started', runId: 'run-1', tool: 'terminal', input: 'npm test', timestamp: 100 }),
      event({ event: 'tool.completed', runId: 'run-1', tool: 'terminal', input: 'npm test', stdout: 'PASS workbench', exitCode: 0, timestamp: 101 }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'done', label: 'terminal' })
    expect(rows[0].body).toContain('$ npm test')
    expect(rows[0].body).toContain('PASS workbench')
  })

  it('builds a nested file tree from observed file activity', () => {
    const tree = buildWorkbenchFileTree([
      event({ tool: 'read_file', input: 'components/chat/UnifiedChat.tsx', output: 'source' }),
      event({ tool: 'write_file', input: 'lib/messages/workbench/state.ts', output: 'ok' }),
    ])

    expect(tree.map((node) => node.name)).toEqual(['components', 'lib'])
    expect(tree[0].children?.[0].children?.[0]).toMatchObject({ name: 'UnifiedChat.tsx', kind: 'file' })
  })

  it('maps V4A patches to changed files with diff previews', () => {
    const patch = '*** Begin Patch\n*** Update File: components/chat/UnifiedChat.tsx\n@@\n-old\n+new\n*** End Patch'
    const changes = buildWorkbenchChanges([event({ tool: 'patch', input: patch, output: 'Done!' })])

    expect(changes).toEqual([expect.objectContaining({ path: 'components/chat/UnifiedChat.tsx', status: 'modified', patch: expect.stringContaining('+new') })])
  })

  it('extracts browser targets from event URLs', () => {
    expect(buildWorkbenchBrowserTargets([event({ tool: 'terminal', output: 'Preview: https://preview.example.test/app' })]))
      .toEqual([expect.objectContaining({ url: 'https://preview.example.test/app', source: 'event' })])
  })
})
