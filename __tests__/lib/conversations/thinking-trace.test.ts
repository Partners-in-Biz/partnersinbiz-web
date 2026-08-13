import {
  buildThinkingTrace,
  isReadableThought,
  liveReasoningText,
  mergeChatEvents,
  summarizeToolEvents,
} from '@/lib/conversations/thinking-trace'
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
      segments: [
        { kind: 'thought', text: 'I should check the project status first.' },
        { kind: 'tools', summary: 'Ran 2 commands' },
      ],
    })
    expect(JSON.stringify(thinking)).not.toMatch(/Bearer|secret|\/var\/lib/)
  })

  it('streams reasoning.delta into live text and thought segments', () => {
    const events: ChatEvent[] = [
      { event: 'reasoning.delta', delta: 'I will start by ', timestamp: 1 },
      { event: 'reasoning.delta', delta: 'loading the skill.', timestamp: 2 },
      { event: 'tool.started', tool: 'skill_view', timestamp: 3 },
      { event: 'tool.completed', tool: 'skill_view', timestamp: 4 },
    ]

    expect(liveReasoningText(events)).toBe('I will start by loading the skill.')
    const thinking = buildThinkingTrace(events)
    expect(thinking?.summary).toBe('I will start by loading the skill.')
    expect(thinking?.segments).toEqual([
      { kind: 'thought', text: 'I will start by loading the skill.' },
      { kind: 'tools', summary: 'Read 2 files' },
    ])
  })

  it('summarises tool events into a muted one-liner', () => {
    expect(summarizeToolEvents([
      { event: 'tool.completed', tool: 'terminal' },
      { event: 'tool.completed', tool: 'read_file' },
    ])).toBe('Ran 1 command, read 1 file')
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

  it('hides encrypted live reasoning until a readable summary arrives', () => {
    const blob = 'eJyNVkuP2zYQvvdXjG0uL9QmN8kA8bC9xYz0pQ=='.repeat(4)
    expect(isReadableThought(blob)).toBe(false)
    expect(liveReasoningText([
      { event: 'reasoning.delta', delta: blob },
    ])).toBe('')
    expect(liveReasoningText([
      { event: 'reasoning.delta', delta: blob },
      { event: 'reasoning.summary', text: 'I should inspect the mobile side chat header first.' },
    ])).toBe('I should inspect the mobile side chat header first.')
    expect(buildThinkingTrace([
      { event: 'reasoning.delta', delta: blob },
    ])).toBeNull()
  })
})
