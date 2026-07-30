/**
 * @jest-environment node
 */
import {
  actorFrom,
  actorTypeFrom,
  agentUpdateAttribution,
  createAttribution,
  crmCreateAttribution,
  crmUpdateAttribution,
  delegatedAgentAttribution,
  formatActorLabel,
  isAgentAssisted,
  isPureAgentCaller,
  lastActorFrom,
  ownerUidFrom,
} from '@/lib/api/actor'
import type { ApiUser } from '@/lib/api/types'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => ({ _sentinel: 'serverTimestamp' })),
  },
}))

const humanSession: ApiUser = {
  uid: 'user-stean',
  role: 'client',
  authKind: 'session',
}

const delegated: ApiUser = {
  uid: 'user-stean',
  role: 'client',
  authKind: 'user_delegation',
  agentId: 'pip',
  actingForUserId: 'user-stean',
}

const pureAgent: ApiUser = {
  uid: 'agent:pip',
  role: 'ai',
  authKind: 'agent_api_key',
  agentId: 'pip',
}

describe('actor ownership contract', () => {
  it('ownerUidFrom prefers actingForUserId under user-delegation', () => {
    expect(ownerUidFrom(delegated)).toBe('user-stean')
    expect(ownerUidFrom({
      ...delegated,
      uid: 'agent-shadow',
      actingForUserId: 'human-1',
    })).toBe('human-1')
    expect(ownerUidFrom(humanSession)).toBe('user-stean')
    expect(ownerUidFrom(pureAgent)).toBe('agent:pip')
  })

  it('actorFrom keeps the human as owner under user-delegation and records the agent', () => {
    expect(actorFrom(delegated)).toEqual({
      createdBy: 'user-stean',
      createdByType: 'user',
      createdByAgentId: 'pip',
    })
    expect(actorTypeFrom(delegated)).toBe('user')
  })

  it('actorFrom keeps pure agent ownership for cron/system keys', () => {
    expect(actorFrom(pureAgent)).toEqual({
      createdBy: 'agent:pip',
      createdByType: 'agent',
      createdByAgentId: 'pip',
    })
    expect(actorTypeFrom(pureAgent)).toBe('agent')
  })

  it('actorFrom keeps direct human sessions without agent keys', () => {
    expect(actorFrom(humanSession)).toEqual({
      createdBy: 'user-stean',
      createdByType: 'user',
    })
  })

  it('lastActorFrom mirrors ownership rules on updates', () => {
    expect(lastActorFrom(delegated)).toEqual({
      updatedBy: 'user-stean',
      updatedByType: 'user',
      updatedAt: { _sentinel: 'serverTimestamp' },
      updatedByAgentId: 'pip',
    })
    expect(lastActorFrom(pureAgent)).toEqual({
      updatedBy: 'agent:pip',
      updatedByType: 'agent',
      updatedAt: { _sentinel: 'serverTimestamp' },
      updatedByAgentId: 'pip',
    })
  })

  it('createAttribution sets both create and update fields', () => {
    expect(createAttribution(delegated)).toEqual({
      createdBy: 'user-stean',
      createdByType: 'user',
      createdByAgentId: 'pip',
      updatedBy: 'user-stean',
      updatedByType: 'user',
      updatedAt: { _sentinel: 'serverTimestamp' },
      updatedByAgentId: 'pip',
    })
  })

  it('CRM helpers omit human ownership for pure agents but still record agent ids', () => {
    expect(crmCreateAttribution(delegated, 'user-stean', false)).toEqual({
      createdBy: 'user-stean',
      updatedBy: 'user-stean',
      createdByAgentId: 'pip',
      updatedByAgentId: 'pip',
    })
    expect(crmCreateAttribution(pureAgent, 'agent:pip', true)).toEqual({
      createdByAgentId: 'pip',
      updatedByAgentId: 'pip',
    })
    expect(crmUpdateAttribution(delegated, 'user-stean', false)).toEqual({
      updatedBy: 'user-stean',
      updatedByAgentId: 'pip',
    })
    expect(crmUpdateAttribution(pureAgent, 'agent:pip', true)).toEqual({
      updatedByAgentId: 'pip',
    })
  })

  it('delegatedAgentAttribution and agentUpdateAttribution only fire for agent-assisted work', () => {
    expect(delegatedAgentAttribution(humanSession)).toEqual({})
    expect(agentUpdateAttribution(humanSession)).toEqual({})
    expect(delegatedAgentAttribution(delegated)).toEqual({ createdByAgentId: 'pip' })
    expect(agentUpdateAttribution(delegated)).toEqual({ updatedByAgentId: 'pip' })
    expect(isAgentAssisted(delegated)).toBe(true)
    expect(isAgentAssisted(humanSession)).toBe(false)
    expect(isPureAgentCaller(pureAgent)).toBe(true)
    expect(isPureAgentCaller(delegated)).toBe(false)
  })

  it('formatActorLabel prefers human owner and appends via agent', () => {
    expect(formatActorLabel({
      createdBy: 'user-stean',
      createdByType: 'user',
      createdByAgentId: 'pip',
      ownerDisplayName: 'Stean',
    })).toBe('Stean via Pip')

    expect(formatActorLabel({
      createdBy: 'agent:pip',
      createdByType: 'agent',
      createdByAgentId: 'pip',
    })).toBe('Pip')
  })
})
