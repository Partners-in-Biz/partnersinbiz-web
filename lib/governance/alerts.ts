// lib/governance/alerts.ts
// Reusable admin-alert dispatcher. Other governance routes call
// dispatchAdminAlert(event, payload) to fan out critical platform events to a
// configured webhook (e.g. Slack incoming webhook). Configuration lives in
// platform_config/alerts; every attempt is recorded in admin_alert_history.
// This never throws — alerting must never break the calling operation.
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

export const ALERT_EVENTS = [
  'org.created',
  'billing.payment_failed',
  'billing.eft_received',
  'support.urgent',
  'maintenance.toggled',
  'security.admin_lockout',
  'moderation.flagged',
] as const

export type AlertEvent = (typeof ALERT_EVENTS)[number] | string

interface AlertConfig {
  webhookUrl: string
  slackEnabled: boolean
  events: Record<string, boolean>
}

async function loadAlertConfig(): Promise<AlertConfig | null> {
  try {
    const snap = await adminDb.collection('platform_config').doc('alerts').get()
    if (!snap.exists) return null
    const data = snap.data() ?? {}
    return {
      webhookUrl: typeof data.webhookUrl === 'string' ? data.webhookUrl : '',
      slackEnabled: data.slackEnabled === true,
      events: typeof data.events === 'object' && data.events ? (data.events as Record<string, boolean>) : {},
    }
  } catch {
    return null
  }
}

async function recordAttempt(entry: {
  event: string
  status: 'sent' | 'failed' | 'skipped'
  httpStatus: number | null
  actor: Record<string, unknown> | null
  error?: string
}): Promise<void> {
  try {
    await adminDb.collection('admin_alert_history').add({
      ...entry,
      at: FieldValue.serverTimestamp(),
    })
  } catch {
    /* swallow — history is best-effort */
  }
}

/**
 * Dispatch an admin alert for `event`. Loads config, checks the event is
 * enabled and a webhook is configured, POSTs the payload, and records the
 * attempt. Never throws.
 */
export async function dispatchAdminAlert(event: string, payload: Record<string, unknown>): Promise<void> {
  const config = await loadAlertConfig()
  if (!config || !config.webhookUrl) {
    return
  }
  if (config.events[event] !== true) {
    return
  }

  const body = {
    text: `PiB admin alert: ${event}`,
    event,
    at: new Date().toISOString(),
    ...payload,
  }

  try {
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await recordAttempt({
      event,
      status: res.ok ? 'sent' : 'failed',
      httpStatus: res.status,
      actor: null,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    })
  } catch (err) {
    await recordAttempt({
      event,
      status: 'failed',
      httpStatus: null,
      actor: null,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
