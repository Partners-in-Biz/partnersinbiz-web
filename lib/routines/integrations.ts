import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  decryptLinkedSecret,
  encryptLinkedSecret,
  type EncryptedLinkedSecret,
} from '@/lib/linked-computers/secret-envelope'
import { signPayload } from '@/lib/webhooks/sign'
import { getOrgIntegration, upsertOrgIntegration } from './store'
import type { OrgIntegration, OrgIntegrationProvider } from './types'

function secretContext(orgId: string, provider: OrgIntegrationProvider): string {
  return `org-integration:${orgId}:${provider}`
}

export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'utf8')
    const bb = Buffer.from(b, 'utf8')
    if (ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/**
 * Encrypt integration webhook secrets with the same helper as linked-computer
 * credentials when SOCIAL_TOKEN_MASTER_KEY is present. Otherwise store a
 * SHA-256 hash only (HMAC verify still works for inbound webhooks that
 * recompute against a provided plaintext secret configured at setup time —
 * hash-only mode requires the caller to pass the plaintext secret on verify
 * via env or a one-time setup response; re-verify uses constant-time hash compare).
 */
export function sealIntegrationSecret(
  secret: string,
  orgId: string,
  provider: OrgIntegrationProvider,
): { secretCiphertext: EncryptedLinkedSecret | null; secretHash: string } {
  const secretHash = hashSecret(secret)
  try {
    const secretCiphertext = encryptLinkedSecret(secret, secretContext(orgId, provider))
    return { secretCiphertext, secretHash }
  } catch {
    return { secretCiphertext: null, secretHash }
  }
}

export function openIntegrationSecret(row: OrgIntegration): string | null {
  if (row.secretCiphertext) {
    try {
      return decryptLinkedSecret(row.secretCiphertext, secretContext(row.orgId, row.provider))
    } catch {
      return null
    }
  }
  return null
}

/** PiB generic hook: X-PIB-Signature + X-PIB-Timestamp (same as outbound sign.ts). */
export function verifyPibHookSignature(input: {
  secret: string
  body: string
  timestampHeader: string | null
  signatureHeader: string | null
  nowMs?: number
  maxSkewMs?: number
}): boolean {
  const tsRaw = input.timestampHeader?.trim()
  const sig = input.signatureHeader?.trim()
  if (!tsRaw || !sig) return false
  const ts = Number(tsRaw)
  if (!Number.isFinite(ts)) return false
  const now = input.nowMs ?? Date.now()
  const maxSkew = input.maxSkewMs ?? 5 * 60_000
  if (Math.abs(now - ts) > maxSkew) return false
  const expected = signPayload(input.secret, input.body, ts)
  return safeEqualHex(expected, sig)
}

/** GitHub: X-Hub-Signature-256: sha256=<hex> over raw body. */
export function verifyGitHubSignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false
  const expected = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`
  return safeEqualHex(expected, signatureHeader.trim())
}

/** Slack: v0=<hex> of `v0:${timestamp}:${body}` with X-Slack-Signature + X-Slack-Request-Timestamp. */
export function verifySlackSignature(input: {
  secret: string
  body: string
  timestampHeader: string | null
  signatureHeader: string | null
  nowSec?: number
  maxSkewSec?: number
}): boolean {
  const ts = input.timestampHeader?.trim()
  const sig = input.signatureHeader?.trim()
  if (!ts || !sig) return false
  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum)) return false
  const now = input.nowSec ?? Math.floor(Date.now() / 1000)
  const maxSkew = input.maxSkewSec ?? 60 * 5
  if (Math.abs(now - tsNum) > maxSkew) return false
  const base = `v0:${ts}:${input.body}`
  const expected = `v0=${createHmac('sha256', input.secret).update(base, 'utf8').digest('hex')}`
  return safeEqualHex(expected, sig)
}

/** Linear: HMAC-SHA256 hex of body in Linear-Signature header. */
export function verifyLinearSignature(
  secret: string,
  body: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader?.trim()) return false
  const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return safeEqualHex(expected, signatureHeader.trim())
}

export async function ensureOrgIntegration(input: {
  orgId: string
  provider: OrgIntegrationProvider
  secret?: string
  enabled?: boolean
}): Promise<{ integration: OrgIntegration; plaintextSecret?: string }> {
  const existing = await getOrgIntegration(input.orgId, input.provider)
  const plaintext = input.secret?.trim() || (existing ? openIntegrationSecret(existing) : null) || randomBytes(24).toString('hex')
  const sealed = sealIntegrationSecret(plaintext, input.orgId, input.provider)
  const now = Date.now()
  const integration: OrgIntegration = {
    orgId: input.orgId,
    provider: input.provider,
    secretCiphertext: sealed.secretCiphertext,
    secretHash: sealed.secretHash,
    webhookPath: `/api/v1/integrations/${input.provider}/${input.provider === 'slack' ? 'events' : 'webhook'}`,
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAtMs: existing?.createdAtMs ?? now,
  }
  await upsertOrgIntegration(integration)
  return {
    integration,
    plaintextSecret: existing && !input.secret ? undefined : plaintext,
  }
}

export async function resolveIntegrationSecret(
  orgId: string,
  provider: OrgIntegrationProvider,
): Promise<string | null> {
  const row = await getOrgIntegration(orgId, provider)
  if (!row || !row.enabled) return null
  return openIntegrationSecret(row)
}
