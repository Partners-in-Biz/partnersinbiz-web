import { normalizeEnabledAgentIds } from '../../../services/agent-watcher/src/config'

describe('agent watcher config', () => {
  it('derives enabled agent ids from agent_team rows', () => {
    expect(normalizeEnabledAgentIds([
      { id: 'pip', data: { enabled: true } },
      { id: 'custom-docs', data: { agentId: 'docs', enabled: true } },
      { id: 'disabled', data: { enabled: false } },
      { id: 'bad id', data: { enabled: true } },
      { id: 'sage', data: { enabled: true } },
    ])).toEqual(['docs', 'pip', 'sage'])
  })

  it('falls back to the live policy team when agent_team yields no usable ids', () => {
    expect(normalizeEnabledAgentIds([
      { id: 'bad id', data: { enabled: true } },
      { id: 'disabled', data: { enabled: false } },
    ])).toEqual(['ads', 'data', 'docs', 'maya', 'nora', 'pip', 'qa-release', 'sage', 'seo', 'support', 'theo', 'sales'])
  })
})
