// app/preferences/[token]/page.tsx
//
// Public preferences page. Verifies the HMAC-signed token (same signer as
// the unsubscribe link), loads the contact + org config + current
// preferences, and renders a clean form. Works WITHOUT JavaScript - the
// form posts back to `/api/preferences/[token]` which server-side processes
// the update and re-renders this page with a saved notice.
//
// Uses Studio CSS classes only (RSC cannot import components/studio until
// that module gains "use client").

import { adminDb } from '@/lib/firebase/admin'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribeToken'
import {
  getOrgPreferencesConfig,
  getContactPreferences,
} from '@/lib/preferences/store'
import type { OrgPreferencesConfig, ContactPreferences, FrequencyChoice } from '@/lib/preferences/types'
import '@/components/studio/studio-ui.css'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ token: string }>
  searchParams?: Promise<{ saved?: string; error?: string }>
}

interface PageState {
  status: 'ok' | 'invalid' | 'missing-contact'
  contactId?: string
  email?: string
  orgConfig?: OrgPreferencesConfig
  prefs?: ContactPreferences
  orgId?: string
}

async function loadState(token: string): Promise<PageState> {
  const verified = verifyUnsubscribeToken(token)
  if (!verified.ok) return { status: 'invalid' }
  const contactId = verified.contactId

  const cSnap = await adminDb.collection('contacts').doc(contactId).get()
  if (!cSnap.exists) return { status: 'missing-contact' }
  const cd = cSnap.data() ?? {}
  const orgId = typeof cd.orgId === 'string' ? cd.orgId : ''
  if (!orgId) return { status: 'missing-contact' }

  const orgConfig = await getOrgPreferencesConfig(orgId)
  const prefs = await getContactPreferences(contactId, orgId)

  return {
    status: 'ok',
    contactId,
    email: typeof cd.email === 'string' ? cd.email : '',
    orgConfig,
    prefs,
    orgId,
  }
}

function PageShell(props: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-8 py-16">
      <div className="st-panel">{props.children}</div>
    </main>
  )
}

const FREQUENCY_OPTIONS: Array<{ value: FrequencyChoice; label: string; help: string }> = [
  { value: 'all', label: 'All emails', help: 'Send me everything I am signed up for.' },
  { value: 'weekly', label: 'Weekly at most', help: 'At most one email per week.' },
  { value: 'monthly', label: 'Monthly at most', help: 'At most one email per month.' },
  {
    value: 'transactional-only',
    label: 'Important account emails only',
    help: 'Receipts and account notifications. No marketing.',
  },
  { value: 'none', label: 'Unsubscribe from everything', help: 'Stop all emails entirely.' },
]

export default async function PreferencesPage({ params, searchParams }: Props) {
  const { token } = await params
  const search: { saved?: string; error?: string } =
    (await (searchParams ?? Promise.resolve({}))) ?? {}
  const state = await loadState(token)

  if (state.status === 'invalid') {
    return (
      <PageShell>
        <h1 className="sc-article__h2">This link is invalid or has expired.</h1>
        <p className="sc-body mt-4">
          We could not verify this preferences link. If you want to update your subscription, reach
          out to the sender directly.
        </p>
      </PageShell>
    )
  }

  if (state.status === 'missing-contact') {
    return (
      <PageShell>
        <h1 className="sc-article__h2">Subscription not found.</h1>
        <p className="sc-body mt-4">
          We could not find your contact record. It may have been removed.
        </p>
      </PageShell>
    )
  }

  const orgConfig = state.orgConfig!
  const prefs = state.prefs!
  const email = state.email ?? ''
  const saved = search.saved === '1'
  const errored = !!search.error

  return (
    <PageShell>
      <h1 className="sc-article__h2">{orgConfig.preferencesPageHeading}</h1>
      <p className="sc-body mt-4">
        {orgConfig.preferencesPageSubheading}
        {email ? (
          <>
            <br />
            <span className="sc-tiny">Updating preferences for {email}</span>
          </>
        ) : null}
      </p>

      {saved ? (
        <div className="mt-8">
          <div className="st-notice st-notice--success sc-body" role="status">
            Saved. Your preferences have been updated.
          </div>
        </div>
      ) : null}
      {errored ? (
        <div className="mt-8">
          <div className="st-notice st-notice--danger sc-body" role="alert">
            We could not save your changes. Please try again.
          </div>
        </div>
      ) : null}

      <form
        method="POST"
        action={`/api/preferences/${encodeURIComponent(token)}`}
        className="mt-8 flex flex-col gap-8"
      >
        <fieldset className="m-0 border-0 p-0">
          <legend className="st-title mb-4">Topics</legend>
          <div className="flex flex-col gap-4">
            {orgConfig.topics.map((t) => {
              const checked =
                typeof prefs.topics[t.id] === 'boolean' ? prefs.topics[t.id] : t.defaultOptIn
              const isTransactional = t.id === 'transactional'
              const id = `topic_${t.id}`
              return (
                <label
                  key={t.id}
                  className="st-checkbox"
                  htmlFor={id}
                  style={isTransactional ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
                >
                  <input
                    id={id}
                    type="checkbox"
                    name={id}
                    defaultChecked={isTransactional ? true : checked}
                    disabled={isTransactional}
                    aria-label={t.label}
                  />
                  <span>
                    <span style={{ display: 'block', color: 'var(--sc-ink)' }}>{t.label}</span>
                    <span className="sc-body" style={{ display: 'block', fontSize: '0.875rem' }}>
                      {t.description}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="m-0 border-0 p-0">
          <legend className="st-title mb-4">How often</legend>
          <div className="st-radio-group" role="radiogroup" aria-label="How often">
            {FREQUENCY_OPTIONS.map((opt) => {
              const id = `frequency_${opt.value}`
              return (
                <label key={opt.value} className="st-radio" htmlFor={id}>
                  <input
                    id={id}
                    type="radio"
                    name="frequency"
                    value={opt.value}
                    defaultChecked={prefs.frequency === opt.value}
                    aria-label={opt.label}
                  />
                  <span>
                    <span style={{ display: 'block', color: 'var(--sc-ink)' }}>{opt.label}</span>
                    <span className="sc-body" style={{ display: 'block', fontSize: '0.875rem' }}>
                      {opt.help}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <button type="submit" className="st-btn st-btn--primary st-btn--block">
          Save preferences
        </button>
      </form>
    </PageShell>
  )
}
