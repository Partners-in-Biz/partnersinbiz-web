// lib/lead-capture/webhook.ts
//
// US-091: outbound webhook delivery for capture-source submissions.
//
// When a capture source has `webhookUrl` configured, every successful
// submission fires a POST to that URL with the submission payload. Delivery is:
//   - async / fire-and-forget — it NEVER blocks the submit response
//   - retried up to MAX_ATTEMPTS times with exponential backoff
//   - short per-attempt timeout so a slow endpoint can't hang the worker
//   - signed with HMAC-SHA256 when `webhookSecret` is set (X-PIB-Signature)
//
// Every delivery's outcome (status, attempts, errors) is written to the
// top-level `capture_webhook_deliveries` collection AND mirrored into a
// `deliveries` subcollection under the source doc, so the settings UI can show
// the last N deliveries cheaply.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { signPayload } from '@/lib/webhooks/sign'
import {
  type CaptureSource,
  type CaptureSubmission,
  type WebhookDeliveryAttempt,
  CAPTURE_WEBHOOK_DELIVERIES,
  LEAD_CAPTURE_SOURCES,
} from './types'

const MAX_ATTEMPTS = 3
const PER_ATTEMPT_TIMEOUT_MS = 8000
const BASE_BACKOFF_MS = 500 // 0.5s, 1s, 2s ...

export const WEBHOOK_EVENT = 'capture.submission'

export interface WebhookPayload {
  event: string
  capturedAt: string
  source: {
    id: string
    name: string
    type: string
    orgId: string
  }
  submission: {
    id: string
    email: string
    data: Record<string, string>
    contactId: string
    referer: string
    ipAddress: string
    userAgent: string
    requiresConfirmation: boolean
  }
  utm: Record<string, string>
}

function isValidWebhookUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  const trimmed = url.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function backoffMs(attempt: number): number {
  // attempt is 1-based; wait BEFORE the next attempt
  return BASE_BACKOFF_MS * 2 ** (attempt - 1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postOnce(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; statusCode: number | null; error: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    return {
      ok: res.ok,
      statusCode: res.status,
      error: res.ok ? null : `HTTP ${res.status}`,
    }
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `timeout after ${PER_ATTEMPT_TIMEOUT_MS}ms`
          : err.message
        : 'unknown error'
    return { ok: false, statusCode: null, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Deliver a submission to the source's webhook with retry + delivery logging.
 *
 * This is fire-and-forget from the caller's perspective: the returned promise
 * resolves once the delivery loop finishes, but callers should NOT await it on
 * the request hot-path (call without await, or `.catch(() => {})`).
 */
export async function deliverCaptureWebhook(opts: {
  source: CaptureSource
  submission: CaptureSubmission
  utm: Record<string, string>
  requiresConfirmation: boolean
}): Promise<void> {
  const { source, submission, utm, requiresConfirmation } = opts
  const url = source.webhookUrl
  if (!isValidWebhookUrl(url)) return

  const payload: WebhookPayload = {
    event: WEBHOOK_EVENT,
    capturedAt: new Date().toISOString(),
    source: {
      id: source.id,
      name: source.name,
      type: source.type,
      orgId: source.orgId,
    },
    submission: {
      id: submission.id,
      email: submission.email,
      data: submission.data ?? {},
      contactId: submission.contactId,
      referer: submission.referer ?? '',
      ipAddress: submission.ipAddress ?? '',
      userAgent: submission.userAgent ?? '',
      requiresConfirmation,
    },
    utm,
  }

  const body = JSON.stringify(payload)
  const timestamp = Date.now()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'PartnersInBiz-Webhook/1.0',
    'X-PIB-Event': WEBHOOK_EVENT,
    'X-PIB-Source-Id': source.id,
    'X-PIB-Delivery-Timestamp': String(timestamp),
  }

  const secret = typeof source.webhookSecret === 'string' ? source.webhookSecret.trim() : ''
  if (secret) {
    headers['X-PIB-Signature'] = signPayload(secret, body, timestamp)
    headers['X-PIB-Timestamp'] = String(timestamp)
  }

  const attempts: WebhookDeliveryAttempt[] = []
  let delivered = false

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now()
    const result = await postOnce(url, body, headers)
    attempts.push({
      attempt,
      ok: result.ok,
      statusCode: result.statusCode,
      error: result.error,
      durationMs: Date.now() - startedAt,
      at: new Date(startedAt).toISOString(),
    })
    if (result.ok) {
      delivered = true
      break
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(backoffMs(attempt))
    }
  }

  const last = attempts[attempts.length - 1]
  const deliveryDoc = {
    orgId: source.orgId,
    captureSourceId: source.id,
    submissionId: submission.id,
    contactId: submission.contactId,
    url,
    event: WEBHOOK_EVENT,
    status: delivered ? 'success' : 'failed',
    statusCode: last?.statusCode ?? null,
    attempts,
    attemptCount: attempts.length,
    lastError: delivered ? null : last?.error ?? 'delivery failed',
    createdAt: FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
  }

  // Write the delivery log to both the top-level collection (queryable) and the
  // source subcollection (cheap UI reads). Best-effort — never throw.
  try {
    const topRef = adminDb.collection(CAPTURE_WEBHOOK_DELIVERIES).doc()
    await topRef.set(deliveryDoc)
    await adminDb
      .collection(LEAD_CAPTURE_SOURCES)
      .doc(source.id)
      .collection('deliveries')
      .doc(topRef.id)
      .set(deliveryDoc)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[lead-capture] webhook delivery log failed', err)
  }
}
