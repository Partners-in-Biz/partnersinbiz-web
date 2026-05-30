// app/(admin)/admin/crm/contacts/page.tsx
'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ContactForm } from '@/components/admin/crm/ContactForm'
import { useOrg } from '@/lib/contexts/OrgContext'

const STAGES = ['new','contacted','replied','demo','proposal','won','lost']
const TYPES = ['lead','prospect','client','churned']

interface Contact {
  id: string
  name: string
  email: string
  company: string
  companyName?: string
  phone?: string
  assignedTo?: string
  type: string
  stage: string
  lastContactedAt: unknown
  tags: string[]
  leadScore?: number
  icpScore?: number
  aiLeadScore?: number
}

interface TeamMember {
  uid: string
  firstName?: string
  lastName?: string
  jobTitle?: string
  role?: string
}

function teamMemberLabel(member: TeamMember): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(' ').trim()
  const title = member.jobTitle?.trim() || member.role?.trim()
  return [name || member.uid, title].filter(Boolean).join(' - ')
}

function daysSince(value: unknown): number | null {
  if (!value) return null
  let ms = 0
  if (value instanceof Date) ms = value.getTime()
  if (typeof value === 'string') ms = Date.parse(value)
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: number; _seconds?: number; toDate?: () => Date; toMillis?: () => number }
    if (typeof timestamp.toMillis === 'function') ms = timestamp.toMillis()
    else if (typeof timestamp.toDate === 'function') ms = timestamp.toDate().getTime()
    else if (typeof timestamp.seconds === 'number') ms = timestamp.seconds * 1000
    else if (typeof timestamp._seconds === 'number') ms = timestamp._seconds * 1000
  }
  if (!ms || Number.isNaN(ms)) return null
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000))
}

function averageScore(contacts: Contact[], key: 'leadScore' | 'icpScore' | 'aiLeadScore'): number {
  const values = contacts
    .map((contact) => contact[key])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function MetricCard({
  icon,
  label,
  value,
  sub,
  actionLabel,
  onAction,
}: {
  icon: string
  label: string
  value: string
  sub: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="pib-card min-w-[150px] flex-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
        <span className="material-symbols-outlined text-[17px] text-on-surface-variant">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-headline font-bold leading-none text-on-surface">{value}</p>
      <p className="mt-1 text-[11px] text-on-surface-variant">{sub}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-3 inline-flex items-center gap-1 rounded-md border border-[var(--color-card-border)] px-2 py-1 text-[11px] font-label text-on-surface-variant transition-colors hover:border-[var(--color-accent-v2)] hover:text-on-surface"
          aria-label={actionLabel}
        >
          <span className="material-symbols-outlined text-[14px]">filter_alt</span>
          Review
        </button>
      )}
    </div>
  )
}

function StageBadge({ stage }: { stage: string }) {
  const win = ['won', 'demo', 'replied']
  const lost = ['lost']
  const color = lost.includes(stage)
    ? 'var(--color-error)'
    : win.includes(stage)
    ? '#4ade80'
    : 'var(--color-accent-v2)'
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full capitalize"
      style={{ background: `${color}20`, color }}
    >
      {stage}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const color = type === 'client'
    ? '#4ade80'
    : type === 'churned'
    ? 'var(--color-error)'
    : 'var(--color-accent-v2)'
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full capitalize"
      style={{ background: `${color}20`, color }}
    >
      {type}
    </span>
  )
}

export default function ContactsPage() {
  const { selectedOrgId, orgs } = useOrg()

  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [contactOrgId, setContactOrgId] = useState('')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'unowned'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkOwner, setBulkOwner] = useState('')
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [showNew, setShowNew] = useState(false)
  const activeOrgId = selectedOrgId || contactOrgId
  const hasActiveFilters = Boolean(search.trim() || stageFilter || typeFilter || ownerFilter !== 'all')

  const visibleContacts = useMemo(() => {
    if (ownerFilter !== 'unowned') return contacts
    return contacts.filter((contact) => !String(contact.assignedTo ?? '').trim())
  }, [contacts, ownerFilter])

  const metrics = useMemo(() => {
    const active = contacts.filter((contact) => !['won', 'lost'].includes(contact.stage))
    const clients = contacts.filter((contact) => contact.type === 'client').length
    const stale = contacts.filter((contact) => {
      const age = daysSince(contact.lastContactedAt)
      return age === null || age >= 14
    }).length
    const withCompany = contacts.filter((contact) => Boolean(contact.companyName || contact.company)).length
    const assigned = contacts.filter((contact) => Boolean(String(contact.assignedTo ?? '').trim())).length
    const unowned = contacts.length - assigned
    return {
      total: contacts.length,
      active: active.length,
      clients,
      stale,
      withCompany,
      assigned,
      unowned,
      ownerCoverage: contacts.length ? Math.round((assigned / contacts.length) * 100) : 0,
      avgLead: averageScore(contacts, 'leadScore'),
      avgIcp: averageScore(contacts, 'icpScore'),
      avgAi: averageScore(contacts, 'aiLeadScore'),
    }
  }, [contacts])

  const fetchContacts = useCallback(async () => {
    if (!activeOrgId) {
      setContacts([])
      setLoading(false)
      return
    }
    setLoading(true)
    const params = new URLSearchParams()
    params.set('orgId', activeOrgId)
    if (search) params.set('search', search)
    if (stageFilter) params.set('stage', stageFilter)
    if (typeFilter) params.set('type', typeFilter)
    const res = await fetch(`/api/v1/crm/contacts?${params}`)
    const body = await res.json()
    setContacts(body.data ?? [])
    setLoading(false)
  }, [search, stageFilter, typeFilter, activeOrgId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchContacts()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchContacts])

  useEffect(() => {
    if (!activeOrgId) {
      setTeamMembers([])
      return
    }
    let cancelled = false
    fetch('/api/v1/portal/settings/team')
      .then((res) => res.ok ? res.json() : null)
      .then((body) => {
        if (cancelled) return
        const members = Array.isArray(body?.members) ? body.members : []
        setTeamMembers(members.filter((member: TeamMember) => member.uid))
      })
      .catch(() => {
        if (!cancelled) setTeamMembers([])
      })
    return () => {
      cancelled = true
    }
  }, [activeOrgId])

  async function createContact(data: Record<string, unknown>) {
    if (!activeOrgId) throw new Error('Select a client workspace before creating a contact')
    const res = await fetch('/api/v1/crm/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...data, orgId: activeOrgId }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error ?? 'Failed to create contact')
    }
    setShowNew(false)
    fetchContacts()
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function assignSelectedOwner() {
    const owner = bulkOwner.trim()
    if (!owner || selectedIds.size === 0) return

    setBulkPending(true)
    setBulkError('')
    try {
      const ids = Array.from(selectedIds)
      const res = await fetch('/api/v1/crm/contacts/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, patch: { assignedTo: owner } }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to assign owner')
      }
      setContacts((current) => current.map((contact) => (
        selectedIds.has(contact.id) ? { ...contact, assignedTo: owner } : contact
      )))
      setSelectedIds(new Set())
      setBulkOwner('')
      setOwnerFilter('all')
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to assign owner')
    } finally {
      setBulkPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">CRM command center</p>
          <h1 className="mt-2 font-headline text-3xl font-bold tracking-tight text-on-surface">Contacts</h1>
          <p className="mt-2 text-sm text-on-surface-variant">
            {activeOrgId
              ? hasActiveFilters
                ? `${visibleContacts.length} contact${visibleContacts.length === 1 ? '' : 's'} match this view.`
                : `${contacts.length} contact${contacts.length === 1 ? '' : 's'} in this workspace.`
              : 'Select a client workspace to work contacts without cross-client bleed.'}
          </p>
        </div>
        <button
          onClick={() => activeOrgId && setShowNew(true)}
          disabled={!activeOrgId}
          className="pib-btn-primary text-sm font-label disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-base">add</span>
          New contact
        </button>
      </header>

      {!selectedOrgId && (
        <div className="pib-card space-y-2">
          <label htmlFor="contactOrgId" className="pib-label">Client workspace</label>
          <select
            id="contactOrgId"
            value={contactOrgId}
            onChange={(e) => setContactOrgId(e.target.value)}
            className="pib-select max-w-md"
          >
            <option value="">Select workspace before adding or viewing contacts…</option>
            {orgs
              .filter((org) => org.type === 'client')
              .map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
          </select>
          <p className="text-xs text-on-surface-variant">
            Contacts are always scoped to one client organisation so leads, automations, and handoffs do not bleed across workspaces.
          </p>
        </div>
      )}

      {activeOrgId && (
        <section className="flex flex-wrap gap-3">
          <MetricCard icon="groups" label="Audience" value={String(metrics.total)} sub={`${metrics.active} active lifecycle records`} />
          <MetricCard icon="workspace_premium" label="Clients" value={String(metrics.clients)} sub={`${metrics.withCompany} linked to a company`} />
          <MetricCard icon="schedule" label="Follow-up risk" value={String(metrics.stale)} sub="No recent touch in 14d" />
          <MetricCard
            icon="supervisor_account"
            label="Owner coverage"
            value={`${metrics.ownerCoverage}%`}
            sub={`${metrics.unowned} unowned`}
            actionLabel={metrics.unowned ? 'Show unowned contacts needing an owner' : undefined}
            onAction={metrics.unowned ? () => setOwnerFilter('unowned') : undefined}
          />
          <MetricCard icon="star_rate" label="Avg lead score" value={metrics.avgLead ? String(metrics.avgLead) : '-'} sub={`ICP ${metrics.avgIcp || '-'} · AI ${metrics.avgAi || '-'}`} />
        </section>
      )}

      {/* Filters */}
      <div className="pib-card flex flex-wrap gap-3 p-4">
        <input
          placeholder="Search name, email, company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pib-input min-w-[240px] flex-1"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="pib-input !w-auto"
        >
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s} className="bg-black">{s}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="pib-input !w-auto"
        >
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t} className="bg-black">{t}</option>)}
        </select>
        {hasActiveFilters && (
          <button
            onClick={() => { setSearch(''); setStageFilter(''); setTypeFilter(''); setOwnerFilter('all') }}
            className="pib-btn-secondary text-sm"
          >
            <span className="material-symbols-outlined text-base">filter_alt_off</span>
            Clear
          </button>
        )}
      </div>

      {selectedIds.size > 0 && (
        <section className="pib-card flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[260px] flex-1">
            <label htmlFor="adminBulkOwner" className="pib-label">Assign selected contacts to owner</label>
            <select
              id="adminBulkOwner"
              value={bulkOwner}
              onChange={(event) => setBulkOwner(event.target.value)}
              className="pib-select mt-1"
            >
              <option value="">Select a team member</option>
              {teamMembers.map((member) => (
                <option key={member.uid} value={member.uid}>
                  {teamMemberLabel(member)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={assignSelectedOwner}
            disabled={!bulkOwner.trim() || bulkPending}
            className="pib-btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Assign owner to ${selectedIds.size} selected contact${selectedIds.size === 1 ? '' : 's'}`}
          >
            <span className="material-symbols-outlined text-base">supervisor_account</span>
            {bulkPending ? 'Assigning…' : 'Assign owner'}
          </button>
          <button
            type="button"
            onClick={() => { setSelectedIds(new Set()); setBulkOwner(''); setBulkError('') }}
            className="pib-btn-secondary text-sm"
          >
            Clear selection
          </button>
          <p className="basis-full text-xs text-on-surface-variant">
            {selectedIds.size} selected for owner assignment.
          </p>
          {bulkError && <p className="basis-full text-xs text-red-300">{bulkError}</p>}
        </section>
      )}

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 pib-skeleton" />
          ))}
        </div>
      ) : visibleContacts.length === 0 ? (
        <div className="pib-card p-8">
          <div className="mx-auto max-w-3xl text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant">contacts</span>
            <h2 className="mt-4 font-headline text-2xl font-bold tracking-tight text-on-surface">
              {hasActiveFilters
                ? 'No contacts match this operating lens'
                : activeOrgId
                  ? 'Build the first admin contact record'
                  : 'Select a client workspace first'}
          </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-on-surface-variant">
              {hasActiveFilters
                ? 'This filter combination is hiding the contact workspace. Clear filters to return to the full audience before ownership, follow-up, and stage gaps disappear from admin review.'
                : activeOrgId
                  ? 'Create the first contact so admin can assign ownership, track follow-up, and give every employee a shared relationship profile before pipeline work starts.'
                  : 'Choose a client workspace before creating or viewing contacts.'}
            </p>
          </div>

          {activeOrgId && !hasActiveFilters && (
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {[
                ['supervisor_account', 'Assign ownership', 'Give every relationship a responsible employee from day one.'],
                ['schedule', 'Track follow-up', 'Start with clean next-touch expectations instead of invisible handoffs.'],
                ['account_tree', 'Feed pipeline', 'Connect people to companies, deals, and revenue work as the CRM grows.'],
              ].map(([icon, title, copy]) => (
                <div key={title} className="rounded-lg border border-[var(--color-card-border)] bg-white/[0.02] p-4 text-left">
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant">{icon}</span>
                  <p className="mt-3 text-sm font-label font-semibold text-on-surface">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-on-surface-variant">{copy}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {hasActiveFilters ? (
              <button onClick={() => { setSearch(''); setStageFilter(''); setTypeFilter(''); setOwnerFilter('all') }} className="pib-btn-secondary text-sm">
                <span className="material-symbols-outlined text-base">filter_alt_off</span>
                Clear filters
              </button>
            ) : (
              <button
                onClick={() => activeOrgId && setShowNew(true)}
                disabled={!activeOrgId}
                aria-label={activeOrgId ? 'Create first admin contact' : 'Select workspace before creating contacts'}
                className="pib-btn-primary text-sm font-label disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-base">add</span>
                {activeOrgId ? 'Create first contact' : 'Add contact'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="pib-card-section overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-card-border)] bg-white/[0.02] text-left">
                {['Select', 'Name', 'Email', 'Company', 'Owner', 'Type', 'Stage', 'Last touch', 'Signals'].map((h) => (
                  <th key={h} className="px-3 py-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleContacts.map((c) => {
                const lastTouchAge = daysSince(c.lastContactedAt)
                const owner = String(c.assignedTo ?? '').trim()
                return (
                  <tr key={c.id} className="border-b border-[var(--color-card-border)] transition-colors hover:bg-surface-container">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleSelected(c.id)}
                        className="h-4 w-4 rounded accent-[var(--color-accent-v2)]"
                        aria-label={`Select ${c.name || c.email || 'contact'} for bulk owner assignment`}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/admin/crm/contacts/${c.id}`} className="font-medium hover:underline" style={{ color: 'var(--color-accent-v2)' }}>
                        {c.name || c.email || 'Unnamed contact'}
                      </Link>
                      {c.tags?.length > 0 && (
                        <p className="mt-1 max-w-[220px] truncate text-[11px] text-on-surface-variant">{c.tags.join(', ')}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-on-surface-variant">{c.email || '—'}</td>
                    <td className="px-3 py-3 text-on-surface-variant">{c.companyName || c.company || '—'}</td>
                    <td className="px-3 py-3">
                      {owner ? (
                        <span className="pill !px-2 !py-0.5 !text-[10px]">Owner set</span>
                      ) : (
                        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-amber-200">
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3"><TypeBadge type={c.type || 'lead'} /></td>
                    <td className="px-3 py-3"><StageBadge stage={c.stage || 'new'} /></td>
                    <td className="px-3 py-3 text-xs text-on-surface-variant">
                      {lastTouchAge === null ? 'Never' : lastTouchAge === 0 ? 'Today' : `${lastTouchAge}d ago`}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {typeof c.leadScore === 'number' && <span className="pill !px-2 !py-0.5 !text-[10px]">Lead {c.leadScore}</span>}
                        {typeof c.icpScore === 'number' && <span className="pill !px-2 !py-0.5 !text-[10px]">ICP {c.icpScore}</span>}
                        {typeof c.aiLeadScore === 'number' && <span className="pill !px-2 !py-0.5 !text-[10px]">AI {c.aiLeadScore}</span>}
                        {typeof c.leadScore !== 'number' && typeof c.icpScore !== 'number' && typeof c.aiLeadScore !== 'number' && (
                          <span className="text-xs text-on-surface-variant">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Contact Slide-In */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={() => setShowNew(false)} />
          <div className="w-96 bg-surface-container border-l border-outline-variant overflow-y-auto">
            <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between">
              <h2 className="font-headline text-base font-bold tracking-tight">New Contact</h2>
              <button onClick={() => setShowNew(false)} className="text-on-surface-variant hover:text-on-surface text-lg leading-none">✕</button>
            </div>
            <ContactForm onSave={createContact} onCancel={() => setShowNew(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
