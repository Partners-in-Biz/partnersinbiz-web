// app/lead/confirm/[token]/page.tsx
//
// Double-opt-in confirmation landing page. Verifies the HMAC-signed token,
// marks the submission as confirmed, runs `performAutoEnroll`, and renders
// a thank-you screen. Uses Studio CSS classes only (RSC-safe).

import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { verifyConfirmToken } from '@/lib/lead-capture/token'
import { performAutoEnroll } from '@/lib/lead-capture/autoEnroll'
import { appendConsentEvent } from '@/lib/consent-ledger/store'
import {
  LEAD_CAPTURE_SOURCES,
  LEAD_CAPTURE_SUBMISSIONS,
  type CaptureSource,
  type CaptureSubmission,
} from '@/lib/lead-capture/types'
import '@/components/studio/studio-ui.css'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ token: string }> }

interface ConfirmState {
  status: 'ok' | 'already' | 'invalid' | 'missing-source'
  source?: CaptureSource
  email?: string
}

async function processToken(token: string): Promise<ConfirmState> {
  const verified = verifyConfirmToken(token)
  if (!verified.ok) return { status: 'invalid' }

  const submissionRef = adminDb.collection(LEAD_CAPTURE_SUBMISSIONS).doc(verified.submissionId)
  const submissionSnap = await submissionRef.get()
  if (!submissionSnap.exists) return { status: 'invalid' }

  const submission = { id: submissionSnap.id, ...submissionSnap.data() } as CaptureSubmission

  if (submission.confirmationToken !== token) {
    return { status: 'invalid' }
  }

  const sourceSnap = await adminDb.collection(LEAD_CAPTURE_SOURCES).doc(submission.captureSourceId).get()
  if (!sourceSnap.exists) return { status: 'missing-source' }
  const source = { id: sourceSnap.id, ...sourceSnap.data() } as CaptureSource

  if (submission.confirmedAt) {
    return { status: 'already', source, email: submission.email }
  }

  await submissionRef.update({ confirmedAt: FieldValue.serverTimestamp() })
  const sourceRecord = source as unknown as Record<string, unknown>
  await appendConsentEvent({
    orgId: submission.orgId,
    contactId: submission.contactId,
    channel: 'email',
    topicId: typeof sourceRecord.topicId === 'string' ? sourceRecord.topicId : 'marketing',
    state: 'confirmed',
    legalBasis: 'consent',
    source: 'double-opt-in-confirmation',
    sourceEventId: `capture:${submission.id}:confirmed`,
    sourceId: source.id,
    occurredAt: new Date().toISOString(),
    doubleOptIn: 'confirmed',
    proofRef: `${LEAD_CAPTURE_SUBMISSIONS}/${submission.id}`,
  })

  try {
    await performAutoEnroll(submission, source)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[lead-capture] confirm auto-enroll failed', err)
  }

  return { status: 'ok', source, email: submission.email }
}

async function fetchOrgSiteUrl(orgId: string): Promise<string | null> {
  try {
    const snap = await adminDb.collection('organizations').doc(orgId).get()
    if (!snap.exists) return null
    const data = snap.data() ?? {}
    const url = data.website || data.siteUrl || data.url
    if (typeof url === 'string' && url.trim()) return url
  } catch {
    return null
  }
  return null
}

function PageShell(props: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-8 py-16">
      <div className="st-panel">{props.children}</div>
    </main>
  )
}

export default async function LeadConfirmPage({ params }: Props) {
  const { token } = await params
  const state = await processToken(token)

  if (state.status === 'invalid') {
    return (
      <PageShell>
        <h1 className="sc-article__h2">Link expired or invalid.</h1>
        <p className="sc-body mt-4">
          We could not confirm this subscription. The link may have expired or already been used.
          If you still want to sign up, please submit the form again.
        </p>
      </PageShell>
    )
  }

  if (state.status === 'missing-source') {
    return (
      <PageShell>
        <h1 className="sc-article__h2">Subscription unavailable.</h1>
        <p className="sc-body mt-4">
          This subscription source has been removed. Please reach out to the team if you signed up by mistake.
        </p>
      </PageShell>
    )
  }

  const source = state.source!
  const isAlready = state.status === 'already'
  const orgUrl = await fetchOrgSiteUrl(source.orgId)

  return (
    <PageShell>
      <h1 className="sc-article__h2">{isAlready ? 'Already confirmed.' : 'You are in.'}</h1>
      <p className="sc-body mt-4">
        {isAlready
          ? `Your subscription to ${source.name} is already active.`
          : source.successMessage || `Thanks for confirming. You are now subscribed to ${source.name}.`}
      </p>
      {state.email ? (
        <div className="mt-4">
          <div className="st-notice sc-body" role="status">Confirmed: {state.email}</div>
        </div>
      ) : null}
      {orgUrl ? (
        <div className="mt-8">
          <a href={orgUrl} className="st-btn st-btn--primary">
            Back to the site
          </a>
        </div>
      ) : null}
    </PageShell>
  )
}
