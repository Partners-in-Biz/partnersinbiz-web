'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import { SystemLinkBadge } from '@/components/crm/SystemLinkBadge'
import { CompanyPicker } from '@/components/crm/CompanyPicker'
import { PartnerRecordPicker, type ShareableRecord } from '@/components/crm/PartnerRecordPicker'
import {
  Button,
  ButtonLink,
  Checkbox,
  Field,
  Input,
  Notice,
  Panel,
  Select,
  Skeleton,
  Status,
  Textarea,
  Title,
} from '@/components/studio'

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
  'campaigns', 'social', 'email', 'seo', 'ads', 'research', 'properties', 'messages',
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

export default function PartnersPage() {
  return (
    <Suspense fallback={<Skeleton height="8rem" />}>
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Partners"
        title="Partners."
        description="Businesses whose workspace is linked to yours. A link is mutual: they appear in your CRM, you appear in theirs. Each side keeps its own private records."
        actions={
          <>
            <ButtonLink href="/portal/partners/orders" variant="secondary" size="sm">Partner orders</ButtonLink>
            <ButtonLink href="/portal/partners/settlements" variant="secondary" size="sm">Settlements</ButtonLink>
          </>
        }
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="info">{notice}</Notice> : null}

      {loading ? (
        <div className="space-y-4">
          <Skeleton height="10rem" />
          <Skeleton height="8rem" />
        </div>
      ) : (
        <>
          <Panel>
            <Title>Invite a partner</Title>
            <p className="mb-4 mt-2 sc-body text-[0.875rem]">
              Pick a company already in your CRM and send its contact an invitation to link workspaces.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="sc-tiny mb-2">Company</p>
                <CompanyPicker
                  currentCompanyId={inviteCompany?.id}
                  currentCompanyName={inviteCompany?.name}
                  allowCreate={false}
                  ariaLabel="Search companies to invite as a partner"
                  onChange={({ companyId, companyName }) =>
                    setInviteCompany(companyId ? { id: companyId, name: companyName ?? '' } : null)}
                />
              </div>
              <Field id="partner-invite-email" label="Their email">
                <Input
                  id="partner-invite-email"
                  aria-label="Their email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="owner@theircompany.com"
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field id="partner-invite-message" label="Message" hint="Optional">
                <Textarea
                  id="partner-invite-message"
                  aria-label="Message"
                  rows={2}
                  value={inviteMessage}
                  onChange={(e) => setInviteMessage(e.target.value)}
                  placeholder="Hi. Linking our workspaces will make shared projects easier to run."
                />
              </Field>
            </div>
            <Button
              type="button"
              className="mt-4"
              onClick={() => void sendInvite()}
              disabled={sending || !inviteCompany || !inviteEmail.trim()}
              loading={sending}
            >
              Send invitation
            </Button>
          </Panel>

          <Panel>
            <Title>
              Linked partners {activeLinks.length > 0 ? `(${activeLinks.length})` : ''}
            </Title>
            {activeLinks.length === 0 ? (
              <EmptyState
                title="No linked partners yet."
                description="Open a company in your CRM and send a partner invitation to link workspaces."
              />
            ) : (
              <ul className="mt-4 divide-y divide-[var(--sc-line)]">
                {activeLinks.map((link) => (
                  <li key={link.relationshipId} className="flex flex-wrap items-center gap-4 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ButtonLink
                          href={`/portal/partners/${link.relationshipId}`}
                          variant="ghost"
                          size="sm"
                          className="!justify-start !px-0 truncate"
                        >
                          {link.companyName || link.partnerOrgName || 'Partner'}
                        </ButtonLink>
                        <SystemLinkBadge kind="org" label={link.partnerOrgName} />
                      </div>
                      <p className="mt-1 sc-tiny text-[var(--sc-ink-soft)]">
                        {link.sharedCapabilities.length > 0
                          ? `You share: ${link.sharedCapabilities.join(', ')}`
                          : 'You share nothing with this partner'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => { setEditingId(editingId === link.relationshipId ? null : link.relationshipId); setShareForId(null); setCatalogForId(null) }}
                        aria-label={`Edit sharing for ${link.companyName || 'partner'}`}
                      >
                        Sharing
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => { setShareForId(shareForId === link.relationshipId ? null : link.relationshipId); setEditingId(null); setCatalogForId(null) }}
                        aria-label={`Share a record with ${link.companyName || 'partner'}`}
                      >
                        Share record
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => { setCatalogForId(catalogForId === link.relationshipId ? null : link.relationshipId); setEditingId(null); setShareForId(null) }}
                        aria-label={`Manage what ${link.companyName || 'this partner'} can order from you`}
                      >
                        Catalogue
                      </Button>
                      <ButtonLink
                        href={`/portal/partners/catalog/${link.relationshipId}`}
                        variant="ghost"
                        size="sm"
                      >
                        Order from them
                      </ButtonLink>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void unlink(link)}
                        disabled={busyId === link.relationshipId}
                        aria-label={`Unlink ${link.companyName || 'partner'}`}
                      >
                        {busyId === link.relationshipId ? 'Working…' : 'Unlink'}
                      </Button>
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
                      <div className="w-full st-panel st-panel--flat p-4">
                        <p className="mb-4 sc-body text-[0.875rem]">
                          Share one specific record with {link.partnerOrgName || 'this partner'}. Only record types
                          you share above can be selected.
                        </p>
                        <div className="flex flex-wrap items-end gap-4">
                          <Field id={`type-${link.relationshipId}`} label="Type">
                            <Select
                              id={`type-${link.relationshipId}`}
                              aria-label="Type"
                              value={shareType}
                              onChange={(e) => setShareType(e.target.value)}
                            >
                              {RESOURCE_TYPES.map((t) => (
                                <option key={t} value={t}>{t.replace('_', ' ')}</option>
                              ))}
                            </Select>
                          </Field>
                          <div className="min-w-[220px] flex-1">
                            <p className="sc-tiny mb-2">Record</p>
                            <PartnerRecordPicker
                              resourceType={shareType}
                              relationshipId={link.relationshipId}
                              value={shareRecordSel}
                              onChange={setShareRecordSel}
                              ariaLabel={`Search ${shareType.replace('_', ' ')}s to share with ${link.companyName || 'this partner'}`}
                            />
                          </div>
                          <Field id={`perm-${link.relationshipId}`} label="Access">
                            <Select
                              id={`perm-${link.relationshipId}`}
                              aria-label="Access"
                              value={sharePermission}
                              onChange={(e) => setSharePermission(e.target.value as 'view' | 'comment')}
                            >
                              <option value="view">View only</option>
                              <option value="comment">Can comment</option>
                            </Select>
                          </Field>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void shareRecord(link)}
                            disabled={busyId === link.relationshipId || !shareRecordSel}
                          >
                            Share
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <Title>
              Invitations in flight {invites.length > 0 ? `(${invites.length})` : ''}
            </Title>
            {invites.length === 0 ? (
              <p className="mt-4 sc-body">No pending invitations.</p>
            ) : (
              <ul className="mt-4 divide-y divide-[var(--sc-line)]">
                {invites.map((invite) => (
                  <li key={invite.id} className="flex flex-wrap items-center gap-4 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate sc-body text-[var(--sc-ink)]">
                        {invite.recipientCompanyName || invite.recipientName || invite.recipientEmail}
                      </p>
                      <p className="truncate sc-tiny text-[var(--sc-ink-soft)]">
                        {invite.recipientEmail} · {invite.kind} invite · {invite.status}
                        {invite.expiresAt ? ` · expires ${new Date(invite.expiresAt).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    {invite.status === 'pending' ? (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => void inviteAction(invite, 'resend')}
                          disabled={busyId === invite.id}
                        >
                          Resend
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void inviteAction(invite, 'revoke')}
                          disabled={busyId === invite.id}
                        >
                          Revoke
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {(outgoing.length > 0 || incoming.length > 0) ? (
            <Panel>
              <Title>Shared records</Title>
              <div className="mt-4 grid gap-8 md:grid-cols-2">
                <div>
                  <p className="mb-2 sc-tiny">
                    You shared out ({outgoing.length})
                  </p>
                  {outgoing.length === 0 ? (
                    <p className="sc-body text-[0.875rem]">Nothing shared yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {outgoing.map((share) => (
                        <li key={share.id} className="flex items-center gap-2 text-[0.875rem]">
                          <Status>{share.resourceType.replace('_', ' ')}</Status>
                          <ButtonLink
                            href={`/portal/partners/shared/${share.id}`}
                            variant="ghost"
                            size="sm"
                            className="min-w-0 flex-1 truncate !justify-start !px-0"
                          >
                            {share.resourceTitle || share.resourceId}
                          </ButtonLink>
                          <Select
                            value={share.permission === 'comment' ? 'comment' : 'view'}
                            onChange={(e) => void changeSharePermission(share, e.target.value as 'view' | 'comment')}
                            disabled={busyId === share.id}
                            aria-label={`Access level for ${share.resourceTitle || share.resourceId}`}
                            className="!h-auto !min-h-0 py-1 text-[0.75rem]"
                          >
                            <option value="view">View only</option>
                            <option value="comment">Can comment</option>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => void revokeShare(share)}
                            disabled={busyId === share.id}
                            aria-label={`Stop sharing ${share.resourceTitle || share.resourceId}`}
                          >
                            Stop
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-2 sc-tiny">
                    Shared with you ({incoming.length})
                  </p>
                  {incoming.length === 0 ? (
                    <p className="sc-body text-[0.875rem]">Nothing shared with you yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {incoming.map((share) => (
                        <li key={share.id} className="flex items-center gap-2 text-[0.875rem]">
                          <Status>{share.resourceType.replace('_', ' ')}</Status>
                          <ButtonLink
                            href={`/portal/partners/shared/${share.id}`}
                            variant="ghost"
                            size="sm"
                            className="min-w-0 flex-1 truncate !justify-start !px-0"
                          >
                            {share.resourceTitle || share.resourceId}
                          </ButtonLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Panel>
          ) : null}

          {endedLinks.length > 0 ? (
            <Panel>
              <Title>Ended links</Title>
              <ul className="mt-4 divide-y divide-[var(--sc-line)]">
                {endedLinks.map((link) => (
                  <li key={link.relationshipId} className="flex items-center gap-4 py-2 sc-body text-[var(--sc-ink-soft)]">
                    <span className="min-w-0 flex-1 truncate">{link.companyName || link.partnerOrgName}</span>
                    <Status>{link.status}</Status>
                  </li>
                ))}
              </ul>
            </Panel>
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
    <div className="w-full st-panel st-panel--flat p-4">
      <p className="mb-4 sc-body text-[0.875rem]">
        What <strong className="text-[var(--sc-ink)]">you</strong> share with{' '}
        {link.partnerOrgName || 'this partner'}. This is one-sided: they control their own side
        independently.
      </p>

      <p className="mb-2 sc-tiny">Capabilities</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {CAPABILITIES.map((cap) => {
          const on = caps.includes(cap)
          return (
            <Button
              key={cap}
              type="button"
              size="sm"
              variant={on ? 'secondary' : 'ghost'}
              aria-pressed={on}
              onClick={() => toggleCap(cap)}
            >
              {cap}
            </Button>
          )
        })}
      </div>

      <p className="mb-2 sc-tiny">Field sharing</p>
      <div className="mb-4 flex flex-wrap gap-4">
        {POLICY_KEYS.map((key) => (
          <Checkbox
            key={key}
            label={key}
            checked={Boolean(policy[key])}
            onChange={(e) => setPolicy((prev) => ({ ...prev, [key]: e.target.checked }))}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => onSave(caps, policy)}
          disabled={busy}
          loading={busy}
        >
          Save sharing
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
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
    <div className="w-full st-panel st-panel--flat p-4">
      <p className="mb-4 sc-body text-[0.875rem]">
        Products {link.partnerOrgName || 'this partner'} can order from you, at the price you set for them.
      </p>

      {!canTrade ? (
        <Notice tone="warning">
          Enable the <strong>orders</strong> capability under Sharing before publishing a catalogue.
        </Notice>
      ) : (
        <>
          {published.length > 0 ? (
            <ul className="mb-4 space-y-2">
              {published.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-[0.875rem]">
                  <span className="min-w-0 flex-1 truncate text-[var(--sc-ink)]">
                    {item.name}{item.sku ? ` · ${item.sku}` : ''}
                  </span>
                  <span className="st-num text-[var(--sc-ink-soft)]">
                    {item.currency} {item.unitPrice.toFixed(2)}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void unpublish(item.id)}
                    disabled={busy}
                    aria-label={`Stop offering ${item.name}`}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 sc-body text-[0.875rem]">Nothing published to them yet.</p>
          )}

          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[180px] flex-1">
              <Field id={`prod-${link.relationshipId}`} label="Product">
                <Select
                  id={`prod-${link.relationshipId}`}
                  aria-label="Product"
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                >
                  <option value="">Choose a product…</option>
                  {availableProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - {p.currency} {p.unitPrice}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field id={`price-${link.relationshipId}`} label="Their price">
              <Input
                id={`price-${link.relationshipId}`}
                aria-label="Their price"
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="list"
                className="w-24"
              />
            </Field>
            <Button
              type="button"
              size="sm"
              onClick={() => void publish()}
              disabled={busy || !productId}
              loading={busy}
            >
              Publish
            </Button>
          </div>
          <p className="mt-2 sc-tiny text-[var(--sc-ink-soft)]">
            Leave the price blank to use your list price.
          </p>
        </>
      )}

      {err ? <Notice tone="danger">{err}</Notice> : null}
      {msg ? <Notice tone="info">{msg}</Notice> : null}
    </div>
  )
}
