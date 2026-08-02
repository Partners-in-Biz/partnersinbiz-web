// lib/crm/facts/job-change.ts
// Job change = supersede prior employer facts + optional owner tasking hook payload.

import { recordContactFact } from './record'
import { scheduleRecheck } from './research-tasks'
import type { Evidence, FactContactView, RecordFactResult } from './types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

export interface RecordJobChangeInput {
  orgId: string
  contactId: string
  employer: string
  evidence: Evidence[]
  title?: string
  method?: string
  sourceUrl?: string
  sessionId?: string
  agentId?: string
  createdByRef?: MemberRef | null
  /** When true, queue a recheck so reps see why we will verify again */
  scheduleFollowUp?: boolean
  followUpReason?: string
  followUpDelaySeconds?: number
}

export interface RecordJobChangeResult {
  employer: RecordFactResult
  title?: RecordFactResult
  researchTaskId?: string
}

/**
 * Record a job change as employer (and optional title) facts.
 * Employer is fact-only (does not rewrite companyId) so company links stay explicit.
 */
export async function recordJobChange(
  input: RecordJobChangeInput,
  contact: FactContactView,
): Promise<RecordJobChangeResult> {
  const employer = await recordContactFact(
    {
      orgId: input.orgId,
      contactId: input.contactId,
      field: 'employer',
      value: input.employer,
      evidence: input.evidence,
      method: input.method ?? 'agent.record_job_change',
      sourceUrl: input.sourceUrl,
      sessionId: input.sessionId,
      agentId: input.agentId,
      createdByRef: input.createdByRef,
    },
    contact,
  )

  let title: RecordFactResult | undefined
  if (input.title?.trim()) {
    title = await recordContactFact(
      {
        orgId: input.orgId,
        contactId: input.contactId,
        field: 'title',
        value: input.title.trim(),
        evidence: input.evidence,
        method: input.method ?? 'agent.record_job_change',
        sourceUrl: input.sourceUrl,
        sessionId: input.sessionId,
        agentId: input.agentId,
        createdByRef: input.createdByRef,
      },
      contact,
    )
  }

  let researchTaskId: string | undefined
  if (input.scheduleFollowUp !== false && employer.stored) {
    const { id } = await scheduleRecheck({
      orgId: input.orgId,
      contactId: input.contactId,
      kind: 'job_change_check',
      reason:
        input.followUpReason?.trim() ||
        `Verify job change to ${input.employer.trim()} (evidence-backed proposal/application).`,
      delaySeconds: input.followUpDelaySeconds ?? 14 * 24 * 3600,
      budgetUnits: 2,
      priority: 10,
      agentId: input.agentId,
      createdByRef: input.createdByRef,
      metadata: {
        employerFactId: employer.factId ?? null,
        titleFactId: title?.factId ?? null,
      },
    })
    researchTaskId = id
  }

  return { employer, title, researchTaskId }
}
