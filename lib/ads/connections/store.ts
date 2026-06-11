// lib/ads/connections/store.ts
import { adminDb } from '@/lib/firebase/admin'
import { encryptToken, decryptToken } from '@/lib/social/encryption'
import { Timestamp } from 'firebase-admin/firestore'
import type { AdAccount, AdConnection, AdPlatform } from '@/lib/ads/types'
import crypto from 'crypto'

const COLLECTION = 'ad_connections'

interface CreateArgs {
  orgId: string
  platform: AdPlatform
  userId: string
  scopes: string[]
  accessToken: string
  refreshToken?: string
  expiresInSeconds: number
  adAccounts: AdAccount[]
  tokenType?: 'user' | 'system'
}

export async function createConnection(args: CreateArgs): Promise<AdConnection> {
  const id = `conn_${crypto.randomBytes(8).toString('hex')}`
  const now = Timestamp.now()
  const accessTokenEnc = encryptToken(args.accessToken, args.orgId)
  const refreshTokenEnc = args.refreshToken
    ? encryptToken(args.refreshToken, args.orgId)
    : undefined
  const expiresAt = Timestamp.fromMillis(Date.now() + args.expiresInSeconds * 1000)

  const doc: AdConnection = {
    id,
    orgId: args.orgId,
    platform: args.platform,
    status: 'active',
    userId: args.userId,
    scopes: args.scopes,
    adAccounts: args.adAccounts,
    tokenType: args.tokenType ?? 'user',
    accessTokenEnc,
    ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
    expiresAt,
    createdAt: now,
    updatedAt: now,
  }
  await adminDb.collection(COLLECTION).doc(id).set(doc)
  return doc
}

export async function getConnection(args: {
  orgId: string
  platform: AdPlatform
}): Promise<AdConnection | null> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where('orgId', '==', args.orgId)
    .where('platform', '==', args.platform)
    .get()
  if (snap.docs.length === 0) return null
  return snap.docs[0].data() as AdConnection
}

export async function listConnections(args: { orgId: string }): Promise<AdConnection[]> {
  const snap = await adminDb.collection(COLLECTION).where('orgId', '==', args.orgId).get()
  return snap.docs.map((d) => d.data() as AdConnection)
}

export async function updateConnection(
  id: string,
  patch: Partial<AdConnection>,
): Promise<void> {
  await adminDb
    .collection(COLLECTION)
    .doc(id)
    .update({
      ...patch,
      updatedAt: Timestamp.now(),
    })
}

export async function deleteConnection(id: string): Promise<void> {
  await adminDb.collection(COLLECTION).doc(id).delete()
}

/** Decrypt an access token. Throws if SOCIAL_TOKEN_MASTER_KEY is misconfigured. */
export function decryptAccessToken(conn: AdConnection): string {
  return decryptToken(conn.accessTokenEnc, conn.orgId)
}
