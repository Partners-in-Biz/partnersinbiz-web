import type { ChatEvent } from '@/lib/hermes/types'
import {
  buildWorkbenchFileTree,
  mapWorkbenchChanges,
  mapWorkbenchTerminal,
  mapWorkbenchUrls,
} from '@/lib/messages/workbench/mappers'

const events: ChatEvent[] = [
  { event: 'tool.started', tool: 'terminal', input: 'npm test -- --runInBand', timestamp: 100, runId: 'run-1' },
  { event: 'tool.completed', tool: 'terminal', stdout: 'PASS workbench', stderr: 'warning', exitCode: 0, timestamp: 102, runId: 'run-1' },
  { event: 'tool.started', tool: 'read_file', input: 'components/chat/UnifiedChat.tsx', timestamp: 103 },
  { event: 'tool.completed', tool: 'read_file', input: 'components/chat/UnifiedChat.tsx', output: 'export default function UnifiedChat() {}', timestamp: 104 },
  {
    event: 'tool.completed',
    tool: 'patch',
    input: [
      '*** Begin Patch',
      '*** Update File: components/chat/UnifiedChat.tsx',
      '@@',
      '-const oldValue = true',
      '+const newValue = true',
      '*** Add File: components/messages/workbench/AgentWorkbenchRail.tsx',
      '+export function AgentWorkbenchRail() {}',
      '*** End Patch',
    ].join('\n'),
    timestamp: 105,
  },
  { event: 'tool.completed', tool: 'terminal', input: 'npm run dev', output: 'ready at https://preview.example.com/workbench', timestamp: 106 },
]

describe('Messages Agent Workbench event mappers', () => {
  it('groups terminal starts and completions into one transcript entry', () => {
    expect(mapWorkbenchTerminal(events)).toEqual([
      expect.objectContaining({
        command: 'npm test -- --runInBand',
        stdout: 'PASS workbench',
        stderr: 'warning',
        exitCode: 0,
        status: 'completed',
      }),
      expect.objectContaining({
        command: 'npm run dev',
        stdout: 'ready at https://preview.example.com/workbench',
        status: 'completed',
      }),
    ])
  })

  it('derives modified and added files with their session patch', () => {
    expect(mapWorkbenchChanges(events)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'components/chat/UnifiedChat.tsx', status: 'modified' }),
      expect.objectContaining({ path: 'components/messages/workbench/AgentWorkbenchRail.tsx', status: 'added' }),
    ]))
    expect(mapWorkbenchChanges(events)[0]?.patch).toContain('@@')
  })

  it('builds a useful read-only file tree and keeps observed file previews', () => {
    const tree = buildWorkbenchFileTree(events, { mappedRootLabel: 'Partners in Biz' })
    expect(tree.label).toBe('Partners in Biz')
    expect(JSON.stringify(tree)).toContain('UnifiedChat.tsx')
    expect(JSON.stringify(tree)).toContain('export default function UnifiedChat() {}')
    expect(JSON.stringify(tree)).toContain('AgentWorkbenchRail.tsx')
  })

  it('extracts safe agent-reported browser URLs', () => {
    expect(mapWorkbenchUrls(events)).toEqual([
      expect.objectContaining({ url: 'https://preview.example.com/workbench' }),
    ])
  })
})
