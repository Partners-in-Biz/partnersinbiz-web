import { adminDb } from '@/lib/firebase/admin'
import {
  runLifeOsRetention,
  type LifeOsRetentionOptions,
  type LifeOsRetentionRecord,
  type LifeOsRetentionReport,
  type LifeOsRetentionStore,
} from './life-os-retention'

const LIFE_OS_TOP_LEVEL_COLLECTIONS = [
  'life_os_profiles',
  'life_os_goals',
  'life_os_plans',
  'life_os_actions',
  'life_os_habits',
  'life_os_habit_check_ins',
  'life_os_check_ins',
  'life_os_reviews',
  'life_os_coach_contexts',
  'life_os_coach_interactions',
  'life_os_experiments',
  'life_os_reminder_preferences',
  'life_os_reminders',
  'life_os_dashboard_signals',
  'life_os_privacy_audits',
  'hermes_conversations',
] as const

const HERMES_MESSAGE_VIRTUAL_COLLECTION = 'hermes_conversation_messages'

export class FirestoreLifeOsRetentionStore implements LifeOsRetentionStore {
  private readonly pathByVirtualId = new Map<string, string>()

  async listCollection(collection: string): Promise<LifeOsRetentionRecord[]> {
    if (collection === HERMES_MESSAGE_VIRTUAL_COLLECTION) return this.listHermesMessages()
    if (!LIFE_OS_TOP_LEVEL_COLLECTIONS.includes(collection as never)) return []

    const snapshot = await adminDb.collection(collection).get()
    return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }))
  }

  async deleteRecord(collection: string, id: string): Promise<void> {
    if (collection === HERMES_MESSAGE_VIRTUAL_COLLECTION) {
      const path = this.pathByVirtualId.get(id)
      if (!path) throw new Error(`Unknown virtual message record: ${id}`)
      await adminDb.doc(path).delete()
      return
    }

    await adminDb.collection(collection).doc(id).delete()
  }

  async updateRecord(collection: string, id: string, patch: Record<string, unknown>): Promise<void> {
    await adminDb.collection(collection).doc(id).update(patch)
  }

  private async listHermesMessages(): Promise<LifeOsRetentionRecord[]> {
    const conversations = await adminDb.collection('hermes_conversations').get()
    const records: LifeOsRetentionRecord[] = []

    for (const conversation of conversations.docs) {
      const conversationData = conversation.data()
      const messages = await conversation.ref.collection('messages').get()
      for (const message of messages.docs) {
        const virtualId = `${conversation.id}/${message.id}`
        this.pathByVirtualId.set(virtualId, message.ref.path)
        records.push({
          id: virtualId,
          data: {
            ...message.data(),
            orgId: conversationData.orgId,
            ownerUid: conversationData.ownerUid,
            ownerId: conversationData.ownerUid,
            participantUids: conversationData.participantUids,
            conversationId: conversation.id,
          },
        })
      }
    }

    return records
  }
}

export async function runFirestoreLifeOsRetention(options: LifeOsRetentionOptions): Promise<LifeOsRetentionReport> {
  return runLifeOsRetention(new FirestoreLifeOsRetentionStore(), options)
}
