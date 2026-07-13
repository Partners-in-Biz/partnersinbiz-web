// app/lead/confirm/[token]/page.tsx
//
// Double-opt-in confirmation landing page. Verifies the HMAC-signed token,
// marks the submission as confirmed, runs `performAutoEnroll`, and renders
// a friendly thank-you screen. Has its own /lead/ route so it sits OUTSIDE
// the (admin) and (portal) auth-guarded layouts.

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

  // Token sanity: must match exactly to prevent token reuse across submissions
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

function PageShell(props: { children: React.ReactNode; theme?: CaptureSource['widgetTheme'] }) {
  const text = props.theme?.textColor ?? '#0f172a'
  return (
    <div style={{ minHeight: '100vh', color: text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif' }}>
      <div style={{ maxWidth: 520, width: '100%', background: '#ffffff', borderRadius: 16, padding: 40, boxShadow: '0 10px 30px rgba(0,0,0,0.06)' }}>
        {props.children}
      </div>
    </div>
  )
}

export default async function LeadConfirmPage({ params }: Props) {
  const { token } = await params
  const state = await processToken(token)

  if (state.status === 'invalid') {
    return (
      <PageShell>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginTop: 0 }}>Link expired or invalid</h1>
        <p style={{ color: '#475569', lineHeight: 1.6 }}>
          We couldn&apos;t confirm this subscription. The link may have expired or already been used.
          If you still want to sign up, please submit the form again.
        </p>
      </PageShell>
    )
  }

  if (state.status === 'missing-source') {
    return (
      <PageShell>
        <h1 style={{ fontSize: 24, fontWeight: 600, marginTop: 0 }}>Subscription unavailable</h1>
        <p style={{ color: '#475569', lineHeight: 1.6 }}>
          This subscription source has been removed. Please reach out to the team if you signed up by mistake.
        </p>
      </PageShell>
    )
  }

  const source = state.source!
  const isAlready = state.status === 'already'
  const orgUrl = await fetchOrgSiteUrl(source.orgId)
  const theme = source.widgetTheme

  return (
    <PageShell theme={theme}>
      <h1 style={{ fontSize: 26, fontWeight: 600, marginTop: 0, color: theme?.textColor ?? '#0f172a' }}>
        {isAlready ? 'Already confirmed' : 'You’re in!'}
      </h1>
      <p style={{ color: '#475569', lineHeight: 1.6, fontSize: 16 }}>
        {isAlready
          ? `Your subscription to ${source.name} is already active.`
          : source.successMessage || `Thanks for confirming — you're now subscribed to ${source.name}.`}
      </p>
      {state.email && (
        <p style={{ color: '#64748b', fontSize: 14, marginTop: 8 }}>
          Confirmed: <strong>{state.email}</strong>
        </p>
      )}
      {orgUrl && (
        <p style={{ marginTop: 28 }}>
          <a
            href={orgUrl}
            style={{
              display: 'inline-block',
              padding: '12px 22px',
              background: theme?.primaryColor ?? '#0f766e',
              color: '#fff',
              borderRadius: theme?.borderRadius ?? 10,
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            Back to the site
          </a>
        </p>
      )}
    </PageShell>
  )
}
