// lib/companies/migration.ts
// Pure normalization + grouping algorithm and Firestore-backed apply for the
// "migrate company strings from contacts → first-class Company entities" tool.

import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'
import type { Contact } from '@/lib/crm/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

// ─── Public interfaces ─────────────────────────────────────────────────────

export interface MigrationGroup {
  normalizedKey: string
  rawValues: string[]           // unique raw strings seen (e.g. ['ACME Corp', 'Acme Corp'])
  suggestedCompanyName: string  // most-frequent raw value
  contactIds: string[]          // contacts belonging to this group (no companyId yet)
  existingCompanyId: string | null  // populated by endpoint after DB lookup
}

export interface MigrationSelection {
  normalizedKey: string
  companyName: string            // user-editable name to use
  applyToContactIds: string[]    // subset of MigrationGroup.contactIds to link
  useExistingCompanyId?: string  // if set, link to existing company rather than creating
}

export interface MigrationResult {
  normalizedKey: string
  outcome: 'created' | 'linked' | 'failed'
  companyId?: string
  error?: string
  contactsUpdated: number
}

// ─── normalizeCompanyKey ───────────────────────────────────────────────────

/**
 * Canonical key for grouping company strings:
 *   NFC unicode normalization → lowercase → trim → collapse internal whitespace.
 * Returns '' for null / undefined / whitespace-only input.
 */
export function normalizeCompanyKey(s: string | undefined | null): string {
  if (!s) return ''
  const result = s
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
  return result
}

// ─── groupContactsByCompanyKey ─────────────────────────────────────────────

/**
 * Groups contacts by normalized company string.
 * Contacts that already have `companyId` are skipped (already migrated).
 * Contacts with empty/whitespace-only company string are skipped.
 * The `existingCompanyId` field is always null here — the API endpoint resolves
 * it via a DB name-lookup after grouping.
 */
export function groupContactsByCompanyKey(contacts: Contact[]): MigrationGroup[] {
  const byKey = new Map<string, { rawValues: string[]; contactIds: string[] }>()

  for (const c of contacts) {
    if (c.companyId) continue                     // already linked — skip
    const key = normalizeCompanyKey(c.company)
    if (!key) continue                             // empty / whitespace — skip

    const entry = byKey.get(key) ?? { rawValues: [], contactIds: [] }
    entry.rawValues.push(c.company)
    entry.contactIds.push(c.id)
    byKey.set(key, entry)
  }

  return Array.from(byKey.entries()).map(([normalizedKey, entry]) => ({
    normalizedKey,
    rawValues: Array.from(new Set(entry.rawValues)),
    suggestedCompanyName: pickMostCommon(entry.rawValues),
    contactIds: entry.contactIds,
    existingCompanyId: null,
  }))
}

/** Returns the most frequently occurring value in an array; ties → first seen. */
function pickMostCommon(arr: string[]): string {
  const counts = new Map<string, number>()
  for (const s of arr) counts.set(s, (counts.get(s) ?? 0) + 1)
  let best = arr[0]
  let bestCount = 0
  for (const [s, n] of counts.entries()) {
    if (n > bestCount) {
      best = s
      bestCount = n
    }
  }
  return best
}

// ─── applyMigration ────────────────────────────────────────────────────────

const BATCH_CHUNK = 30  // Firestore batch write limit

/**
 * For each selection:
 * 1. Create a new Company document (unless useExistingCompanyId is set).
 * 2. Batch-update all `applyToContactIds` with { companyId, companyName, updatedAt }.
 * 3. Return a per-selection result with outcome 'created' | 'linked' | 'failed'.
 *
 * Idempotent: already-linked contacts will be re-linked to the same company
 * without error (they are typically filtered out by groupContactsByCompanyKey
 * on a second preview run).
 */
export async function applyMigration(
  orgId: string,
  selections: MigrationSelection[],
  actor: MemberRef,
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = []

  for (const sel of selections) {
    try {
      let companyId = sel.useExistingCompanyId

      if (!companyId) {
        // Create new company
        const ref = adminDb.collection('companies').doc()
        await ref.set({
          orgId,
          name: sel.companyName,
          tags: [],
          notes: '',
          createdBy: actor.uid,
          createdByRef: actor,
          updatedBy: actor.uid,
          updatedByRef: actor,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        })
        companyId = ref.id
      }

      // Batch-update contacts in 30-record chunks
      let updated = 0
      for (let i = 0; i < sel.applyToContactIds.length; i += BATCH_CHUNK) {
        const slice = sel.applyToContactIds.slice(i, i + BATCH_CHUNK)
        const batch = adminDb.batch()
        for (const cid of slice) {
          batch.update(
            adminDb.collection('contacts').doc(cid),
            { companyId, companyName: sel.companyName, updatedAt: Timestamp.now() },
          )
        }
        await batch.commit()
        updated += slice.length
      }

      results.push({
        normalizedKey: sel.normalizedKey,
        outcome: sel.useExistingCompanyId ? 'linked' : 'created',
        companyId,
        contactsUpdated: updated,
      })
    } catch (e) {
      results.push({
        normalizedKey: sel.normalizedKey,
        outcome: 'failed',
        error: e instanceof Error ? e.message : String(e),
        contactsUpdated: 0,
      })
    }
  }

  return results
}
