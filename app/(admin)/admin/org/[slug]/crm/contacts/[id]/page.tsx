'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/studio'
import { useParams } from 'next/navigation'
import { ContactFactProposalsPanel } from '@/components/crm/ContactFactProposalsPanel'
import { ContactResearchTasksPanel } from '@/components/crm/ContactResearchTasksPanel'
import { SystemLinkBadge } from '@/components/crm/SystemLinkBadge'

type ContactRecord = {
  id?: string
  orgId?: string
  name?: string
  email?: string
  phone?: string
  jobTitle?: string
  company?: string
  companyName?: string
  companyId?: string
  stage?: string
  type?: string
  /** Server-set cross-tenant link to a platform user account. */
  linkedUserId?: string
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function AdminCrmContactDetailPage() {
  const params = useParams<{ slug: string; id: string }>()
  const slug = params.slug
  const id = params.id

  const [orgId, setOrgId] = useState<string | null>(null)
  const [contact, setContact] = useState<ContactRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const apiPath = useCallback(
    (path: string) => {
      if (!orgId) return path
      const joiner = path.includes('?') ? '&' : '?'
      return `${path}${joiner}orgId=${encodeURIComponent(orgId)}`
    },
    [orgId],
  )

  const portalHref = useMemo(() => {
    if (!id) return '/portal/contacts'
    if (orgId) return `/portal/contacts/${encodeURIComponent(id)}?orgId=${encodeURIComponent(orgId)}&orgSlug=${encodeURIComponent(slug || '')}`
    return `/portal/contacts/${encodeURIComponent(id)}`
  }, [id, orgId, slug])

  const load = useCallback(async () => {
    if (!slug || !id) return
    setLoading(true)
    setError(null)
    try {
      const orgRes = await fetch(`/api/v1/admin/org/${encodeURIComponent(slug)}`)
      const orgBody = await orgRes.json().catch(() => null)
      if (!orgRes.ok) {
        throw new Error(orgBody?.error || `Organization load failed (${orgRes.status})`)
      }
      const resolvedOrgId =
        orgBody?.data?.id ||
        orgBody?.data?.org?.id ||
        orgBody?.id ||
        orgBody?.orgId ||
        null
      if (!resolvedOrgId || typeof resolvedOrgId !== 'string') {
        throw new Error('Organization id missing from admin org payload')
      }
      setOrgId(resolvedOrgId)

      const contactRes = await fetch(
        `/api/v1/crm/contacts/${encodeURIComponent(id)}?orgId=${encodeURIComponent(resolvedOrgId)}`,
      )
      const contactBody = await contactRes.json().catch(() => null)
      if (!contactRes.ok) {
        throw new Error(contactBody?.error || `Contact load failed (${contactRes.status})`)
      }
      const row = (contactBody?.data?.contact || contactBody?.data || contactBody?.contact || contactBody) as ContactRecord
      setContact({ ...row, id: row.id || id, orgId: resolvedOrgId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load contact')
      setContact(null)
    } finally {
      setLoading(false)
    }
  }, [id, slug])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !contact) {
    return (
      <div className="bento-card p-10 text-center">
        <Icon name="error_outline" className="text-[var(--st-danger)]" />
        <p className="mt-3 text-sm text-[var(--color-pib-text-muted)]">{error ?? 'Contact not found.'}</p>
        <Link href={`/admin/org/${slug}/dashboard`} className="btn-pib-secondary mt-5 inline-flex items-center gap-1.5">
          Back to org dashboard
        </Link>
      </div>
    )
  }

  const contactName = contact.name || contact.email || 'Contact'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow !text-[10px]">Admin CRM · selected org</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-headline text-3xl text-[var(--color-pib-text)]">{contactName}</h1>
            {contact.linkedUserId ? <SystemLinkBadge kind="user" size="md" /> : null}
          </div>
          <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
            {[contact.jobTitle, contact.companyName || contact.company, contact.email].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={portalHref} className="btn-pib-secondary inline-flex items-center gap-1.5">
            <Icon name="open_in_new" className="text-[16px]" />
            Open full portal contact
          </Link>
          <Link href={`/admin/org/${slug}/dashboard`} className="btn-pib-secondary inline-flex items-center gap-1.5">
            Org dashboard
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-4 py-3">
          <p className="eyebrow !text-[9px]">Type</p>
          <p className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">{contact.type || ' - '}</p>
        </div>
        <div className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-4 py-3">
          <p className="eyebrow !text-[9px]">Stage</p>
          <p className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">{contact.stage || ' - '}</p>
        </div>
        <div className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] px-4 py-3">
          <p className="eyebrow !text-[9px]">Phone</p>
          <p className="mt-1 text-sm font-medium text-[var(--color-pib-text)]">{contact.phone || ' - '}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ContactFactProposalsPanel
          contactId={id}
          contactName={contactName}
          apiPath={apiPath}
          onApplied={() => {
            void load()
          }}
        />
        <ContactResearchTasksPanel contactId={id} contactName={contactName} apiPath={apiPath} />
      </div>
    </div>
  )
}
