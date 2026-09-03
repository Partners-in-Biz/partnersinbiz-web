/**
 * @jest-environment node
 */

const docs = new Map<string, Record<string, unknown>>()

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => ({
      doc: (id: string) => {
        const key = `${name}/${id}`
        return {
          id,
          get: async () => {
            const data = docs.get(key)
            return { exists: Boolean(data), id, data: () => data }
          },
          set: async (value: Record<string, unknown>) => {
            docs.set(key, { ...value })
          },
          update: async (value: Record<string, unknown>) => {
            const existing = docs.get(key) ?? {}
            docs.set(key, { ...existing, ...value })
          },
        }
      },
    }),
  },
}))

jest.mock('@/lib/llm-providers/crypto', () => ({
  encryptLlmCredentials: () => ({ ciphertext: 'c', iv: 'i', tag: 't' }),
}))

import {
  DEFAULT_LLM_SHARE_TARGETS,
  normalizeLlmShareTargets,
} from '@/lib/llm-providers/types'
import { updateLlmConnectionShareTargets, upsertLlmProviderConnection } from '@/lib/llm-providers/store'

const actor = { uid: 'admin-1', type: 'user' as const }

function upsertInput(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'openai-api' as const,
    orgId: 'org-1',
    ownerUid: null,
    label: 'OpenAI',
    credentials: { apiKey: 'sk-test-1234567890' },
    ...overrides,
  }
}

describe('normalizeLlmShareTargets', () => {
  it('defaults missing or invalid values to admins with empty lists', () => {
    expect(normalizeLlmShareTargets(undefined)).toEqual(DEFAULT_LLM_SHARE_TARGETS)
    expect(normalizeLlmShareTargets(null)).toEqual(DEFAULT_LLM_SHARE_TARGETS)
    expect(normalizeLlmShareTargets('admins')).toEqual(DEFAULT_LLM_SHARE_TARGETS)
    expect(normalizeLlmShareTargets({})).toEqual(DEFAULT_LLM_SHARE_TARGETS)
  })

  it('maps unknown mode to admins and always requires an active device grant', () => {
    expect(normalizeLlmShareTargets({
      mode: 'everyone',
      requireActiveDeviceGrant: false,
    })).toEqual(DEFAULT_LLM_SHARE_TARGETS)
  })

  it('trims, dedupes, and clamps string lists to 500', () => {
    const teamIds = Array.from({ length: 505 }, (_, index) => ` team-${index} `)
    const normalized = normalizeLlmShareTargets({
      mode: 'teams',
      teamIds: [...teamIds, 'team-0', '', '   '],
      userIds: [' u1 ', 'u1', 'u2'],
    })
    expect(normalized.mode).toBe('teams')
    expect(normalized.teamIds).toHaveLength(500)
    expect(normalized.teamIds[0]).toBe('team-0')
    expect(normalized.teamIds.at(-1)).toBe('team-499')
    expect(normalized.userIds).toEqual(['u1', 'u2'])
  })

  it('drops invalid agent ids', () => {
    expect(normalizeLlmShareTargets({
      mode: 'organization',
      agentIds: ['pip', 'PIP', 'x', 'not valid', 'theo', 'Agent'],
    }).agentIds).toEqual(['pip', 'theo'])
  })
})

describe('upsertLlmProviderConnection shareTargets', () => {
  beforeEach(() => {
    docs.clear()
  })

  it('stores normalized shareTargets on organisation connections', async () => {
    const connection = await upsertLlmProviderConnection(upsertInput({
      scope: 'org',
      shareTargets: {
        mode: 'teams',
        teamIds: [' growth ', 'growth'],
        userIds: ['u1'],
        agentIds: ['pip', 'NOPE'],
      },
    }), actor)

    expect(connection.shareTargets).toEqual({
      mode: 'teams',
      teamIds: ['growth'],
      userIds: ['u1'],
      agentIds: ['pip'],
      requireActiveDeviceGrant: true,
    })
    expect(docs.get('llm_provider_connections/org:org-1:openai-api')?.shareTargets).toEqual(connection.shareTargets)
  })

  it('defaults organisation shareTargets to admins when omitted', async () => {
    const connection = await upsertLlmProviderConnection(upsertInput({ scope: 'org' }), actor)
    expect(connection.shareTargets).toEqual(DEFAULT_LLM_SHARE_TARGETS)
  })

  it('drops shareTargets on user connections', async () => {
    const connection = await upsertLlmProviderConnection(upsertInput({
      scope: 'user',
      ownerUid: 'user-1',
      shareTargets: {
        mode: 'organization',
        teamIds: ['growth'],
        userIds: ['u1'],
        agentIds: ['pip'],
        requireActiveDeviceGrant: true,
      },
    }), actor)

    expect(connection.shareTargets).toBeUndefined()
    expect(docs.get('llm_provider_connections/user:user-1:openai-api')).not.toHaveProperty('shareTargets')
  })

  it('updates org shareTargets without bumping credentialVersion', async () => {
    const created = await upsertLlmProviderConnection(upsertInput({ scope: 'org' }), actor)
    expect(created.credentialVersion).toBe(1)

    const updated = await updateLlmConnectionShareTargets(created.id, {
      mode: 'selected_users',
      teamIds: [],
      userIds: ['u2'],
      agentIds: ['maya'],
      requireActiveDeviceGrant: true,
    }, { uid: 'admin-1' })

    expect(updated.credentialVersion).toBe(1)
    expect(updated.shareTargets).toEqual({
      mode: 'selected_users',
      teamIds: [],
      userIds: ['u2'],
      agentIds: ['maya'],
      requireActiveDeviceGrant: true,
    })
  })
})
