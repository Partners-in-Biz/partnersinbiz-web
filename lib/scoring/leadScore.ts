// lib/scoring/leadScore.ts
//
// Formula-based lead score for a contact. Pulls last-30d engagement signals
// from Firestore and weights them per the org's LeadSignalsWeights config.
//
// ALL Firestore queries are wrapped in try/catch — a query failure returns
// 0-signals rather than throwing so the orchestrator can still write partial
// data.

import type { Firestore } from 'firebase-admin/firestore'
import { Timestamp } from 'firebase-admin/firestore'
import type { Contact } from '@/lib/crm/types'
import type { LeadSignalsWeights, ScoreResult } from './types'
import { DEFAULT_LEAD_WEIGHTS } from './store'

const DAY_MS = 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * DAY_MS
const SEVEN_DAYS_MS = 7 * DAY_MS

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function resolvedWeights(weights: LeadSignalsWeights): Required<LeadSignalsWeights> {
  return {
    emailOpens: weights.emailOpens ?? DEFAULT_LEAD_WEIGHTS.emailOpens,
    emailClicks: weights.emailClicks ?? DEFAULT_LEAD_WEIGHTS.emailClicks,
    emailReplies: weights.emailReplies ?? DEFAULT_LEAD_WEIGHTS.emailReplies,
    sequenceCompleted: weights.sequenceCompleted ?? DEFAULT_LEAD_WEIGHTS.sequenceCompleted,
    recentContact: weights.recentContact ?? DEFAULT_LEAD_WEIGHTS.recentContact,
    formSubmission: weights.formSubmission ?? DEFAULT_LEAD_WEIGHTS.formSubmission,
  }
}

export async function computeLeadScore(
  contact: Contact,
  weights: LeadSignalsWeights,
  ctx: { adminDb: Firestore },
): Promise<ScoreResult> {
  const { adminDb: db } = ctx
  const w = resolvedWeights(weights)
  const now = Date.now()
  const thirtyDaysAgo = Timestamp.fromMillis(now - THIRTY_DAYS_MS)
  const sevenDaysAgo = new Date(now - SEVEN_DAYS_MS)
  const contactId = contact.id

  let opens = 0
  let clicks = 0
  let replies = 0
  let sequenceCompleted = 0
  let formSubmissions = 0

  // ── Email opens + clicks (emails collection, last 30d) ───────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emailsSnap: any = await (db.collection('emails') as any)
      .where('contactId', '==', contactId)
      .where('sentAt', '>=', thirtyDaysAgo)
      .get()

    for (const doc of emailsSnap.docs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = doc.data() as any
      const isOpened = !!e.openedAt || e.status === 'opened' || e.status === 'clicked'
      const isClicked = !!e.clickedAt || e.status === 'clicked'
      if (isOpened) opens += 1
      if (isClicked) clicks += 1
    }
  } catch (_err) {
    // best-effort; signals stay 0
  }

  // ── Email replies (inbound_emails collection, last 30d) ─────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repliesSnap: any = await (db.collection('inbound_emails') as any)
      .where('contactId', '==', contactId)
      .where('intent', '==', 'reply')
      .where('receivedAt', '>=', thirtyDaysAgo)
      .get()
    replies = repliesSnap.size ?? 0
  } catch (_err) {
    // best-effort
  }

  // ── Sequence completions (sequence_enrollments, last 30d) ────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seqSnap: any = await (db.collection('sequence_enrollments') as any)
      .where('contactId', '==', contactId)
      .where('status', '==', 'completed')
      .where('completedAt', '>=', thirtyDaysAgo)
      .get()
    sequenceCompleted = seqSnap.size ?? 0
  } catch (_err) {
    // best-effort
  }

  // ── Form submissions (form_submissions, last 30d) ─────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formsSnap: any = await (db.collection('form_submissions') as any)
      .where('contactId', '==', contactId)
      .where('submittedAt', '>=', thirtyDaysAgo)
      .get()
    formSubmissions = formsSnap.size ?? 0
  } catch (_err) {
    // best-effort
  }

  // ── Recent contact within 7d ─────────────────────────────────────────────
  let recentContactSignal = 0
  try {
    const lastContactedAt = contact.lastContactedAt
    if (lastContactedAt) {
      const lastMs =
        typeof lastContactedAt === 'object' && 'toDate' in lastContactedAt
          ? (lastContactedAt as Timestamp).toDate().getTime()
          : new Date(lastContactedAt as unknown as string).getTime()
      if (lastMs >= sevenDaysAgo.getTime()) {
        recentContactSignal = w.recentContact
      }
    }
  } catch (_err) {
    // best-effort
  }

  // ── Formula ──────────────────────────────────────────────────────────────
  const raw =
    opens * w.emailOpens +
    clicks * w.emailClicks +
    replies * w.emailReplies +
    sequenceCompleted * w.sequenceCompleted +
    recentContactSignal +
    formSubmissions * w.formSubmission

  const score = clamp(Math.round(raw), 0, 100)

  return {
    score,
    signals: {
      opens,
      clicks,
      replies,
      sequenceCompleted,
      recentContact: recentContactSignal,
      formSubmissions,
    },
  }
}
