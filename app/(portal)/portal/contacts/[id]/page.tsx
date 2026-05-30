'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { fmtTimestamp } from '@/components/admin/email/fmtTimestamp'
import { ContactDealsPanel } from '@/components/crm/ContactDealsPanel'
import { ContactEngagementPanel } from '@/components/crm/ContactEngagementPanel'
import { CompanyPanel } from '@/components/crm/CompanyPanel'
import { CompanyPicker } from '@/components/crm/CompanyPicker'
import { ContactIdentityPanel } from '@/components/crm/ContactIdentityPanel'
import { ContactOwnershipPanel } from '@/components/crm/ContactOwnershipPanel'
import { CustomFieldsSection } from '@/components/crm/CustomFieldsSection'
import { ScoreChip } from '@/components/crm/ScoreChip'
import type { CustomFieldDefinition } from '@/lib/customFields/types'
import type { MemberRef } from '@/lib/orgMembers/memberRef'

interface ContactRecord {
  id?: string
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
  assignedTo?: string
  assignedToRef?: MemberRef
  createdByRef?: MemberRef
  updatedByRef?: MemberRef
  capturedFromId?: string
  tags?: string[]
  lastContactedAt?: unknown
  createdAt?: unknown
  timezone?: string
  phoneVerified?: boolean
  smsOptedIn?: boolean
  unsubscribedAt?: unknown
  bouncedAt?: unknown
  smsUnsubscribedAt?: unknown
  lastRepliedAt?: unknown
  repliesCount?: number
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

interface TeamMemberOption {
  uid: string
  firstName?: string
  lastName?: string
  jobTitle?: string
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

const STAGE_OPTIONS = ['new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost']
const TYPE_OPTIONS = ['lead', 'prospect', 'client', 'churned']
const SOURCE_OPTIONS = ['manual', 'form', 'import', 'outreach']
const STAGE_LABELS: Record<string, string> = {
  new: 'New lead',
  contacted: 'Contacted',
  replied: 'Replied',
  demo: 'Demo booked',
  proposal: 'Proposal sent',
  won: 'Won customer',
  lost: 'Lost opportunity',
}
const TYPE_LABELS: Record<string, string> = {
  lead: 'Lead',
  prospect: 'Prospect',
  client: 'Client',
  churned: 'Churned',
}
const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual entry',
  form: 'Form capture',
  import: 'Imported list',
  outreach: 'Outreach',
}

function timestampMillis(value: unknown): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'object' && value !== null) {
    const candidate = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number }
    if (typeof candidate.toMillis === 'function') return candidate.toMillis()
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime()
    if (typeof candidate.seconds === 'number') return candidate.seconds * 1000
  }
  return 0
}

function daysSince(value: unknown): number | null {
  const millis = timestampMillis(value)
  if (!millis) return null
  return Math.max(0, Math.floor((Date.now() - millis) / 86_400_000))
}

function fmtPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(value, 1)) * 100)}%`
}

function displayLabel(value: string, labels: Record<string, string>): string {
  const key = value.trim()
  if (!key) return ''
  return labels[key] ?? key
}

function activityNotesPlaceholder(logType: string): string {
  if (logType === 'note') return 'Add a relationship note, handoff, or context…'
  if (logType === 'call') return 'Add call notes…'
  return `Add ${logType} notes…`
}

function activityMetricCaption(count: number): string {
  if (count === 0) return 'No relationship history yet'
  return count === 1 ? '1 relationship touch logged' : `${count} relationship touches logged`
}

function normalizeSequenceOptions(body: unknown): { id: string; name: string }[] {
  if (!body || typeof body !== 'object') return []
  const payload = body as { data?: unknown }
  const data = payload.data
  const candidate =
    data && typeof data === 'object' && 'sequences' in data
      ? (data as { sequences?: unknown }).sequences
      : data
  return Array.isArray(candidate) ? candidate as { id: string; name: string }[] : []
}

function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function toDateTimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function teamMemberRef(member?: TeamMemberOption): MemberRef | undefined {
  if (!member) return undefined
  return {
    uid: member.uid,
    displayName: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.uid,
    jobTitle: member.jobTitle,
    kind: 'human',
  }
}

export default function PortalContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const companyPickerRef = useRef<HTMLDivElement | null>(null)
  const emailFieldRef = useRef<HTMLInputElement | null>(null)
  const phoneFieldRef = useRef<HTMLInputElement | null>(null)
  const jobTitleFieldRef = useRef<HTMLInputElement | null>(null)
  const departmentFieldRef = useRef<HTMLInputElement | null>(null)
  const timezoneFieldRef = useRef<HTMLInputElement | null>(null)
  const websiteFieldRef = useRef<HTMLInputElement | null>(null)
  const notesFieldRef = useRef<HTMLTextAreaElement | null>(null)
  const stageFieldRef = useRef<HTMLSelectElement | null>(null)
  const ownerFieldRef = useRef<HTMLSelectElement | null>(null)
  const sourceFieldRef = useRef<HTMLSelectElement | null>(null)
  const customFieldsEditRef = useRef<HTMLDivElement | null>(null)
  const [contact, setContact] = useState<ContactRecord | null>(null)
  const [emails, setEmails] = useState<EmailRecord[]>([])
  const [activities, setActivities] = useState<ActivityRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [emailsLoading, setEmailsLoading] = useState(true)
  const [activitiesLoading, setActivitiesLoading] = useState(true)

  // edit-in-place
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [website, setWebsite] = useState('')
  const [timezone, setTimezone] = useState('')
  const [source, setSource] = useState('manual')
  const [type, setType] = useState('lead')
  const [stage, setStage] = useState('new')
  const [assignedTo, setAssignedTo] = useState('')
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([])
  const [tagsInput, setTagsInput] = useState('')
  const [notes, setNotes] = useState('')
  // companyId/companyName for the picker — undefined = not in edit mode yet, '' = clear intent
  const [editCompanyId, setEditCompanyId] = useState<string | undefined>(undefined)
  const [editCompanyName, setEditCompanyName] = useState<string | undefined>(undefined)
  // Custom fields — definitions cached for the page lifecycle; values are part of the edit form
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([])
  const [editCustomFields, setEditCustomFields] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [error, setError] = useState('')
  const [scoreSaving, setScoreSaving] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)

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
        const c = (b.data?.contact ?? b.contact ?? b.data ?? null) as ContactRecord | null
        setContact(c)
        setName(c?.name ?? '')
        setEmail(c?.email ?? '')
        setPhone(c?.phone ?? '')
        setJobTitle(c?.jobTitle ?? '')
        setDepartment(c?.department ?? '')
        setWebsite(c?.website ?? '')
        setTimezone(c?.timezone ?? '')
        setSource(c?.source ?? 'manual')
        setType(c?.type ?? 'lead')
        setStage(c?.stage ?? 'new')
        setAssignedTo(c?.assignedTo ?? c?.assignedToRef?.uid ?? '')
        setTagsInput(Array.isArray(c?.tags) ? c.tags.join(', ') : '')
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
    fetch('/api/v1/portal/settings/team')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setTeamMembers(body?.members ?? []))
      .catch(() => setTeamMembers([]))
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
      const selectedOwnerRef = teamMemberRef(teamMembers.find((member) => member.uid === assignedTo))
      // Build payload — companyId: '' signals clear to the API (FieldValue.delete())
      const payload: Record<string, unknown> = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        jobTitle: jobTitle.trim(),
        department: department.trim(),
        website: website.trim(),
        timezone: timezone.trim(),
        source,
        type,
        stage,
        assignedTo,
        tags: splitTags(tagsInput),
        notes: notes.trim(),
      }
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
          ? {
              ...prev,
              name: name.trim(),
              email: email.trim(),
              phone: phone.trim(),
              jobTitle: jobTitle.trim(),
              department: department.trim(),
              website: website.trim(),
              timezone: timezone.trim(),
              source,
              type,
              stage,
              assignedTo,
              assignedToRef: selectedOwnerRef,
              tags: splitTags(tagsInput),
              notes: notes.trim(),
              companyId: editCompanyId,
              companyName: editCompanyName,
              customFields: editCustomFields,
            }
          : prev,
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function openArchiveConfirmation() {
    setArchiveConfirmOpen(true)
    setError('')
  }

  async function archiveContact() {
    if (!contact) return
    setArchiving(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/crm/contacts/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Archive failed')
      }
      setArchiveConfirmOpen(false)
      router.push('/portal/contacts')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Archive failed')
    } finally {
      setArchiving(false)
    }
  }

  async function handleRecomputeScore() {
    if (!contact) return
    setScoreSaving(true)
    setScoreError(null)
    try {
      const res = await fetch(`/api/v1/crm/contacts/${id}/recompute-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeAi: true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? 'Score recompute failed')
      }
      const body = await res.json() as { data?: { update?: Partial<ContactRecord> } }
      const update = body.data?.update
      if (update) {
        setContact((prev) => prev ? { ...prev, ...update } : prev)
      }
    } catch (err: unknown) {
      setScoreError(err instanceof Error ? err.message : 'Score recompute failed')
    } finally {
      setScoreSaving(false)
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

  function openFirstEmailComposer() {
    setLogType('email_sent')
    setShowAiComposer(false)
    setLogError(null)
  }

  function useAiDraftInComposer() {
    if (!aiDraft) return
    setLogEmailSubject(aiDraft.subject)
    setLogSummary(aiDraft.bodyText)
    openFirstEmailComposer()
  }

  function openFirstCallComposer() {
    setLogType('call')
    setShowAiComposer(false)
    setLogError(null)
  }

  function startSuggestion(suggestion: SuggestionItem) {
    const action = suggestion.action.toLowerCase()
    if (action.includes('follow') || action.includes('proposal') || action.includes('send') || action.includes('chase')) {
      setLogEmailSubject(suggestion.action)
      setLogSummary('')
      openFirstEmailComposer()
      return
    }
    if (action.includes('demo')) {
      setStage('demo')
      focusProfileField(stageFieldRef)
      return
    }
    if (action.includes('qualify') || action.includes('archive')) {
      focusProfileField(stageFieldRef)
      return
    }
    setLogSummary(suggestion.reason)
    openFirstNoteComposer()
  }

  function openFirstNoteComposer() {
    setLogType('note')
    setShowAiComposer(false)
    setLogError(null)
  }

  function openFirstMeetingComposer() {
    if (!meetingStartAt) {
      const start = new Date(Date.now() + 60 * 60 * 1000)
      const end = new Date(start.getTime() + 30 * 60 * 1000)
      setMeetingStartAt(toDateTimeLocalValue(start))
      setMeetingEndAt(toDateTimeLocalValue(end))
      setMeetingTitle(contact?.name ? `Meeting with ${contact.name}` : '')
    }
    setLogType('meeting')
    setShowAiComposer(false)
    setLogError(null)
  }

  function focusCompanyPicker() {
    const companyPicker = companyPickerRef.current
    companyPicker?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    companyPicker?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus()
  }

  function focusProfileField(fieldRef: RefObject<HTMLElement | null>) {
    const field = fieldRef.current
    field?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    field?.focus()
  }

  function focusCustomFields() {
    const section = customFieldsEditRef.current
    section?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    section?.querySelector<HTMLElement>('input, select, textarea')?.focus()
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
    setSequences(normalizeSequenceOptions(b))
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
    (contact.email ?? '') !== email ||
    (contact.phone ?? '') !== phone ||
    (contact.jobTitle ?? '') !== jobTitle ||
    (contact.department ?? '') !== department ||
    (contact.website ?? '') !== website ||
    (contact.timezone ?? '') !== timezone ||
    (contact.source ?? 'manual') !== source ||
    (contact.type ?? 'lead') !== type ||
    (contact.stage ?? 'new') !== stage ||
    (contact.assignedTo ?? contact.assignedToRef?.uid ?? '') !== assignedTo ||
    (Array.isArray(contact.tags) ? contact.tags.join(', ') : '') !== tagsInput ||
    (contact.notes ?? '') !== notes ||
    editCompanyId !== (contact.companyId ?? undefined) ||
    JSON.stringify(editCustomFields) !== JSON.stringify(storedCustomFields)
  const tags = splitTags(tagsInput)
  const contactName = name.trim() || contact.name || 'Unnamed contact'
  const companyLabel = editCompanyName || contact.companyName || contact.company || 'No company linked'
  const hasLinkedCompany = !!(editCompanyId || contact.companyId || editCompanyName || contact.companyName || contact.company)
  const lastTouchDays = daysSince(contact.lastContactedAt)
  const createdDays = daysSince(contact.createdAt)
  const profileFields = [
    name,
    email,
    phone,
    jobTitle,
    department,
    hasLinkedCompany ? companyLabel : '',
    website,
    timezone,
    source,
    type,
    stage,
    assignedTo,
    notes,
    tags.length > 0 ? tags.join(',') : '',
  ]
  const profileStrength = profileFields.filter((value) => String(value ?? '').trim()).length / profileFields.length
  const hasAnyScore = contact.leadScore != null || contact.icpScore != null || contact.aiLeadScore != null
  const bestScore = Math.max(contact.leadScore ?? 0, contact.icpScore ?? 0, contact.aiLeadScore ?? 0)
  const shouldPromptScoreRecompute = !hasAnyScore
  const recentActivityCount = activities.length
  const shouldPromptActivityLog = recentActivityCount === 0
  const sentEmailCount = emails.filter((item) => item.direction !== 'inbound').length
  const receivedEmailCount = emails.filter((item) => item.direction === 'inbound').length
  const shouldPromptFirstEmail = emails.length === 0 && !!email.trim()
  const nextSuggestion = suggestions[0]
  const missingFields = [
    !email.trim() ? 'email' : '',
    !phone.trim() ? 'phone' : '',
    !hasLinkedCompany ? 'company' : '',
    !website.trim() ? 'website' : '',
    !notes.trim() ? 'relationship notes' : '',
  ].filter(Boolean)
  const profileGapAction = !email.trim()
    ? { label: 'Add email', icon: 'alternate_email', ariaLabel: `Add email for ${contactName}`, fieldRef: emailFieldRef }
    : !phone.trim()
      ? { label: 'Add phone', icon: 'call', ariaLabel: `Add phone for ${contactName}`, fieldRef: phoneFieldRef }
      : !website.trim()
        ? { label: 'Add website', icon: 'language', ariaLabel: `Add website for ${contactName}`, fieldRef: websiteFieldRef }
        : !notes.trim()
          ? { label: 'Add notes', icon: 'notes', ariaLabel: `Add notes for ${contactName}`, fieldRef: notesFieldRef }
          : null
  const relationshipSignal =
    lastTouchDays === null
      ? 'No touch logged'
      : lastTouchDays <= 7
        ? 'Warm'
        : lastTouchDays <= 30
          ? 'Follow-up due'
          : 'Cold'
  const shouldPromptTouchLog = lastTouchDays === null || lastTouchDays > 30
  const ownerRef =
    assignedTo && contact.assignedToRef?.uid === assignedTo
      ? contact.assignedToRef
      : teamMemberRef(teamMembers.find((member) => member.uid === assignedTo))
  const sourceLabel = displayLabel(source, SOURCE_LABELS)
  const typeLabel = displayLabel(type, TYPE_LABELS)
  const stageLabel = displayLabel(stage, STAGE_LABELS)
  const detailRows = [
    {
      label: 'Email',
      value: email.trim(),
      empty: 'No email captured',
      actionLabel: 'Add email',
      actionAriaLabel: `Add email from details for ${contactName}`,
      onAction: () => focusProfileField(emailFieldRef),
    },
    {
      label: 'Phone',
      value: phone.trim(),
      empty: 'No phone captured',
      actionLabel: 'Add phone',
      actionAriaLabel: `Add phone from details for ${contactName}`,
      onAction: () => focusProfileField(phoneFieldRef),
    },
    {
      label: 'Linked company',
      value: hasLinkedCompany ? companyLabel : '',
      empty: 'No company linked',
      actionLabel: 'Link company',
      actionAriaLabel: `Link company from details for ${contactName}`,
      onAction: focusCompanyPicker,
    },
    {
      label: 'Website',
      value: website.trim(),
      empty: 'No website captured',
      actionLabel: 'Add website',
      actionAriaLabel: `Add website from details for ${contactName}`,
      onAction: () => focusProfileField(websiteFieldRef),
    },
    {
      label: 'Relationship notes',
      value: notes.trim(),
      empty: 'No relationship notes captured',
      actionLabel: 'Add notes',
      actionAriaLabel: `Add relationship notes from details for ${contactName}`,
      onAction: () => focusProfileField(notesFieldRef),
    },
    { label: 'Source', value: sourceLabel },
    { label: 'Type', value: typeLabel },
    { label: 'Stage', value: stageLabel },
  ]

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link
          href="/portal/contacts"
          className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
        >
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Contacts
        </Link>
        <div className="flex items-center gap-2">
          {email.trim() && (
            <button
              type="button"
              aria-label={`Email ${contactName} from contact command center`}
              onClick={openFirstEmailComposer}
              className="btn-pib-secondary text-xs inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">mail</span>
              Email
            </button>
          )}
          {phone.trim() && (
            <button
              type="button"
              aria-label={`Log call with ${contactName} from contact command center`}
              onClick={openFirstCallComposer}
              className="btn-pib-secondary text-xs inline-flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">call</span>
              Call
            </button>
          )}
          <button
            type="button"
            onClick={openArchiveConfirmation}
            disabled={archiving}
            aria-label={`Archive ${contactName}`}
            className="btn-pib-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">archive</span>
            {archiving ? 'Archiving…' : 'Archive'}
          </button>
        </div>
      </div>

      {archiveConfirmOpen && (
        <section className="bento-card border border-red-500/30 bg-red-500/[0.04] !p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl">
              <p className="eyebrow !text-[10px] text-red-300">Archive contact</p>
              <h2 className="mt-2 font-display text-xl text-[var(--color-pib-text)]">Archive {contactName}?</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                This contact will leave the active CRM list, but relationship history stays available for reporting and audit context.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setArchiveConfirmOpen(false)}
                disabled={archiving}
                className="btn-pib-secondary text-xs disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                aria-label={`Confirm archive for ${contactName}`}
                onClick={archiveContact}
                disabled={archiving}
                className="btn-pib-accent text-xs disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">archive</span>
                {archiving ? 'Archiving…' : 'Confirm archive'}
              </button>
            </div>
          </div>
        </section>
      )}

      <header className="space-y-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] font-display text-2xl text-[var(--color-pib-accent)]">
                {contactName.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="eyebrow">Contact command center</p>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full border-0 bg-transparent p-0 font-display text-3xl tracking-tight text-[var(--color-pib-text)] outline-none md:text-4xl"
                  placeholder="Contact name"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--color-pib-text-muted)]">
                  <span className="inline-flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">business</span>
                    {companyLabel}
                  </span>
                  {!hasLinkedCompany && (
                    <button
                      type="button"
                      aria-label={`Link company for ${contactName}`}
                      onClick={focusCompanyPicker}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-1 text-xs font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
                    >
                      <span className="material-symbols-outlined text-[14px]">add_business</span>
                      Link company
                    </button>
                  )}
                  {email.trim() && (
                    <span className="inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">alternate_email</span>
                      {email.trim()}
                    </span>
                  )}
                  {createdDays !== null && <span>{createdDays === 0 ? 'Created today' : `Created ${createdDays}d ago`}</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill">{stageLabel}</span>
              <span className="pill">{typeLabel}</span>
              <span className="pill">{relationshipSignal}</span>
              {tags.map((t) => (
                <span key={t} className="pill">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="bento-card !p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow !text-[10px]">Profile strength</p>
                <p className="mt-2 font-display text-3xl text-[var(--color-pib-text)]">{fmtPercent(profileStrength)}</p>
              </div>
              <span className="material-symbols-outlined text-3xl text-[var(--color-pib-accent)]">account_circle</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--color-pib-line-strong)]">
              <div
                className="h-full rounded-full bg-[var(--color-pib-accent)] transition-all duration-500"
                style={{ width: fmtPercent(profileStrength) }}
              />
            </div>
            <p className="text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
              {missingFields.length === 0
                ? 'The core contact profile is complete enough for segmentation, scoring, and follow-up.'
                : `Missing ${missingFields.slice(0, 3).join(', ')}${missingFields.length > 3 ? ' and more' : ''}.`}
            </p>
            {profileGapAction && (
              <button
                type="button"
                aria-label={profileGapAction.ariaLabel}
                onClick={() => focusProfileField(profileGapAction.fieldRef)}
                className="btn-pib-secondary inline-flex w-full items-center justify-center gap-1.5 text-xs"
              >
                <span className="material-symbols-outlined text-[14px]">{profileGapAction.icon}</span>
                {profileGapAction.label}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Best score</p>
            <p className="mt-3 font-display text-3xl text-[var(--color-pib-text)]">{hasAnyScore ? bestScore : '—'}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Lead, ICP, or AI signal</p>
            {shouldPromptScoreRecompute && (
              <button
                type="button"
                aria-label={`Recompute score for ${contactName} from best score insight`}
                onClick={handleRecomputeScore}
                disabled={scoreSaving}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-2 py-1.5 text-xs font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)] disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">speed</span>
                {scoreSaving ? 'Scoring…' : 'Recompute score'}
              </button>
            )}
            {scoreError && <p className="mt-2 text-xs text-red-400">{scoreError}</p>}
          </div>
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Last touch</p>
            <p className="mt-3 font-display text-3xl text-[var(--color-pib-text)]">
              {lastTouchDays === null ? '—' : lastTouchDays === 0 ? 'Today' : `${lastTouchDays}d`}
            </p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{relationshipSignal}</p>
            {shouldPromptTouchLog && (
              <button
                type="button"
                aria-label={`Log touch for ${contactName} from last touch insight`}
                onClick={openFirstNoteComposer}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-2 py-1.5 text-xs font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit_note</span>
                Log touch
              </button>
            )}
          </div>
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Email thread</p>
            <p className="mt-3 font-display text-3xl text-[var(--color-pib-text)]">{emails.length}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{sentEmailCount} sent / {receivedEmailCount} received</p>
            {shouldPromptFirstEmail && (
              <button
                type="button"
                aria-label={`Send email to ${contactName} from email thread insight`}
                onClick={openFirstEmailComposer}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-2 py-1.5 text-xs font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">mail</span>
                Send email
              </button>
            )}
          </div>
          <div className="pib-stat-card">
            <p className="eyebrow !text-[10px]">Activity</p>
            <p className="mt-3 font-display text-3xl text-[var(--color-pib-text)]">{recentActivityCount}</p>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{activityMetricCaption(recentActivityCount)}</p>
            {shouldPromptActivityLog && (
              <button
                type="button"
                aria-label={`Log activity for ${contactName} from activity insight`}
                onClick={openFirstNoteComposer}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-2 py-1.5 text-xs font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit_note</span>
                Log activity
              </button>
            )}
          </div>
        </div>

        {(contact.leadScore !== undefined || contact.icpScore !== undefined || contact.aiLeadScore !== undefined || nextSuggestion) && (
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            {(contact.leadScore !== undefined || contact.icpScore !== undefined || contact.aiLeadScore !== undefined) && (
              <div className="bento-card !p-5">
                <p className="eyebrow !text-[10px] mb-3">Scoring</p>
                <div className="flex flex-wrap items-center gap-2">
                  <ScoreChip score={contact.leadScore} kind="lead" label="Lead score (formula)" size="sm" />
                  <ScoreChip score={contact.icpScore} kind="icp" label="ICP match score" size="sm" />
                  {contact.aiLeadScore !== undefined && (
                    <ScoreChip score={contact.aiLeadScore} kind="ai" label="AI lead score" size="sm" />
                  )}
                </div>
              </div>
            )}
            {nextSuggestion && (
              <div className="bento-card !p-5">
                <p className="eyebrow !text-[10px] mb-3">Next best action</p>
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">tips_and_updates</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--color-pib-text)]">{nextSuggestion.action}</p>
                    <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{nextSuggestion.reason}</p>
                    <button
                      type="button"
                      onClick={() => startSuggestion(nextSuggestion)}
                      aria-label={`Act on top recommendation: ${nextSuggestion.action} for ${contactName}`}
                      className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">play_arrow</span>
                      Start action
                    </button>
                  </div>
                </div>
              </div>
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
              emptyAction={{
                label: 'Link company',
                ariaLabel: `Link company from company card for ${contactName}`,
                icon: 'add_business',
                onClick: focusCompanyPicker,
              }}
            />
          </div>

          <div className="bento-card !p-5 space-y-3 text-sm">
            <p className="eyebrow !text-[10px]">Details</p>
            {detailRows.map((row) => (
              <div key={row.label} className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.015] p-3">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                  {row.label}
                </p>
                {row.value ? (
                  <p className="text-[var(--color-pib-text)] mt-1 break-words">{row.value}</p>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[var(--color-pib-text-muted)]">{row.empty}</p>
                    {row.onAction && (
                      <button
                        type="button"
                        aria-label={row.actionAriaLabel}
                        onClick={row.onAction}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
                      >
                        <span className="material-symbols-outlined text-[13px]">add</span>
                        {row.actionLabel}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
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

          <ContactIdentityPanel
            profile={{
              jobTitle,
              department,
              timezone,
              phoneVerified: contact.phoneVerified,
              smsOptedIn: contact.smsOptedIn && !contact.smsUnsubscribedAt,
              unsubscribedAt: contact.unsubscribedAt,
              bouncedAt: contact.bouncedAt,
              repliesCount: contact.repliesCount,
            }}
            fieldActions={{
              jobTitle: {
                label: 'Add role',
                ariaLabel: `Add role for ${contactName} from identity intelligence`,
                onClick: () => focusProfileField(jobTitleFieldRef),
              },
              department: {
                label: 'Add department',
                ariaLabel: `Add department for ${contactName} from identity intelligence`,
                onClick: () => focusProfileField(departmentFieldRef),
              },
              timezone: {
                label: 'Add timezone',
                ariaLabel: `Add timezone for ${contactName} from identity intelligence`,
                onClick: () => focusProfileField(timezoneFieldRef),
              },
            }}
          />

          <ContactOwnershipPanel
            profile={{
              assignedTo,
              assignedToRef: ownerRef,
              source,
              capturedFromId: contact.capturedFromId,
              createdByRef: contact.createdByRef,
              updatedByRef: contact.updatedByRef,
            }}
            actions={{
              assignOwner: {
                label: 'Assign owner',
                ariaLabel: `Assign owner for ${contactName} from relationship ownership`,
                onClick: () => focusProfileField(ownerFieldRef),
              },
              reviewSource: {
                label: 'Review source',
                ariaLabel: `Review source provenance for ${contactName} from relationship ownership`,
                onClick: () => focusProfileField(sourceFieldRef),
              },
            }}
          />

          {customFieldDefs.length > 0 && (
            <div className="bento-card !p-5 space-y-3 text-sm">
              <p className="eyebrow !text-[10px]">Custom fields</p>
              <CustomFieldsSection
                definitions={customFieldDefs}
                values={storedCustomFields}
                mode="read"
                emptyAction={{
                  label: 'Capture fields',
                  ariaLabel: `Capture custom fields for ${contactName}`,
                  onClick: focusCustomFields,
                }}
              />
            </div>
          )}

          <div className="bento-card !p-5 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow !text-[10px]">Edit profile</p>
              {dirty && <span className="text-[11px] text-[var(--color-pib-accent)]">Unsaved changes</span>}
            </div>

            <div className="space-y-1 pt-1">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                Name
              </p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="pib-input w-full"
                placeholder="Contact name"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 pt-1">
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                  Email
                </p>
                <input
                  ref={emailFieldRef}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pib-input w-full"
                  placeholder="name@example.com"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                  Phone
                </p>
                <input
                  ref={phoneFieldRef}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="pib-input w-full"
                  placeholder="+27..."
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                  Job title
                </p>
                <input
                  ref={jobTitleFieldRef}
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="pib-input w-full"
                  placeholder="Decision maker, Finance Director..."
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                  Department
                </p>
                <input
                  ref={departmentFieldRef}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="pib-input w-full"
                  placeholder="Finance, Operations..."
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                  Timezone
                </p>
                <input
                  ref={timezoneFieldRef}
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="pib-input w-full"
                  placeholder="Africa/Johannesburg"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                  Website
                </p>
                <input
                  ref={websiteFieldRef}
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="pib-input w-full"
                  placeholder="https://..."
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Source</p>
                <select ref={sourceFieldRef} value={source} onChange={(e) => setSource(e.target.value)} className="pib-input w-full">
                  {SOURCE_OPTIONS.map((option) => <option key={option} value={option} className="bg-black">{displayLabel(option, SOURCE_LABELS)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Type</p>
                <select value={type} onChange={(e) => setType(e.target.value)} className="pib-input w-full">
                  {TYPE_OPTIONS.map((option) => <option key={option} value={option} className="bg-black">{displayLabel(option, TYPE_LABELS)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Stage</p>
                <select ref={stageFieldRef} value={stage} onChange={(e) => setStage(e.target.value)} className="pib-input w-full">
                  {STAGE_OPTIONS.map((option) => <option key={option} value={option} className="bg-black">{displayLabel(option, STAGE_LABELS)}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1 pt-1">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                Owner
              </p>
              <select ref={ownerFieldRef} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="pib-input w-full">
                <option value="" className="bg-black">Unassigned</option>
                {teamMembers.map((member) => {
                  const name = [member.firstName, member.lastName].filter(Boolean).join(' ') || member.uid
                  const label = member.jobTitle ? `${name} · ${member.jobTitle}` : name
                  return (
                    <option key={member.uid} value={member.uid} className="bg-black">
                      {label}
                    </option>
                  )
                })}
              </select>
            </div>

            <div className="space-y-1 pt-1">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                Tags
              </p>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                className="pib-input w-full"
                placeholder="priority, referral, decision maker"
              />
            </div>

            {/* Company picker — above legacy company string field */}
            <div ref={companyPickerRef} className="space-y-1">
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
                ref={notesFieldRef}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                placeholder="Add a note about this contact…"
                className="pib-input resize-none w-full"
              />
            </div>

            {customFieldDefs.length > 0 && (
              <div ref={customFieldsEditRef} className="space-y-1 pt-1">
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
          <ContactEngagementPanel
            profile={{
              lastContactedAt: contact.lastContactedAt,
              emails,
              activities,
              nextSuggestion,
            }}
            actions={{
              contactName,
              onLogNote: openFirstNoteComposer,
              onSendEmail: email.trim() ? openFirstEmailComposer : undefined,
              onScheduleMeeting: openFirstMeetingComposer,
              onStartSuggestion: startSuggestion,
            }}
          />

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
                <span className="material-symbols-outlined inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[20px] text-[var(--color-pib-accent)]">
                  mail
                </span>
                <p className="mt-3 text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                  Email trail missing
                </p>
                <h3 className="mt-1 text-base font-semibold text-[var(--color-pib-text)]">Start the first outreach thread</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  Send the first message so future replies, campaign touches, and account history are visible to every team member working this relationship.
                </p>
                {contact.email ? (
                  <button
                    type="button"
                    onClick={openFirstEmailComposer}
                    aria-label={`Send first email to ${contact.name ?? 'this contact'}`}
                    className="btn-pib-primary mt-4 inline-flex items-center gap-1.5 text-xs"
                  >
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">outgoing_mail</span>
                    Send first email
                  </button>
                ) : (
                  <p className="mx-auto mt-3 max-w-sm text-xs text-[var(--color-pib-text-muted)]">
                    Add an email address in the profile panel before starting outreach.
                  </p>
                )}
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
                      <button
                        type="button"
                        onClick={() => startSuggestion(s)}
                        aria-label={`Start suggested action: ${s.action} for ${contactName}`}
                        className="btn-pib-secondary mt-2 inline-flex items-center gap-1.5 text-xs"
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">play_arrow</span>
                        Start action
                      </button>
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
                        openFirstMeetingComposer()
                        return
                      }
                      setLogType(type)
                    }}
                    className={`btn-pib-secondary text-xs flex items-center gap-1 ${logType === type ? 'ring-1 ring-[var(--color-pib-accent)]' : ''}`}
                  >
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{icon}</span>
                    {label}
                  </button>
                ))}
                <button onClick={() => setShowAiComposer((v) => !v)} className="btn-pib-secondary text-xs flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">auto_awesome</span>
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
                      placeholder={activityNotesPlaceholder(logType)}
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
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">content_copy</span>
                        Copy to clipboard
                      </button>
                      <button
                        type="button"
                        onClick={useAiDraftInComposer}
                        aria-label={`Use AI draft in email composer for ${contactName}`}
                        className="btn-pib-accent text-xs inline-flex items-center gap-1.5"
                      >
                        <span className="material-symbols-outlined text-[14px]" aria-hidden="true">outgoing_mail</span>
                        Use draft
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
              <div className="p-10">
                <div className="mx-auto flex max-w-lg flex-col items-center gap-3 text-center">
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined flex h-10 w-10 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[20px] text-[var(--color-pib-accent)]"
                  >
                    history
                  </span>
                  <div>
                    <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      Relationship timeline missing
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-[var(--color-pib-text)]">Start the first contact note</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                      Log the first note, call, email, or meeting so the whole team can see what happened, who followed up, and what should happen next.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openFirstNoteComposer}
                    aria-label={`Start activity trail for ${contact.name ?? 'this contact'}`}
                    className="btn-pib-primary mt-4 inline-flex items-center gap-1.5 text-xs"
                  >
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">edit_note</span>
                    Start activity trail
                  </button>
                </div>
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
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">add</span>
                Enroll
              </button>
            </div>
            {enrollmentsLoading ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">Loading…</p>
            ) : enrollments.length === 0 ? (
              <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">
                    automation
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      Nurture gap
                    </p>
                    <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">No nurture workflow enrolled</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                      Enroll {contactName} into a sequence when outreach should happen on a repeatable cadence instead of relying on one-off reminders.
                    </p>
                    <button
                      type="button"
                      aria-label={`Choose nurture sequence for ${contactName}`}
                      onClick={handleOpenEnrollModal}
                      className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">add</span>
                      Choose sequence
                    </button>
                  </div>
                </div>
              </div>
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
                aria-label="Enroll contact"
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
