// lib/crm/facts/record.ts
// Evidence-first fact write path. Tools never pass model confidence.

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { scoreEvidence } from './evidence'
import {
  HUMAN_OWNABLE_CONTACT_COLUMNS,
  columnForField,
  sameFactValue,
} from './fields'
import {
  createFactDoc,
  findActiveFactsForField,
  findDismissedMatch,
  getFactById,
  supersedeFacts,
  updateFactDoc,
} from './store'
import type {
  DecideFactInput,
  DecideFactResult,
  FactContactView,
  FactField,
  RecordFactInput,
  RecordFactResult,
} from './types'

function cleanValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function isHumanOwned(contact: FactContactView, field: FactField): boolean {
  const owned = contact.humanOwnedFields
  if (!Array.isArray(owned) || owned.length === 0) return false
  const column = columnForField(field)
  // humanOwnedFields stores contact columns (jobTitle) and/or fact fields (title)
  return owned.includes(field) || (column != null && owned.includes(column))
}

function currentContactValue(contact: FactContactView, field: FactField): string | null {
  const column = columnForField(field)
  if (!column) {
    if (field === 'employer') {
      const v = contact.company
      return typeof v === 'string' && v.trim() ? v.trim() : null
    }
    return null
  }
  const raw = contact[column]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

/**
 * Record an observation-backed fact about a contact.
 *
 * Hard rules (enforced in code, not agent prompt):
 * 1. Never accept model confidence — score comes from evidence kinds only.
 * 2. Never re-propose a dismissed field+value.
 * 3. Never auto-apply over a human-owned field.
 * 4. VERIFIED requires a primary evidence source; only then auto-apply.
 * 5. PROBABLE becomes PROPOSED for human accept/dismiss.
 * 6. POSSIBLE is stored but not surfaced in default proposals UI.
 * 7. Contradictions hold (band drops; no auto-apply).
 */
export async function recordContactFact(
  input: RecordFactInput,
  contact: FactContactView,
): Promise<RecordFactResult> {
  const value = cleanValue(input.value)
  if (!value) {
    return {
      stored: false,
      applied: false,
      band: null,
      score: 0,
      rationale: 'Empty value.',
      reason: 'empty_value',
    }
  }

  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    return {
      stored: false,
      applied: false,
      band: null,
      score: 0,
      rationale: 'No evidence.',
      reason: 'no_evidence',
    }
  }

  if (contact.orgId !== input.orgId || contact.id !== input.contactId) {
    return {
      stored: false,
      applied: false,
      band: null,
      score: 0,
      rationale: 'Contact scope mismatch.',
      reason: 'scope_mismatch',
    }
  }

  const scored = scoreEvidence(input.evidence)
  if (!scored.band) {
    return {
      stored: false,
      applied: false,
      band: null,
      score: scored.score,
      rationale: scored.rationale,
      reason: 'below_threshold',
    }
  }

  // Never re-propose a dismissal
  const dismissed = await findDismissedMatch({
    orgId: input.orgId,
    contactId: input.contactId,
    field: input.field,
    value,
    sameValue: sameFactValue,
  })
  if (dismissed) {
    return {
      stored: false,
      applied: false,
      band: scored.band,
      score: scored.score,
      rationale: scored.rationale,
      reason: 'previously_dismissed',
      factId: dismissed.id,
    }
  }

  // Idempotent: same active value already recorded
  const active = await findActiveFactsForField({
    orgId: input.orgId,
    contactId: input.contactId,
    field: input.field,
  })
  const existingSame = active.find((f) => sameFactValue(f.value, value))
  if (existingSame) {
    return {
      stored: true,
      applied: existingSame.status === 'APPLIED',
      band: existingSame.band,
      score: existingSame.score,
      rationale: existingSame.rationale || scored.rationale,
      reason: 'already_present',
      factId: existingSame.id,
    }
  }

  // Contact already holds this value — mark APPLIED observation without rewrite
  const current = currentContactValue(contact, input.field)
  const alreadyOnContact = current != null && sameFactValue(current, value)

  const humanOwned = isHumanOwned(contact, input.field)
  const canAutoApply =
    scored.band === 'VERIFIED' &&
    scored.hasPrimary &&
    !humanOwned &&
    columnForField(input.field) != null

  let status: 'APPLIED' | 'PROPOSED' = 'PROPOSED'
  if (alreadyOnContact) {
    status = 'APPLIED'
  } else if (canAutoApply) {
    status = 'APPLIED'
  } else if (scored.band === 'VERIFIED' && humanOwned) {
    // Strong evidence but human owns the field — propose only
    status = 'PROPOSED'
  } else if (scored.band === 'VERIFIED' && columnForField(input.field) == null) {
    // Fact-only fields (employer, seniority, …): VERIFIED still applies as ledger truth
    status = 'APPLIED'
  } else if (scored.band === 'PROBABLE' || scored.band === 'POSSIBLE') {
    status = 'PROPOSED'
  }

  // Supersede prior active rows for this field when we apply a new value
  if (status === 'APPLIED') {
    const toSupersede = active
      .filter((f) => !sameFactValue(f.value, value))
      .map((f) => f.id)
    await supersedeFacts({ factIds: toSupersede })
  }

  const factId = await createFactDoc({
    orgId: input.orgId,
    contactId: input.contactId,
    field: input.field,
    value,
    score: scored.score,
    band: scored.band,
    status,
    evidence: input.evidence.map((e) => ({
      kind: e.kind,
      detail: String(e.detail ?? '').trim().slice(0, 2000),
      ...(e.sourceUrl ? { sourceUrl: e.sourceUrl } : {}),
    })),
    method: String(input.method ?? 'agent').slice(0, 120),
    sourceUrl: input.sourceUrl ?? null,
    sessionId: input.sessionId ?? null,
    agentId: input.agentId ?? null,
    rationale: scored.rationale,
    createdByRef: input.createdByRef ?? null,
  })

  if (status === 'APPLIED' && canAutoApply && !alreadyOnContact) {
    await applyFactToContact({
      contactId: input.contactId,
      field: input.field,
      value,
      agentId: input.agentId,
    })
  }

  return {
    stored: true,
    applied: status === 'APPLIED',
    band: scored.band,
    score: scored.score,
    rationale: scored.rationale,
    factId,
    reason:
      status === 'APPLIED'
        ? alreadyOnContact
          ? 'confirmed_existing'
          : canAutoApply
            ? 'auto_applied'
            : 'fact_only_applied'
        : humanOwned
          ? 'proposed_human_owned'
          : scored.band === 'POSSIBLE'
            ? 'proposed_possible'
            : 'proposed',
  }
}

async function applyFactToContact(args: {
  contactId: string
  field: FactField
  value: string
  agentId?: string | null
}): Promise<void> {
  const column = columnForField(args.field)
  if (!column) return

  const patch: Record<string, unknown> = {
    [column]: args.value,
    updatedAt: FieldValue.serverTimestamp(),
  }
  // Agent-applied facts must NOT mark humanOwnedFields
  if (args.agentId) {
    patch.updatedBy = `agent:${args.agentId}`
  }

  await adminDb.collection('contacts').doc(args.contactId).update(patch)
}

/**
 * Human accept or dismiss a PROPOSED fact.
 * Accept applies to contact (unless human-owned blocks... accept is human decision so it applies
 * and marks the field human-owned).
 * Dismiss prevents re-proposal of same field+value.
 */
export async function decideContactFact(
  input: DecideFactInput,
  contact: FactContactView,
): Promise<DecideFactResult> {
  const fact = await getFactById(input.orgId, input.factId)
  if (!fact || fact.contactId !== input.contactId) {
    return { ok: false, applied: false, reason: 'not_found' }
  }
  if (fact.status === 'DISMISSED') {
    return { ok: true, applied: false, status: 'DISMISSED', reason: 'already_dismissed' }
  }
  if (fact.status === 'SUPERSEDED') {
    return { ok: false, applied: false, reason: 'superseded' }
  }

  if (input.decision === 'dismiss') {
    await updateFactDoc(fact.id, {
      status: 'DISMISSED',
      decidedAt: FieldValue.serverTimestamp(),
      decidedByRef: input.decidedByRef ?? null,
    })
    return { ok: true, applied: false, status: 'DISMISSED' }
  }

  // accept
  const active = await findActiveFactsForField({
    orgId: input.orgId,
    contactId: input.contactId,
    field: fact.field,
  })
  const toSupersede = active
    .filter((f) => f.id !== fact.id)
    .map((f) => f.id)
  await supersedeFacts({ factIds: toSupersede })

  await updateFactDoc(fact.id, {
    status: 'APPLIED',
    decidedAt: FieldValue.serverTimestamp(),
    decidedByRef: input.decidedByRef ?? null,
  })

  const column = columnForField(fact.field)
  if (column) {
    const owned = Array.isArray(contact.humanOwnedFields)
      ? [...contact.humanOwnedFields]
      : []
    if (!owned.includes(column)) owned.push(column)

    await adminDb.collection('contacts').doc(input.contactId).update({
      [column]: fact.value,
      humanOwnedFields: owned,
      updatedAt: FieldValue.serverTimestamp(),
      ...(input.decidedByRef?.uid
        ? { updatedBy: input.decidedByRef.uid, updatedByRef: input.decidedByRef }
        : {}),
    })
  }

  return { ok: true, applied: true, status: 'APPLIED' }
}

/** Mark columns as human-owned when a human edits them via CRM UI/API. */
export function humanOwnedFieldsAfterHumanEdit(args: {
  existingOwned?: string[] | null
  patch: Record<string, unknown>
  isHumanActor: boolean
}): string[] | null {
  if (!args.isHumanActor) return null

  const next = new Set(
    Array.isArray(args.existingOwned)
      ? args.existingOwned.filter((x) => typeof x === 'string')
      : [],
  )
  let touched = false
  for (const col of HUMAN_OWNABLE_CONTACT_COLUMNS) {
    if (col in args.patch && args.patch[col] !== undefined) {
      touched = true
      next.add(col)
    }
  }
  if (!touched) return null
  return Array.from(next)
}
