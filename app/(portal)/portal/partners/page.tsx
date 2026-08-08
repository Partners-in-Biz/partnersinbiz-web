'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { SystemLinkBadge } from '@/components/crm/SystemLinkBadge'
import { CompanyPicker } from '@/components/crm/CompanyPicker'
import { PartnerRecordPicker, type ShareableRecord } from '@/components/crm/PartnerRecordPicker'

interface PartnerLink {
  relationshipId: string
  partnerLinkId?: string
  status: string
  partnerOrgId?: string
  partnerOrgName?: string
  companyId?: string
  companyName?: string
  contactId?: string
  sharedCapabilities: string[]
  fieldSharingPolicy?: Record<string, boolean>
}

interface PartnerShare {
  id: string
  relationshipId: string
  ownerOrgId: string
  partnerOrgId: string
  resourceType: string
  resourceId: string
  resourceTitle?: string
  permission: string
  status: string
}

const CAPABILITIES = [
  'crm', 'projects', 'documents', 'invoices',
  'orders', 'shipments', 'inventory', 'analytics', 'support', 'services',
] as const

const POLICY_KEYS = [
  'companyProfile', 'contacts', 'projects', 'documents', 'commerce', 'analytics',
] as const

const RESOURCE_TYPES = ['deal', 'project', 'invoice', 'quote', 'client_document'] as const

interface PartnerInvite {
  id: string
  kind: 'company' | 'contact'
  status: string
  recipientEmail: string
  recipientName?: string
  recipientCompanyName?: string
  expiresAt?: string
  sourceCompanyId: string
}

function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  return (b.data as Record<string, unknown>) ?? b
}

const CARD = 'rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)]'

export default function PartnersPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-[var(--color-pib-text-muted)]">Loading…</div>}>
      <PartnersPageInner />
    </Suspense>
  )
}

function PartnersPageInner() {
  const searchParams = useSearchParams()
  const [links, setLinks] = useState<PartnerLink[]>([])
  const [invites, setInvites] = useState<PartnerInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [inviteCompany, setInviteCompany] = useState<{ id: string; name: string } | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [sending, setSending] = useState(false)

  const [outgoing, setOutgoing] = useState<PartnerShare[]>([])
  const [incoming, setIncoming] = useState<PartnerShare[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [shareForId, setShareForId] = useState<string | null>(null)
  const [shareType, setShareType] = useState<string>('project')
  const [shareRecordSel, setShareRecordSel] = useState<ShareableRecord | null>(null)
  const [sharePermission, setSharePermission] = useState<'view' | 'comment'>('view')
  const [catalogForId, setCatalogForId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/crm/partner-links')
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not load partners.')
        return
      }
      setLinks((data?.links as PartnerLink[]) ?? [])
      setInvites((data?.invites as PartnerInvite[]) ?? [])

      const shareRes = await fetch('/api/v1/crm/partner-shares')
      const shareData = unwrap(await shareRes.json().catch(() => null))
      if (shareRes.ok) {
        setOutgoing((shareData?.outgoing as PartnerShare[]) ?? [])
        setIncoming((shareData?.incoming as PartnerShare[]) ?? [])
      }
    } catch {
      setError('Could not load partners.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Pre-select the company when arriving from a company command center's
  // "Invite to link workspaces" action.
  useEffect(() => {
    const companyId = searchParams.get('companyId')
    if (!companyId) return
    setInviteCompany((prev) => prev ?? { id: companyId, name: searchParams.get('companyName') ?? '' })
  }, [searchParams])

  async function unlink(link: PartnerLink) {
    const name = link.partnerOrgName || link.companyName || 'this partner'
    if (!window.confirm(
      `Unlink ${name}?\n\nBoth workspaces stop seeing each other's shared records. Your company and contact records are kept.`,
    )) return
    setBusyId(link.relationshipId)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-links/${link.relationshipId}/unlink`, { method: 'POST' })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not unlink.')
        return
      }
      setNotice(`Unlinked ${name}.`)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function inviteAction(invite: PartnerInvite, action: 'revoke' | 'resend') {
    setBusyId(invite.id)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-invites/${invite.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || `Could not ${action} the invitation.`)
        return
      }
      setNotice(action === 'revoke' ? 'Invitation revoked.' : 'Invitation resent.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function sendInvite() {
    if (!inviteCompany || !inviteEmail.trim()) return
    setSending(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/crm/partner-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'company',
          companyId: inviteCompany.id,
          email: inviteEmail.trim(),
          message: inviteMessage.trim() || undefined,
        }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not send the invitation.')
        return
      }
      setNotice(data?.emailSent
        ? `Invitation sent to ${inviteEmail.trim()}.`
        : `Invitation created, but the email could not be sent${data?.emailError ? ` (${data.emailError})` : ''}. Share this link: ${data?.acceptUrl ?? ''}`)
      setInviteEmail('')
      setInviteMessage('')
      setInviteCompany(null)
      await load()
    } finally {
      setSending(false)
    }
  }

  async function saveSharing(link: PartnerLink, capabilities: string[], policy: Record<string, boolean>) {
    setBusyId(link.relationshipId)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-links/${link.relationshipId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharedCapabilities: capabilities, fieldSharingPolicy: policy }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not update sharing.')
        return
      }
      setNotice('Sharing updated.')
      setEditingId(null)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function shareRecord(link: PartnerLink) {
    if (!shareRecordSel) return
    setBusyId(link.relationshipId)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/v1/crm/partner-shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationshipId: link.relationshipId,
          resourceType: shareType,
          resourceId: shareRecordSel.id,
          permission: sharePermission,
        }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not share that record.')
        return
      }
      setNotice(`Shared "${shareRecordSel.title}" (${sharePermission === 'comment' ? 'can comment' : 'view only'}).`)
      setShareRecordSel(null)
      setShareForId(null)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function changeSharePermission(share: PartnerShare, permission: 'view' | 'comment') {
    setBusyId(share.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-shares/${share.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not change access.')
        return
      }
      setNotice(permission === 'comment' ? 'Partner can now comment.' : 'Set to view only.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function revokeShare(share: PartnerShare) {
    setBusyId(share.id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-shares/${share.id}`, { method: 'DELETE' })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) {
        setError((data?.error as string) || 'Could not stop sharing.')
        return
      }
      setNotice('Stopped sharing.')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const activeLinks = links.filter((l) => l.status === 'active')
  const endedLinks = links.filter((l) => l.status !== 'active')

  return (
    <div className="space-y-5 p-4">
      <header>
        <p className="eyebrow">CRM</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-[var(--color-pib-text)]">Partners</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          Businesses whose workspace is linked to yours. A link is mutual — they appear in your CRM,
          you appear in theirs. Each side keeps its own private records.
        </p>
        <Link
          href="/portal/partners/orders"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
        >
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">receipt_long</span>
          Partner orders
        </Link>
        <Link
          href="/portal/partners/settlements"
          className="mt-2 ml-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
        >
          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">account_balance</span>
          Settlements
        </Link>
      </header>

      {error ? (
        <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
      ) : null}
      {notice ? (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : (
        <>
          <section className={`${CARD} p-4`}>
            <h2 className="mb-1 text-sm font-semibold text-[var(--color-pib-text)]">Invite a partner</h2>
            <p className="mb-3 text-xs text-[var(--color-pib-text-muted)]">
              Pick a company already in your CRM and send its contact an invitation to link workspaces.
            </p>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                  Company
                </label>
                <CompanyPicker
                  currentCompanyId={inviteCompany?.id}
                  currentCompanyName={inviteCompany?.name}
                  allowCreate={false}
                  ariaLabel="Search companies to invite as a partner"
                  onChange={({ companyId, companyName }) =>
                    setInviteCompany(companyId ? { id: companyId, name: companyName ?? '' } : null)}
                />
              </div>
              <div>
                <label htmlFor="partner-invite-email" className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                  Their email
                </label>
                <input
                  id="partner-invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="owner@theircompany.com"
                  className="w-full rounded-lg border border-[var(--color-pib-line)] bg-black/20 px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-[var(--color-accent-v2)]"
                />
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="partner-invite-message" className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                Message (optional)
              </label>
              <textarea
                id="partner-invite-message"
                rows={2}
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                placeholder="Hi — linking our workspaces will make shared projects easier to run."
                className="w-full rounded-lg border border-[var(--color-pib-line)] bg-black/20 px-3 py-2 text-sm text-[var(--color-pib-text)] outline-none focus:border-[var(--color-accent-v2)]"
              />
            </div>
            <button
              type="button"
              onClick={() => void sendInvite()}
              disabled={sending || !inviteCompany || !inviteEmail.trim()}
              className="mt-3 rounded-lg bg-[var(--color-accent-v2)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send invitation'}
            </button>
          </section>

          <section className={`${CARD} p-4`}>
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">
              Linked partners {activeLinks.length > 0 ? `(${activeLinks.length})` : ''}
            </h2>
            {activeLinks.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">
                No linked partners yet. Open a company in your CRM and send a partner invitation to link workspaces.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--color-pib-line)]">
                {activeLinks.map((link) => (
                  <li key={link.relationshipId} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/portal/partners/${link.relationshipId}`}
                          className="truncate text-sm font-medium text-[var(--color-pib-text)] hover:text-[var(--color-accent-v2)]"
                        >
                          {link.companyName || link.partnerOrgName || 'Partner'}
                        </Link>
                        <SystemLinkBadge kind="org" label={link.partnerOrgName} />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-[var(--color-pib-text-muted)]">
                        {link.sharedCapabilities.length > 0
                          ? `You share: ${link.sharedCapabilities.join(', ')}`
                          : 'You share nothing with this partner'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setEditingId(editingId === link.relationshipId ? null : link.relationshipId); setShareForId(null); setCatalogForId(null) }}
                        aria-label={`Edit sharing for ${link.companyName || 'partner'}`}
                        className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                      >
                        Sharing
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShareForId(shareForId === link.relationshipId ? null : link.relationshipId); setEditingId(null); setCatalogForId(null) }}
                        aria-label={`Share a record with ${link.companyName || 'partner'}`}
                        className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                      >
                        Share record
                      </button>
                      <button
                        type="button"
                        onClick={() => { setCatalogForId(catalogForId === link.relationshipId ? null : link.relationshipId); setEditingId(null); setShareForId(null) }}
                        aria-label={`Manage what ${link.companyName || 'this partner'} can order from you`}
                        className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                      >
                        Catalogue
                      </button>
                      <Link
                        href={`/portal/partners/catalog/${link.relationshipId}`}
                        aria-label={`Order from ${link.companyName || 'this partner'}`}
                        className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)]"
                      >
                        Order from them
                      </Link>
                      <button
                        type="button"
                        onClick={() => void unlink(link)}
                        disabled={busyId === link.relationshipId}
                        aria-label={`Unlink ${link.companyName || 'partner'}`}
                        className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] disabled:opacity-50"
                      >
                        {busyId === link.relationshipId ? 'Working…' : 'Unlink'}
                      </button>
                    </div>

                    {editingId === link.relationshipId ? (
                      <SharingEditor
                        link={link}
                        busy={busyId === link.relationshipId}
                        onCancel={() => setEditingId(null)}
                        onSave={(caps, policy) => void saveSharing(link, caps, policy)}
                      />
                    ) : null}

                    {catalogForId === link.relationshipId ? (
                      <CatalogEditor link={link} />
                    ) : null}

                    {shareForId === link.relationshipId ? (
                      <div className="w-full rounded-lg border border-[var(--color-pib-line)] bg-black/20 p-3">
                        <p className="mb-2 text-xs text-[var(--color-pib-text-muted)]">
                          Share one specific record with {link.partnerOrgName || 'this partner'}. Only record types
                          you share above can be selected.
                        </p>
                        <div className="flex flex-wrap items-end gap-2">
                          <div>
                            <label htmlFor={`type-${link.relationshipId}`} className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Type</label>
                            <select
                              id={`type-${link.relationshipId}`}
                              value={shareType}
                              onChange={(e) => setShareType(e.target.value)}
                              className="rounded-md border border-[var(--color-pib-line)] bg-black/30 px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                            >
                              {RESOURCE_TYPES.map((t) => (
                                <option key={t} value={t}>{t.replace('_', ' ')}</option>
                              ))}
                            </select>
                          </div>
                          <div className="min-w-[220px] flex-1">
                            <span className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Record</span>
                            <PartnerRecordPicker
                              resourceType={shareType}
                              relationshipId={link.relationshipId}
                              value={shareRecordSel}
                              onChange={setShareRecordSel}
                              ariaLabel={`Search ${shareType.replace('_', ' ')}s to share with ${link.companyName || 'this partner'}`}
                            />
                          </div>
                          <div>
                            <label htmlFor={`perm-${link.relationshipId}`} className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Access</label>
                            <select
                              id={`perm-${link.relationshipId}`}
                              value={sharePermission}
                              onChange={(e) => setSharePermission(e.target.value as 'view' | 'comment')}
                              className="rounded-md border border-[var(--color-pib-line)] bg-black/30 px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
                            >
                              <option value="view">View only</option>
                              <option value="comment">Can comment</option>
                            </select>
                          </div>
                          <button
                            type="button"
                            onClick={() => void shareRecord(link)}
                            disabled={busyId === link.relationshipId || !shareRecordSel}
                            className="rounded-md bg-[var(--color-accent-v2)] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
                          >
                            Share
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${CARD} p-4`}>
            <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">
              Invitations in flight {invites.length > 0 ? `(${invites.length})` : ''}
            </h2>
            {invites.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">No pending invitations.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-pib-line)]">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[var(--color-pib-text)]">
                        {invite.recipientCompanyName || invite.recipientName || invite.recipientEmail}
                      </p>
                      <p className="truncate text-[11px] text-[var(--color-pib-text-muted)]">
                        {invite.recipientEmail} · {invite.kind} invite · {invite.status}
                        {invite.expiresAt ? ` · expires ${new Date(invite.expiresAt).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    {invite.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void inviteAction(invite, 'resend')}
                          disabled={busyId === invite.id}
                          className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] disabled:opacity-50"
                        >
                          Resend
                        </button>
                        <button
                          type="button"
                          onClick={() => void inviteAction(invite, 'revoke')}
                          disabled={busyId === invite.id}
                          className="rounded-md border border-[var(--color-pib-line)] px-2.5 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05] hover:text-[var(--color-pib-text)] disabled:opacity-50"
                        >
                          Revoke
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(outgoing.length > 0 || incoming.length > 0) ? (
            <section className={`${CARD} p-4`}>
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">Shared records</h2>
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                    You shared out ({outgoing.length})
                  </p>
                  {outgoing.length === 0 ? (
                    <p className="text-xs text-[var(--color-pib-text-muted)]">Nothing shared yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {outgoing.map((share) => (
                        <li key={share.id} className="flex items-center gap-2 text-xs">
                          <span className="pib-pill px-1.5 py-0.5 text-[10px]">{share.resourceType.replace('_', ' ')}</span>
                          <Link
                            href={`/portal/partners/shared/${share.id}`}
                            className="min-w-0 flex-1 truncate text-[var(--color-pib-text)] hover:text-[var(--color-accent-v2)]"
                          >
                            {share.resourceTitle || share.resourceId}
                          </Link>
                          <select
                            value={share.permission === 'comment' ? 'comment' : 'view'}
                            onChange={(e) => void changeSharePermission(share, e.target.value as 'view' | 'comment')}
                            disabled={busyId === share.id}
                            aria-label={`Access level for ${share.resourceTitle || share.resourceId}`}
                            className="rounded border border-[var(--color-pib-line)] bg-black/30 px-1 py-0.5 text-[10px] text-[var(--color-pib-text-muted)] disabled:opacity-50"
                          >
                            <option value="view">View only</option>
                            <option value="comment">Can comment</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void revokeShare(share)}
                            disabled={busyId === share.id}
                            aria-label={`Stop sharing ${share.resourceTitle || share.resourceId}`}
                            className="text-[var(--color-pib-text-muted)] transition hover:text-rose-300 disabled:opacity-50"
                          >
                            Stop
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">
                    Shared with you ({incoming.length})
                  </p>
                  {incoming.length === 0 ? (
                    <p className="text-xs text-[var(--color-pib-text-muted)]">Nothing shared with you yet.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {incoming.map((share) => (
                        <li key={share.id} className="flex items-center gap-2 text-xs">
                          <span className="pib-pill px-1.5 py-0.5 text-[10px]">{share.resourceType.replace('_', ' ')}</span>
                          <Link
                            href={`/portal/partners/shared/${share.id}`}
                            className="min-w-0 flex-1 truncate text-[var(--color-pib-text)] hover:text-[var(--color-accent-v2)]"
                          >
                            {share.resourceTitle || share.resourceId}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {endedLinks.length > 0 ? (
            <section className={`${CARD} p-4`}>
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-pib-text)]">Ended links</h2>
              <ul className="divide-y divide-[var(--color-pib-line)]">
                {endedLinks.map((link) => (
                  <li key={link.relationshipId} className="flex items-center gap-3 py-2 text-sm text-[var(--color-pib-text-muted)]">
                    <span className="min-w-0 flex-1 truncate">{link.companyName || link.partnerOrgName}</span>
                    <span className="pib-pill px-2 py-0.5 text-[10px]">{link.status}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

function SharingEditor({
  link, busy, onCancel, onSave,
}: {
  link: PartnerLink
  busy: boolean
  onCancel: () => void
  onSave: (capabilities: string[], policy: Record<string, boolean>) => void
}) {
  const [caps, setCaps] = useState<string[]>(link.sharedCapabilities ?? [])
  const [policy, setPolicy] = useState<Record<string, boolean>>(link.fieldSharingPolicy ?? {})

  function toggleCap(cap: string) {
    setCaps((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]))
  }

  return (
    <div className="w-full rounded-lg border border-[var(--color-pib-line)] bg-black/20 p-3">
      <p className="mb-2 text-xs text-[var(--color-pib-text-muted)]">
        What <strong className="text-[var(--color-pib-text)]">you</strong> share with{' '}
        {link.partnerOrgName || 'this partner'}. This is one-sided — they control their own side
        independently.
      </p>

      <p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Capabilities</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {CAPABILITIES.map((cap) => {
          const on = caps.includes(cap)
          return (
            <button
              key={cap}
              type="button"
              aria-pressed={on}
              onClick={() => toggleCap(cap)}
              className={`rounded-md border px-2 py-1 text-[11px] transition ${
                on
                  ? 'border-[var(--color-accent-v2)] bg-[var(--color-accent-v2)]/15 text-[var(--color-pib-text)]'
                  : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]'
              }`}
            >
              {cap}
            </button>
          )
        })}
      </div>

      <p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Field sharing</p>
      <div className="mb-3 flex flex-wrap gap-3">
        {POLICY_KEYS.map((key) => (
          <label key={key} className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-pib-text-muted)]">
            <input
              type="checkbox"
              checked={Boolean(policy[key])}
              onChange={(e) => setPolicy((prev) => ({ ...prev, [key]: e.target.checked }))}
              className="h-3.5 w-3.5 rounded accent-[var(--color-accent-v2)]"
            />
            {key}
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave(caps, policy)}
          disabled={busy}
          className="rounded-md bg-[var(--color-accent-v2)] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save sharing'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[var(--color-pib-line)] px-3 py-1.5 text-xs text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.05]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

interface OrgProduct {
  id: string
  name: string
  sku?: string
  unitPrice: number
  currency: string
}

interface PublishedItem {
  id: string
  productId: string
  name: string
  sku?: string
  unitPrice: number
  currency: string
}

/**
 * Supplier-side catalogue for one partner link: which of my products they can
 * order, and at what negotiated price.
 */
function CatalogEditor({ link }: { link: PartnerLink }) {
  const [products, setProducts] = useState<OrgProduct[]>([])
  const [published, setPublished] = useState<PublishedItem[]>([])
  const [productId, setProductId] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [prodRes, pubRes] = await Promise.all([
        fetch('/api/v1/crm/products'),
        fetch(`/api/v1/crm/partner-catalog?view=published&relationshipId=${encodeURIComponent(link.relationshipId)}`),
      ])
      const prodData = unwrap(await prodRes.json().catch(() => null))
      const pubData = unwrap(await pubRes.json().catch(() => null))
      if (prodRes.ok) setProducts((prodData?.products as OrgProduct[]) ?? [])
      if (pubRes.ok) setPublished((pubData?.items as PublishedItem[]) ?? [])
    } catch {
      setErr('Could not load the catalogue.')
    }
  }, [link.relationshipId])

  useEffect(() => { void load() }, [load])

  async function publish() {
    if (!productId) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const res = await fetch('/api/v1/crm/partner-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relationshipId: link.relationshipId,
          productId,
          unitPrice: price.trim() === '' ? undefined : Number(price),
        }),
      })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) { setErr((data?.error as string) || 'Could not publish.'); return }
      setMsg('Published.'); setProductId(''); setPrice('')
      await load()
    } finally { setBusy(false) }
  }

  async function unpublish(itemId: string) {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const res = await fetch(`/api/v1/crm/partner-catalog/${itemId}`, { method: 'DELETE' })
      const data = unwrap(await res.json().catch(() => null))
      if (!res.ok) { setErr((data?.error as string) || 'Could not remove.'); return }
      setMsg('Removed from their catalogue.')
      await load()
    } finally { setBusy(false) }
  }

  const canTrade = link.sharedCapabilities?.includes('orders')
  const availableProducts = products.filter((p) => !published.some((i) => i.productId === p.id))

  return (
    <div className="w-full rounded-lg border border-[var(--color-pib-line)] bg-black/20 p-3">
      <p className="mb-2 text-xs text-[var(--color-pib-text-muted)]">
        Products {link.partnerOrgName || 'this partner'} can order from you, at the price you set for them.
      </p>

      {!canTrade ? (
        <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
          Enable the <strong>orders</strong> capability under Sharing before publishing a catalogue.
        </p>
      ) : (
        <>
          {published.length > 0 ? (
            <ul className="mb-3 space-y-1">
              {published.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-[var(--color-pib-text)]">
                    {item.name}{item.sku ? ` · ${item.sku}` : ''}
                  </span>
                  <span className="font-mono text-[var(--color-pib-text-muted)]">
                    {item.currency} {item.unitPrice.toFixed(2)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void unpublish(item.id)}
                    disabled={busy}
                    aria-label={`Stop offering ${item.name}`}
                    className="text-[var(--color-pib-text-muted)] transition hover:text-rose-300 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-xs text-[var(--color-pib-text-muted)]">Nothing published to them yet.</p>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <label htmlFor={`prod-${link.relationshipId}`} className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Product</label>
              <select
                id={`prod-${link.relationshipId}`}
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="w-full rounded-md border border-[var(--color-pib-line)] bg-black/30 px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
              >
                <option value="">Choose a product…</option>
                {availableProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.currency} {p.unitPrice}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`price-${link.relationshipId}`} className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-[var(--color-pib-text-muted)]">Their price</label>
              <input
                id={`price-${link.relationshipId}`}
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="list"
                className="w-24 rounded-md border border-[var(--color-pib-line)] bg-black/30 px-2 py-1.5 text-xs text-[var(--color-pib-text)]"
              />
            </div>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={busy || !productId}
              className="rounded-md bg-[var(--color-accent-v2)] px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
            >
              Publish
            </button>
          </div>
          <p className="mt-1 text-[10px] text-[var(--color-pib-text-muted)]">
            Leave the price blank to use your list price.
          </p>
        </>
      )}

      {err ? <p className="mt-2 text-[11px] text-rose-300">{err}</p> : null}
      {msg ? <p className="mt-2 text-[11px] text-emerald-300">{msg}</p> : null}
    </div>
  )
}
