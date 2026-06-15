import { adminDb } from '@/lib/firebase/admin'
import type { LifeOsUserDataRecord, LifeOsUserDataStore } from './life-os-user-data'
import { LIFE_OS_USER_DATA_FAMILIES } from './life-os-user-data'

const TOP_LEVEL_COLLECTIONS = Array.from(new Set(
  LIFE_OS_USER_DATA_FAMILIES
    .flatMap((family) => family.collections)
    .filter((collection) => collection !== 'hermes_conversation_messages'),
))

const HERMES_MESSAGE_VIRTUAL_COLLECTION = 'hermes_conversation_messages'

export class FirestoreLifeOsUserDataStore implements LifeOsUserDataStore {
  private readonly pathByVirtualId = new Map<string, string>()

  async listCollection(collection: string): Promise<LifeOsUserDataRecord[]> {
    if (collection === HERMES_MESSAGE_VIRTUAL_COLLECTION) return this.listHermesMessages()
    if (!TOP_LEVEL_COLLECTIONS.includes(collection)) return []
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
    await adminDb.collection(collection).doc(id).set(patch, { merge: true })
  }

  async createRecord(collection: string, data: Record<string, unknown>): Promise<string> {
    const doc = await adminDb.collection(collection).add(data)
    return doc.id
  }

  private async listHermesMessages(): Promise<LifeOsUserDataRecord[]> {
    const conversations = await adminDb.collection('hermes_conversations').get()
    const records: LifeOsUserDataRecord[] = []

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
            ownerId: conversationData.ownerId ?? conversationData.ownerUid,
            participantUids: conversationData.participantUids,
            conversationId: conversation.id,
          },
        })
      }
    }

    return records
  }
}
