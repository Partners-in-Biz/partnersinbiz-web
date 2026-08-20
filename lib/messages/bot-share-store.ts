import crypto from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import {
  buildBotShareSnapshot,
  parseBotShareId,
  parseBotShareVisibility,
  publicBotSharePreview,
  type BotShareRecord,
  type BotShareVisibility,
  type PublicBotSharePreview,
} from '@/lib/messages/bot-shares'

export const BOT_SHARES_COLLECTION = 'bot_shares'

export function newBotShareId(): string {
  return `bs_${crypto.randomBytes(12).toString('hex')}`
}

function shareDoc(shareId: string) {
  return adminDb.collection(BOT_SHARES_COLLECTION).doc(shareId)
}

export async function createBotShare(input: {
  sourceOrgId: string
  sourceAgentId: string
  visibility: BotShareVisibility
  allowClone: boolean
  createdByUserId: string
  agent: {
    name?: string | null
    role?: string | null
    persona?: string | null
    iconKey?: string | null
    colorKey?: string | null
    defaultModel?: string | null
    agentHandle?: string | null
  }
}): Promise<BotShareRecord> {
  const snapshot = buildBotShareSnapshot(input.agent)
  if (!snapshot) throw new Error('This Bot is missing a name, role, or purpose')
  const shareId = newBotShareId()
  const data: BotShareRecord = {
    shareId,
    sourceOrgId: input.sourceOrgId,
    sourceAgentId: input.sourceAgentId,
    visibility: parseBotShareVisibility(input.visibility),
    allowClone: input.allowClone !== false,
    createdByUserId: input.createdByUserId,
    snapshot,
  }
  await shareDoc(shareId).create({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return data
}

function revokedAtIso(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    try {
      const date = (value as { toDate: () => Date }).toDate()
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
    } catch {
      return null
    }
  }
  return null
}

export async function getBotShare(shareId: string): Promise<(BotShareRecord & { revokedAt?: string | null }) | null> {
  const id = parseBotShareId(shareId)
  if (!id) return null
  const snap = await shareDoc(id).get()
  if (!snap.exists) return null
  const row = snap.data() as Omit<BotShareRecord, 'revokedAt'> & { revokedAt?: unknown }
  return {
    ...row,
    shareId: id,
    revokedAt: revokedAtIso(row.revokedAt),
  }
}

export function previewBotShare(share: BotShareRecord): PublicBotSharePreview | null {
  return publicBotSharePreview(share)
}
