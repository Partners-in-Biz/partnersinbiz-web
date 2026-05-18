'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ContactForm } from '@/components/admin/crm/ContactForm'
import { fmtTimestamp } from '@/components/admin/email/fmtTimestamp'
import { SavedViewsBar } from '@/components/crm/SavedViewsBar'
import { ScoreChip } from '@/components/crm/ScoreChip'

interface DuplicateContact {
  id: string
  name?: string
  email?: string
  company?: string
  stage?: string
}

interface DuplicateGroup {
  contacts: DuplicateContact[]
  reason: 'email' | 'name'
}

function DuplicateGroupCard({
  group,
  isMerging,
  onMerge,
}: {
  group: DuplicateGroup
  isMerging: boolean
  onMerge: (winnerId: string, loserId: string) => void
}) {
  const [winnerId, setWinnerId] = useState(group.contacts[0]?.id ?? '')

  return (
    <div className="border border-[var(--color-pib-line)] rounded-xl p-4 space-y-3">
      <p className="text-xs text-[var(--color-pib-text-muted)]">
        Matched by: <span className="font-medium">{group.reason}</span>
        {' · '}{group.contacts.length} contacts
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {group.contacts.map(c => (
          <label
            key={c.id}
            className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
              winnerId === c.id
                ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]/5'
                : 'border-[var(--color-pib-line)] hover:border-[var(--color-pib-line-strong)]'
            }`}
          >
            <input
              type="radio"
              name={`winner-${group.contacts.map(x => x.id).join('-')}`}
              value={c.id}
              checked={winnerId === c.id}
              onChange={() => setWinnerId(c.id)}
              className="mt-0.5"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{c.name ?? '—'}</p>
              <p className="text-xs text-[var(--color-pib-text-muted)] truncate">{c.email ?? '—'}</p>
              {c.company && (
                <p className="text-xs text-[var(--color-pib-text-muted)] truncate">{c.company}</p>
              )}
              {winnerId === c.id && (
                <span className="text-xs text-[var(--color-pib-accent)] font-medium">Keep this one</span>
              )}
            </div>
          </label>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => {
            const losers = group.contacts.filter(c => c.id !== winnerId)
            if (losers.length > 0) onMerge(winnerId, losers[0].id)
          }}
          disabled={isMerging}
          className="btn-pib-accent text-xs disabled:opacity-50 flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[14px]">merge</span>
          {isMerging ? 'Merging…' : 'Merge'}
        </button>
      </div>
    </div>
  )
}

const STAGES = ['new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost']
const TYPES = ['lead', 'prospect', 'client', 'churned']
const BULK_ACTIONS = ['assign', 'stage', 'type', 'add-tags', 'remove-tags'] as const
type BulkActionKey = typeof BULK_ACTIONS[number]
const BULK_ACTION_LABELS: Record<BulkActionKey, string> = {
  assign: 'Assign to…',
  stage: 'Change stage to…',
  type: 'Change type to…',
  'add-tags': 'Add tags…',
  'remove-tags': 'Remove tags…',
}

interface Contact {
  id: string
  name: string
  email: string
  company?: string
  type: string
  stage: string
  lastContactedAt?: unknown
  tags?: string[]
  leadScore?: number
  icpScore?: number
  aiLeadScore?: number
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
      {stage}
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
      {type}
    </span>
  )
}

export default function PortalContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showNew, setShowNew] = useState(false)

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<BulkActionKey>('assign')
  const [bulkPending, setBulkPending] = useState(false)

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
  const [mergingGroup, setMergingGroup] = useState<string | null>(null)

  const { push: pushToast, node: toastNode } = useInlineToast()

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (stageFilter) params.set('stage', stageFilter)
    if (typeFilter) params.set('type', typeFilter)
    const qs = params.toString()
    const res = await fetch(`/api/v1/crm/contacts${qs ? `?${qs}` : ''}`)
    if (res.ok) {
      const body = await res.json()
      setContacts(body.data ?? [])
    }
    setLoading(false)
  }, [search, stageFilter, typeFilter])

  useEffect(() => {
    fetchContacts()
  }, [fetchContacts])

  // Load team members once
  useEffect(() => {
    fetch('/api/v1/portal/settings/team')
      .then(r => r.ok ? r.json() : null)
      .then(body => {
        if (body?.members) setTeamMembers(body.members)
      })
      .catch(() => {})
  }, [])

  async function createContact(data: Record<string, unknown>) {
    const res = await fetch('/api/v1/crm/contacts', {
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
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(contacts.map(c => c.id)))
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    const count = selectedIds.size
    if (!confirm(`Delete ${count} contact${count === 1 ? '' : 's'}? This cannot be undone.`)) return

    setBulkPending(true)
    try {
      const res = await fetch('/api/v1/crm/contacts/bulk', {
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
      const res = await fetch('/api/v1/crm/contacts/bulk', {
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
    try {
      const res = await fetch('/api/v1/crm/contacts/duplicates')
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
    try {
      const res = await fetch('/api/v1/crm/contacts/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerId, loserId }),
      })
      if (!res.ok) throw new Error('Merge failed')
      setDuplicateGroups(prev => prev.filter((_, i) => i !== groupIndex))
      setContacts(prev => prev.filter(c => c.id !== loserId))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setMergingGroup(null)
    }
  }

  const allSelected = contacts.length > 0 && selectedIds.size === contacts.length
  const someSelected = selectedIds.size > 0 && !allSelected

  return (
    <div className="space-y-8">
      {toastNode}

      <header>
        <p className="eyebrow">CRM</p>
        <div className="flex items-end justify-between gap-4 flex-wrap mt-2">
          <div>
            <h1 className="pib-page-title">Contacts</h1>
            <p className="pib-page-sub max-w-2xl">
              {loading ? 'Loading…' : `${contacts.length} contact${contacts.length === 1 ? '' : 's'}`} in your audience.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleFindDuplicates}
              disabled={duplicatesLoading}
              className="btn-pib-secondary text-xs flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[14px]">merge</span>
              {duplicatesLoading ? 'Scanning…' : 'Find duplicates'}
            </button>
            <button onClick={() => setShowNew(true)} className="btn-pib-accent">
              <span className="material-symbols-outlined text-base">add</span>
              New contact
            </button>
          </div>
        </div>
      </header>

      {/* Filters */}
      <section className="space-y-2">
        <SavedViewsBar
          currentFilters={{ search, stage: stageFilter, type: typeFilter }}
          onSelectView={(f) => {
            if (typeof f.search === 'string') setSearch(f.search)
            if (typeof f.stage === 'string') setStageFilter(f.stage)
            if (typeof f.type === 'string') setTypeFilter(f.type)
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
        >
          <option value="">All stages</option>
          {STAGES.map((s) => (
            <option key={s} value={s} className="bg-black">
              {s}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="pib-input !w-auto"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t} className="bg-black">
              {t}
            </option>
          ))}
        </select>
      </section>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div
          className="sticky top-4 z-40 flex flex-wrap items-center gap-3 px-4 py-3 rounded-[var(--radius-card)] shadow-lg"
          style={{ background: 'var(--color-pib-surface)', border: '1px solid var(--color-pib-accent)' }}
        >
          <span className="text-sm font-medium text-[var(--color-pib-accent)] shrink-0">
            {selectedIds.size} selected
          </span>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors shrink-0"
          >
            Clear
          </button>

          <div className="h-4 w-px bg-[var(--color-pib-line)] shrink-0" />

          {/* Action picker */}
          <select
            value={bulkAction}
            onChange={(e) => { setBulkAction(e.target.value as BulkActionKey); setBulkTagsInput('') }}
            className="pib-input !w-auto !py-1.5 !text-sm"
          >
            {BULK_ACTIONS.map(a => (
              <option key={a} value={a} className="bg-black">{BULK_ACTION_LABELS[a]}</option>
            ))}
          </select>

          {/* Action-specific input */}
          {bulkAction === 'assign' && (
            teamMembers.length > 0 ? (
              <select
                value={bulkAssignUid}
                onChange={(e) => setBulkAssignUid(e.target.value)}
                className="pib-input !w-auto !py-1.5 !text-sm"
              >
                <option value="" className="bg-black">Select member…</option>
                {teamMembers.map(m => (
                  <option key={m.uid} value={m.uid} className="bg-black">
                    {m.firstName} {m.lastName}{m.jobTitle ? ` (${m.jobTitle})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                placeholder="User UID…"
                value={bulkAssignUid}
                onChange={(e) => setBulkAssignUid(e.target.value)}
                className="pib-input !py-1.5 !text-sm w-48"
              />
            )
          )}

          {bulkAction === 'stage' && (
            <select
              value={bulkStage}
              onChange={(e) => setBulkStage(e.target.value)}
              className="pib-input !w-auto !py-1.5 !text-sm"
            >
              {STAGES.map(s => (
                <option key={s} value={s} className="bg-black">{s}</option>
              ))}
            </select>
          )}

          {bulkAction === 'type' && (
            <select
              value={bulkType}
              onChange={(e) => setBulkType(e.target.value)}
              className="pib-input !w-auto !py-1.5 !text-sm"
            >
              {TYPES.map(t => (
                <option key={t} value={t} className="bg-black">{t}</option>
              ))}
            </select>
          )}

          {(bulkAction === 'add-tags' || bulkAction === 'remove-tags') && (
            <input
              placeholder="tag1, tag2…"
              value={bulkTagsInput}
              onChange={(e) => setBulkTagsInput(e.target.value)}
              className="pib-input !py-1.5 !text-sm w-48"
            />
          )}

          <button
            onClick={applyBulk}
            disabled={bulkPending}
            className="btn-pib-accent !py-1.5 !text-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {bulkPending ? 'Applying…' : 'Apply'}
          </button>

          <div className="h-4 w-px bg-[var(--color-pib-line)] shrink-0" />

          <button
            onClick={handleBulkDelete}
            disabled={bulkPending}
            className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-red-400/10 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
            Delete selected ({selectedIds.size})
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="pib-skeleton h-12" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="bento-card p-10 text-center">
          <span className="material-symbols-outlined text-4xl text-[var(--color-pib-accent)]">contacts</span>
          <h2 className="font-display text-2xl mt-4">No contacts yet.</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">
            Add your first contact to start building your audience.
          </p>
          <button onClick={() => setShowNew(true)} className="btn-pib-accent mt-6">
            <span className="material-symbols-outlined text-base">add</span>
            Add contact
          </button>
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
            {contacts.map((c) => {
              const isSelected = selectedIds.has(c.id)
              return (
                <div
                  key={c.id}
                  className="grid grid-cols-2 md:grid-cols-15 gap-3 md:gap-4 items-center px-5 py-4 hover:bg-[var(--color-pib-surface-2)] transition-colors"
                  style={isSelected ? { background: 'var(--color-pib-accent, #7c3aed)10' } : undefined}
                >
                  {/* Checkbox */}
                  <div className="col-span-1 flex items-center" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(c.id)}
                      className="w-4 h-4 rounded cursor-pointer accent-[var(--color-pib-accent)]"
                      aria-label={`Select ${c.name}`}
                    />
                  </div>
                  {/* Rest of the row — wrapped in Link */}
                  <Link
                    href={`/portal/contacts/${c.id}`}
                    className="col-span-1 md:col-span-14 grid grid-cols-1 md:grid-cols-14 gap-3 md:gap-4 items-center"
                    onClick={e => { if (selectedIds.size > 0) e.preventDefault(); toggleSelect(c.id) }}
                  >
                    <div className="md:col-span-2">
                      <p className="font-medium text-[var(--color-pib-accent-hover)]">{c.name || '—'}</p>
                      {c.tags && c.tags.length > 0 && (
                        <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-0.5 truncate">
                          {c.tags.join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-3 text-sm text-[var(--color-pib-text-muted)] truncate">
                      {c.email || '—'}
                    </div>
                    <div className="md:col-span-2 text-sm text-[var(--color-pib-text-muted)] truncate">
                      {c.company || '—'}
                    </div>
                    <div className="md:col-span-1">
                      <TypeBadge type={c.type} />
                    </div>
                    <div className="md:col-span-1">
                      <StageBadge stage={c.stage} />
                    </div>
                    <div className="md:col-span-2 text-xs text-[var(--color-pib-text-muted)] font-mono">
                      {fmtTimestamp(c.lastContactedAt) || '—'}
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
                  </Link>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Duplicates error inline */}
      {duplicatesError && (
        <p className="text-sm text-red-400">{duplicatesError}</p>
      )}

      {/* Duplicates modal */}
      {showDuplicatesModal && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-16 z-50 overflow-y-auto">
          <div className="bento-card !p-6 w-full max-w-2xl mx-4 mb-8 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold">Duplicate contacts</p>
              <button onClick={() => setShowDuplicatesModal(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {duplicateGroups.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)] py-4 text-center">
                <span className="material-symbols-outlined text-3xl block mb-2">check_circle</span>
                No duplicates found.
              </p>
            ) : (
              duplicateGroups.map((group, gi) => (
                <DuplicateGroupCard
                  key={gi}
                  group={group}
                  isMerging={mergingGroup === String(gi)}
                  onMerge={(winnerId, loserId) => handleMerge(gi, winnerId, loserId)}
                />
              ))
            )}
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
                aria-label="Close"
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
