'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { PartnerModuleMatrix } from '@/components/crm/PartnerModuleMatrix'
import { DEFAULT_COMPANY_WORKSPACE_MODULES } from '@/lib/company-work/module-keys'

interface CandidateOrg {
  id: string
  name: string
  role: string
}

interface CandidateCompany {
  id: string
  name: string
  domain?: string
  suggested: boolean
  alreadyLinked: boolean
}

interface InvitePreview {
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'
  expired: boolean
  kind: 'company' | 'contact'
  recipientEmail: string
  recipientName?: string
  recipientCompanyName?: string
  message?: string
  expiresAt?: string
  inviterOrgName: string
  inviterName?: string
  proposedCapabilities: string[]
  signedIn: boolean
  sessionEmail?: string
  candidateOrgs: CandidateOrg[]
  selectedOrgId: string
  companies: CandidateCompany[]
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: InvitePreview }
  | { kind: 'accepted'; createdOrg: boolean }
  | { kind: 'declined' }
  | { kind: 'error'; message: string; requiresSignIn?: boolean }

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

const CARD = 'rounded-xl border border-white/10 bg-[#1A1A1A] p-6'
const LABEL = 'mb-1 block text-xs uppercase tracking-[0.14em] text-white/40'
const INPUT = 'w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-amber-500/60'

export default function PartnerInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [displayName, setDisplayName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [password, setPassword] = useState('')
  const [orgId, setOrgId] = useState('')
  const [companyChoice, setCompanyChoice] = useState('__create__')
  const [modules, setModules] = useState<string[]>([...DEFAULT_COMPANY_WORKSPACE_MODULES])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const load = useCallback(async (forOrgId?: string) => {
    try {
      const qs = forOrgId ? `?orgId=${encodeURIComponent(forOrgId)}` : ''
      const res = await fetch(`/api/v1/public/partner-invites/${token}${qs}`)
      const body = await res.json().catch(() => null)
      const data = unwrap(body)
      if (!res.ok) {
        setState({ kind: 'error', message: (data?.error as string) || 'This invitation link is not valid.' })
        return
      }
      const preview = data as unknown as InvitePreview
      setState({ kind: 'ready', preview })
      setDisplayName((prev) => prev || preview.recipientName || '')
      setBusinessName((prev) => prev || preview.recipientCompanyName || '')
      setOrgId(preview.selectedOrgId || '')
      const suggested = preview.companies.find((c) => c.suggested && !c.alreadyLinked)
      setCompanyChoice(suggested ? suggested.id : '__create__')
      if (preview.proposedCapabilities?.length) setModules(preview.proposedCapabilities)
    } catch {
      setState({ kind: 'error', message: 'Could not load this invitation. Please try again.' })
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  async function submit(action: 'accept' | 'decline') {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/v1/public/partner-invites/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          displayName: displayName || undefined,
          businessName: businessName || undefined,
          password: password || undefined,
          orgId: orgId || undefined,
          preferTargetCompanyId: companyChoice !== '__create__' ? companyChoice : undefined,
          capabilities: action === 'accept' ? modules : undefined,
        }),
      })
      const body = await res.json().catch(() => null)
      const data = unwrap(body)
      if (!res.ok) {
        if (data?.requiresSignIn) {
          const next = encodeURIComponent(`/partners/invite/${token}`)
          window.location.href = `/login?next=${next}`
          return
        }
        setSubmitError((data?.error as string) || 'Something went wrong. Please try again.')
        return
      }
      if (action === 'decline') setState({ kind: 'declined' })
      else setState({ kind: 'accepted', createdOrg: Boolean(data?.createdOrg) })
    } catch {
      setSubmitError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (state.kind === 'loading') {
    return <Shell><p className="text-white/50">Loading…</p></Shell>
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <div className={CARD}>
          <h1 className="mb-2 text-lg font-semibold text-white">Invitation unavailable</h1>
          <p className="text-sm text-white/60">{state.message}</p>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'declined') {
    return (
      <Shell>
        <div className={CARD}>
          <h1 className="mb-2 text-lg font-semibold text-white">Invitation declined</h1>
          <p className="text-sm text-white/60">We&rsquo;ve let them know. Nothing has been shared.</p>
        </div>
      </Shell>
    )
  }

  if (state.kind === 'accepted') {
    return (
      <Shell>
        <div className={CARD}>
          <h1 className="mb-2 text-lg font-semibold text-white">You&rsquo;re connected</h1>
          <p className="mb-4 text-sm text-white/60">
            {state.createdOrg
              ? 'Your workspace has been created and linked. You can sign in to see the partnership.'
              : 'Your workspace is now linked. The partner company has been added to your CRM.'}
          </p>
          <a href="/portal/dashboard" className="inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black">
            Go to your workspace
          </a>
        </div>
      </Shell>
    )
  }

  const { preview } = state

  if (preview.status !== 'pending' || preview.expired) {
    const label = preview.expired ? 'expired' : preview.status
    return (
      <Shell>
        <div className={CARD}>
          <h1 className="mb-2 text-lg font-semibold text-white">This invitation is {label}</h1>
          <p className="text-sm text-white/60">Ask {preview.inviterOrgName} to send a new one.</p>
        </div>
      </Shell>
    )
  }

  const needsAccount = !preview.signedIn
  const canSubmit = !submitting && (!needsAccount || password.length >= 8)

  return (
    <Shell>
      <div className={CARD}>
        <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-amber-500/80">Partner invitation</p>
        <h1 className="mb-3 text-xl font-semibold text-white">
          {preview.inviterOrgName} wants to connect
        </h1>
        <p className="mb-4 text-sm leading-relaxed text-white/60">
          {preview.inviterName ? `${preview.inviterName} at ` : ''}{preview.inviterOrgName} invited{' '}
          <span className="text-white">{preview.recipientEmail}</span> to link workspaces. Accepting creates a
          mutual link: they appear in your CRM, you appear in theirs, and you can work on shared projects and
          documents. Your own records stay private.
        </p>

        {preview.message ? (
          <p className="mb-4 rounded-lg border-l-2 border-amber-500 bg-white/[0.03] px-3 py-2 text-sm text-white/70">
            “{preview.message}”
          </p>
        ) : null}

        <div className="mb-5">
          <PartnerModuleMatrix
            value={modules}
            onChange={setModules}
            label="Modules to share (pre-checked)"
            className="rounded-lg border border-white/10 bg-black/20 p-3"
          />
        </div>

        {needsAccount ? (
          <div className="space-y-3">
            <div>
              <label className={LABEL} htmlFor="displayName">Your name</label>
              <input id="displayName" className={INPUT} value={displayName}
                onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Smith" />
            </div>
            <div>
              <label className={LABEL} htmlFor="businessName">Your business name</label>
              <input id="businessName" className={INPUT} value={businessName}
                onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Pty Ltd" />
            </div>
            <div>
              <label className={LABEL} htmlFor="password">Choose a password</label>
              <input id="password" type="password" className={INPUT} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              <p className="mt-1 text-xs text-white/35">
                This creates your Partners in Biz account for {preview.recipientEmail}.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {preview.candidateOrgs.length > 1 ? (
              <div>
                <label className={LABEL} htmlFor="orgId">Link which workspace?</label>
                <select id="orgId" className={INPUT} value={orgId}
                  onChange={(e) => { setOrgId(e.target.value); void load(e.target.value) }}>
                  {preview.candidateOrgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label className={LABEL} htmlFor="company">
                Which of your companies is {preview.inviterOrgName}?
              </label>
              <select id="company" className={INPUT} value={companyChoice}
                onChange={(e) => setCompanyChoice(e.target.value)}>
                <option value="__create__">Create a new company record</option>
                {preview.companies.filter((c) => !c.alreadyLinked).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.suggested ? ' — likely match' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-white/35">
                Pick an existing company to avoid a duplicate, or let us create one.
              </p>
            </div>
          </div>
        )}

        {submitError ? (
          <p className="mt-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {submitError}
          </p>
        ) : null}

        <div className="mt-5 flex gap-3">
          <button type="button" disabled={!canSubmit} onClick={() => void submit('accept')}
            className="flex-1 rounded-lg bg-amber-500 px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">
            {submitting ? 'Working…' : 'Accept & connect'}
          </button>
          {preview.signedIn ? (
            <button type="button" disabled={submitting} onClick={() => void submit('decline')}
              className="rounded-lg border border-white/10 px-4 py-3 text-sm text-white/60 disabled:opacity-50">
              Decline
            </button>
          ) : null}
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#111] px-6 py-16">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 text-center">
          <span className="text-xl font-bold tracking-[-0.5px] text-amber-500">Partners in Biz</span>
        </div>
        {children}
      </div>
    </div>
  )
}
