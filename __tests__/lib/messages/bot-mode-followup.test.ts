import {
  botInboxTitle,
  findOpenBotInboxThread,
  isBotInboxConversation,
  listBotInboxThreads,
  orderedInboxAgentIds,
  parseBotChannelKind,
  parseBotInboxMeta,
  usesBotComputerIsolation,
} from '@/lib/messages/bot-channel'
import {
  applyBotIsolationToWorkbenchPaths,
  botComputerFoldersToEnsure,
  buildBotComputerBinding,
  isolatedBotBrowserProfileId,
  isolatedBotWorkspacePath,
  joinIsolatedBotFolder,
} from '@/lib/messages/bot-computer-isolation'
import {
  allocateBotHandle,
  buildBotShareSnapshot,
  canCloneBotShare,
  canShareAgentAsGrokBot,
  canViewBotShare,
  parseBotShareIdFromInput,
  publicBotSharePreview,
} from '@/lib/messages/bot-shares'

describe('bot-to-bot inbox', () => {
  it('treats unknown channel kinds as messages and isolates bot + inbox', () => {
    expect(parseBotChannelKind('channels')).toBe('messages')
    expect(parseBotChannelKind('bot')).toBe('bot')
    expect(usesBotComputerIsolation('bot_inbox')).toBe(true)
    expect(usesBotComputerIsolation('messages')).toBe(false)
  })

  it('requires two distinct bots and puts the recipient first for dispatch', () => {
    expect(parseBotInboxMeta({ fromAgentId: 'theo', toAgentId: 'theo' })).toBeNull()
    expect(parseBotInboxMeta({ fromAgentId: 'theo', toAgentId: 'maya', status: 'working' })).toEqual({
      fromAgentId: 'theo',
      toAgentId: 'maya',
      status: 'working',
    })
    expect(orderedInboxAgentIds('theo', 'maya')).toEqual(['maya', 'theo'])
    expect(botInboxTitle('Theo', 'Maya')).toBe('Inbox · Theo → Maya')
  })

  it('lists open inbox threads and reuses an existing from→to conversation', () => {
    const conversations = [
      { id: 'human', channelKind: 'bot', participantAgentIds: ['theo'] },
      {
        id: 'inbox-1',
        channelKind: 'bot_inbox',
        title: 'Inbox · Theo → Maya',
        botInbox: { fromAgentId: 'theo', toAgentId: 'maya', status: 'open' },
        participantAgentIds: ['maya', 'theo'],
        lastMessagePreview: 'Draft the changelog',
      },
      {
        id: 'closed',
        channelKind: 'bot_inbox',
        botInbox: { fromAgentId: 'theo', toAgentId: 'maya', status: 'closed' },
        participantAgentIds: ['maya', 'theo'],
        archived: true,
      },
    ]
    expect(isBotInboxConversation(conversations[0])).toBe(false)
    const threads = listBotInboxThreads(conversations, { theo: 'Theo', maya: 'Maya' })
    expect(threads).toEqual([
      expect.objectContaining({
        id: 'inbox-1',
        fromAgentId: 'theo',
        toAgentId: 'maya',
        preview: 'Draft the changelog',
      }),
    ])
    expect(findOpenBotInboxThread(conversations, 'theo', 'maya')?.id).toBe('inbox-1')
    expect(findOpenBotInboxThread(conversations, 'maya', 'theo')).toBeNull()
  })
})

describe('isolated per-bot computers', () => {
  it('builds a bots/{agentId} folder and browser profile on the linked machine', () => {
    expect(isolatedBotWorkspacePath('theo')).toBe('bots/theo')
    expect(isolatedBotBrowserProfileId('qa-release')).toBe('bot-qa-release')
    expect(isolatedBotWorkspacePath('../etc')).toBeNull()
    expect(buildBotComputerBinding({ agentId: 'theo', deviceId: 'mac-1' })).toEqual({
      isolated: true,
      workspaceRelativePath: 'bots/theo',
      browserProfileId: 'bot-theo',
      deviceId: 'mac-1',
      runtimeTarget: null,
    })
  })

  it('joins isolation under an existing workspace without double-nesting', () => {
    expect(joinIsolatedBotFolder('.', 'theo')).toBe('bots/theo')
    expect(joinIsolatedBotFolder('projects/abc', 'theo')).toBe('projects/abc/bots/theo')
    expect(joinIsolatedBotFolder('bots/theo', 'theo')).toBe('bots/theo')
    expect(joinIsolatedBotFolder('bots/maya', 'theo')).toBe('bots/theo')
    expect(joinIsolatedBotFolder('partners/Acme/bots/maya', 'theo')).toBe('partners/Acme/bots/theo')
  })

  it('lists VPS folders to ensure for Bot isolation paths', () => {
    expect(botComputerFoldersToEnsure('bots/sales')).toEqual(['bots/sales', 'bots'])
    expect(botComputerFoldersToEnsure('projects/abc/bots/theo')).toEqual(['projects/abc/bots/theo'])
    expect(botComputerFoldersToEnsure('docs')).toEqual([])
    expect(botComputerFoldersToEnsure('../etc')).toEqual([])
  })

  it('isolates workbench folders, and company roots via workingDirectory', () => {
    expect(applyBotIsolationToWorkbenchPaths({
      agentId: 'theo',
      relativeFolder: '.',
    })).toEqual({ relativeFolder: 'bots/theo' })
    expect(applyBotIsolationToWorkbenchPaths({
      agentId: 'theo',
      relativeFolder: '.',
      workingDirectory: '/Cowork/partners/Acme',
    })).toEqual({
      relativeFolder: '.',
      workingDirectory: '/Cowork/partners/Acme/bots/theo',
    })
  })
})

describe('shareable custom GrokBots', () => {
  it('allows custom linked agents and rejects marketplace or platform-only rows', () => {
    expect(canShareAgentAsGrokBot({ agentKind: 'custom', provisioningMode: 'linked_device', scopeOrgId: 'org-1' })).toBe(true)
    expect(canShareAgentAsGrokBot({ agentKind: 'marketplace', marketplaceTemplateId: 'pip', provisioningMode: 'linked_device' })).toBe(false)
    expect(canShareAgentAsGrokBot({ provisioningMode: 'platform_vps' })).toBe(false)
  })

  it('parses share ids from links and gates visibility without exposing secrets', () => {
    const shareId = 'bs_aaaaaaaaaaaaaaaaaaaaaaaa'
    expect(parseBotShareIdFromInput(`https://app.example/portal/messages?mode=bot&botShare=${shareId}`)).toBe(shareId)
    expect(parseBotShareIdFromInput(`/api/v1/bots/shares/${shareId}`)).toBe(shareId)
    const snapshot = buildBotShareSnapshot({
      name: 'Research Bot',
      role: 'Analyst',
      persona: 'Cite sources.',
      agentHandle: 'research',
      iconKey: 'science',
      colorKey: 'emerald',
      defaultModel: 'auto',
    })
    const share = {
      shareId,
      sourceOrgId: 'org-1',
      sourceAgentId: 'oa-x-research',
      visibility: 'organization' as const,
      allowClone: true,
      createdByUserId: 'user-1',
      snapshot: snapshot!,
    }
    expect(canViewBotShare(share, { uid: 'user-2', orgId: 'org-1' })).toBe(true)
    expect(canViewBotShare(share, { uid: 'user-2', orgId: 'org-2' })).toBe(false)
    expect(canCloneBotShare({ ...share, visibility: 'link' }, { uid: 'user-9', orgId: 'org-9' })).toBe(true)
    expect(publicBotSharePreview(share)).toEqual(expect.objectContaining({
      shareId,
      name: 'Research Bot',
      agentKind: 'custom',
    }))
    expect(JSON.stringify(publicBotSharePreview(share))).not.toContain('apiKey')
  })

  it('allocates a unique handle when the source handle is taken', () => {
    expect(allocateBotHandle('research', ['research'], 'Research Bot')).toBe('research2')
    expect(allocateBotHandle('My Bot!', [], 'My Bot')).toBe('my-bot')
  })
})
