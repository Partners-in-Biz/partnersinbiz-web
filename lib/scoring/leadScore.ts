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

// Cap the number of page visits that contribute to the score so a single very
// active anonymous-then-identified visitor cannot dominate the formula.
const MAX_SCORED_PAGE_VISITS = 5

// Product-analytics pageview event names (mirrors lib/reports/snapshot.ts).
const PAGEVIEW_EVENT_NAMES = ['$pageview', 'page_view', 'pageview']

function ignoreScoreSignalFailure() {
  return undefined
}

function resolvedWeights(weights: LeadSignalsWeights): Required<LeadSignalsWeights> {
  return {
    emailOpens: weights.emailOpens ?? DEFAULT_LEAD_WEIGHTS.emailOpens,
    emailClicks: weights.emailClicks ?? DEFAULT_LEAD_WEIGHTS.emailClicks,
    emailReplies: weights.emailReplies ?? DEFAULT_LEAD_WEIGHTS.emailReplies,
    sequenceCompleted: weights.sequenceCompleted ?? DEFAULT_LEAD_WEIGHTS.sequenceCompleted,
    recentContact: weights.recentContact ?? DEFAULT_LEAD_WEIGHTS.recentContact,
    formSubmission: weights.formSubmission ?? DEFAULT_LEAD_WEIGHTS.formSubmission,
    pageVisit: weights.pageVisit ?? DEFAULT_LEAD_WEIGHTS.pageVisit,
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
  let pageVisits = 0

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
  } catch(_err) { ignoreScoreSignalFailure() }

  // ── Email replies (inbound_emails collection, last 30d) ─────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repliesSnap: any = await (db.collection('inbound_emails') as any)
      .where('contactId', '==', contactId)
      .where('intent', '==', 'reply')
      .where('receivedAt', '>=', thirtyDaysAgo)
      .get()
    replies = repliesSnap.size ?? 0
  } catch(_err) { ignoreScoreSignalFailure() }

  // ── Sequence completions (sequence_enrollments, last 30d) ────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seqSnap: any = await (db.collection('sequence_enrollments') as any)
      .where('contactId', '==', contactId)
      .where('status', '==', 'completed')
      .where('completedAt', '>=', thirtyDaysAgo)
      .get()
    sequenceCompleted = seqSnap.size ?? 0
  } catch(_err) { ignoreScoreSignalFailure() }

  // ── Form submissions (form_submissions, last 30d) ─────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formsSnap: any = await (db.collection('form_submissions') as any)
      .where('contactId', '==', contactId)
      .where('submittedAt', '>=', thirtyDaysAgo)
      .get()
    formSubmissions = formsSnap.size ?? 0
  } catch(_err) { ignoreScoreSignalFailure() }

  // ── Page visits (product_events pageviews, last 30d) ─────────────────────
  // Product-analytics events live in `product_events`, keyed by `userId` — the
  // identified visitor id set by the analytics SDK's identify() call, which by
  // convention is the contact's email. We count distinct pageview events for
  // this org where userId matches the contact email, capped to avoid a single
  // hyper-active visitor dominating the score. Wrapped in try/catch + org scoped
  // so a missing index or empty collection simply yields 0 contribution.
  const contactEmail = typeof contact.email === 'string' ? contact.email.trim().toLowerCase() : ''
  if (contactEmail) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const visitsSnap: any = await (db.collection('product_events') as any)
        .where('orgId', '==', contact.orgId)
        .where('userId', '==', contactEmail)
        .where('timestamp', '>=', thirtyDaysAgo)
        .get()

      for (const doc of visitsSnap.docs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ev = doc.data() as any
        if (PAGEVIEW_EVENT_NAMES.includes(ev.event)) pageVisits += 1
      }
    } catch(_err) { ignoreScoreSignalFailure() }
  }
  const scoredPageVisits = Math.min(pageVisits, MAX_SCORED_PAGE_VISITS)

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
  } catch(_err) { ignoreScoreSignalFailure() }

  // ── Formula ──────────────────────────────────────────────────────────────
  const raw =
    opens * w.emailOpens +
    clicks * w.emailClicks +
    replies * w.emailReplies +
    sequenceCompleted * w.sequenceCompleted +
    recentContactSignal +
    formSubmissions * w.formSubmission +
    scoredPageVisits * w.pageVisit

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
      pageVisits: scoredPageVisits,
    },
  }
}
