/**
 * lib/observability/health-probe.ts
 *
 * Real per-service health probes for the admin System Health page (US-266).
 * Each probe measures REAL latency by timing the round-trip. No fabricated
 * numbers — where a service can't be instrumented, status is 'not-configured'
 * and latencyMs is null.
 *
 * Services probed:
 *   - firestore:    times a tiny adminDb.collection('_health').limit(1).get()
 *   - auth:         times adminAuth.listUsers(1)
 *   - paypal:       times a real OAuth client_credentials token request (if creds set)
 *   - social:       counts connected social_accounts (reachability not instrumented)
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { getPayPalAccessToken } from '@/lib/payments/paypal'

export type ServiceStatus = 'ok' | 'degraded' | 'down' | 'not-configured'

export interface ServiceHealth {
  name: string
  /** Stable key used for storage / uptime aggregation. */
  key: string
  status: ServiceStatus
  /** Real measured round-trip latency in ms, or null when not instrumented. */
  latencyMs: number | null
  /** True when latency is genuinely not measurable for this service. */
  latencyInstrumented: boolean
  lastCheckedAt: string
  /** Optional human note (e.g. "12 connected accounts", "not configured"). */
  detail: string | null
}

export const HEALTH_CHECKS_COLLECTION = 'health_checks'

/** A "degraded" latency threshold (ms) — anything slower is flagged degraded. */
const DEGRADED_MS = 1500

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: unknown }> {
  const t0 = Date.now()
  try {
    const value = await fn()
    return { ms: Date.now() - t0, value }
  } catch (error) {
    return { ms: Date.now() - t0, error }
  }
}

function classify(ms: number, ok: boolean): ServiceStatus {
  if (!ok) return 'down'
  return ms > DEGRADED_MS ? 'degraded' : 'ok'
}

async function probeFirestore(now: string): Promise<ServiceHealth> {
  const r = await timed(() => adminDb.collection('_health').limit(1).get())
  const ok = !r.error
  return {
    name: 'Firestore',
    key: 'firestore',
    status: classify(r.ms, ok),
    latencyMs: r.ms,
    latencyInstrumented: true,
    lastCheckedAt: now,
    detail: ok ? 'read round-trip' : (r.error instanceof Error ? r.error.message : 'probe failed'),
  }
}

async function probeAuth(now: string): Promise<ServiceHealth> {
  const r = await timed(() => adminAuth.listUsers(1))
  const ok = !r.error
  return {
    name: 'Firebase Auth',
    key: 'auth',
    status: classify(r.ms, ok),
    latencyMs: r.ms,
    latencyInstrumented: true,
    lastCheckedAt: now,
    detail: ok ? 'listUsers(1)' : (r.error instanceof Error ? r.error.message : 'probe failed'),
  }
}

async function probePayPal(now: string): Promise<ServiceHealth> {
  const configured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET)
  if (!configured) {
    return {
      name: 'PayPal',
      key: 'paypal',
      status: 'not-configured',
      latencyMs: null,
      latencyInstrumented: true,
      lastCheckedAt: now,
      detail: 'PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set',
    }
  }
  const r = await timed(() => getPayPalAccessToken())
  const ok = !r.error
  return {
    name: 'PayPal',
    key: 'paypal',
    status: classify(r.ms, ok),
    latencyMs: r.ms,
    latencyInstrumented: true,
    lastCheckedAt: now,
    detail: ok ? `OAuth token (${process.env.PAYPAL_ENV ?? 'live'})` : (r.error instanceof Error ? r.error.message : 'token request failed'),
  }
}

async function probeSocial(now: string): Promise<ServiceHealth> {
  // No cheap aggregate reachability check across N social providers without
  // making N live API calls (and burning rate limits / requiring per-account
  // tokens). Report the real count of connected accounts; latency is NOT
  // instrumented for the social provider mesh.
  const r = await timed(() => adminDb.collection('social_accounts').count().get())
  if (r.error) {
    return {
      name: 'Social APIs',
      key: 'social',
      status: 'degraded',
      latencyMs: null,
      latencyInstrumented: false,
      lastCheckedAt: now,
      detail: 'connected-account count failed; reachability not instrumented',
    }
  }
  const count = r.value?.data().count ?? 0
  return {
    name: 'Social APIs',
    key: 'social',
    status: 'ok',
    latencyMs: null,
    latencyInstrumented: false,
    lastCheckedAt: now,
    detail: `${count} connected account${count === 1 ? '' : 's'} — reachability not instrumented`,
  }
}

/**
 * Run all service probes concurrently. Returns the per-service health array.
 */
export async function probeAllServices(): Promise<ServiceHealth[]> {
  const now = new Date().toISOString()
  const [firestore, auth, paypal, social] = await Promise.all([
    probeFirestore(now),
    probeAuth(now),
    probePayPal(now),
    probeSocial(now),
  ])
  return [firestore, auth, paypal, social]
}

/**
 * Persist a probe snapshot to `health_checks` (one doc per probe run).
 * Best-effort; never throws.
 */
export async function recordHealthChecks(services: ServiceHealth[]): Promise<void> {
  try {
    const batch = adminDb.batch()
    const col = adminDb.collection(HEALTH_CHECKS_COLLECTION)
    for (const svc of services) {
      const ref = col.doc()
      batch.set(ref, {
        service: svc.key,
        name: svc.name,
        status: svc.status,
        latencyMs: svc.latencyMs,
        checkedAt: FieldValue.serverTimestamp(),
        checkedAtMs: Date.now(),
      })
    }
    await batch.commit()
  } catch (err) {
    console.error('[recordHealthChecks] failed to persist', err)
  }
}

export { Timestamp }
