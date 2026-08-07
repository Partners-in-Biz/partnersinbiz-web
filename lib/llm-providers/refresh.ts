import crypto from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { decryptLlmCredentials, encryptLlmCredentials } from './crypto'
import { refreshXaiOAuthToken, XaiOAuthRefreshError } from './oauth/xai'
import { refreshAnthropicToken, AnthropicOAuthRefreshError } from './oauth/anthropic'
import { LLM_PROVIDER_CONNECTIONS_COLLECTION, type LlmProviderConnection } from './types'

// Managed runtimes receive access-only OAuth credentials. Keep a generous
// delivery window so the control plane can refresh, sync, and live-verify a
// profile before Hermes reaches the bearer expiry boundary.
const REFRESH_SKEW_MS = 30 * 60_000
const REFRESH_LEASE_MS = 2 * 60_000

export function oauthAccessTokenExpiresAt(accessToken: string): number {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1] || '', 'base64url').toString('utf8')) as {
      exp?: number
    }
    return Number.isFinite(payload.exp) ? Number(payload.exp) * 1000 : 0
  } catch {
    return 0
  }
}

function storedExpiresAtMs(credentials: Record<string, string>): number {
  const stored = credentials.expires_at ? Date.parse(credentials.expires_at) : 0
  return Number.isFinite(stored) && stored > 0 ? stored : 0
}

export function xaiCredentialsNeedRefresh(
  credentials: Record<string, string>,
  nowMs = Date.now(),
): boolean {
  const expiresAt = oauthAccessTokenExpiresAt(credentials.access_token || '')
  return !expiresAt || expiresAt <= nowMs + REFRESH_SKEW_MS
}

export function anthropicCredentialsNeedRefresh(
  credentials: Record<string, string>,
  nowMs = Date.now(),
): boolean {
  const expiresAt = storedExpiresAtMs(credentials) || oauthAccessTokenExpiresAt(credentials.access_token || '')
  return !expiresAt || expiresAt <= nowMs + REFRESH_SKEW_MS
}

/**
 * Refresh a managed OAuth connection before a sync when its access token is
 * close to expiry. xAI and Anthropic refresh tokens stay in the control plane;
 * runtimes receive access-only material.
 */
export async function ensureFreshLlmProviderConnection(
  connection: LlmProviderConnection,
): Promise<LlmProviderConnection> {
  if (connection.provider === 'xai-oauth') return ensureFreshXaiOauthConnection(connection)
  if (connection.provider === 'anthropic') return ensureFreshAnthropicOauthConnection(connection)
  return connection
}

async function ensureFreshXaiOauthConnection(
  connection: LlmProviderConnection,
): Promise<LlmProviderConnection> {
  if (!connection.credentialsEnc) throw new Error('xAI OAuth connection has no credentials')
  const currentCredentials = decryptLlmCredentials(connection.credentialsEnc, connection.scopeKeyRef)
  if (!xaiCredentialsNeedRefresh(currentCredentials)) return connection

  const ref = adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(connection.id)
  const leaseId = crypto.randomUUID()
  const leased = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new Error('xAI OAuth connection no longer exists')
    const current = { ...(snapshot.data() as LlmProviderConnection), id: snapshot.id }
    if (!current.credentialsEnc || current.status === 'revoked') {
      throw new Error('xAI OAuth connection is unavailable')
    }
    const credentials = decryptLlmCredentials(current.credentialsEnc, current.scopeKeyRef)
    if (!xaiCredentialsNeedRefresh(credentials)) return { current, credentials, acquired: false }
    const leaseUntil = Date.parse(String(current.meta?.refreshLeaseUntil || ''))
    if (Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
      throw new Error('xAI OAuth refresh is already in progress')
    }
    transaction.update(ref, {
      meta: {
        ...(current.meta || {}),
        refreshLeaseId: leaseId,
        refreshLeaseUntil: new Date(Date.now() + REFRESH_LEASE_MS).toISOString(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { current, credentials, acquired: true }
  })
  if (!leased.acquired) return leased.current
  if (!leased.credentials.refresh_token) {
    await ref.update({
      status: 'reauth_required',
      lastError: 'xAI OAuth refresh token is missing. Reconnect this account in Settings.',
      meta: { ...(leased.current.meta || {}), refreshLeaseId: null, refreshLeaseUntil: null },
      updatedAt: FieldValue.serverTimestamp(),
    })
    throw new Error('xAI OAuth account must be reconnected in Settings')
  }

  try {
    const refreshed = await refreshXaiOAuthToken(leased.credentials.refresh_token)
    const now = Date.now()
    const credentials = {
      ...leased.credentials,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || leased.credentials.refresh_token,
      ...(refreshed.expires_in ? { expires_in: String(refreshed.expires_in) } : {}),
      ...(refreshed.token_type ? { token_type: refreshed.token_type } : {}),
      ...(refreshed.scope ? { scope: refreshed.scope } : {}),
      obtained_at: new Date(now).toISOString(),
      expires_at: new Date(now + (Number(refreshed.expires_in) || 21_600) * 1000).toISOString(),
    }
    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const latest = snapshot.data() as LlmProviderConnection | undefined
      if (!latest || latest.meta?.refreshLeaseId !== leaseId) {
        throw new Error('xAI OAuth refresh lease was superseded')
      }
      transaction.update(ref, {
        credentialsEnc: encryptLlmCredentials(credentials, leased.current.scopeKeyRef),
        credentialVersion: Math.max(1, Number(latest.credentialVersion || 1)) + 1,
        status: 'connected',
        lastError: null,
        lastValidatedAt: FieldValue.serverTimestamp(),
        meta: {
          ...(latest.meta || {}),
          refreshLeaseId: null,
          refreshLeaseUntil: null,
          tokenExpiresAt: credentials.expires_at,
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
    const saved = await ref.get()
    return { ...(saved.data() as LlmProviderConnection), id: saved.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'xAI OAuth refresh failed'
    const requiresReauth = error instanceof XaiOAuthRefreshError && error.terminal
    await ref.update({
      status: requiresReauth ? 'reauth_required' : 'invalid',
      lastError: requiresReauth
        ? `${message}. Reconnect this account in Settings.`.slice(0, 500)
        : `xAI OAuth refresh temporarily failed: ${message}`.slice(0, 500),
      meta: { ...(leased.current.meta || {}), refreshLeaseId: null, refreshLeaseUntil: null },
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined)
    throw new Error(requiresReauth
      ? 'xAI OAuth account must be reconnected in Settings'
      : 'xAI OAuth refresh temporarily failed; it will retry automatically')
  }
}

async function ensureFreshAnthropicOauthConnection(
  connection: LlmProviderConnection,
): Promise<LlmProviderConnection> {
  if (!connection.credentialsEnc) throw new Error('Anthropic OAuth connection has no credentials')
  const currentCredentials = decryptLlmCredentials(connection.credentialsEnc, connection.scopeKeyRef)
  if (!anthropicCredentialsNeedRefresh(currentCredentials)) return connection

  const ref = adminDb.collection(LLM_PROVIDER_CONNECTIONS_COLLECTION).doc(connection.id)
  const leaseId = crypto.randomUUID()
  const leased = await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new Error('Anthropic OAuth connection no longer exists')
    const current = { ...(snapshot.data() as LlmProviderConnection), id: snapshot.id }
    if (!current.credentialsEnc || current.status === 'revoked') {
      throw new Error('Anthropic OAuth connection is unavailable')
    }
    const credentials = decryptLlmCredentials(current.credentialsEnc, current.scopeKeyRef)
    if (!anthropicCredentialsNeedRefresh(credentials)) return { current, credentials, acquired: false }
    const leaseUntil = Date.parse(String(current.meta?.refreshLeaseUntil || ''))
    if (Number.isFinite(leaseUntil) && leaseUntil > Date.now()) {
      throw new Error('Anthropic OAuth refresh is already in progress')
    }
    transaction.update(ref, {
      meta: {
        ...(current.meta || {}),
        refreshLeaseId: leaseId,
        refreshLeaseUntil: new Date(Date.now() + REFRESH_LEASE_MS).toISOString(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { current, credentials, acquired: true }
  })
  if (!leased.acquired) return leased.current
  if (!leased.credentials.refresh_token) {
    await ref.update({
      status: 'reauth_required',
      lastError: 'Anthropic OAuth refresh token is missing. Reconnect this account in Settings.',
      meta: { ...(leased.current.meta || {}), refreshLeaseId: null, refreshLeaseUntil: null },
      updatedAt: FieldValue.serverTimestamp(),
    })
    throw new Error('Anthropic OAuth account must be reconnected in Settings')
  }

  try {
    const refreshed = await refreshAnthropicToken(leased.credentials.refresh_token)
    const now = Date.now()
    const credentials = {
      ...leased.credentials,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || leased.credentials.refresh_token,
      ...(refreshed.expires_in ? { expires_in: String(refreshed.expires_in) } : {}),
      ...(refreshed.token_type ? { token_type: refreshed.token_type } : {}),
      ...(refreshed.scope ? { scope: refreshed.scope } : {}),
      obtained_at: new Date(now).toISOString(),
      expires_at: new Date(now + (Number(refreshed.expires_in) || 21_600) * 1000).toISOString(),
    }
    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const latest = snapshot.data() as LlmProviderConnection | undefined
      if (!latest || latest.meta?.refreshLeaseId !== leaseId) {
        throw new Error('Anthropic OAuth refresh lease was superseded')
      }
      transaction.update(ref, {
        credentialsEnc: encryptLlmCredentials(credentials, leased.current.scopeKeyRef),
        credentialVersion: Math.max(1, Number(latest.credentialVersion || 1)) + 1,
        status: 'connected',
        lastError: null,
        lastValidatedAt: FieldValue.serverTimestamp(),
        meta: {
          ...(latest.meta || {}),
          refreshLeaseId: null,
          refreshLeaseUntil: null,
          tokenExpiresAt: credentials.expires_at,
        },
        updatedAt: FieldValue.serverTimestamp(),
      })
    })
    const saved = await ref.get()
    return { ...(saved.data() as LlmProviderConnection), id: saved.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Anthropic OAuth refresh failed'
    const requiresReauth = error instanceof AnthropicOAuthRefreshError && error.terminal
    await ref.update({
      status: requiresReauth ? 'reauth_required' : 'invalid',
      lastError: requiresReauth
        ? `${message}. Reconnect this account in Settings.`.slice(0, 500)
        : `Anthropic OAuth refresh temporarily failed: ${message}`.slice(0, 500),
      meta: { ...(leased.current.meta || {}), refreshLeaseId: null, refreshLeaseUntil: null },
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined)
    throw new Error(requiresReauth
      ? 'Anthropic OAuth account must be reconnected in Settings'
      : 'Anthropic OAuth refresh temporarily failed; it will retry automatically')
  }
}
