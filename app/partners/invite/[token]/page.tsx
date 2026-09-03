'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { PartnerModuleMatrix } from '@/components/crm/PartnerModuleMatrix'
import { DEFAULT_COMPANY_WORKSPACE_MODULES } from '@/lib/company-work/module-keys'
import { Button, ButtonLink, Field, Input, Notice, Panel, Select, Skeleton } from '@/components/studio'

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
    return (
      <Shell>
        <Skeleton height={160} />
      </Shell>
    )
  }

  if (state.kind === 'error') {
    return (
      <Shell>
        <Panel>
          <h1 className="sc-article__h2">Invitation unavailable.</h1>
          <p className="sc-body mt-4">{state.message}</p>
        </Panel>
      </Shell>
    )
  }

  if (state.kind === 'declined') {
    return (
      <Shell>
        <Panel>
          <h1 className="sc-article__h2">Invitation declined.</h1>
          <p className="sc-body mt-4">We have let them know. Nothing has been shared.</p>
        </Panel>
      </Shell>
    )
  }

  if (state.kind === 'accepted') {
    return (
      <Shell>
        <Panel>
          <h1 className="sc-article__h2">You are connected.</h1>
          <p className="sc-body mt-4">
            {state.createdOrg
              ? 'Your workspace has been created and linked. You can sign in to see the partnership.'
              : 'Your workspace is now linked. The partner company has been added to your CRM.'}
          </p>
          <div className="mt-8">
            <ButtonLink href="/portal/dashboard">Go to your workspace</ButtonLink>
          </div>
        </Panel>
      </Shell>
    )
  }

  const { preview } = state

  if (preview.status !== 'pending' || preview.expired) {
    const label = preview.expired ? 'expired' : preview.status
    return (
      <Shell>
        <Panel>
          <h1 className="sc-article__h2">This invitation is {label}.</h1>
          <p className="sc-body mt-4">Ask {preview.inviterOrgName} to send a new one.</p>
        </Panel>
      </Shell>
    )
  }

  const needsAccount = !preview.signedIn
  const canSubmit = !submitting && (!needsAccount || password.length >= 8)

  return (
    <Shell>
      <Panel>
        <p className="sc-tiny">Partner invitation</p>
        <h1 className="sc-article__h2 mt-2">
          {preview.inviterOrgName} wants to connect.
        </h1>
        <p className="sc-body mt-4">
          {preview.inviterName ? `${preview.inviterName} at ` : ''}{preview.inviterOrgName} invited{' '}
          {preview.recipientEmail} to link workspaces. Accepting creates a mutual link: they appear
          in your CRM, you appear in theirs, and you can work on shared projects and documents. Your
          own records stay private.
        </p>

        {preview.message ? (
          <div className="mt-4">
            <Notice>{preview.message}</Notice>
          </div>
        ) : null}

        <div className="mt-8">
          <PartnerModuleMatrix
            value={modules}
            onChange={setModules}
            label="Modules to share (pre-checked)"
            className="st-panel st-panel--flat p-4"
          />
        </div>

        {needsAccount ? (
          <div className="mt-8 flex flex-col gap-4">
            <Field id="displayName" label="Your name">
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane Smith"
                aria-label="Your name"
              />
            </Field>
            <Field id="businessName" label="Your business name">
              <Input
                id="businessName"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Acme Pty Ltd"
                aria-label="Your business name"
              />
            </Field>
            <Field
              id="password"
              label="Choose a password"
              help={`This creates your Partners in Biz account for ${preview.recipientEmail}.`}
            >
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                aria-label="Choose a password"
              />
            </Field>
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-4">
            {preview.candidateOrgs.length > 1 ? (
              <Field id="orgId" label="Link which workspace?">
                <Select
                  id="orgId"
                  value={orgId}
                  aria-label="Link which workspace?"
                  onChange={(e) => {
                    setOrgId(e.target.value)
                    void load(e.target.value)
                  }}
                >
                  {preview.candidateOrgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <Field
              id="company"
              label={`Which of your companies is ${preview.inviterOrgName}?`}
              help="Pick an existing company to avoid a duplicate, or let us create one."
            >
              <Select
                id="company"
                value={companyChoice}
                aria-label={`Which of your companies is ${preview.inviterOrgName}?`}
                onChange={(e) => setCompanyChoice(e.target.value)}
              >
                <option value="__create__">Create a new company record</option>
                {preview.companies.filter((c) => !c.alreadyLinked).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.suggested ? ' (likely match)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {submitError ? (
          <div className="mt-4">
            <Notice tone="danger">{submitError}</Notice>
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-4">
          <Button
            type="button"
            disabled={!canSubmit}
            loading={submitting}
            onClick={() => void submit('accept')}
            className="flex-1"
          >
            Accept and connect
          </Button>
          {preview.signedIn ? (
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={() => void submit('decline')}
            >
              Decline
            </Button>
          ) : null}
        </div>
      </Panel>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-lg px-8 py-16">
      <p className="sc-tiny mb-8 text-center">Partners in Biz</p>
      {children}
    </main>
  )
}
