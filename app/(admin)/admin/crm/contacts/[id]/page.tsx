'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ActivityTimeline } from '@/components/admin/crm/ActivityTimeline'
import ContactBrief from '@/components/admin/crm/ContactBrief'
import { ContactForm } from '@/components/admin/crm/ContactForm'
import { fmtTimestamp } from '@/components/admin/email/fmtTimestamp'
import { CompanyPanel } from '@/components/crm/CompanyPanel'
import { ContactArchiveControl } from '@/components/crm/ContactArchiveControl'
import { ContactDealsPanel } from '@/components/crm/ContactDealsPanel'
import { ContactIntelligenceStack } from '@/components/crm/ContactIntelligenceStack'
import { ScoreChip } from '@/components/crm/ScoreChip'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

const STAGES = ['new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost'] as const

type ContactRecord = {
  id?: string
  orgId?: string
  name?: string
  email?: string
  phone?: string
  jobTitle?: string
  department?: string
  company?: string
  companyId?: string
  companyName?: string
  website?: string
  source?: string
  type?: string
  stage?: string
  notes?: string
  tags?: string[]
  assignedTo?: string
  assignedToRef?: MemberRef
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
  capturedFromId?: string
  timezone?: string
  phoneVerified?: boolean
  smsOptedIn?: boolean
  smsUnsubscribedAt?: unknown
  unsubscribedAt?: unknown
  bouncedAt?: unknown
  repliesCount?: number
  lastContactedAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  leadScore?: number
  icpScore?: number
  aiLeadScore?: number
  scoreUpdatedAt?: unknown
  agreementRoles?: string[]
  customFields?: Record<string, unknown>
}

type ActivityRecord = {
  id: string
  type?: string
  summary?: string
  notes?: string
  createdAt?: unknown
}

type EmailRecord = {
  id: string
  subject?: string
  status?: string
  direction?: string
  sentAt?: unknown
  createdAt?: unknown
}

type SuggestionItem = {
  action: string
  reason: string
  urgency: 'high' | 'medium' | 'low'
}

function unwrapContact(body: unknown): ContactRecord | null {
  const response = body as { data?: ContactRecord | { contact?: ContactRecord } }
  if (!response.data) return null
  const data = response.data as Record<string, unknown>
  if ('contact' in data) return (data.contact as ContactRecord | undefined) ?? null
  return data as ContactRecord
}

function unwrapList<T>(body: unknown, nestedKey?: string): T[] {
  const response = body as { data?: T[] | Record<string, T[]> }
  if (Array.isArray(response.data)) return response.data
  if (nestedKey && response.data && Array.isArray(response.data[nestedKey])) {
    return response.data[nestedKey]
  }
  return []
}

function textValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function displayValue(value: unknown): string {
  return textValue(value) || 'Not captured'
}

function contactDisplayName(contact: ContactRecord | null): string {
  if (!contact) return 'Contact'
  return textValue(contact.name) || textValue(contact.email) || 'Unnamed contact'
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

function profileStrength(contact: ContactRecord): number {
  const checks = [
    contact.name,
    contact.email,
    contact.phone,
    contact.jobTitle,
    contact.companyId || contact.companyName || contact.company,
    contact.website,
    contact.source,
    contact.notes,
  ]
  const complete = checks.filter((value) => textValue(value).length > 0).length
  return Math.round((complete / checks.length) * 100)
}

function toneForUrgency(urgency: SuggestionItem['urgency']): string {
  if (urgency === 'high') return 'border-red-400/30 bg-red-400/10 text-red-200'
  if (urgency === 'medium') return 'border-amber-400/30 bg-amber-400/10 text-amber-200'
  return 'border-white/10 bg-white/5 text-[var(--color-pib-text-muted)]'
}

function CommandMetric({
  icon,
  label,
  value,
  sub,
}: {
  icon: string
  label: string
  value: string
  sub: string
}) {
  return (
    <div className="pib-card min-w-[150px] flex-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
        <span className="material-symbols-outlined text-[17px] text-on-surface-variant">{icon}</span>
      </div>
      <p className="mt-2 text-xl font-headline font-bold text-on-surface leading-none">{value}</p>
      <p className="mt-1 text-[11px] text-on-surface-variant">{sub}</p>
    </div>
  )
}

function DetailRow({
  label,
  value,
  actionLabel,
  onAction,
  actionIcon = 'add',
}: {
  label: string
  value: unknown
  actionLabel?: string
  onAction?: () => void
  actionIcon?: string
}) {
  const captured = Boolean(textValue(value))
  return (
    <div className="rounded-lg border border-[var(--color-card-border)] bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{label}</p>
        {!captured && actionLabel && onAction && (
          <button
            type="button"
            aria-label={actionLabel}
            onClick={onAction}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--color-card-border)] px-2 py-1 text-[10px] font-semibold text-[var(--color-accent-v2)] transition-colors hover:border-[var(--color-accent-v2)] hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[13px]" aria-hidden="true">{actionIcon}</span>
            Add
          </button>
        )}
      </div>
      <p className={`mt-1 text-sm break-words ${captured ? 'text-on-surface' : 'text-on-surface-variant'}`}>
        {displayValue(value)}
      </p>
    </div>
  )
}

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const noteInputRef = useRef<HTMLInputElement | null>(null)
  const [contact, setContact] = useState<ContactRecord | null>(null)
  const [activities, setActivities] = useState<ActivityRecord[]>([])
  const [emails, setEmails] = useState<EmailRecord[]>([])
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activitiesLoading, setActivitiesLoading] = useState(true)
  const [emailsLoading, setEmailsLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [scoreSaving, setScoreSaving] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)

  const loadContact = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setPageError('')
    try {
      const res = await fetch(`/api/v1/crm/contacts/${id}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to load contact')
      setContact(unwrapContact(body))
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to load contact')
      setContact(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadActivities = useCallback(async () => {
    if (!id) return
    setActivitiesLoading(true)
    try {
      const res = await fetch(`/api/v1/crm/contacts/${id}/activities`)
      const body = await res.json()
      setActivities(unwrapList<ActivityRecord>(body, 'activities'))
    } finally {
      setActivitiesLoading(false)
    }
  }, [id])

  const loadEmails = useCallback(async () => {
    if (!id) return
    setEmailsLoading(true)
    try {
      const res = await fetch(`/api/v1/email?contactId=${encodeURIComponent(id)}&limit=8`)
      const body = await res.json()
      setEmails(unwrapList<EmailRecord>(body))
    } finally {
      setEmailsLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadContact()
  }, [loadContact])

  useEffect(() => {
    void loadActivities()
  }, [loadActivities])

  useEffect(() => {
    void loadEmails()
  }, [loadEmails])

  useEffect(() => {
    if (!id) return
    fetch(`/api/v1/crm/contacts/${id}/suggestions`)
      .then((r) => r.json())
      .then((body) => {
        const data = body as { data?: { suggestions?: SuggestionItem[] } }
        setSuggestions(data.data?.suggestions ?? [])
      })
      .catch(() => setSuggestions([]))
  }, [id])

  async function saveContact(data: Record<string, unknown>) {
    const res = await fetch(`/api/v1/crm/contacts/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Save failed')
    setContact((prev) => ({ ...(prev ?? {}), ...data }))
    setEditing(false)
    void loadContact()
  }

  async function addNote() {
    if (!noteText.trim()) return
    setSavingNote(true)
    try {
      const res = await fetch('/api/v1/crm/activities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId: id, type: 'note', summary: noteText.trim(), dealId: '', metadata: {} }),
      })
      if (!res.ok) throw new Error('Failed to add note')
      setNoteText('')
      await loadActivities()
    } finally {
      setSavingNote(false)
    }
  }

  function focusNoteComposer() {
    noteInputRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    noteInputRef.current?.focus()
  }

  async function changeStage(stage: string) {
    const res = await fetch(`/api/v1/crm/contacts/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stage }),
    })
    if (!res.ok) return
    await fetch('/api/v1/crm/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contactId: id,
        type: 'stage_change',
        summary: `Stage changed to ${stage}`,
        dealId: '',
        metadata: { newStage: stage },
      }),
    }).catch(() => undefined)
    setContact((prev) => (prev ? { ...prev, stage } : prev))
    await loadActivities()
  }

  async function archiveContact() {
    setArchiving(true)
    setPageError('')
    try {
      const res = await fetch(`/api/v1/crm/contacts/${id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Archive failed')
      router.push('/admin/crm/contacts')
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Archive failed')
      setArchiving(false)
    }
  }

  async function recomputeScore() {
    if (!contact) return
    setScoreSaving(true)
    setScoreError(null)
    try {
      const res = await fetch(`/api/v1/crm/contacts/${id}/recompute-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeAi: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Score recompute failed')
      const update = (body as { data?: { update?: Partial<ContactRecord> } }).data?.update
      if (update) {
        setContact((prev) => prev ? { ...prev, ...update } : prev)
      }
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : 'Score recompute failed')
    } finally {
      setScoreSaving(false)
    }
  }

  const strength = useMemo(() => (contact ? profileStrength(contact) : 0), [contact])
  const lastTouchAge = daysSince(contact?.lastContactedAt)
  const name = contactDisplayName(contact)
  const tags = Array.isArray(contact?.tags) ? contact.tags : []
  const customFieldCount = contact?.customFields ? Object.keys(contact.customFields).length : 0
  const hasAnyScore = contact?.leadScore != null || contact?.icpScore != null || contact?.aiLeadScore != null
  const hasCompanyContext = Boolean(contact?.companyId || contact?.companyName || contact?.company)
  const composeEmailHref = contact?.email
    ? `/admin/email/compose?to=${encodeURIComponent(contact.email)}&contactId=${encodeURIComponent(id)}`
    : ''

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="pib-skeleton h-24" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="pib-skeleton h-72" />
          <div className="pib-skeleton h-72 lg:col-span-2" />
        </div>
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="pib-card p-12 text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant">person_off</span>
        <h1 className="mt-4 font-headline text-2xl font-bold tracking-tight text-on-surface">Contact not found</h1>
        <p className="mt-2 text-sm text-on-surface-variant">{pageError || 'This contact may have been removed or belongs to another workspace.'}</p>
        <Link href="/admin/crm/contacts" className="pib-btn-secondary mt-6 inline-flex text-sm">
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back to contacts
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link
        href="/admin/crm/contacts"
        className="inline-flex items-center gap-1 text-xs font-label uppercase tracking-widest text-on-surface-variant hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-[15px]">arrow_back</span>
        Contacts
      </Link>

      <header className="pib-card overflow-hidden !p-0">
        <div className="border-b border-[var(--color-card-border)] bg-white/[0.02] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Contact command center</p>
              <h1 className="mt-2 font-headline text-3xl font-bold tracking-tight text-on-surface">{name}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {contact.stage && <span className="pill capitalize">{contact.stage}</span>}
                {contact.type && <span className="pill capitalize">{contact.type}</span>}
                {contact.source && <span className="pill capitalize">Source: {contact.source}</span>}
                {tags.slice(0, 6).map((tag) => <span key={tag} className="pill">{tag}</span>)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {composeEmailHref && (
                <Link href={composeEmailHref} aria-label={`Email ${name} from contact command center`} className="pib-btn-secondary text-sm">
                  <span className="material-symbols-outlined text-base">mail</span>
                  Email
                </Link>
              )}
              {!composeEmailHref && (
                <button
                  type="button"
                  aria-label={`Add email for ${name} from contact command center`}
                  onClick={() => setEditing(true)}
                  className="pib-btn-secondary text-sm"
                >
                  <span className="material-symbols-outlined text-base">alternate_email</span>
                  Add email
                </button>
              )}
              {contact.phone && (
                <a href={`tel:${contact.phone}`} className="pib-btn-secondary text-sm">
                  <span className="material-symbols-outlined text-base">call</span>
                  Call
                </a>
              )}
              {!contact.phone && (
                <button
                  type="button"
                  aria-label={`Add phone for ${name} from contact command center`}
                  onClick={() => setEditing(true)}
                  className="pib-btn-secondary text-sm"
                >
                  <span className="material-symbols-outlined text-base">add_call</span>
                  Add phone
                </button>
              )}
              {!hasCompanyContext && (
                <button
                  type="button"
                  aria-label={`Add company for ${name} from contact command center`}
                  onClick={() => setEditing(true)}
                  className="pib-btn-secondary text-sm"
                >
                  <span className="material-symbols-outlined text-base">domain_add</span>
                  Add company
                </button>
              )}
              <button onClick={() => setEditing((value) => !value)} className="pib-btn-primary text-sm">
                <span className="material-symbols-outlined text-base">{editing ? 'close' : 'edit'}</span>
                {editing ? 'Cancel edit' : 'Edit contact'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 p-5">
          <CommandMetric icon="fact_check" label="Profile strength" value={`${strength}%`} sub={strength >= 75 ? 'Ready for handoff' : 'Needs enrichment'} />
          <CommandMetric icon="moving" label="Stage" value={displayValue(contact.stage)} sub="Lifecycle position" />
          <CommandMetric icon="schedule" label="Last touch" value={lastTouchAge === null ? 'Never' : `${lastTouchAge}d`} sub={fmtTimestamp(contact.lastContactedAt) || 'No outreach logged'} />
          <CommandMetric icon="mail" label="Email records" value={emailsLoading ? '...' : String(emails.length)} sub="Recent communication" />
          <CommandMetric icon="hub" label="Custom fields" value={String(customFieldCount)} sub="Workspace data points" />
        </div>
      </header>

      {editing && (
        <div className="pib-card-section overflow-hidden">
          <div className="border-b border-[var(--color-card-border)] bg-white/[0.02] px-5 py-3">
            <p className="text-sm font-semibold text-on-surface">Edit contact profile</p>
          </div>
          <ContactForm onSave={saveContact} onCancel={() => setEditing(false)} initial={contact} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-5 lg:col-span-1">
          <div className="pib-card-section">
            <div className="border-b border-[var(--color-card-border)] bg-white/[0.02] px-5 py-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Relationship profile</p>
            </div>
            <div className="space-y-3 p-5">
              <CompanyPanel companyId={contact.companyId} companyName={contact.companyName ?? contact.company} />
              <div className="grid gap-3">
                <DetailRow label="Email" value={contact.email} />
                <DetailRow label="Phone" value={contact.phone} />
                <DetailRow label="Role" value={[contact.jobTitle, contact.department].filter(Boolean).join(' · ')} />
                <DetailRow
                  label="Website"
                  value={contact.website}
                  actionLabel={`Add website for ${name} from relationship profile`}
                  onAction={() => setEditing(true)}
                  actionIcon="language"
                />
                <DetailRow label="Owner" value={contact.assignedTo} />
                <DetailRow label="Created" value={fmtTimestamp(contact.createdAt)} />
                <DetailRow label="Updated" value={fmtTimestamp(contact.updatedAt)} />
              </div>
            </div>
          </div>

          <ContactArchiveControl contactName={name} archiving={archiving} onArchive={archiveContact} />

          <div className="pib-card-section">
            <div className="border-b border-[var(--color-card-border)] bg-white/[0.02] px-5 py-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Scores and qualification</p>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                <ScoreChip score={numberValue(contact.leadScore)} kind="lead" label="Lead score (formula)" size="sm" />
                <ScoreChip score={numberValue(contact.icpScore)} kind="icp" label="ICP match score" size="sm" />
                <ScoreChip score={numberValue(contact.aiLeadScore)} kind="ai" label="AI lead score" size="sm" />
              </div>
              {!hasAnyScore && (
                <button
                  type="button"
                  aria-label={`Recompute score for ${name} from admin qualification panel`}
                  onClick={recomputeScore}
                  disabled={scoreSaving}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-xs font-semibold text-[var(--color-accent-v2)] transition-colors hover:border-[var(--color-accent-v2)] hover:text-on-surface disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[15px]" aria-hidden="true">speed</span>
                  {scoreSaving ? 'Scoring...' : 'Recompute score'}
                </button>
              )}
              {scoreError && <p className="text-xs text-red-300">{scoreError}</p>}
              <DetailRow label="Score updated" value={fmtTimestamp(contact.scoreUpdatedAt)} />
              <DetailRow label="Agreement roles" value={contact.agreementRoles?.join(', ')} />
              <DetailRow label="Notes" value={contact.notes} />
            </div>
          </div>

          <div className="pib-card-section">
            <div className="border-b border-[var(--color-card-border)] bg-white/[0.02] px-5 py-3">
              <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Stage control</p>
            </div>
            <div className="flex flex-wrap gap-2 p-5">
              {STAGES.map((stage) => (
                <button
                  key={stage}
                  onClick={() => changeStage(stage)}
                  className={`rounded-full border px-3 py-1.5 text-[10px] font-label uppercase tracking-widest transition-colors ${
                    contact.stage === stage
                      ? 'border-[var(--color-accent-v2)] bg-[var(--color-accent-v2)] text-black'
                      : 'border-[var(--color-card-border)] text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {stage}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-5 lg:col-span-2">
          <ContactIntelligenceStack
            contact={contact}
            emails={emails}
            activities={activities}
            nextSuggestion={suggestions[0]}
          />

          {suggestions.length > 0 && (
            <div className="pib-card-section">
              <div className="border-b border-[var(--color-card-border)] bg-white/[0.02] px-5 py-3">
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Next best actions</p>
              </div>
              <div className="grid gap-3 p-5 md:grid-cols-2">
                {suggestions.slice(0, 4).map((suggestion, index) => (
                  <div key={`${suggestion.action}-${index}`} className={`rounded-lg border px-4 py-3 ${toneForUrgency(suggestion.urgency)}`}>
                    <p className="text-sm font-semibold">{suggestion.action}</p>
                    <p className="mt-1 text-xs opacity-80">{suggestion.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            <div className="pib-card-section">
              <div className="border-b border-[var(--color-card-border)] bg-white/[0.02] px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Recent emails</p>
                  <span className="text-[11px] text-on-surface-variant">{emailsLoading ? '...' : `${emails.length} records`}</span>
                </div>
              </div>
              {emailsLoading ? (
                <div className="space-y-2 p-5">
                  {[...Array(3)].map((_, index) => <div key={index} className="pib-skeleton h-12" />)}
                </div>
              ) : emails.length === 0 ? (
                <div className="p-8 text-center text-sm text-on-surface-variant">
                  <span className="material-symbols-outlined text-3xl">mail</span>
                  <p className="mt-2">No email history yet.</p>
                  {composeEmailHref && (
                    <Link
                      href={composeEmailHref}
                      aria-label={`Compose first email to ${name} from admin email history`}
                      className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-xs font-semibold text-[var(--color-accent-v2)] transition-colors hover:border-[var(--color-accent-v2)] hover:text-on-surface"
                    >
                      <span className="material-symbols-outlined text-[15px]" aria-hidden="true">edit_square</span>
                      Compose first email
                    </Link>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-[var(--color-card-border)]">
                  {emails.map((email) => (
                    <div key={email.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="material-symbols-outlined text-[17px] text-on-surface-variant">
                        {email.direction === 'inbound' ? 'inbox' : 'send'}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-on-surface">{email.subject || '(no subject)'}</p>
                        <p className="mt-0.5 text-[11px] text-on-surface-variant">
                          {email.status ? `${email.status} · ` : ''}
                          {fmtTimestamp(email.sentAt) || fmtTimestamp(email.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <ContactBrief contactId={id} />
          </div>

          <ContactDealsPanel
            contactId={id}
            contactName={contact.name}
            orgId={contact.orgId ?? ''}
          />

          <div className="pib-card-section">
            <div className="border-b border-[var(--color-card-border)] bg-white/[0.02] px-5 py-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Activity command log</p>
                <span className="text-[11px] text-on-surface-variant">{activitiesLoading ? '...' : `${activities.length} records`}</span>
              </div>
            </div>
            <div className="border-b border-[var(--color-card-border)] px-5 py-4">
              <div className="flex gap-3">
                <input
                  ref={noteInputRef}
                  placeholder="Add an internal note, handoff, decision, or context..."
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && addNote()}
                  className="pib-input flex-1"
                />
                <button
                  onClick={addNote}
                  disabled={savingNote || !noteText.trim()}
                  className="pib-btn-primary text-sm disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-base">add_comment</span>
                  {savingNote ? 'Adding' : 'Add note'}
                </button>
              </div>
            </div>
            <div className="p-5">
              <ActivityTimeline activities={activities as never} loading={activitiesLoading} onAddNote={focusNoteComposer} />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
