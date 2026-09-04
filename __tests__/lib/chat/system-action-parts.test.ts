import { extractPibFences } from '@/lib/chat/pib-fences'
import { validatePart } from '@/lib/chat/parts'
import { toActionCardPart, toSystemEventPart } from '@/components/chat/parts/from-rich-part'

describe('pib:action fence', () => {
  it('parses an action_card from a pib:action fence', () => {
    const { markdown, parts } = extractPibFences('Done.\n\n```pib:action\n{"kind":"email_sent","title":"Sent follow-up","status":"succeeded"}\n```\n')
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ type: 'action_card', kind: 'email_sent', title: 'Sent follow-up' })
    expect(markdown).toContain('<!--pib-part:0-->')
  })
})

describe('system_event / action_card validation', () => {
  it('accepts well-formed system events and rejects empty summaries', () => {
    expect(validatePart({
      type: 'system_event',
      eventKind: 'driver.hand_back',
      actorKind: 'user',
      actorLabel: 'Peet',
      summary: 'Handed back',
      at: '2026-09-04T09:00:00.000Z',
    }).ok).toBe(true)
    expect(validatePart({ type: 'system_event', summary: '' }).ok).toBe(false)
  })

  it('maps rich parts into typed system_event and action_card shapes', () => {
    expect(toSystemEventPart({
      type: 'system_event',
      eventKind: 'driver.take_control',
      actorKind: 'user',
      actorLabel: 'Peet',
      summary: 'Took control',
      at: '2026-09-04T09:00:00.000Z',
    })).toMatchObject({ type: 'system_event', summary: 'Took control' })
    expect(toActionCardPart({
      type: 'action_card',
      kind: 'routine_run',
      title: 'Morning brief',
      status: 'succeeded',
    })).toMatchObject({ type: 'action_card', kind: 'routine_run', title: 'Morning brief' })
    expect(toActionCardPart({ type: 'action_card', title: '' })).toBeNull()
  })
})
