import {
  canDispatchStandingGoals,
  canOperateAgentRuntime,
  evaluateSlashCommandAccess,
  filterSlashCommandsByAccess,
  listSlashCommandsForAccess,
  slashCommandAccessTier,
} from '@/lib/chat/slash-command-access'
import { SLASH_COMMANDS } from '@/lib/chat/slash-commands'

describe('slash-command-access', () => {
  const owner = {
    uid: 'user-owner',
    role: 'client',
    isSuperAdmin: false,
    isOrgManager: false,
  }
  const stranger = {
    uid: 'user-stranger',
    role: 'client',
    isSuperAdmin: false,
    isOrgManager: false,
  }
  const orgAdmin = {
    uid: 'user-org-admin',
    role: 'admin',
    isSuperAdmin: false,
    isOrgManager: true,
  }
  const superAdmin = {
    uid: 'peet',
    role: 'admin',
    isSuperAdmin: true,
    isOrgManager: true,
  }

  const personalAgent = {
    agentId: 'my-bot',
    ownerUserId: 'user-owner',
    accessScope: 'personal',
    provisioningMode: 'linked_device',
  }
  const orgAgent = {
    agentId: 'org-bot',
    ownerUserId: 'someone-else',
    accessScope: 'organization',
    provisioningMode: 'linked_device',
  }
  const fleetAgent = {
    agentId: 'pip',
    ownerUserId: null,
    accessScope: null,
    provisioningMode: 'platform_vps',
  }

  it('classifies command tiers', () => {
    expect(slashCommandAccessTier('task')).toBe('public')
    expect(slashCommandAccessTier('goal')).toBe('dispatch')
    expect(slashCommandAccessTier('hire')).toBe('dispatch')
    expect(slashCommandAccessTier('memory', '')).toBe('operator_read')
    expect(slashCommandAccessTier('memory', 'add foo')).toBe('operator_write')
    expect(slashCommandAccessTier('toolsets')).toBe('operator_write')
    expect(slashCommandAccessTier('rollback')).toBe('operator_write')
    expect(slashCommandAccessTier('hermes-features')).toBe('operator_read')
    expect(slashCommandAccessTier('context')).toBe('public')
    expect(slashCommandAccessTier('compress')).toBe('dispatch')
  })

  it('registers /hire as agent_intent with hire guidance', () => {
    const hire = SLASH_COMMANDS.find((command) => command.id === 'hire')
    expect(hire?.token).toBe('/hire')
    expect(hire?.executorKind).toBe('agent_intent')
    expect(hire?.aliases).toEqual(expect.arrayContaining(['/agent-hire', '/provision-agent']))
  })

  it('exposes /context and /compress in the registry with distinct identities', () => {
    const context = SLASH_COMMANDS.find((command) => command.id === 'context')
    const compress = SLASH_COMMANDS.find((command) => command.id === 'compress')
    const useCurrentPage = SLASH_COMMANDS.find((command) => command.id === 'use-current-page')
    expect(context?.token).toBe('/context')
    expect(context?.executorKind).toBe('hermes_features')
    expect(compress?.token).toBe('/compress')
    expect(compress?.executorKind).toBe('hermes_features')
    // /context must resolve to the context command, not the use-current-page alias.
    expect(useCurrentPage?.aliases).not.toContain('/context')
    expect(SLASH_COMMANDS.filter((command) => command.token === '/context' || command.aliases.includes('/context'))).toHaveLength(1)
  })

  it('personal agent: only owner can operate runtime', () => {
    expect(canOperateAgentRuntime(owner, personalAgent)).toBe(true)
    expect(canOperateAgentRuntime(stranger, personalAgent)).toBe(false)
    expect(canOperateAgentRuntime(orgAdmin, personalAgent)).toBe(false)
    expect(canOperateAgentRuntime(superAdmin, personalAgent)).toBe(true)
  })

  it('org linked agent: org managers and super-admin can operate', () => {
    expect(canOperateAgentRuntime(owner, orgAgent)).toBe(false)
    expect(canOperateAgentRuntime(orgAdmin, orgAgent)).toBe(true)
    expect(canOperateAgentRuntime(superAdmin, orgAgent)).toBe(true)
  })

  it('platform fleet agents: super-admin only for operator commands', () => {
    expect(canOperateAgentRuntime(owner, fleetAgent)).toBe(false)
    expect(canOperateAgentRuntime(orgAdmin, fleetAgent)).toBe(false)
    expect(canOperateAgentRuntime(superAdmin, fleetAgent)).toBe(true)
  })

  it('standing goals: conversation starter allowed; strangers denied', () => {
    expect(canDispatchStandingGoals(stranger, { startedBy: 'user-owner' }, fleetAgent)).toBe(false)
    expect(canDispatchStandingGoals(owner, { startedBy: 'user-owner' }, fleetAgent)).toBe(true)
    expect(canDispatchStandingGoals(superAdmin, { startedBy: 'user-owner' }, fleetAgent)).toBe(true)
  })

  it('evaluateSlashCommandAccess enforces write vs public', () => {
    expect(
      evaluateSlashCommandAccess({
        commandId: 'task',
        actor: stranger,
        agent: fleetAgent,
      }).allowed,
    ).toBe(true)

    expect(
      evaluateSlashCommandAccess({
        commandId: 'toolsets',
        actor: stranger,
        agent: fleetAgent,
      }).allowed,
    ).toBe(false)

    expect(
      evaluateSlashCommandAccess({
        commandId: 'toolsets',
        actor: owner,
        agent: personalAgent,
      }).allowed,
    ).toBe(true)

    expect(
      evaluateSlashCommandAccess({
        commandId: 'memory',
        args: 'add secret',
        actor: stranger,
        agent: personalAgent,
      }).allowed,
    ).toBe(false)

    expect(
      evaluateSlashCommandAccess({
        commandId: 'goal',
        actor: stranger,
        conversation: { startedBy: 'user-owner' },
        agent: fleetAgent,
      }).allowed,
    ).toBe(false)

    expect(
      evaluateSlashCommandAccess({
        commandId: 'goal',
        actor: owner,
        conversation: { startedBy: 'user-owner' },
        agent: fleetAgent,
      }).allowed,
    ).toBe(true)
  })

  it('composer menu hides operator commands for strangers on fleet agents', () => {
    const forStranger = listSlashCommandsForAccess({
      actor: stranger,
      agent: fleetAgent,
      conversation: { startedBy: 'user-owner' },
    })
    const tokens = forStranger.map((c) => c.token)
    expect(tokens).toContain('/task')
    expect(tokens).toContain('/help')
    expect(tokens).not.toContain('/toolsets')
    expect(tokens).not.toContain('/rollback')
    expect(tokens).not.toContain('/personality')
    expect(tokens).not.toContain('/memory')
    expect(tokens).not.toContain('/hermes-features')
    expect(tokens).not.toContain('/goal')

    const forOwnerPersonal = listSlashCommandsForAccess({
      actor: owner,
      agent: personalAgent,
      conversation: { startedBy: 'user-owner' },
    })
    const ownerTokens = forOwnerPersonal.map((c) => c.token)
    expect(ownerTokens).toContain('/toolsets')
    expect(ownerTokens).toContain('/memory')
    expect(ownerTokens).toContain('/goal')

    const forSuper = filterSlashCommandsByAccess(SLASH_COMMANDS, {
      actor: superAdmin,
      agent: fleetAgent,
    })
    expect(forSuper.map((c) => c.id)).toEqual(expect.arrayContaining(['toolsets', 'rollback', 'goal', 'hermes-features']))
  })
})
