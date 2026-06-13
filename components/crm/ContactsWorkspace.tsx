'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { ContactForm } from '@/components/crm/ContactForm'
import { fmtTimestamp } from '@/lib/format/timestamp'
import { SavedViewsBar } from '@/components/crm/SavedViewsBar'
import { ScoreChip } from '@/components/crm/ScoreChip'
import {
  type BulkActionKey,
  ContactsBulkCommandBar,
} from '@/components/crm/ContactsBulkCommandBar'
import {
  applyContactMergeToDuplicateGroups,
  ContactDuplicateCommandCenter,
  type DuplicateGroup,
} from '@/components/crm/ContactDuplicateCommandCenter'
import { useOrg } from '@/lib/contexts/OrgContext'
import { useCrmLiveRefresh } from '@/lib/crm/use-crm-live-refresh'
import { scopedApiPath, scopedPortalPath, type PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

type SearchParamReader = {
  get(name: string): string | null
}

interface ContactsWorkspaceProps {
  mode: 'admin' | 'portal'
  orgScope?: PortalOrgRouteScope
  searchParams?: SearchParamReader
}

const STAGES = ['new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost']
const TYPES = ['lead', 'prospect', 'client', 'churned']

interface Contact {
  id: string
  orgId?: string
  name: string
  email: string
  phone?: string
  company?: string
  type: string
  stage: string
  lastContactedAt?: unknown
  tags?: string[]
  leadScore?: number
  icpScore?: number
  aiLeadScore?: number
  assignedTo?: string
  assignedToRef?: {
    uid?: string
    displayName?: string
  }
}

interface TeamMember {
  uid: string
  firstName: string
  lastName: string
  jobTitle: string
  avatarUrl: string
  role: string
}

// --- inline lightweight toast ---
type ToastItem = { id: string; message: string; tone: 'success' | 'error' | 'info' }

function useInlineToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const push = useCallback((message: string, tone: ToastItem['tone'] = 'success') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev.slice(-3), { id, message, tone }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 5000)
  }, [])
  const node = (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-[var(--radius-card)] shadow-lg min-w-72 max-w-sm"
          style={{
            background: 'var(--color-sidebar)',
            border: `1px solid ${t.tone === 'success' ? '#4ade80' : t.tone === 'error' ? '#ef4444' : '#60a5fa'}`,
          }}
        >
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{
              background: t.tone === 'success' ? 'rgba(74,222,128,0.15)' : t.tone === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(96,165,250,0.15)',
              color: t.tone === 'success' ? '#4ade80' : t.tone === 'error' ? '#ef4444' : '#60a5fa',
            }}
          >
            {t.tone === 'success' ? '✓' : t.tone === 'error' ? '✕' : 'i'}
          </span>
          <span className="text-sm text-[var(--color-pib-text)]">{t.message}</span>
        </div>
      ))}
    </div>
  )
  return { push, node }
}

function StageBadge({ stage }: { stage: string }) {
  const win = ['won', 'demo', 'replied']
  const lost = ['lost']
  const color = lost.includes(stage)
    ? 'var(--color-pib-danger, #FCA5A5)'
    : win.includes(stage)
    ? 'var(--color-pib-success)'
    : 'var(--color-pib-accent)'
  return (
    <span
      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full capitalize font-mono"
      style={{ background: `${color}20`, color }}
    >
      {readableContactLabel(stage)}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const color =
    type === 'client'
      ? 'var(--color-pib-success)'
      : type === 'churned'
      ? 'var(--color-pib-danger, #FCA5A5)'
      : 'var(--color-pib-accent)'
  return (
    <span
      className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full capitalize font-mono"
      style={{ background: `${color}20`, color }}
    >
      {readableContactLabel(type)}
    </span>
  )
}

function readableContactLabel(value?: string): string {
  if (!value) return ''
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

function contactOwnerLabel(contact: Contact): string {
  if (contact.assignedToRef?.displayName) return contact.assignedToRef.displayName
  if (hasContactOwner(contact)) return 'Owner identity missing'
  return 'Unassigned'
}

function hasContactOwner(contact: Contact): boolean {
  return Boolean(String(contact.assignedTo ?? contact.assignedToRef?.uid ?? '').trim())
}

function searchParamInList(value: string | null, allowedValues: readonly string[]): string {
  return value && allowedValues.includes(value) ? value : ''
}

function timestampMs(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') return Date.parse(value) || 0
  if (typeof value === 'object') {
    const timestamp = value as { seconds?: number; _seconds?: number; toDate?: () => Date; toMillis?: () => number }
    if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
    if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime()
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return 0
}

function needsFollowUp(contact: Contact): boolean {
  const lastContactedMs = timestampMs(contact.lastContactedAt)
  if (!lastContactedMs) return true
  const staleAfterMs = 14 * 24 * 60 * 60 * 1000
  return Date.now() - lastContactedMs > staleAfterMs
}

function isContactSetupArtifact(contact: Pick<Contact, 'name' | 'email'>): boolean {
  const haystack = [contact.name, contact.email]
    .map((value) => value?.trim().toLowerCase() ?? '')
    .filter(Boolean)
    .join(' ')

  return /\b(smoke|test|fixture|delete)\b/.test(haystack)
}

export function ContactsWorkspace({
  mode,
  orgScope = {},
  searchParams,
}: ContactsWorkspaceProps) {
  const { selectedOrgId, orgs } = useOrg()
  const isAdmin = mode === 'admin'
  const scopedOrgId = orgScope.orgId ?? orgScope.id
  const scopedOrgSlug = orgScope.orgSlug ?? orgScope.slug
  const scopedSourceCompanyId = orgScope.sourceCompanyId
  const scopedSourceCompanyName = orgScope.sourceCompanyName
  const routeScope = useMemo(
    () => ({
      orgId: scopedOrgId,
      orgSlug: scopedOrgSlug,
      sourceCompanyId: scopedSourceCompanyId,
      sourceCompanyName: scopedSourceCompanyName,
    }),
    [scopedOrgId, scopedOrgSlug, scopedSourceCompanyId, scopedSourceCompanyName],
  )
  const [contactOrgId, setContactOrgId] = useState('')
  const activeAdminOrgId = selectedOrgId || scopedOrgId || contactOrgId
  const apiScope = useMemo(
    () => (isAdmin ? { orgId: activeAdminOrgId } : routeScope),
    [activeAdminOrgId, isAdmin, routeScope],
  )
  const canLoadContacts = !isAdmin || Boolean(activeAdminOrgId)
  const shouldOpenCreateContact = searchParams?.get('create') === 'contact'
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [contactsError, setContactsError] = useState('')
  const [search, setSearch] = useState(() => searchParams?.get('search') ?? '')
  const [stageFilter, setStageFilter] = useState(() => searchParamInList(searchParams?.get('stage') ?? null, STAGES))
  const [typeFilter, setTypeFilter] = useState(() => searchParamInList(searchParams?.get('type') ?? null, TYPES))
  const [ownerLens, setOwnerLens] = useState<'all' | 'unowned'>(() => searchParams?.get('owner') === 'unowned' ? 'unowned' : 'all')
  const [followUpLens, setFollowUpLens] = useState<'all' | 'stale'>(() => searchParams?.get('followUp') === 'stale' ? 'stale' : 'all')
  const [showNew, setShowNew] = useState(() => shouldOpenCreateContact)

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<BulkActionKey>('assign')
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)

  // Bulk action inputs
  const [bulkAssignUid, setBulkAssignUid] = useState('')
  const [bulkStage, setBulkStage] = useState(STAGES[0])
  const [bulkType, setBulkType] = useState(TYPES[0])
  const [bulkTagsInput, setBulkTagsInput] = useState('')

  // Team members for assign dropdown
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])

  // Duplicates state
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false)
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([])
  const [duplicatesLoading, setDuplicatesLoading] = useState(false)
  const [duplicatesError, setDuplicatesError] = useState<string | null>(null)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [mergingGroup, setMergingGroup] = useState<string | null>(null)

  const { push: pushToast, node: toastNode } = useInlineToast()

  const contactHref = useCallback((id: string, suffix = '') => {
    const encodedId = encodeURIComponent(id)
    if (isAdmin) return `/portal/crm/contacts/${encodedId}${suffix}`
    return scopedPortalPath(`/portal/contacts/${encodedId}${suffix}`, routeScope)
  }, [isAdmin, routeScope])

  const fetchContacts = useCallback(async () => {
    if (!canLoadContacts) {
      setContacts([])
      setContactsError('')
      setLoading(false)
      return
    }
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (stageFilter) params.set('stage', stageFilter)
    if (typeFilter) params.set('type', typeFilter)
    const qs = params.toString()
    try {
      const res = await fetch(scopedApiPath(`/api/v1/crm/contacts${qs ? `?${qs}` : ''}`, apiScope))
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Contacts could not be loaded')
      }
      const body = await res.json()
      const nextContacts = body.data ?? []
      setContacts(nextContacts)
      setContactOrgId(body.meta?.orgId ?? nextContacts.find((contact: Contact) => contact.orgId)?.orgId ?? scopedOrgId ?? '')
      setContactsError('')
    } catch (err) {
      setContacts([])
      setContactsError(err instanceof Error ? err.message : 'Contacts could not be loaded')
    } finally {
      setLoading(false)
    }
  }, [apiScope, canLoadContacts, scopedOrgId, search, stageFilter, typeFilter])

  useEffect(() => {
    fetchContacts()
  }, [fetchContacts])

  useCrmLiveRefresh({
    orgId: scopedOrgId || contactOrgId,
    entity: 'contacts',
    enabled: canLoadContacts,
    onRefresh: fetchContacts,
  })

  // Load team members once
  useEffect(() => {
    if (!canLoadContacts) {
      setTeamMembers([])
      return
    }
    fetch(scopedApiPath('/api/v1/portal/settings/team', apiScope))
      .then(r => r.ok ? r.json() : null)
      .then(body => {
        if (body?.members) setTeamMembers(body.members)
      })
      .catch(() => {})
  }, [apiScope, canLoadContacts])

  async function createContact(data: Record<string, unknown>) {
    if (!canLoadContacts) throw new Error('Select a client workspace before creating a contact')
    const res = await fetch(scopedApiPath('/api/v1/crm/contacts', apiScope), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? 'Failed to create contact')
    }
    setShowNew(false)
    fetchContacts()
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(prev => {
      const visibleIds = displayedContacts.map(c => c.id)
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => prev.has(id))
      if (allVisibleSelected) {
        const next = new Set(prev)
        for (const id of visibleIds) next.delete(id)
        return next
      }
      return new Set([...prev, ...visibleIds])
    })
  }

  function filterByCompany(company: string) {
    setSearch(company)
    setStageFilter('')
    setTypeFilter('')
    setOwnerLens('all')
    setFollowUpLens('all')
  }

  function selectUnownedContactsForAssignment() {
    const ids = unownedContacts.map((contact) => contact.id)
    if (!ids.length) return
    setSelectedIds(new Set(ids))
    setBulkAction('assign')
    setOwnerLens('unowned')
    setFollowUpLens('all')
  }

  function selectSetupArtifactContactsForCleanup() {
    const ids = setupArtifactContacts.map((contact) => contact.id)
    if (!ids.length) return
    setSelectedIds(new Set(ids))
    setBulkAction('add-tags')
    setBulkDeleteConfirmOpen(true)
    pushToast(
      `${ids.length} setup contact${ids.length === 1 ? '' : 's'} selected for cleanup — confirm delete below.`,
      'info',
    )
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkDeleteConfirmOpen(true)
  }

  async function confirmBulkDelete() {
    if (selectedIds.size === 0) return
    const count = selectedIds.size

    setBulkPending(true)
    try {
      const res = await fetch(scopedApiPath('/api/v1/crm/contacts/bulk', apiScope), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), patch: { delete: true } }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        pushToast((err as { error?: string }).error ?? 'Delete failed', 'error')
        return
      }
      setContacts(prev => prev.filter(c => !selectedIds.has(c.id)))
      setSelectedIds(new Set())
      setBulkDeleteConfirmOpen(false)
      pushToast(`${count} contact${count === 1 ? '' : 's'} deleted`, 'success')
    } catch {
      pushToast('Network error — delete failed', 'error')
    } finally {
      setBulkPending(false)
    }
  }

  async function applyBulk() {
    if (selectedIds.size === 0) return

    const parseTags = (raw: string) =>
      raw.split(',').map(t => t.trim()).filter(Boolean)

    let patch: Record<string, unknown> = {}
    if (bulkAction === 'assign') {
      if (!bulkAssignUid.trim()) {
        pushToast('Select a team member to assign', 'error')
        return
      }
      patch = { assignedTo: bulkAssignUid.trim() }
    } else if (bulkAction === 'stage') {
      patch = { stage: bulkStage }
    } else if (bulkAction === 'type') {
      patch = { type: bulkType }
    } else if (bulkAction === 'add-tags') {
      const tags = parseTags(bulkTagsInput)
      if (!tags.length) { pushToast('Enter at least one tag', 'error'); return }
      patch = { tags: { add: tags } }
    } else if (bulkAction === 'remove-tags') {
      const tags = parseTags(bulkTagsInput)
      if (!tags.length) { pushToast('Enter at least one tag', 'error'); return }
      patch = { tags: { remove: tags } }
    }

    setBulkPending(true)
    try {
      const res = await fetch(scopedApiPath('/api/v1/crm/contacts/bulk', apiScope), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), patch }),
      })
      const body = await res.json()
      if (res.ok) {
        const { updated = 0, skipped = 0, failed = [] } = body.data ?? {}
        const failedCount = Array.isArray(failed) ? failed.length : 0
        pushToast(
          `Updated ${updated}, skipped ${skipped}${failedCount ? `, failed ${failedCount}` : ''}`,
          failedCount ? 'info' : 'success',
        )
        setSelectedIds(new Set())
        setBulkTagsInput('')
        await fetchContacts()
      } else {
        pushToast(body.error ?? 'Bulk update failed', 'error')
      }
    } catch {
      pushToast('Network error — bulk update failed', 'error')
    } finally {
      setBulkPending(false)
    }
  }

  async function handleFindDuplicates() {
    setDuplicatesLoading(true)
    setDuplicatesError(null)
    setMergeError(null)
    try {
      const res = await fetch(scopedApiPath('/api/v1/crm/contacts/duplicates', apiScope))
      const body = (await res.json()) as { error?: string; data?: DuplicateGroup[] | { groups?: DuplicateGroup[] } }
      if (!res.ok) throw new Error(body.error ?? 'Failed to fetch duplicates')
      const raw = body.data
      const groups: DuplicateGroup[] = Array.isArray(raw)
        ? raw
        : (raw as { groups?: DuplicateGroup[] } | undefined)?.groups ?? []
      setDuplicateGroups(groups)
      setShowDuplicatesModal(true)
    } catch (err) {
      setDuplicatesError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setDuplicatesLoading(false)
    }
  }

  async function handleMerge(groupIndex: number, winnerId: string, loserId: string) {
    setMergingGroup(String(groupIndex))
    setMergeError(null)
    try {
      const res = await fetch(scopedApiPath('/api/v1/crm/contacts/merge', apiScope), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerId, loserId }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Merge failed')
      setDuplicateGroups(prev => applyContactMergeToDuplicateGroups(prev, groupIndex, loserId))
      setContacts(prev => prev.filter(c => c.id !== loserId))
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setMergingGroup(null)
    }
  }

  const unownedContacts = contacts.filter((contact) => !hasContactOwner(contact))
  const followUpDueContacts = contacts.filter(needsFollowUp)
  const clientContacts = contacts.filter((contact) => contact.type === 'client')
  const ownerCoverage = contacts.length > 0 ? (contacts.length - unownedContacts.length) / contacts.length : 1
  const ownerFilteredContacts = ownerLens === 'unowned' ? unownedContacts : contacts
  const displayedContacts = followUpLens === 'stale'
    ? ownerFilteredContacts.filter(needsFollowUp)
    : ownerFilteredContacts
  const setupArtifactContacts = displayedContacts.filter(isContactSetupArtifact)
  const allSelected = displayedContacts.length > 0 && displayedContacts.every((contact) => selectedIds.has(contact.id))
  const someSelected = selectedIds.size > 0 && !allSelected
  const hasActiveFilters = !!(search.trim() || stageFilter || typeFilter || followUpLens === 'stale')
  const isStageLens = !!stageFilter && !search.trim() && !typeFilter && ownerLens === 'all' && followUpLens === 'all'
  const contactCountLabel = loading
    ? canLoadContacts ? 'Loading…' : 'Select a client workspace to work contacts without cross-client bleed.'
    : followUpLens === 'stale'
      ? displayedContacts.length === 0
        ? 'No contacts need follow-up.'
        : `${displayedContacts.length} contact${displayedContacts.length === 1 ? '' : 's'} need follow-up.`
    : ownerLens === 'unowned'
      ? displayedContacts.length === 0
        ? 'No unowned contacts.'
        : `${displayedContacts.length} unowned contact${displayedContacts.length === 1 ? '' : 's'} need assignment.`
    : isStageLens && displayedContacts.length === 0
      ? `No contacts in ${readableContactLabel(stageFilter)}.`
    : hasActiveFilters
      ? `${displayedContacts.length} contact${displayedContacts.length === 1 ? '' : 's'} match this view.`
      : `${displayedContacts.length} contact${displayedContacts.length === 1 ? '' : 's'} in your audience.`
  const emptyTitle = followUpLens === 'stale'
    ? 'No contacts need follow-up.'
    : !canLoadContacts
      ? 'Select a client workspace first'
    : ownerLens === 'unowned'
      ? 'No unowned contacts.'
    : isStageLens
      ? `No contacts in ${readableContactLabel(stageFilter)}.`
    : hasActiveFilters
      ? 'No contacts match this view.'
      : 'No contacts yet.'
  const emptyDescription = followUpLens === 'stale'
    ? 'Every contact in this view has recent activity.'
    : !canLoadContacts
      ? 'Choose a client workspace before creating or viewing contacts.'
    : isStageLens
      ? 'This funnel stage is clear for the current contact lens.'
    : hasActiveFilters
      ? 'Clear the search or filters to return to your full audience.'
      : ownerLens === 'unowned'
        ? 'Every contact in this view has an owner.'
        : 'Add your first contact to start building your audience.'

  return (
    <div className="space-y-8">
      {toastNode}

      <header>
        <p className="eyebrow">CRM</p>
        <div className="flex items-end justify-between gap-4 flex-wrap mt-2">
          <div>
            <h1 className="pib-page-title">Contacts</h1>
            <p className="pib-page-sub max-w-2xl">
              {contactCountLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleFindDuplicates}
              disabled={duplicatesLoading || !canLoadContacts}
              className="btn-pib-secondary text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">merge</span>
              {duplicatesLoading ? 'Scanning…' : 'Find duplicates'}
            </button>
            <button
              onClick={() => canLoadContacts && setShowNew(true)}
              disabled={!canLoadContacts}
              aria-label="New contact"
              className="btn-pib-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">add</span>
              New contact
            </button>
          </div>
        </div>
      </header>

      {isAdmin && !selectedOrgId && (
        <section className="pib-card space-y-2">
          <label htmlFor="contactOrgId" className="pib-label">Client workspace</label>
          <select
            id="contactOrgId"
            value={contactOrgId}
            onChange={(event) => setContactOrgId(event.target.value)}
            className="pib-select max-w-md"
          >
            <option value="">Select workspace before adding or viewing contacts...</option>
            {orgs
              .filter((org) => org.type === 'client')
              .map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
          </select>
          <p className="text-xs text-on-surface-variant">
            Contacts are always scoped to one client organisation so leads, automations, and handoffs do not bleed across workspaces.
          </p>
        </section>
      )}

      <section
        role="region"
        aria-label="Today's contact cockpit"
        className="space-y-4"
      >
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 xl:max-w-sm">
            <p className="eyebrow !text-[10px]">Executive lens</p>
            <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">Today&apos;s contact cockpit</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              Follow-up pressure, owner gaps, customer volume, and the current working lens in one board-ready view.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setOwnerLens('all')
                setFollowUpLens('stale')
              }}
              className={[
                'btn-pib-secondary text-xs',
                followUpLens === 'stale' ? 'border-amber-400/50 bg-amber-400/10 text-amber-100' : '',
              ].join(' ')}
              aria-label="Show contacts needing follow-up"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit_note</span>
              Follow-ups
            </button>
            <button
              type="button"
              onClick={() => {
                setOwnerLens('unowned')
                setFollowUpLens('all')
              }}
              className={[
                'btn-pib-secondary text-xs',
                ownerLens === 'unowned' ? 'border-amber-400/50 bg-amber-400/10 text-amber-100' : '',
              ].join(' ')}
              aria-label="Show owner gaps"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">manage_accounts</span>
              Owner gaps
            </button>
            <button
              type="button"
              onClick={() => {
                setOwnerLens('all')
                setFollowUpLens('all')
              }}
              className="btn-pib-secondary text-xs"
              aria-label="Show full contact audience"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">groups</span>
              Full audience
            </button>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="eyebrow !text-[10px]">Follow-up</p>
              <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-accent)]" aria-hidden="true">edit_note</span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-[var(--color-pib-text)]">
              {followUpDueContacts.length} {followUpDueContacts.length === 1 ? 'follow-up due' : 'follow-ups due'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="eyebrow !text-[10px]">Owner gaps</p>
              <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-accent)]" aria-hidden="true">supervisor_account</span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-[var(--color-pib-text)]">
              {unownedContacts.length} {unownedContacts.length === 1 ? 'owner gap' : 'owner gaps'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="eyebrow !text-[10px]">Customers</p>
              <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-accent)]" aria-hidden="true">handshake</span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-[var(--color-pib-text)]">
              {clientContacts.length} {clientContacts.length === 1 ? 'client' : 'clients'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="eyebrow !text-[10px]">Visible</p>
              <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-accent)]" aria-hidden="true">filter_alt</span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-[var(--color-pib-text)]">
              {displayedContacts.length} visible
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="pib-stat-card">
          <div className="flex items-start justify-between gap-3">
            <p className="eyebrow !text-[10px]">Owner coverage</p>
            <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)]">supervisor_account</span>
          </div>
          <p className="mt-3 font-display tracking-tight leading-none text-3xl text-[var(--color-pib-text)]">
            {Math.round(ownerCoverage * 100)}%
          </p>
          <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">
            {unownedContacts.length} unowned
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOwnerLens(ownerLens === 'unowned' ? 'all' : 'unowned')}
          className={[
            'rounded-[var(--radius-card)] border p-4 text-left transition-colors',
            ownerLens === 'unowned'
              ? 'border-amber-400/40 bg-amber-400/10'
              : 'border-[var(--color-pib-line)] bg-white/[0.03] hover:bg-white/[0.05]',
          ].join(' ')}
          aria-label={ownerLens === 'unowned' ? 'Show all contacts' : 'Show unowned contacts needing an owner'}
        >
          <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">manage_accounts</span>
          <p className="mt-3 text-sm font-semibold text-[var(--color-pib-text)]">
            {ownerLens === 'unowned' ? 'Showing owner gaps' : 'Review owner gaps'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
            {unownedContacts.length > 0
              ? `${unownedContacts.length} contacts need an accountable team member before follow-up slips.`
              : 'Every contact in this view has an owner.'}
          </p>
        </button>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
          <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">groups</span>
          <p className="mt-3 text-sm font-semibold text-[var(--color-pib-text)]">Team workload</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
            Select unowned contacts, assign a team member, and keep the customer base accountable from this workspace.
          </p>
          <button
            type="button"
            onClick={selectUnownedContactsForAssignment}
            disabled={unownedContacts.length === 0}
            className="btn-pib-secondary mt-4 w-full justify-center text-xs disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={
              unownedContacts.length === 1
                ? 'Select 1 unowned contact for owner assignment'
                : `Select ${unownedContacts.length} unowned contacts for owner assignment`
            }
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">playlist_add_check</span>
            {unownedContacts.length > 0
              ? `Select ${unownedContacts.length} owner gap${unownedContacts.length === 1 ? '' : 's'}`
              : 'No owner gaps'}
          </button>
        </div>
      </section>

      {setupArtifactContacts.length > 0 && (
        <section
          role="region"
          aria-label="Contact setup review for visible contacts"
          className="rounded-[var(--radius-card)] border border-amber-400/30 bg-amber-400/10 p-5"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <span
                className="material-symbols-outlined mt-0.5 rounded-lg border border-amber-400/25 bg-amber-400/10 p-2 text-[20px] text-amber-200"
                aria-hidden="true"
              >
                rule_settings
              </span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Audience hygiene</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">Contact setup needs review</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  {setupArtifactContacts.length} visible contact{setupArtifactContacts.length === 1 ? ' looks' : 's look'} like smoke-test setup data.
                </p>
                <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  Review these records before the team treats setup residue as real customer relationships.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {setupArtifactContacts.slice(0, 3).map((contact) => (
                    <span
                      key={contact.id}
                      className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-100"
                    >
                      {contact.name || contact.email || 'Unnamed setup contact'}
                    </span>
                  ))}
                  {setupArtifactContacts.length > 3 && (
                    <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-100">
                      +{setupArtifactContacts.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={selectSetupArtifactContactsForCleanup}
              className="btn-pib-secondary shrink-0 justify-center text-xs"
              aria-label={
                setupArtifactContacts.length === 1
                  ? 'Select 1 setup contact for cleanup'
                  : `Select ${setupArtifactContacts.length} setup contacts for cleanup`
              }
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">playlist_add_check</span>
              Select setup contact{setupArtifactContacts.length === 1 ? '' : 's'}
            </button>
          </div>
        </section>
      )}

      {duplicatesError && (
        <section
          role="status"
          aria-label="Duplicate scan could not run"
          className="bento-card border-amber-400/25 bg-amber-400/10"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className="material-symbols-outlined mt-0.5 rounded-lg border border-amber-400/25 bg-amber-400/10 p-2 text-[20px] text-amber-200"
                aria-hidden="true"
              >
                warning
              </span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Duplicate hygiene</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">Duplicate scan could not run</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{duplicatesError}</p>
                <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  Contacts stay visible, but merge decisions are paused until the duplicate source responds.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleFindDuplicates}
              disabled={duplicatesLoading}
              className="btn-pib-secondary shrink-0 text-xs disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">refresh</span>
              Retry scan
            </button>
          </div>
        </section>
      )}

      {/* Filters */}
      <section className="space-y-2">
        <SavedViewsBar
          orgScope={apiScope}
          currentFilters={{
            search,
            stage: stageFilter,
            type: typeFilter,
            owner: ownerLens === 'unowned' ? 'unowned' : '',
            followUp: followUpLens === 'stale' ? 'stale' : '',
          }}
          onSelectView={(f) => {
            if (typeof f.search === 'string') setSearch(f.search)
            if (typeof f.stage === 'string') setStageFilter(f.stage)
            if (typeof f.type === 'string') setTypeFilter(f.type)
            setOwnerLens(f.owner === 'unowned' ? 'unowned' : 'all')
            setFollowUpLens(f.followUp === 'stale' ? 'stale' : 'all')
          }}
        />
      </section>
      <section className="flex flex-wrap gap-3">
        <input
          placeholder="Search name, email, company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pib-input flex-1 min-w-[240px]"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="pib-input !w-auto"
          aria-label="Filter contacts by stage"
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s} className="bg-black">
              {readableContactLabel(s)}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="pib-input !w-auto"
          aria-label="Filter contacts by type"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t} className="bg-black">
              {readableContactLabel(t)}
            </option>
          ))}
        </select>
      </section>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <ContactsBulkCommandBar
          selectedCount={selectedIds.size}
          totalCount={displayedContacts.length}
          bulkAction={bulkAction}
          bulkPending={bulkPending}
          teamMembers={teamMembers}
          bulkAssignUid={bulkAssignUid}
          bulkStage={bulkStage}
          bulkType={bulkType}
          bulkTagsInput={bulkTagsInput}
          stages={STAGES}
          types={TYPES}
          onActionChange={(action) => {
            setBulkAction(action)
            setBulkTagsInput('')
          }}
          onAssignUidChange={setBulkAssignUid}
          onStageChange={setBulkStage}
          onTypeChange={setBulkType}
          onTagsInputChange={setBulkTagsInput}
          onClear={() => setSelectedIds(new Set())}
          onApply={applyBulk}
          onDelete={handleBulkDelete}
        />
      )}

      {bulkDeleteConfirmOpen && selectedIds.size > 0 && (
        <section
          role="alertdialog"
          aria-labelledby="bulk-delete-confirm-title"
          aria-describedby="bulk-delete-confirm-description"
          className="rounded-[var(--radius-card)] border border-red-500/30 bg-red-500/10 p-4 shadow-xl"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-red-300" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] text-red-200">Bulk delete confirmation</p>
                <h2 id="bulk-delete-confirm-title" className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
                  Delete {selectedIds.size} selected contact{selectedIds.size === 1 ? '?' : 's?'}
                </h2>
                <p id="bulk-delete-confirm-description" className="mt-2 text-sm text-red-100/90">
                  This cannot be undone. The selected contacts will be removed from this audience.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={`Cancel delete ${selectedIds.size} selected contact${selectedIds.size === 1 ? '' : 's'}`}
                onClick={() => setBulkDeleteConfirmOpen(false)}
                className="btn-pib-secondary text-xs"
                disabled={bulkPending}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmBulkDelete}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-card)] border border-red-400/40 bg-red-500/15 px-3 py-2 text-xs font-medium text-red-100 transition-colors hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={bulkPending}
                aria-label={`Confirm delete ${selectedIds.size} selected contact${selectedIds.size === 1 ? '' : 's'}`}
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">delete</span>
                {bulkPending ? 'Deleting...' : 'Delete selected'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* List */}
      {contactsError ? (
        <section className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">warning</span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">Contacts could not load</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{contactsError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchContacts}
              className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
              aria-label="Retry loading contacts"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>
              Retry
            </button>
          </div>
        </section>
      ) : loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="pib-skeleton h-12" />
          ))}
        </div>
      ) : displayedContacts.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">contacts</span>
          <h2 className="font-display text-2xl mt-4">{emptyTitle}</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">
            {emptyDescription}
          </p>
          {hasActiveFilters || ownerLens === 'unowned' ? (
            <button
              onClick={() => { setSearch(''); setStageFilter(''); setTypeFilter(''); setOwnerLens('all'); setFollowUpLens('all') }}
              className="btn-pib-secondary mt-6"
              aria-label={ownerLens === 'unowned' || followUpLens === 'stale' ? 'Show all contacts' : 'Clear filters'}
            >
              <span className="material-symbols-outlined text-base">filter_alt_off</span>
              {ownerLens === 'unowned' || followUpLens === 'stale' ? 'Show all contacts' : 'Clear filters'}
            </button>
          ) : (
            <button
              onClick={() => canLoadContacts && setShowNew(true)}
              disabled={!canLoadContacts}
              aria-label="Add contact"
              className="btn-pib-accent mt-6 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">add</span>
              Add contact
            </button>
          )}
        </div>
      ) : (
        <div className="pib-card-section">
          {/* Table header */}
          <div className="hidden md:grid grid-cols-15 gap-4 px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02]">
            {/* Checkbox cell — 1 col */}
            <div className="col-span-1 flex items-center">
              <input
                type="checkbox"
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = someSelected }}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded cursor-pointer accent-[var(--color-pib-accent)]"
                aria-label="Select all contacts"
              />
            </div>
            <p className="col-span-2 eyebrow !text-[10px]">Name</p>
            <p className="col-span-3 eyebrow !text-[10px]">Email</p>
            <p className="col-span-2 eyebrow !text-[10px]">Company</p>
            <p className="col-span-1 eyebrow !text-[10px]">Type</p>
            <p className="col-span-1 eyebrow !text-[10px]">Stage</p>
            <p className="col-span-2 eyebrow !text-[10px]">Last contacted</p>
            <p className="col-span-1 eyebrow !text-[10px]">Lead</p>
            <p className="col-span-1 eyebrow !text-[10px]">ICP</p>
            <p className="col-span-1 eyebrow !text-[10px]">AI</p>
          </div>
          <div className="divide-y divide-[var(--color-pib-line)]">
              {displayedContacts.map((c) => {
              const isSelected = selectedIds.has(c.id)
              const contactName = c.name || 'Unnamed contact'
              const lastContactedLabel = fmtTimestamp(c.lastContactedAt) || 'No touch logged'
              return (
                <div
                  key={c.id}
                  data-contact-row
                  className="relative grid grid-cols-1 md:grid-cols-15 gap-3 md:gap-4 items-start md:items-center px-4 py-4 md:px-5 hover:bg-[var(--color-pib-surface-2)] transition-colors"
                  style={isSelected ? { background: 'var(--color-pib-accent, #7c3aed)10' } : undefined}
                >
                  {/* Checkbox */}
                  <div
                    data-contact-select
                    className="absolute right-4 top-4 z-10 flex items-center md:static md:col-span-1 md:z-auto"
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(c.id)}
                      className="h-5 w-5 rounded cursor-pointer accent-[var(--color-pib-accent)] md:h-4 md:w-4"
                      aria-label={`Select ${contactName}`}
                    />
                  </div>
                  <div
                    data-contact-card-content
                    className="col-span-1 md:col-span-14 grid grid-cols-1 md:grid-cols-14 gap-3 md:gap-4 items-start md:items-center pr-10 md:pr-0"
                  >
                    <div className="md:col-span-2">
                      <Link
                        href={contactHref(c.id)}
                        aria-label={`Open contact ${contactName}`}
                        className="font-medium text-[var(--color-pib-accent-hover)] transition-colors hover:text-[var(--color-pib-text)]"
                      >
                        {contactName}
                      </Link>
                      {c.tags && c.tags.length > 0 && (
                        <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-0.5 truncate">
                          {c.tags.join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-3 text-sm text-[var(--color-pib-text-muted)]">
                      {c.email ? (
                        <a
                          href={`mailto:${c.email}`}
                          aria-label={`Email ${c.email} from contacts list`}
                          className="inline-flex max-w-full items-center gap-1 truncate text-[var(--color-pib-accent)] transition-colors hover:text-[var(--color-pib-text)]"
                        >
                          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">alternate_email</span>
                          <span className="truncate">{c.email}</span>
                        </a>
                      ) : (
                        'Email missing'
                      )}
                      {c.phone?.trim() && (
                        <a
                          href={`tel:${c.phone.trim()}`}
                          aria-label={`Call ${c.phone.trim()} from contacts list`}
                          className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-[var(--color-pib-accent)] transition-colors hover:text-[var(--color-pib-text)]"
                        >
                          <span className="material-symbols-outlined text-[13px]" aria-hidden="true">call</span>
                          <span className="truncate">{c.phone.trim()}</span>
                        </a>
                      )}
                    </div>
                    <div className="md:col-span-2 text-sm text-[var(--color-pib-text-muted)] truncate">
                      {c.company ? (
                        <button
                          type="button"
                          aria-label={`Filter contacts by company ${c.company}`}
                          onClick={() => filterByCompany(c.company as string)}
                          className="inline-flex max-w-full items-center gap-1 truncate text-left text-[var(--color-pib-accent)] transition-colors hover:text-[var(--color-pib-text)]"
                        >
                          <span className="material-symbols-outlined text-[14px]" aria-hidden="true">business</span>
                          <span className="truncate">{c.company}</span>
                        </button>
                      ) : (
                        'Company missing'
                      )}
                      <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
                        Owner: <span>{contactOwnerLabel(c)}</span>
                      </p>
                    </div>
                    <div className="md:col-span-1">
                      <TypeBadge type={c.type} />
                    </div>
                    <div className="md:col-span-1">
                      <StageBadge stage={c.stage} />
                    </div>
                    <div className="md:col-span-2 text-xs font-mono">
                      <Link
                        href={contactHref(c.id, '?activity=note')}
                        aria-label={`Log activity for ${contactName} from last contacted column`}
                        className="inline-flex max-w-full items-center gap-1 text-[var(--color-pib-accent)] transition-colors hover:text-[var(--color-pib-text)]"
                      >
                        <span className="material-symbols-outlined text-[13px]" aria-hidden="true">edit_note</span>
                        <span className="truncate">{lastContactedLabel}</span>
                      </Link>
                    </div>
                    <div className="md:col-span-1">
                      <ScoreChip score={c.leadScore} kind="lead" label="Lead score (formula)" size="sm" />
                    </div>
                    <div className="md:col-span-1">
                      <ScoreChip score={c.icpScore} kind="icp" label="ICP match score" size="sm" />
                    </div>
                    <div className="md:col-span-1">
                      <ScoreChip score={c.aiLeadScore} kind="ai" label="AI lead score" size="sm" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Duplicates modal */}
      {showDuplicatesModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-16 z-50 overflow-y-auto">
          <div className="bento-card !p-6 w-full max-w-4xl mx-4 mb-8">
            {mergeError && (
              <section
                role="status"
                aria-label="Duplicate merge failed"
                className="mb-5 rounded-[var(--radius-card)] border border-amber-400/25 bg-amber-400/10 p-4"
              >
                <div className="flex gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">
                    warning
                  </span>
                  <div>
                    <p className="eyebrow !text-[10px] text-amber-200">Duplicate merge failed</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--color-pib-text)]">{mergeError}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                      No records were merged. Review the canonical contact and try again before the team works this list.
                    </p>
                  </div>
                </div>
              </section>
            )}
            <ContactDuplicateCommandCenter
              groups={duplicateGroups}
              mergingGroup={mergingGroup}
              onClose={() => {
                setShowDuplicatesModal(false)
                setMergeError(null)
              }}
              onMerge={handleMerge}
            />
          </div>
        </div>
      )}

      {/* New Contact Slide-In */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => setShowNew(false)} />
          <div className="w-full max-w-md bg-[var(--color-pib-surface)] border-l border-[var(--color-pib-line)] overflow-y-auto">
            <div className="px-6 py-4 border-b border-[var(--color-pib-line)] flex items-center justify-between">
              <h2 className="font-display text-lg">New contact</h2>
              <button
                onClick={() => setShowNew(false)}
                className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
                aria-label="Close New contact drawer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <ContactForm onSave={createContact} onCancel={() => setShowNew(false)} />
          </div>
        </div>
      )}
    </div>
  )
}
