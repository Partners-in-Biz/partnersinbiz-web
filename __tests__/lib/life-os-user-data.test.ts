import {
  LIFE_OS_USER_DATA_FAMILIES,
  buildLifeOsExport,
  deleteOrAnonymiseLifeOsUserData,
  requestLifeOsDelete,
  type LifeOsUserDataRecord,
  type LifeOsUserDataStore,
} from '@/lib/privacy/life-os-user-data'

class MemoryLifeOsStore implements LifeOsUserDataStore {
  records: Record<string, LifeOsUserDataRecord[]>
  deleted: string[] = []
  updated: Array<{ collection: string; id: string; patch: Record<string, unknown> }> = []
  created: Array<{ collection: string; data: Record<string, unknown> }> = []

  constructor(records: Record<string, LifeOsUserDataRecord[]>) {
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

  async createRecord(collection: string, data: Record<string, unknown>) {
    this.created.push({ collection, data })
    return `${collection}-created`
  }
}

function record(id: string, overrides: Record<string, unknown> = {}): LifeOsUserDataRecord {
  return {
    id,
    data: {
      orgId: 'org-1',
      ownerUid: 'uid-1',
      ownerId: 'uid-1',
      createdAt: '2026-06-15T08:00:00.000Z',
      sensitiveText: 'private journal text',
      ...overrides,
    },
  }
}

describe('Life OS user export/delete privacy helpers', () => {
  it('exports every Life OS family for only the active org and owner without analytics duplication', async () => {
    const store = new MemoryLifeOsStore({
      life_os_profiles: [
        record('profile-1', { firstRun: { goals: ['private goal'], baseline: { energy: 4 } } }),
        record('profile-other-org', { orgId: 'org-2', firstRun: { goals: ['other org'] } }),
        record('profile-other-user', { ownerUid: 'uid-2', ownerId: 'uid-2', firstRun: { goals: ['other user'] } }),
      ],
      life_os_plans: [record('plan-1', { activeDailyActions: [{ title: 'walk' }] })],
      life_os_goals: [record('goal-1', { title: 'Health' })],
      life_os_habits: [record('habit-1', { title: 'Meditate' })],
      life_os_habit_check_ins: [record('habit-check-1', { habitId: 'habit-1' })],
      life_os_check_ins: [record('check-in-1', { wins: ['private win'], dashboardSignals: { winCount: 1 } })],
      life_os_reviews: [record('review-1', { summary: 'private review' })],
      life_os_coach_contexts: [record('coach-context-1', { context: { blockers: ['private blocker'] } })],
      life_os_coach_interactions: [record('coach-interaction-1', { userMessage: 'private coaching prompt' })],
      life_os_experiments: [record('experiment-1', { hypothesis: 'private hypothesis' })],
      life_os_reminder_preferences: [record('prefs-1', { optedIn: true })],
      life_os_reminders: [record('reminder-1', { body: 'private nudge' })],
      life_os_dashboard_signals: [record('signal-1', { energyMoodAverage: 4 })],
      life_os_privacy_audits: [record('audit-1', { action: 'export_requested', payload: 'must not be here' })],
      hermes_conversations: [record('conversation-1', { participantUids: ['uid-1'], title: 'Life OS chat' })],
      hermes_conversation_messages: [record('message-1', { content: 'private coach message' })],
      metrics: [record('metric-1')],
    })

    const exported = await buildLifeOsExport(store, { orgId: 'org-1', ownerUid: 'uid-1', requestedAt: '2026-06-15T09:00:00.000Z' })

    expect(Object.keys(exported.lifeOs.families).sort()).toEqual(LIFE_OS_USER_DATA_FAMILIES.map((family) => family.key).sort())
    expect(exported.lifeOs.families.profile.records).toHaveLength(1)
    expect(exported.lifeOs.families.plans.records).toHaveLength(1)
    expect(exported.lifeOs.families.goals.records).toHaveLength(1)
    expect(exported.lifeOs.families.habits.records).toHaveLength(1)
    expect(exported.lifeOs.families.habitCheckIns.records).toHaveLength(1)
    expect(exported.lifeOs.families.reflections.records).toHaveLength(1)
    expect(exported.lifeOs.families.reviews.records).toHaveLength(1)
    expect(exported.lifeOs.families.coachContext.records).toHaveLength(1)
    expect(exported.lifeOs.families.coachInteractions.records).toHaveLength(1)
    expect(exported.lifeOs.families.experiments.records).toHaveLength(1)
    expect(exported.lifeOs.families.reminderSettings.records).toHaveLength(1)
    expect(exported.lifeOs.families.reminders.records).toHaveLength(1)
    expect(exported.lifeOs.families.dashboardSignals.records).toHaveLength(1)
    expect(exported.lifeOs.families.exportDeleteAudits.records).toHaveLength(1)
    expect(exported.lifeOs.families.coachConversations.records).toHaveLength(2)
    expect(JSON.stringify(exported.metrics ?? '')).not.toContain('private journal text')
    expect(JSON.stringify(exported)).not.toContain('other org')
    expect(JSON.stringify(exported)).not.toContain('other user')
  })

  it('deletes or anonymises only records matching active org and owner and writes redacted audit records', async () => {
    const store = new MemoryLifeOsStore({
      life_os_profiles: [record('profile-1', { displayName: 'Sensitive Name' }), record('profile-other', { ownerUid: 'uid-2', ownerId: 'uid-2' })],
      life_os_plans: [record('plan-1')],
      life_os_check_ins: [record('check-in-1'), record('check-in-other-org', { orgId: 'org-2' })],
      life_os_coach_interactions: [record('coach-interaction-1', { userMessage: 'private coaching prompt' })],
      life_os_privacy_audits: [record('old-audit-1', { action: 'export_requested' })],
      hermes_conversations: [record('conversation-1', { title: 'Private coach chat', participantUids: ['uid-1'] })],
      hermes_conversation_messages: [record('message-1', { content: 'private coach message' })],
    })

    const request = await requestLifeOsDelete(store, { orgId: 'org-1', ownerUid: 'uid-1', actorUid: 'uid-1', requestedAt: '2026-06-15T09:00:00.000Z' })
    store.updated = []
    const report = await deleteOrAnonymiseLifeOsUserData(store, { orgId: 'org-1', ownerUid: 'uid-1', actorUid: 'uid-1', requestedAt: '2026-06-15T09:05:00.000Z' })

    expect(request.auditId).toBe('life_os_privacy_audits-created')
    expect(store.deleted.sort()).toEqual([
      'hermes_conversation_messages/message-1',
      'life_os_check_ins/check-in-1',
      'life_os_coach_interactions/coach-interaction-1',
      'life_os_plans/plan-1',
    ])
    expect(store.updated.map((entry) => `${entry.collection}/${entry.id}`).sort()).toEqual([
      'hermes_conversations/conversation-1',
      'life_os_privacy_audits/old-audit-1',
      'life_os_profiles/profile-1',
    ])
    expect(store.records.life_os_profiles.find((candidate) => candidate.id === 'profile-other')).toBeTruthy()
    expect(store.records.life_os_check_ins.find((candidate) => candidate.id === 'check-in-other-org')).toBeTruthy()
    expect(report.totals).toMatchObject({ deleted: 4, anonymised: 3 })
    expect(JSON.stringify(store.created)).not.toContain('private coaching prompt')
    expect(JSON.stringify(store.created)).not.toContain('private coach message')
    expect(store.created.every((entry) => entry.collection === 'life_os_privacy_audits')).toBe(true)
  })
})
