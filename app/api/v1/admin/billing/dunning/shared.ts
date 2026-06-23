/**
 * Shared server helpers for the EFT dunning endpoints. Colocated with the
 * dunning routes (not a Next.js route file — only `route.ts` is routed).
 *
 * EFT-first: dunning = payment-reminder email sequences. No card retries.
 */
import { adminDb } from '@/lib/firebase/admin'
import type { DunningConfig } from '@/lib/billing/types'

export const DUNNING_CONFIG_COLLECTION = 'billing_config'
export const DUNNING_CONFIG_DOC = 'dunning'
export const DUNNING_SEQUENCES_COLLECTION = 'dunning_sequences'
export const DUNNING_EMAILS_COLLECTION = 'dunning_emails'

/** Sensible default config (inactive until an operator turns it on). */
export function defaultDunningConfig(): DunningConfig {
  return {
    active: false,
    stages: [
      {
        daysAfterDue: 1,
        subject: 'Reminder: invoice {{invoiceNumber}} is overdue',
        body:
          'Hi {{orgName}},\n\nOur records show invoice {{invoiceNumber}} for {{amount}} is now past its due date. ' +
          'Please make payment via EFT at your earliest convenience. If you have already paid, kindly ignore this message.\n\n' +
          'Thank you,\nPartners in Biz Billing',
        suspend: false,
      },
      {
        daysAfterDue: 7,
        subject: 'Second reminder: invoice {{invoiceNumber}} still outstanding',
        body:
          'Hi {{orgName}},\n\nInvoice {{invoiceNumber}} for {{amount}} remains unpaid. ' +
          'Please settle the outstanding amount via EFT to avoid any interruption to your service.\n\n' +
          'Thank you,\nPartners in Biz Billing',
        suspend: false,
      },
      {
        daysAfterDue: 14,
        subject: 'Final notice: invoice {{invoiceNumber}} — service suspension',
        body:
          'Hi {{orgName}},\n\nInvoice {{invoiceNumber}} for {{amount}} is now seriously overdue. ' +
          'As a result your subscription has been suspended. Please make payment via EFT to restore your service. ' +
          'Reach out to billing if you need to arrange a payment plan.\n\n' +
          'Partners in Biz Billing',
        suspend: true,
      },
    ],
  }
}

export function toMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
  if (typeof v.toMillis === 'function') {
    try { return v.toMillis() } catch { return null }
  }
  const seconds = v.seconds ?? v._seconds
  if (typeof seconds === 'number') return seconds * 1000
  return null
}

export interface OverdueInvoice {
  id: string
  invoiceNumber: string
  orgId: string
  total: number
  currency: string
  dueDate: number | null
  dueDateMs: number | null
  status: string
  recipientEmail: string | null
}

/**
 * Invoices considered overdue: status `sent` or `overdue` with a dueDate in
 * the past. Status is unindexed-friendly (we filter in memory) so it stays
 * cron-safe without a composite index.
 */
export async function loadOverdueInvoices(): Promise<OverdueInvoice[]> {
  const now = Date.now()
  const snap = await adminDb
    .collection('invoices')
    .where('status', 'in', ['sent', 'overdue'])
    .get()

  const out: OverdueInvoice[] = []
  for (const doc of snap.docs) {
    const inv = doc.data() as Record<string, unknown>
    const dueMs = toMillis(inv.dueDate)
    if (!dueMs || dueMs >= now) continue
    const orgId = typeof inv.orgId === 'string' ? inv.orgId : ''
    if (!orgId) continue
    const clientDetails = (inv.clientDetails ?? {}) as Record<string, unknown>
    out.push({
      id: doc.id,
      invoiceNumber: typeof inv.invoiceNumber === 'string' ? inv.invoiceNumber : doc.id,
      orgId,
      total: typeof inv.total === 'number' ? inv.total : 0,
      currency: typeof inv.currency === 'string' ? inv.currency : 'ZAR',
      dueDate: dueMs,
      dueDateMs: dueMs,
      status: typeof inv.status === 'string' ? inv.status : 'sent',
      recipientEmail:
        (typeof inv.recipientEmail === 'string' && inv.recipientEmail) ||
        (typeof clientDetails.email === 'string' && clientDetails.email) ||
        null,
    })
  }
  return out
}

/** Render a dunning template, replacing the supported variables. */
export function renderTemplate(
  template: string,
  vars: { invoiceNumber: string; amount: string; orgName: string },
): string {
  return template
    .replace(/\{\{\s*invoiceNumber\s*\}\}/g, vars.invoiceNumber)
    .replace(/\{\{\s*amount\s*\}\}/g, vars.amount)
    .replace(/\{\{\s*orgName\s*\}\}/g, vars.orgName)
}
