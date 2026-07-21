import { buildThinkingTrace, mergeChatEvents } from '@/lib/conversations/thinking-trace'
import type { ChatEvent } from '@/lib/hermes/types'

describe('thinking-trace', () => {
  it('builds a public thinking trail from reasoning and tool events without I/O', () => {
    const events: ChatEvent[] = [
      { event: 'reasoning.summary', text: 'I should check the project status first.', timestamp: 1_770_000_000 },
      { event: 'tool.started', tool: 'terminal', input: 'curl -H "Authorization: Bearer secret" https://x', timestamp: 1_770_000_010 },
      { event: 'tool.completed', tool: 'terminal', stdout: '/var/lib/hermes/private/ok', exitCode: 0, timestamp: 1_770_000_040 },
      { event: 'assistant.text_delta', delta: 'Done.', timestamp: 1_770_000_050 },
    ]

    const thinking = buildThinkingTrace(events)
    expect(thinking).toEqual({
      summary: 'I should check the project status first.',
      steps: [
        { kind: 'tool', label: 'terminal', status: 'started', at: 1_770_000_010 },
        { kind: 'tool', label: 'terminal', status: 'completed', at: 1_770_000_040 },
      ],
      toolCount: 1,
      durationMs: 50_000,
    })
    expect(JSON.stringify(thinking)).not.toMatch(/Bearer|secret|\/var\/lib/)
  })

  it('prefers the richer event trail when merging', () => {
    const short: ChatEvent[] = [{ event: 'tool.started', tool: 'skill_view', timestamp: 1 }]
    const long: ChatEvent[] = [
      ...short,
      { event: 'reasoning.summary', text: 'Reading the skill.', timestamp: 2 },
    ]
    expect(mergeChatEvents(short, long)).toBe(long)
    expect(mergeChatEvents(long, short)).toBe(long)
  })
})
