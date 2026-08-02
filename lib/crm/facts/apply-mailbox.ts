// lib/crm/facts/apply-mailbox.ts
// Shared egress-safe mailbox → ContactFact pipeline for API routes and Gmail sync.

import { parseMailboxEvidence } from './mailbox-evidence'
import { recordContactFact } from './record'
import type { FactContactView, RecordFactResult } from './types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export interface ApplyMailboxFactsInput {
  orgId: string
  contact: FactContactView
  bodyText: string
  fromName?: string | null
  fromEmail?: string | null
  sourceUrl?: string | null
  direction?: 'inbound' | 'outbound' | 'unknown'
  agentId?: string | null
  createdByRef?: MemberRef | null
  /** Parse only — no ledger writes */
  dryRun?: boolean
  /** Hard cap already enforced by callers; default 100KB */
  maxBodyChars?: number
}

export interface ApplyMailboxFactsResult {
  dryRun: boolean
  candidateCount: number
  storedCount: number
  candidates: ReturnType<typeof parseMailboxEvidence>
  results: Array<{
    field: string
    value: string
    result: RecordFactResult
  }>
}

/**
 * Parse signature/reply text and optionally record observation-backed facts.
 * Never sends body text to third-party services.
 */
export async function applyMailboxFactsToContact(
  input: ApplyMailboxFactsInput,
): Promise<ApplyMailboxFactsResult> {
  const maxChars = input.maxBodyChars ?? 100_000
  const bodyText = String(input.bodyText || '')
  if (!bodyText.trim()) {
    return {
      dryRun: Boolean(input.dryRun),
      candidateCount: 0,
      storedCount: 0,
      candidates: [],
      results: [],
    }
  }

  const clipped = bodyText.length > maxChars ? bodyText.slice(0, maxChars) : bodyText
  const candidates = parseMailboxEvidence({
    bodyText: clipped,
    fromName: input.fromName ?? null,
    fromEmail: input.fromEmail ?? null,
    sourceUrl: input.sourceUrl ?? null,
    direction: input.direction ?? 'unknown',
  })

  if (input.dryRun) {
    return {
      dryRun: true,
      candidateCount: candidates.length,
      storedCount: 0,
      candidates,
      results: [],
    }
  }

  const agentId = input.agentId ?? 'mailbox-pipeline'
  const results: ApplyMailboxFactsResult['results'] = []
  let storedCount = 0

  for (const candidate of candidates) {
    const result = await recordContactFact(
      {
        orgId: input.orgId,
        contactId: input.contact.id,
        field: candidate.field,
        value: candidate.value,
        evidence: candidate.evidence,
        method: candidate.method,
        sourceUrl: candidate.evidence[0]?.sourceUrl ?? input.sourceUrl ?? undefined,
        agentId,
        createdByRef: input.createdByRef ?? null,
      },
      input.contact,
    )
    results.push({ field: candidate.field, value: candidate.value, result })
    if (result.stored) storedCount += 1
  }

  return {
    dryRun: false,
    candidateCount: candidates.length,
    storedCount,
    candidates,
    results,
  }
}
