/**
 * Scoring Orchestrator
 *
 * computeScoresForContact loads a contact + optional linked company, fetches
 * the per-org scoring config (bootstrapping defaults if absent), then runs
 * formula leadScore + icpScore in parallel, optionally followed by the AI
 * lead scorer. All three scores + signals are written back to the contact doc.
 *
 * Score writes are best-effort — failures are logged and do NOT bubble up to
 * the caller. The returned ScoreUpdate reflects what was computed in memory
 * regardless of whether the Firestore write succeeded.
 */

import { Timestamp, FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { Contact } from '@/lib/crm/types'
import type { Company } from '@/lib/companies/types'
import { computeLeadScore } from './leadScore'
import { computeIcpScore } from './icpScore'
import { computeAiLeadScore } from './aiLeadScore'
import { getOrBootstrapConfig } from './store'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ComputeScoresOptions {
  includeAi: boolean
  actor: MemberRef
}

export interface ScoreUpdate {
  leadScore: number
  icpScore: number
  aiLeadScore?: number
  aiRationale?: string
  scoreSignals: Record<string, number>
  scoreUpdatedAt: Timestamp
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Computes lead + ICP + (optional) AI scores for a contact and persists them.
 *
 * @returns ScoreUpdate on success, null if the contact doesn't exist or
 *          belongs to a different org.
 */
export async function computeScoresForContact(
  orgId: string,
  contactId: string,
  opts: ComputeScoresOptions,
): Promise<ScoreUpdate | null> {
  // Load contact
  const contactRef = adminDb.collection('contacts').doc(contactId)
  const contactSnap = await contactRef.get()
  if (!contactSnap.exists) return null

  const contact: Contact = { id: contactSnap.id, ...(contactSnap.data() as Omit<Contact, 'id'>) }
  if (contact.orgId !== orgId) return null

  // Load linked company — best-effort
  let company: Company | null = null
  if (contact.companyId) {
    try {
      const coSnap = await adminDb.collection('companies').doc(contact.companyId).get()
      if (coSnap.exists) {
        const data = coSnap.data() as Company
        if (data.orgId === orgId) {
          company = { ...data, id: coSnap.id }
        }
      }
    } catch (e) {
      console.warn('[compute] company lookup failed', e)
    }
  }

  // Load or bootstrap config
  const config = await getOrBootstrapConfig(orgId).catch((e) => {
    console.error('[compute] getOrBootstrapConfig failed', e)
    return null
  })
  if (!config) throw new Error('Scoring config bootstrap failed')

  // Run formula scorers in parallel
  const [lead, icp] = await Promise.all([
    computeLeadScore(contact, config.leadWeights, { adminDb }).catch((e) => {
      console.warn('[compute] leadScore failed', e)
      return { score: 0, signals: {} as Record<string, number> }
    }),
    Promise.resolve(computeIcpScore(contact, company, config.icp)),
  ])

  // Optional AI score
  let ai: AiResult | null = null
  if (opts.includeAi && config.aiEnabled) {
    try {
      ai = await computeAiLeadScore({
        contact,
        company,
        config,
        formulaLeadScore: lead.score,
        formulaIcpScore: icp.score,
      })
    } catch (e) {
      console.warn('[compute] aiLeadScore failed', e)
      ai = null
    }
  }

  // Merge signals with prefix to avoid key collisions
  const signals: Record<string, number> = {}
  for (const [k, v] of Object.entries(lead.signals)) signals[`lead_${k}`] = v
  for (const [k, v] of Object.entries(icp.signals)) signals[`icp_${k}`] = v

  const update: ScoreUpdate = {
    leadScore: lead.score,
    icpScore: icp.score,
    aiLeadScore: ai?.score,
    aiRationale: ai?.rationale,
    scoreSignals: signals,
    scoreUpdatedAt: Timestamp.now(),
  }

  // Persist back to contact doc — never block caller on failure
  try {
    const persistedUpdate: Record<string, unknown> = {
      leadScore: update.leadScore,
      icpScore: update.icpScore,
      scoreSignals: update.scoreSignals,
      scoreUpdatedAt: update.scoreUpdatedAt,
      updatedAt: Timestamp.now(),
      updatedBy: opts.actor.uid,
      updatedByRef: opts.actor,
    }

    if (ai) {
      persistedUpdate.aiLeadScore = ai.score
    } else if (opts.includeAi && config.aiEnabled) {
      // AI was requested but failed — clear any stale value
      persistedUpdate.aiLeadScore = FieldValue.delete()
    }

    await contactRef.update(persistedUpdate)
  } catch (e) {
    console.error('[compute] contact persist failed', e)
  }

  return update
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface AiResult {
  score: number
  rationale: string
}
