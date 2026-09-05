import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { BotAvatarStyle } from '@/lib/agents/types'

/**
 * Per-org Bot mode look. Platform specialists (pip, theo, …) are shared across
 * tenants, so their avatar lives here instead of on the shared agent_team doc;
 * custom org bots use the same doc shape for one read path.
 */
export const BOT_APPEARANCE_COLLECTION = 'bot_appearance'

export interface BotAppearanceDoc {
  orgId: string
  agentId: string
  avatarUrl: string | null
  avatarStyle: BotAvatarStyle
  updatedByUserId: string
  updatedAt?: unknown
}

export type BotAppearance = Pick<BotAppearanceDoc, 'avatarUrl' | 'avatarStyle'>

export function botAppearanceDocId(orgId: string, agentId: string): string {
  return `${orgId}_${agentId}`
}

export function botAppearanceRef(orgId: string, agentId: string) {
  return adminDb.collection(BOT_APPEARANCE_COLLECTION).doc(botAppearanceDocId(orgId, agentId))
}

export async function loadBotAppearance(orgId: string, agentId: string): Promise<BotAppearance | null> {
  const snap = await botAppearanceRef(orgId, agentId).get()
  if (!snap.exists) return null
  const data = snap.data() as Partial<BotAppearanceDoc>
  return { avatarUrl: data.avatarUrl ?? null, avatarStyle: data.avatarStyle ?? 'blob' }
}

export async function loadBotAppearanceMapForOrg(orgId: string): Promise<Record<string, BotAppearance>> {
  const snap = await adminDb.collection(BOT_APPEARANCE_COLLECTION).where('orgId', '==', orgId).get()
  const map: Record<string, BotAppearance> = {}
  for (const doc of snap.docs) {
    const data = doc.data() as Partial<BotAppearanceDoc>
    if (typeof data.agentId !== 'string') continue
    map[data.agentId] = { avatarUrl: data.avatarUrl ?? null, avatarStyle: data.avatarStyle ?? 'blob' }
  }
  return map
}

export async function saveBotAppearance(input: {
  orgId: string
  agentId: string
  actorUserId: string
  avatarUrl: string | null
  avatarStyle: BotAvatarStyle
}): Promise<BotAppearance> {
  const doc: BotAppearanceDoc = {
    orgId: input.orgId,
    agentId: input.agentId,
    avatarUrl: input.avatarUrl,
    avatarStyle: input.avatarStyle,
    updatedByUserId: input.actorUserId,
    updatedAt: FieldValue.serverTimestamp(),
  }
  await botAppearanceRef(input.orgId, input.agentId).set(doc, { merge: true })
  return { avatarUrl: doc.avatarUrl, avatarStyle: doc.avatarStyle }
}
