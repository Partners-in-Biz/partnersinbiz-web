'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { fmtTimestamp } from '@/components/admin/email/fmtTimestamp'
import { ContactDealsPanel } from '@/components/crm/ContactDealsPanel'
import { CompanyPanel } from '@/components/crm/CompanyPanel'
import { CompanyPicker } from '@/components/crm/CompanyPicker'
import { CustomFieldsSection } from '@/components/crm/CustomFieldsSection'
import { ScoreChip } from '@/components/crm/ScoreChip'
import type { CustomFieldDefinition } from '@/lib/customFields/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

interface ContactRecord {
  id?: string
  name?: string
  email?: string
  phone?: string
  company?: string
  companyId?: string
  companyName?: string
  website?: string
  source?: string
  type?: string
  stage?: string
  notes?: string
  tags?: string[]
  lastContactedAt?: unknown
  createdAt?: unknown
  leadScore?: number
  icpScore?: number
  aiLeadScore?: number
  scoreUpdatedAt?: unknown
  [key: string]: unknown
}

interface EmailRecord {
  id: string
  subject?: string
  status?: string
  direction?: string
  sentAt?: unknown
  createdAt?: unknown
  to?: string | string[]
}

interface ActivityRecord {
  id: string
  type?: string
  summary?: string
  notes?: string
  createdAt?: unknown
  metadata?: Record<string, unknown>
  createdByRef?: MemberRef
}

const ACTIVITY_ICONS: Record<string, string> = {
  note: 'notes',
  email_sent: 'mail',
  email_received: 'inbox',
  sequence_enrolled: 'route',
  sequence_completed: 'route',
  contact_captured: 'add_circle',
  call: 'call',
  meeting_scheduled: 'event',
  stage_change: 'swap_horiz',
}

function toDateTimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

export default function PortalContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [contact, setContact] = useState<ContactRecord | null>(null)
  const [emails, setEmails] = useState<EmailRecord[]>([])
  const [activities, setActivities] = useState<ActivityRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [emailsLoading, setEmailsLoading] = useState(true)
  const [activitiesLoading, setActivitiesLoading] = useState(true)

  // edit-in-place
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  // companyId/companyName for the picker — undefined = not in edit mode yet, '' = clear intent
  const [editCompanyId, setEditCompanyId] = useState<string | undefined>(undefined)
  const [editCompanyName, setEditCompanyName] = useState<string | undefined>(undefined)
  // Custom fields — definitions cached for the page lifecycle; values are part of the edit form
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([])
  const [editCustomFields, setEditCustomFields] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // B2: Log activity quick actions
  const [logType, setLogType] = useState<string | null>(null)
  const [logSummary, setLogSummary] = useState('')
  const [logEmailSubject, setLogEmailSubject] = useState('')
  const [meetingTitle, setMeetingTitle] = useState('')
  const [meetingStartAt, setMeetingStartAt] = useState('')
  const [meetingEndAt, setMeetingEndAt] = useState('')
  const [meetingUrl, setMeetingUrl] = useState('')
  const [logSaving, setLogSaving] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)

  // B1: Activity page for load-more
  const [activityPage, setActivityPage] = useState(1)

  // C1: Smart next-action suggestions
  interface SuggestionItem {
    action: string
    reason: string
    urgency: 'high' | 'medium' | 'low'
  }
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])

  // C2: AI email composer
  const [showAiComposer, setShowAiComposer] = useState(false)
  const [aiPurpose, setAiPurpose] = useState('')
  const [aiTone, setAiTone] = useState<'professional' | 'friendly' | 'bold'>('professional')
  const [aiDraft, setAiDraft] = useState<{ subject: string; bodyText: string } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // C3: Sequence enrollment panel
  interface EnrollmentRecord {
    id: string
    sequenceId?: string
    sequenceName?: string
    status?: string
    currentStep?: number
    nextSendAt?: unknown
  }
  const [enrollments, setEnrollments] = useState<EnrollmentRecord[]>([])
  const [enrollmentsLoading, setEnrollmentsLoading] = useState(true)
  const [showEnrollModal, setShowEnrollModal] = useState(false)
  const [sequences, setSequences] = useState<{ id: string; name: string }[]>([])
  const [enrollingSequenceId, setEnrollingSequenceId] = useState('')
  const [enrolling, setEnrolling] = useState(false)

  useEffect(() => {
    if (!id) return
    fetch(`/api/v1/crm/contacts/${id}`)
      .then((r) => r.json())
      .then((b) => {
        const c = (b.data ?? null) as ContactRecord | null
        setContact(c)
        setName(c?.name ?? '')
        setNotes(c?.notes ?? '')
        setEditCompanyId(c?.companyId ?? undefined)
        setEditCompanyName(c?.companyName ?? undefined)
        setEditCustomFields((c?.customFields as Record<string, unknown>) ?? {})
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    // Fetch custom field definitions once per page mount
    fetch('/api/v1/crm/custom-fields?resource=contact')
      .then((r) => r.json())
      .then((b) => setCustomFieldDefs(b.data?.definitions ?? b.definitions ?? []))
      .catch(() => setCustomFieldDefs([]))
  }, [])

  useEffect(() => {
    if (!id) return
    fetch(`/api/v1/email?contactId=${id}&limit=20`)
      .then((r) => r.json())
      .then((b) => {
        setEmails(b.data ?? [])
        setEmailsLoading(false)
      })
      .catch(() => setEmailsLoading(false))
  }, [id])

  useEffect(() => {
    if (!id) return
    fetch(`/api/v1/crm/activities?contactId=${id}&limit=50`)
      .then((r) => r.json())
      .then((b) => {
        setActivities(b.data?.activities ?? b.data ?? [])
        setActivitiesLoading(false)
      })
      .catch(() => setActivitiesLoading(false))
  }, [id])

  // C1: Fetch smart suggestions (silent fail)
  useEffect(() => {
    if (!id) return
    fetch(`/api/v1/crm/contacts/${id}/suggestions`)
      .then((r) => r.json())
      .then((b) => setSuggestions(b.data?.suggestions ?? []))
      .catch(() => setSuggestions([]))
  }, [id])

  // C3: Fetch enrollments
  useEffect(() => {
    if (!id) return
    fetch(`/api/v1/crm/contacts/${id}/enrollments`)
      .then((r) => r.json())
      .then((b) => {
        setEnrollments(b.data?.enrollments ?? [])
        setEnrollmentsLoading(false)
      })
      .catch(() => setEnrollmentsLoading(false))
  }, [id])

  async function saveChanges() {
    setSaving(true)
    setError('')
    try {
      // Build payload — companyId: '' signals clear to the API (FieldValue.delete())
      const payload: Record<string, unknown> = { name, notes }
      if (editCompanyId !== undefined) {
        payload.companyId = editCompanyId
      }
      // Always send customFields if we have definitions (server validates against per-workspace defs)
      if (customFieldDefs.length > 0) {
        payload.customFields = editCustomFields
      }
      const res = await fetch(`/api/v1/crm/contacts/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Save failed')
      }
      setContact((prev) =>
        prev
          ? { ...prev, name, notes, companyId: editCompanyId, companyName: editCompanyName, customFields: editCustomFields }
          : prev,
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function loadMoreActivities() {
    const nextPage = activityPage + 1
    try {
      const r = await fetch(`/api/v1/crm/activities?contactId=${id}&limit=50&page=${nextPage}`)
      const b = await r.json()
      const more: ActivityRecord[] = b.data?.activities ?? b.data ?? []
      setActivities((prev) => [...prev, ...more])
      setActivityPage(nextPage)
    } catch {
      // silent — user can retry by clicking again
    }
  }

  async function handleLogActivity() {
    setLogSaving(true)
    setLogError(null)
    try {
      if (logType === 'email_sent') {
        if (!logEmailSubject.trim() || !logSummary.trim()) return
        const res = await fetch(`/api/v1/crm/contacts/${id}/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: logEmailSubject.trim(), bodyText: logSummary.trim() }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error((errBody as { error?: string }).error ?? 'Failed to send email')
        }
        const optimistic: ActivityRecord = {
          id: Date.now().toString(),
          type: 'email_sent',
          summary: logEmailSubject.trim(),
          createdAt: new Date(),
        }
        setActivities((prev) => [optimistic, ...prev])
        setLogType(null)
        setLogSummary('')
        setLogEmailSubject('')
        setLogError(null)
      } else if (logType === 'sms') {
        if (!logSummary.trim()) return
        const res = await fetch(`/api/v1/crm/contacts/${id}/send-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: logSummary.trim() }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error((errBody as { error?: string }).error ?? 'Failed to send SMS')
        }
        const optimistic: ActivityRecord = {
          id: Date.now().toString(),
          type: 'sms_sent',
          summary: logSummary.trim(),
          createdAt: new Date(),
        }
        setActivities((prev) => [optimistic, ...prev])
        setLogType(null)
        setLogSummary('')
        setLogError(null)
      } else if (logType === 'meeting') {
        if (!meetingStartAt || !meetingEndAt) return
        const start = new Date(meetingStartAt)
        const end = new Date(meetingEndAt)
        const title = meetingTitle.trim() || `Meeting with ${contact?.name ?? 'contact'}`
        const res = await fetch(`/api/v1/crm/contacts/${id}/schedule-meeting`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            description: logSummary.trim(),
            startAt: start.toISOString(),
            endAt: end.toISOString(),
            meetingUrl: meetingUrl.trim(),
          }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error((errBody as { error?: string }).error ?? 'Failed to schedule meeting')
        }
        const optimistic: ActivityRecord = {
          id: Date.now().toString(),
          type: 'meeting_scheduled',
          summary: `Meeting scheduled: ${title}`,
          createdAt: new Date(),
        }
        setActivities((prev) => [optimistic, ...prev])
        setLogType(null)
        setLogSummary('')
        setMeetingTitle('')
        setMeetingStartAt('')
        setMeetingEndAt('')
        setMeetingUrl('')
        setLogError(null)
      } else {
        if (!logSummary.trim()) return
        const res = await fetch('/api/v1/crm/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contactId: id,
            type: logType,
            summary: logSummary.trim(),
          }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error((errBody as { error?: string }).error ?? 'Failed to log activity')
        }
        const body = await res.json() as { data?: ActivityRecord; success?: boolean }
        const newActivity: ActivityRecord = body.data ?? { id: Date.now().toString(), type: logType ?? undefined, summary: logSummary.trim(), createdAt: new Date() }
        setActivities((prev) => [newActivity, ...prev])
        setLogType(null)
        setLogSummary('')
        setLogError(null)
      }
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setLogSaving(false)
    }
  }

  // C2: AI email composer handler
  async function handleAiGenerate() {
    setAiLoading(true)
    setAiError(null)
    setAiDraft(null)
    try {
      const res = await fetch('/api/v1/crm/ai/compose-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: id, purpose: aiPurpose, tone: aiTone }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'AI generation failed')
      setAiDraft((body as { data?: { subject: string; bodyText: string } }).data ?? (body as { subject: string; bodyText: string }))
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI generation failed')
    } finally {
      setAiLoading(false)
    }
  }

  // C3: Enrollment handlers
  async function handleOpenEnrollModal() {
    const r = await fetch('/api/v1/crm/sequences')
    const b = await r.json()
    const list = (b.data?.sequences ?? b.data ?? []) as { id: string; name: string }[]
    setSequences(list)
    setEnrollingSequenceId('')
    setShowEnrollModal(true)
  }

  async function handleEnroll() {
    if (!enrollingSequenceId) return
    setEnrolling(true)
    try {
      const res = await fetch(`/api/v1/crm/sequences/${enrollingSequenceId}/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Enrollment failed')
      const newEnrollment = (body as { data?: EnrollmentRecord }).data ?? (body as EnrollmentRecord)
      setEnrollments((prev) => [newEnrollment, ...prev])
      setShowEnrollModal(false)
    } catch {
      // silent — modal stays open; user can retry
    } finally {
      setEnrolling(false)
    }
  }

  async function handleUnenroll(enrollmentId: string) {
    const enrollment = enrollments.find((e) => e.id === enrollmentId)
    if (!enrollment?.sequenceId) return
    try {
      await fetch(`/api/v1/crm/sequences/${enrollment.sequenceId}/enrollments/${enrollmentId}`, {
        method: 'DELETE',
      })
      setEnrollments((prev) => prev.filter((e) => e.id !== enrollmentId))
    } catch {
      // silent
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="pib-skeleton h-8 w-32" />
        <div className="pib-skeleton h-64" />
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="bento-card p-10 text-center">
        <h2 className="font-display text-2xl">Contact not found.</h2>
        <Link href="/portal/contacts" className="btn-pib-secondary mt-6">
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Back to contacts
        </Link>
      </div>
    )
  }

  const storedCustomFields = (contact.customFields as Record<string, unknown>) ?? {}
  const dirty =
    (contact.name ?? '') !== name ||
    (contact.notes ?? '') !== notes ||
    editCompanyId !== (contact.companyId ?? undefined) ||
    JSON.stringify(editCustomFields) !== JSON.stringify(storedCustomFields)
  const tags = Array.isArray(contact.tags) ? contact.tags : []

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/portal/contacts"
          className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Contacts
        </Link>
      </div>

      <header className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="pib-input !text-2xl !font-display !py-2 !px-3 max-w-xl"
          placeholder="Contact name"
        />
        <div className="flex flex-wrap items-center gap-2">
          {contact.stage && (
            <span className="pill capitalize">{String(contact.stage)}</span>
          )}
          {contact.type && (
            <span className="pill capitalize">{String(contact.type)}</span>
          )}
          {tags.map((t) => (
            <span key={t} className="pill">
              {t}
            </span>
          ))}
        </div>
        {(contact.leadScore !== undefined || contact.icpScore !== undefined || contact.aiLeadScore !== undefined) && (
          <div className="flex items-center gap-2">
            <ScoreChip score={contact.leadScore} kind="lead" label="Lead score (formula)" size="sm" />
            <ScoreChip score={contact.icpScore} kind="icp" label="ICP match score" size="sm" />
            {contact.aiLeadScore !== undefined && (
              <ScoreChip score={contact.aiLeadScore} kind="ai" label="AI lead score" size="sm" />
            )}
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Info */}
        <section className="lg:col-span-1 space-y-4">
          {/* Company panel — shows linked company card (or fallback) */}
          <div className="bento-card !p-5 space-y-3">
            <p className="eyebrow !text-[10px]">Company</p>
            <CompanyPanel
              companyId={contact.companyId}
              companyName={contact.companyName ?? contact.company}
            />
          </div>

          <div className="bento-card !p-5 space-y-3 text-sm">
            <p className="eyebrow !text-[10px]">Details</p>
            {[
              ['Email', contact.email],
              ['Phone', contact.phone],
              ['Company (legacy)', contact.company],
              ['Website', contact.website],
              ['Source', contact.source],
            ].map(([label, val]) =>
              val ? (
                <div key={String(label)}>
                  <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                    {String(label)}
                  </p>
                  <p className="text-[var(--color-pib-text)] mt-0.5 break-words">{String(val)}</p>
                </div>
              ) : null,
            )}
            {contact.lastContactedAt ? (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                  Last contacted
                </p>
                <p className="text-[var(--color-pib-text-muted)] mt-0.5 text-xs font-mono">
                  {fmtTimestamp(contact.lastContactedAt)}
                </p>
              </div>
            ) : null}
          </div>

          {customFieldDefs.length > 0 && (
            <div className="bento-card !p-5 space-y-3 text-sm">
              <p className="eyebrow !text-[10px]">Custom fields</p>
              <CustomFieldsSection
                definitions={customFieldDefs}
                values={storedCustomFields}
                mode="read"
              />
            </div>
          )}

          <div className="bento-card !p-5 space-y-2">
            <p className="eyebrow !text-[10px]">Edit</p>

            {/* Company picker — above legacy company string field */}
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                Linked company
              </p>
              <CompanyPicker
                currentCompanyId={editCompanyId}
                currentCompanyName={editCompanyName}
                onChange={({ companyId, companyName }) => {
                  setEditCompanyId(companyId ?? '')
                  setEditCompanyName(companyName ?? undefined)
                }}
              />
            </div>

            <div className="space-y-1 pt-1">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                Notes
              </p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                placeholder="Add a note about this contact…"
                className="pib-input resize-none w-full"
              />
            </div>

            {customFieldDefs.length > 0 && (
              <div className="space-y-1 pt-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                  Custom fields
                </p>
                <CustomFieldsSection
                  definitions={customFieldDefs}
                  values={editCustomFields}
                  mode="edit"
                  onChange={setEditCustomFields}
                />
              </div>
            )}

            {error && (
              <p className="text-[11px]" style={{ color: 'var(--color-pib-danger, #FCA5A5)' }}>
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <button
                onClick={saveChanges}
                disabled={!dirty || saving}
                className="btn-pib-accent !py-2 !px-4 !text-sm disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </section>

        {/* Right: Recent emails + activity */}
        <section className="lg:col-span-2 space-y-6">
          <div className="pib-card-section">
            <div className="px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02] flex items-center justify-between">
              <p className="eyebrow !text-[10px]">Recent emails</p>
              <span className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">
                {emailsLoading ? '…' : `${emails.length} record${emails.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {emailsLoading ? (
              <div className="p-5 space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="pib-skeleton h-10" />
                ))}
              </div>
            ) : emails.length === 0 ? (
              <div className="p-10 text-center">
                <span className="material-symbols-outlined text-3xl text-[var(--color-pib-text-muted)]">
                  mail
                </span>
                <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">
                  No emails sent or received yet.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-pib-line)]">
                {emails.map((e) => (
                  <div key={e.id} className="px-5 py-3 flex items-center gap-4">
                    <span
                      className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)] shrink-0"
                      title={e.direction || 'email'}
                    >
                      {e.direction === 'inbound' ? 'inbox' : 'send'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{e.subject || '(no subject)'}</p>
                      <p className="text-[11px] text-[var(--color-pib-text-muted)] font-mono mt-0.5">
                        {e.status ? `${e.status} · ` : ''}
                        {fmtTimestamp(e.sentAt) || fmtTimestamp(e.createdAt) || ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* C1: Smart next-action suggestions */}
          {suggestions.length > 0 && (
            <div className="bento-card !p-4">
              <p className="eyebrow !text-[10px] mb-3 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">tips_and_updates</span>
                Suggested actions
              </p>
              <div className="flex flex-col gap-2">
                {suggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      s.urgency === 'high' ? 'bg-red-500/20 text-red-400' :
                      s.urgency === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-[var(--color-pib-surface)] text-[var(--color-pib-text-muted)]'
                    }`}>{s.urgency}</span>
                    <div>
                      <p className="text-sm font-medium">{s.action}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">{s.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pib-card-section">
            <div className="px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02] flex items-center justify-between">
              <p className="eyebrow !text-[10px]">Activity</p>
              <span className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">
                {activitiesLoading ? '…' : `${activities.length} record${activities.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {/* B2: Log activity quick actions */}
            <div className="px-5 pt-4">
              <div className="flex gap-2 mb-3 flex-wrap">
                {([
                  { type: 'call', icon: 'call', label: 'Call' },
                  { type: 'email_sent', icon: 'mail', label: 'Email' },
                  { type: 'note', icon: 'notes', label: 'Note' },
                  { type: 'sms', icon: 'sms', label: 'SMS' },
                  { type: 'meeting', icon: 'event', label: 'Meeting' },
                ] as const).map(({ type, icon, label }) => (
                  <button
                    key={type}
                    onClick={() => {
                      if (logType === type) {
                        setLogType(null)
                        return
                      }
                      if (type === 'meeting' && !meetingStartAt) {
                        const start = new Date(Date.now() + 60 * 60 * 1000)
                        const end = new Date(start.getTime() + 30 * 60 * 1000)
                        setMeetingStartAt(toDateTimeLocalValue(start))
                        setMeetingEndAt(toDateTimeLocalValue(end))
                        setMeetingTitle(contact?.name ? `Meeting with ${contact.name}` : '')
                      }
                      setLogType(type)
                    }}
                    className={`btn-pib-secondary text-xs flex items-center gap-1 ${logType === type ? 'ring-1 ring-[var(--color-pib-accent)]' : ''}`}
                  >
                    <span className="material-symbols-outlined text-[14px]">{icon}</span>
                    {label}
                  </button>
                ))}
                <button onClick={() => setShowAiComposer((v) => !v)} className="btn-pib-secondary text-xs flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                  AI draft
                </button>
              </div>

              {logType && (
                <div className="bento-card !p-4 mb-4 space-y-3">
                  {logType === 'email_sent' ? (
                    <>
                      <input
                        placeholder="Subject…"
                        value={logEmailSubject}
                        onChange={(e) => setLogEmailSubject(e.target.value)}
                        className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                      />
                      <textarea
                        rows={3}
                        placeholder="Message…"
                        value={logSummary}
                        onChange={(e) => setLogSummary(e.target.value)}
                        className="w-full text-sm bg-transparent border border-[var(--color-pib-line)] rounded-lg p-2 resize-none"
                      />
                    </>
                  ) : logType === 'sms' ? (
                    <textarea
                      rows={3}
                      placeholder="SMS message…"
                      value={logSummary}
                      onChange={(e) => setLogSummary(e.target.value)}
                      className="w-full text-sm bg-transparent border border-[var(--color-pib-line)] rounded-lg p-2 resize-none"
                    />
                  ) : logType === 'meeting' ? (
                    <>
                      <input
                        placeholder="Meeting title…"
                        value={meetingTitle}
                        onChange={(e) => setMeetingTitle(e.target.value)}
                        className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="block text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Starts</span>
                          <input
                            type="datetime-local"
                            value={meetingStartAt}
                            onChange={(e) => setMeetingStartAt(e.target.value)}
                            className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Ends</span>
                          <input
                            type="datetime-local"
                            value={meetingEndAt}
                            onChange={(e) => setMeetingEndAt(e.target.value)}
                            className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                          />
                        </label>
                      </div>
                      <input
                        placeholder="Meeting link (optional)…"
                        value={meetingUrl}
                        onChange={(e) => setMeetingUrl(e.target.value)}
                        className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                      />
                      <textarea
                        rows={3}
                        placeholder="Agenda or notes…"
                        value={logSummary}
                        onChange={(e) => setLogSummary(e.target.value)}
                        className="w-full text-sm bg-transparent border border-[var(--color-pib-line)] rounded-lg p-2 resize-none"
                      />
                    </>
                  ) : (
                    <textarea
                      rows={3}
                      placeholder={`Add ${logType} notes…`}
                      value={logSummary}
                      onChange={(e) => setLogSummary(e.target.value)}
                      className="w-full text-sm bg-transparent border border-[var(--color-pib-line)] rounded-lg p-2 resize-none"
                    />
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleLogActivity}
                      disabled={
                        logSaving ||
                        (logType === 'email_sent'
                          ? !logEmailSubject.trim() || !logSummary.trim()
                          : logType === 'meeting'
                          ? !meetingStartAt || !meetingEndAt
                          : !logSummary.trim())
                      }
                      className="btn-pib-accent text-xs disabled:opacity-50"
                    >
                      {logSaving
                        ? 'Sending…'
                        : logType === 'email_sent'
                        ? 'Send email'
                        : logType === 'sms'
                        ? 'Send SMS'
                        : logType === 'meeting'
                        ? 'Schedule'
                        : 'Save'}
                    </button>
                    <button
                      onClick={() => { setLogType(null); setLogSummary(''); setLogEmailSubject(''); setMeetingTitle(''); setMeetingStartAt(''); setMeetingEndAt(''); setMeetingUrl(''); setLogError(null) }}
                      className="text-xs text-[var(--color-pib-text-muted)]"
                    >
                      Cancel
                    </button>
                  </div>
                  {logError && <p className="text-xs text-red-400">{logError}</p>}
                </div>
              )}

              {/* C2: AI email composer */}
              {showAiComposer && (
                <div className="bento-card !p-4 mb-4 space-y-3">
                  <p className="text-xs font-medium">AI email composer</p>
                  <input
                    placeholder="Purpose (e.g. Follow up after demo)"
                    value={aiPurpose}
                    onChange={(e) => setAiPurpose(e.target.value)}
                    className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                  />
                  <select
                    value={aiTone}
                    onChange={(e) => setAiTone(e.target.value as 'professional' | 'friendly' | 'bold')}
                    className="text-sm border border-[var(--color-pib-line)] rounded p-1 bg-transparent"
                  >
                    <option value="professional">Professional</option>
                    <option value="friendly">Friendly</option>
                    <option value="bold">Bold</option>
                  </select>
                  <button
                    onClick={handleAiGenerate}
                    disabled={aiLoading || !aiPurpose.trim()}
                    className="btn-pib-accent text-xs disabled:opacity-50"
                  >
                    {aiLoading ? 'Generating…' : 'Generate'}
                  </button>
                  {aiError && <p className="text-xs text-red-400">{aiError}</p>}
                  {aiDraft && (
                    <div className="space-y-2 mt-2">
                      <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">Subject:</p>
                      <p className="text-sm font-medium">{aiDraft.subject}</p>
                      <p className="text-xs font-medium text-[var(--color-pib-text-muted)]">Body:</p>
                      <p className="text-sm whitespace-pre-wrap">{aiDraft.bodyText}</p>
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(`Subject: ${aiDraft!.subject}\n\n${aiDraft!.bodyText}`)
                        }}
                        className="btn-pib-secondary text-xs flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[14px]">content_copy</span>
                        Copy to clipboard
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* B1: Activity timeline */}
            {activitiesLoading ? (
              <div className="p-5 space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="pib-skeleton h-10" />
                ))}
              </div>
            ) : activities.length === 0 ? (
              <div className="p-10 text-center">
                <span className="material-symbols-outlined text-3xl text-[var(--color-pib-text-muted)]">
                  history
                </span>
                <p className="text-sm text-[var(--color-pib-text-muted)] mt-2">
                  No activity logged yet.
                </p>
              </div>
            ) : (
              <div className="px-5 pb-4">
                {activities.map((a) => (
                  <div key={a.id} className="flex gap-3 py-3 border-b border-[var(--color-pib-line)] last:border-0">
                    {/* Icon */}
                    <div className="shrink-0 w-8 h-8 rounded-full bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] flex items-center justify-center">
                      <span className="material-symbols-outlined text-[14px] text-[var(--color-pib-text-muted)]">
                        {ACTIVITY_ICONS[String(a.type ?? '')] ?? 'circle'}
                      </span>
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[var(--color-pib-text)]">{a.summary ?? a.notes ?? a.type}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                        {a.createdByRef?.displayName ?? 'System'} · {fmtTimestamp(a.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
                {activities.length === 50 && (
                  <button
                    onClick={loadMoreActivities}
                    className="text-sm text-[var(--color-pib-text-muted)] w-full py-2 hover:text-[var(--color-pib-text)]"
                  >
                    Load more
                  </button>
                )}
              </div>
            )}
          </div>

          <ContactDealsPanel
            contactId={id}
            contactName={contact.name}
            orgId={typeof contact.orgId === 'string' ? contact.orgId : ''}
          />

          {/* C3: Sequence enrollment panel */}
          <div className="bento-card !p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="eyebrow !text-[10px]">Sequences</p>
              <button onClick={handleOpenEnrollModal} className="btn-pib-secondary text-xs flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">add</span>
                Enroll
              </button>
            </div>
            {enrollmentsLoading ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
            ) : enrollments.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">Not enrolled in any sequences.</p>
            ) : (
              enrollments.map((e) => (
                <div key={e.id} className="flex items-center justify-between py-2 border-b border-[var(--color-pib-line)] last:border-0">
                  <div>
                    <p className="text-sm font-medium">{e.sequenceName ?? e.sequenceId ?? 'Sequence'}</p>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">Step {(e.currentStep ?? 0) + 1} · {e.status}</p>
                  </div>
                  <button
                    onClick={() => handleUnenroll(e.id)}
                    className="text-xs text-[var(--color-pib-text-muted)] hover:text-red-400"
                  >
                    Unenroll
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* C3: Enroll modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bento-card !p-6 w-full max-w-sm space-y-4">
            <p className="text-sm font-semibold">Enroll in sequence</p>
            <select
              value={enrollingSequenceId}
              onChange={(e) => setEnrollingSequenceId(e.target.value)}
              className="w-full text-sm border border-[var(--color-pib-line)] rounded p-2 bg-transparent"
            >
              <option value="">Choose a sequence…</option>
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={handleEnroll}
                disabled={!enrollingSequenceId || enrolling}
                className="btn-pib-accent text-sm disabled:opacity-50"
              >
                {enrolling ? 'Enrolling…' : 'Enroll'}
              </button>
              <button
                onClick={() => setShowEnrollModal(false)}
                className="btn-pib-secondary text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
