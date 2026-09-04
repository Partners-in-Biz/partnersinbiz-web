import {
  applyExperienceModeToSearch,
  BOT_MODE_CAPABILITIES,
  parseMessagesExperienceMode,
  resolveMessagesExperienceMode,
} from '@/lib/messages/experience-mode'
import { computersForBot, uniqueBotComputers } from '@/lib/messages/bot-computers'
import { buildBotRosterItems } from '@/lib/messages/bot-roster'

describe('messages experience mode', () => {
  it('treats unknown values as messages and bot as bot', () => {
    expect(parseMessagesExperienceMode(undefined)).toBe('messages')
    expect(parseMessagesExperienceMode('channels')).toBe('messages')
    expect(parseMessagesExperienceMode('bot')).toBe('bot')
  })

  it('lets a URL param win over stored mode', () => {
    expect(resolveMessagesExperienceMode({ searchParam: 'bot', stored: 'messages' })).toBe('bot')
    expect(resolveMessagesExperienceMode({ searchParam: 'messages', stored: 'bot' })).toBe('messages')
    expect(resolveMessagesExperienceMode({ searchParam: null, stored: 'bot' })).toBe('bot')
  })

  it('writes bot mode into search and omits the default messages mode', () => {
    expect(applyExperienceModeToSearch('?convId=abc', 'bot')).toBe('?convId=abc&mode=bot')
    expect(applyExperienceModeToSearch('?convId=abc&mode=bot', 'messages')).toBe('?convId=abc')
    expect(applyExperienceModeToSearch('', 'messages')).toBe('')
  })
})

describe('bot computers', () => {
  it('dedupes runtimes, prefers online copies, and sorts the active computer first', () => {
    const computers = uniqueBotComputers([
      { id: 'mac', label: 'Peet Mac', deviceKind: 'computer', selectable: false, isFresh: false, isHealthy: false },
      { id: 'mac', label: 'Peet Mac', deviceKind: 'computer', selectable: true, isFresh: true, isHealthy: true, availableAgentIds: ['theo'] },
      { id: 'vps', label: 'Canonical VPS', kind: 'vps', selectable: true, isFresh: true, isHealthy: true, availableAgentIds: ['pip'] },
    ], 'vps')

    expect(computers.map((computer) => computer.id)).toEqual(['vps', 'mac'])
    expect(computers[1]?.online).toBe(true)
    expect(computers[1]?.availableAgentIds).toEqual(['theo'])
  })

  it('filters computers to a bot when the machine reports agent inventory', () => {
    const computers = uniqueBotComputers([
      { id: 'mac', label: 'Mac', selectable: true, isFresh: true, isHealthy: true, availableAgentIds: ['theo'] },
      { id: 'vps', label: 'VPS', selectable: true, isFresh: true, isHealthy: true, availableAgentIds: ['pip'] },
    ])
    expect(computersForBot(computers, 'theo').map((computer) => computer.id)).toEqual(['mac'])
  })

  it('does not treat an empty inventory as every machine', () => {
    const computers = uniqueBotComputers([
      { id: 'mac', label: 'Mac', selectable: true, isFresh: true, isHealthy: true, availableAgentIds: [] },
      { id: 'vps', label: 'VPS', selectable: true, isFresh: true, isHealthy: true, availableAgentIds: ['pip'] },
    ])
    expect(computersForBot(computers, 'pip').map((computer) => computer.id)).toEqual(['vps'])
    expect(computersForBot(computers, 'blake')).toEqual([])
  })
})

describe('bot roster', () => {
  it('turns visible agents into named bots with channel and computer counts', () => {
    const roster = buildBotRosterItems(
      [
        { agentId: 'theo', name: 'Theo', role: 'Engineering', enabled: true },
        { agentId: 'maya', name: 'Maya', role: 'Content', enabled: false },
      ],
      [{ id: 'theo', conversations: [{ title: 'Fix preview builds' }] }],
      [{ id: 'mac', label: 'Mac', kind: 'computer', online: true, availableAgentIds: ['theo'] }],
    )
    expect(roster).toEqual([
      expect.objectContaining({
        id: 'theo',
        name: 'Theo',
        role: 'Engineering',
        channelCount: 1,
        lastChannelTitle: 'Fix preview builds',
        lastPreview: 'Fix preview builds',
        onlineComputerCount: 1,
        kind: 'specialist',
      }),
    ])
  })

  it('labels marketplace and custom bots without widening kind to string', () => {
    const roster = buildBotRosterItems(
      [
        { agentId: 'ads-pack', name: 'Ads Pack', enabled: true, marketplaceTemplateId: 'tpl-1' },
        { agentId: 'custom-1', name: 'Site Bot', enabled: true, agentKind: 'custom', scopeOrgId: 'org-1', provisioningMode: 'linked_device' },
      ],
      [],
      [],
    )
    expect(roster.map((bot) => bot.kind)).toEqual(['marketplace', 'custom'])
  })

  it('attaches optional presence onto roster rows', () => {
    const roster = buildBotRosterItems(
      [{ agentId: 'theo', name: 'Theo', enabled: true }],
      [],
      [],
      { theo: { state: 'thinking', currentStep: 'Planning next step' } },
    )
    expect(roster[0]?.presence).toEqual({ state: 'thinking', currentStep: 'Planning next step' })
  })

  it('keeps Grok Bot surfaces and PiB extras in the capability map', () => {
    expect(BOT_MODE_CAPABILITIES.filter((item) => item.grok).map((item) => item.id)).toEqual([
      'named-bots',
      'direct-chat',
      'computer',
      'screen',
      'routines',
      'skills',
      'plugins',
      'bot-to-bot',
      'approvals',
    ])
    expect(BOT_MODE_CAPABILITIES.find((item) => item.id === 'canvas')?.grok).toBe(false)
  })
})
