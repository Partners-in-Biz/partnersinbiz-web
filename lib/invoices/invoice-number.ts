// lib/invoices/invoice-number.ts
import type * as FirebaseFirestore from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

/**
 * Generate a client-prefixed invoice number using an atomic Firestore transaction.
 * Format: CLI-001 (first 3 letters of client name, uppercase, then sequential number)
 * Example: "Lumen Digital" → LUM-001, LUM-002, etc.
 *
 * Uses a prefix-specific counter document at
 * organizations/{orgId}/counters/invoices_{PREFIX}. That keeps COU-001,
 * AHS-001, etc. independent while still preventing duplicates for the same
 * prefix under concurrent requests.
 */
function invoicePrefix(clientName: string): string {
  const alphaOnly = clientName.replace(/[^a-zA-Z]/g, '')
  return (alphaOnly.length >= 3 ? alphaOnly.slice(0, 3) : alphaOnly.padEnd(3, 'X')).toUpperCase()
}

function counterIdForPrefix(prefix: string): string {
  return `invoices_${prefix}`
}

function invoiceSequenceForPrefix(invoiceNumber: unknown, prefix: string): number {
  if (typeof invoiceNumber !== 'string') return 0
  const match = invoiceNumber.match(new RegExp(`^${prefix}-(\\d+)$`))
  return match ? Number(match[1]) || 0 : 0
}

async function highestExistingSequenceForPrefix(
  orgId: string,
  prefix: string,
  tx?: FirebaseFirestore.Transaction,
): Promise<number> {
  const query = adminDb.collection('invoices').where('orgId', '==', orgId)
  const snap = tx ? await tx.get(query) : await query.get()
  return snap.docs.reduce((max, doc) => {
    const sequence = invoiceSequenceForPrefix(doc.data()?.invoiceNumber, prefix)
    return Math.max(max, sequence)
  }, 0)
}

function counterCount(snap: FirebaseFirestore.DocumentSnapshot): number {
  if (!snap.exists) return 0
  const count = snap.data()?.count
  return typeof count === 'number' && Number.isFinite(count) ? count : 0
}

export async function generateInvoiceNumber(orgId: string, clientName: string): Promise<string> {
  const prefix = invoicePrefix(clientName)

  const counterRef = adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('counters')
    .doc(counterIdForPrefix(prefix))

  const count = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef)
    const current = snap.exists
      ? counterCount(snap)
      : await highestExistingSequenceForPrefix(orgId, prefix, tx)
    const next = current + 1
    tx.set(counterRef, { count: next, prefix }, { merge: true })
    return next
  })

  return `${prefix}-${String(count).padStart(3, '0')}`
}

/**
 * Preview what the next invoice number would be (for UI display).
 * Reads the current counter without incrementing — safe to call without side effects.
 */
export async function previewNextInvoiceNumber(orgId: string, clientName: string): Promise<string> {
  const prefix = invoicePrefix(clientName)

  const counterRef = adminDb
    .collection('organizations')
    .doc(orgId)
    .collection('counters')
    .doc(counterIdForPrefix(prefix))

  const snap = await counterRef.get()
  const current = snap.exists
    ? counterCount(snap)
    : await highestExistingSequenceForPrefix(orgId, prefix)
  const next = current + 1

  return `${prefix}-${String(next).padStart(3, '0')}`
}
