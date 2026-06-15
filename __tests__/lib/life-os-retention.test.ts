import {
  LIFE_OS_RETENTION_RULES,
  runLifeOsRetention,
  type LifeOsRetentionRecord,
  type LifeOsRetentionStore,
} from '@/lib/privacy/life-os-retention'

class MemoryRetentionStore implements LifeOsRetentionStore {
  records: Record<string, LifeOsRetentionRecord[]>
  deleted: string[] = []
  updated: Array<{ collection: string; id: string; patch: Record<string, unknown> }> = []

  constructor(records: Record<string, LifeOsRetentionRecord[]>) {
    this.records = Object.fromEntries(
      Object.entries(records).map(([collection, docs]) => [
        collection,
        docs.map((doc) => ({ ...doc, data: { ...doc.data } })),
      ]),
    )
  }

  async listCollection(collection: string) {
    return this.records[collection] ?? []
  }

  async deleteRecord(collection: string, id: string) {
    this.deleted.push(`${collection}/${id}`)
    this.records[collection] = (this.records[collection] ?? []).filter((record) => record.id !== id)
  }

  async updateRecord(collection: string, id: string, patch: Record<string, unknown>) {
    this.updated.push({ collection, id, patch })
    const record = (this.records[collection] ?? []).find((candidate) => candidate.id === id)
    if (record) record.data = { ...record.data, ...patch }
  }
}

const old = '2026-01-01T00:00:00.000Z'
const recent = '2026-06-01T00:00:00.000Z'
const now = '2026-06-15T00:00:00.000Z'

function personalRecord(id: string, overrides: Record<string, unknown> = {}): LifeOsRetentionRecord {
  return {
    id,
    data: {
      orgId: 'org-1',
      ownerId: 'uid-1',
      ownerUid: 'uid-1',
      createdAt: old,
      updatedAt: old,
      wins: ['sensitive win'],
      content: 'sensitive journal payload',
      ...overrides,
    },
  }
}

describe('Life OS retention purge/anonymisation utility', () => {
  it('dry-runs scoped purge/anonymisation counts without mutating or leaking sensitive payloads', async () => {
    const store = new MemoryRetentionStore({
      life_os_profiles: [
        personalRecord('profile-target', { deletionRequestedAt: '2026-04-01T00:00:00.000Z', displayName: 'Sensitive Name' }),
        personalRecord('profile-recent', { deletionRequestedAt: recent }),
        personalRecord('profile-other-user', { ownerUid: 'uid-2', ownerId: 'uid-2', deletionRequestedAt: '2026-04-01T00:00:00.000Z' }),
      ],
      life_os_check_ins: [
        personalRecord('check-in-target', { localDate: '2026-01-01' }),
        personalRecord('check-in-other-org', { orgId: 'org-2', localDate: '2026-01-01' }),
      ],
      life_os_reminders: [
        personalRecord('reminder-old', { status: 'sent', deliveredAt: '2026-02-01T00:00:00.000Z' }),
        personalRecord('reminder-open', { status: 'pending', scheduledFor: '2026-02-01T00:00:00.000Z' }),
      ],
      hermes_conversations: [
        personalRecord('conversation-target', { title: 'Sensitive chat', participantUids: ['uid-1'] }),
      ],
    })

    const report = await runLifeOsRetention(store, {
      orgId: 'org-1',
      ownerUid: 'uid-1',
      mode: 'dry-run',
      now,
    })

    expect(report.mode).toBe('dry-run')
    expect(report.requiresApprovalForCommit).toBe(true)
    expect(report.scopedTo).toEqual({ orgId: 'org-1', ownerUid: 'uid-1' })
    expect(report.totals).toEqual({ purge: 2, anonymise: 2, skipped: 0 })
    expect(report.collections.life_os_profiles).toEqual({ purge: 0, anonymise: 1, skipped: 0 })
    expect(report.collections.life_os_check_ins).toEqual({ purge: 1, anonymise: 0, skipped: 0 })
    expect(report.collections.life_os_reminders).toEqual({ purge: 1, anonymise: 0, skipped: 0 })
    expect(report.collections.hermes_conversations).toEqual({ purge: 0, anonymise: 1, skipped: 0 })
    expect(store.deleted).toEqual([])
    expect(store.updated).toEqual([])

    const serializedReport = JSON.stringify(report)
    expect(serializedReport).not.toContain('sensitive win')
    expect(serializedReport).not.toContain('sensitive journal payload')
    expect(serializedReport).not.toContain('Sensitive Name')
    expect(serializedReport).not.toContain('Sensitive chat')
  })

  it('refuses commit mode without explicit approval evidence', async () => {
    const store = new MemoryRetentionStore({
      life_os_profiles: [personalRecord('profile-target', { deletionRequestedAt: '2026-04-01T00:00:00.000Z' })],
    })

    await expect(runLifeOsRetention(store, {
      orgId: 'org-1',
      ownerUid: 'uid-1',
      mode: 'commit',
      now,
    })).rejects.toThrow('approvalEvidence is required for commit mode')

    expect(store.deleted).toEqual([])
    expect(store.updated).toEqual([])
  })

  it('commit mode only mutates scoped target records in fixtures', async () => {
    const store = new MemoryRetentionStore({
      life_os_profiles: [
        personalRecord('profile-target', { deletionRequestedAt: '2026-04-01T00:00:00.000Z', displayName: 'Sensitive Name' }),
        personalRecord('profile-other-org', { orgId: 'org-2', deletionRequestedAt: '2026-04-01T00:00:00.000Z' }),
        personalRecord('profile-other-user', { ownerUid: 'uid-2', ownerId: 'uid-2', deletionRequestedAt: '2026-04-01T00:00:00.000Z' }),
      ],
      life_os_reviews: [
        personalRecord('review-target', { periodStart: '2026-01-01' }),
        personalRecord('review-recent', { createdAt: recent, updatedAt: recent }),
      ],
      life_os_reminder_preferences: [
        personalRecord('prefs-target', { channel: 'email' }),
      ],
      hermes_conversation_messages: [
        personalRecord('message-target', { conversationId: 'conversation-target', content: 'Sensitive coach exchange' }),
        personalRecord('message-other-user', { ownerUid: 'uid-2', ownerId: 'uid-2', content: 'Other user message' }),
      ],
    })

    const report = await runLifeOsRetention(store, {
      orgId: 'org-1',
      ownerUid: 'uid-1',
      mode: 'commit',
      now,
      approvalEvidence: 'privacy-review-task-approved-by-peet',
    })

    expect(report.mode).toBe('commit')
    expect(report.approvalEvidenceRecorded).toBe(true)
    expect(store.deleted.sort()).toEqual([
      'hermes_conversation_messages/message-target',
      'life_os_reminder_preferences/prefs-target',
      'life_os_reviews/review-recent',
      'life_os_reviews/review-target',
    ])
    expect(store.updated.map((entry) => `${entry.collection}/${entry.id}`)).toEqual(['life_os_profiles/profile-target'])
    expect(store.updated[0].patch).toMatchObject({
      anonymised: true,
      anonymisedReason: LIFE_OS_RETENTION_RULES.deletionRequest.reason,
      displayName: null,
      values: [],
      constraints: [],
    })
    expect(store.records.life_os_profiles.find((record) => record.id === 'profile-other-org')).toBeTruthy()
    expect(store.records.life_os_profiles.find((record) => record.id === 'profile-other-user')).toBeTruthy()
    expect(store.records.hermes_conversation_messages.find((record) => record.id === 'message-other-user')).toBeTruthy()
  })
})
