'use client'
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
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

interface RelationshipRiskItem {
  title: string
  body: string
  icon: string
  actionLabel: string
  actionAriaLabel: string
  onAction: () => void | Promise<void>
  disabled?: boolean
}

function ContactSetupReviewCard({
  contactName,
  onReviewProfile,
}: {
  contactName: string
  onReviewProfile: () => void
}) {
  return (
    <section
      role="region"
      aria-label={`Contact setup review for ${contactName}`}
      className="rounded-[var(--radius-card)] border border-amber-500/25 bg-amber-500/[0.07] p-5"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <span className="material-symbols-outlined mt-0.5 text-amber-200" aria-hidden="true">rule_settings</span>
          <div>
            <p className="eyebrow !text-[10px] text-amber-200">Contact hygiene</p>
            <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">Contact setup needs review</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
              <span className="font-medium text-[var(--color-pib-text)]">{contactName}</span> looks like smoke-test contact data.
              Review the profile before the team treats this as a real relationship.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onReviewProfile}
          className="btn-pib-secondary inline-flex shrink-0 items-center gap-1.5 text-sm"
          aria-label={`Review contact setup for ${contactName}`}
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">edit</span>
          Review profile
        </button>
      </div>
    </section>
  )
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
const EMAIL_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  queued: 'Queued',
  queued_for_retry: 'Queued for retry',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  opened: 'Opened',
  clicked: 'Clicked',
  replied: 'Replied',
  bounced: 'Bounced',
  hard_bounce: 'Hard bounce',
  soft_bounce: 'Soft bounce',
  failed: 'Failed',
  suppressed: 'Suppressed',
  unsubscribed: 'Unsubscribed',
}
const INBOUND_EMAIL_DIRECTIONS = new Set(['inbound', 'incoming', 'incoming_reply', 'received', 'email_received', 'reply'])

function emailDirectionKind(email: EmailRecord): 'sent' | 'received' {
  const key = email.direction?.trim().toLowerCase()
  return key && INBOUND_EMAIL_DIRECTIONS.has(key) ? 'received' : 'sent'
}

function emailDirectionLabel(email: EmailRecord): string {
  return emailDirectionKind(email) === 'received' ? 'Received email' : 'Sent email'
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

function websiteHref(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function isContactSetupArtifact(contact: Pick<ContactRecord, 'name' | 'email'>): boolean {
  const haystack = [contact.name, contact.email]
    .map((value) => value?.trim().toLowerCase() ?? '')
    .filter(Boolean)
    .join(' ')
  if (!haystack) return false
  return /\b(smoke|test|fixture|delete)\b/.test(haystack)
}

function readableStatusLabel(value?: string): string {
  const key = value?.trim()
  if (!key) return 'Enrollment status not set'
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

function activityNotesPlaceholder(logType: string): string {
  if (logType === 'note') return 'Add a relationship note, handoff, or context…'
  if (logType === 'call') return 'Add call notes…'
  return `Add ${logType} notes…`
}

function activityNotesFieldName(logType: string, contactName: string): string {
  if (logType === 'note') return `Relationship note for ${contactName}`
  if (logType === 'call') return `Call notes for ${contactName}`
  if (logType === 'sms') return `SMS message for ${contactName}`
  return `Activity notes for ${contactName}`
}

function activityComposerActionName(logType: string, contactName: string): string {
  if (logType === 'email_sent') return `Send email to ${contactName} from activity composer`
  if (logType === 'sms') return `Send SMS to ${contactName} from activity composer`
  if (logType === 'meeting') return `Schedule meeting with ${contactName} from activity composer`
  if (logType === 'call') return `Log call with ${contactName} from activity composer`
  return `Save note for ${contactName} from activity composer`
}

function activityComposerCancelName(logType: string, contactName: string): string {
  if (logType === 'email_sent') return `Cancel email composer for ${contactName}`
  if (logType === 'sms') return `Cancel SMS composer for ${contactName}`
  if (logType === 'meeting') return `Cancel meeting composer for ${contactName}`
  if (logType === 'call') return `Cancel call composer for ${contactName}`
  return `Cancel note composer for ${contactName}`
}

function activityMetricCaption(count: number): string {
  if (count === 0) return 'No relationship history yet'
  return count === 1 ? '1 relationship touch logged' : `${count} relationship touches logged`
}

function emailTimeLabel(email: EmailRecord): string {
  return fmtTimestamp(email.sentAt) || fmtTimestamp(email.createdAt) || 'Email time not captured'
}

function emailSubjectLabel(email: EmailRecord): string {
  return email.subject?.trim() || 'Email subject missing'
}

function emailFollowUpSubject(email: EmailRecord): string {
  const subject = email.subject?.trim()
  if (!subject) return ''
  return subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`
}

function emailStatusLabel(email: EmailRecord): string {
  const key = email.status?.trim()
  if (!key) return 'Email status not captured'
  const fallback = key.replace(/[_-]+/g, ' ').trim()
  return EMAIL_STATUS_LABELS[key] ?? (fallback ? fallback.charAt(0).toUpperCase() + fallback.slice(1) : 'Email status not captured')
}

function activityTimeLabel(activity: ActivityRecord): string {
  return fmtTimestamp(activity.createdAt) || 'Activity time not captured'
}

function activitySummaryLabel(activity: ActivityRecord): string {
  const summary = activity.summary?.trim() || activity.notes?.trim()
  if (summary) return summary
  return 'Activity summary missing'
}

function activityContinuationNote(activity: ActivityRecord): string {
  const summary = activity.summary?.trim() || activity.notes?.trim()
  if (!summary) return ''
  return `Follow-up from: ${summary}`
}

function activityActorLabel(activity: ActivityRecord): string {
  if (activity.createdByRef?.displayName?.trim()) return activity.createdByRef.displayName
  if (activity.createdByRef?.uid?.trim()) return 'Activity actor identity missing'
  return 'Activity actor not captured'
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
  const displayName = teamMemberDisplayLabel(member)
  return {
    uid: member.uid,
    displayName,
    jobTitle: member.jobTitle,
    kind: 'human',
  }
}

function teamMemberDisplayLabel(member: TeamMemberOption): string {
  const name = [member.firstName, member.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
  if (name) return member.jobTitle?.trim() ? `${name} · ${member.jobTitle.trim()}` : name
  return member.jobTitle?.trim()
    ? `Team member identity missing · ${member.jobTitle.trim()}`
    : 'Team member identity missing'
}

export default function PortalContactDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyPickerRef = useRef<HTMLDivElement | null>(null)
  const nameFieldRef = useRef<HTMLInputElement | null>(null)
  const emailFieldRef = useRef<HTMLInputElement | null>(null)
  const phoneFieldRef = useRef<HTMLInputElement | null>(null)
  const jobTitleFieldRef = useRef<HTMLInputElement | null>(null)
  const departmentFieldRef = useRef<HTMLInputElement | null>(null)
  const timezoneFieldRef = useRef<HTMLInputElement | null>(null)
  const websiteFieldRef = useRef<HTMLInputElement | null>(null)
  const notesFieldRef = useRef<HTMLTextAreaElement | null>(null)
  const typeFieldRef = useRef<HTMLSelectElement | null>(null)
  const stageFieldRef = useRef<HTMLSelectElement | null>(null)
  const tagsFieldRef = useRef<HTMLInputElement | null>(null)
  const ownerFieldRef = useRef<HTMLSelectElement | null>(null)
  const sourceFieldRef = useRef<HTMLSelectElement | null>(null)
  const customFieldsEditRef = useRef<HTMLDivElement | null>(null)
  const activityComposerRef = useRef<HTMLDivElement | null>(null)
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
  const meetingStartTime = meetingStartAt ? new Date(meetingStartAt).getTime() : null
  const meetingEndTime = meetingEndAt ? new Date(meetingEndAt).getTime() : null
  const meetingTimingError = (
    meetingStartTime !== null &&
    meetingEndTime !== null &&
    Number.isFinite(meetingStartTime) &&
    Number.isFinite(meetingEndTime) &&
    meetingEndTime <= meetingStartTime
  )
    ? 'Meeting end time must be after the start time.'
    : null

  // B1: Activity page for load-more
  const [activityPage, setActivityPage] = useState(1)

  // C1: Smart next-action suggestions
  interface SuggestionItem {
    action: string
    reason: string
    urgency: 'high' | 'medium' | 'low'
  }
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const suggestionActionLabel = (suggestion: SuggestionItem): string => (
    suggestion.action?.trim() || 'Suggested action missing'
  )
  const suggestionReasonLabel = (suggestion: SuggestionItem): string => (
    suggestion.reason?.trim() || 'Suggestion reason missing'
  )

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
  const [enrollError, setEnrollError] = useState('')
  const [pendingUnenrollId, setPendingUnenrollId] = useState<string | null>(null)
  const [unenrollError, setUnenrollError] = useState('')
  const [contactFetchError, setContactFetchError] = useState('')

  const loadContact = useCallback(async (cancelled?: () => boolean) => {
    if (!id) return
    setLoading(true)
    setContactFetchError('')
    try {
      const r = await fetch(`/api/v1/crm/contacts/${id}`)
      const b = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(typeof b?.error === 'string' ? b.error : `HTTP ${r.status}`)
      }
      const c = (b.data?.contact ?? b.contact ?? b.data ?? null) as ContactRecord | null
      if (cancelled?.()) return
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
    } catch (err) {
      if (!cancelled?.()) {
        setContact(null)
        setContactFetchError(err instanceof Error ? err.message : 'Contact details failed to load.')
      }
    } finally {
      if (!cancelled?.()) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    let cancelled = false

    void loadContact(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [loadContact])

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

  useEffect(() => {
    if (searchParams.get('activity') !== 'note') return
    setLogType('note')
    setShowAiComposer(false)
    setLogError(null)
  }, [searchParams])

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

  function resetProfileEdits() {
    if (!contact) return
    setName(contact.name ?? '')
    setEmail(contact.email ?? '')
    setPhone(contact.phone ?? '')
    setJobTitle(contact.jobTitle ?? '')
    setDepartment(contact.department ?? '')
    setWebsite(contact.website ?? '')
    setTimezone(contact.timezone ?? '')
    setSource(contact.source ?? 'manual')
    setType(contact.type ?? 'lead')
    setStage(contact.stage ?? 'new')
    setAssignedTo(contact.assignedTo ?? contact.assignedToRef?.uid ?? '')
    setTagsInput(Array.isArray(contact.tags) ? contact.tags.join(', ') : '')
    setNotes(contact.notes ?? '')
    setEditCompanyId(contact.companyId ?? undefined)
    setEditCompanyName(contact.companyName ?? undefined)
    setEditCustomFields((contact.customFields as Record<string, unknown>) ?? {})
    setError('')
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

  function openEmailFollowUp(email: EmailRecord) {
    setLogEmailSubject(emailFollowUpSubject(email))
    setLogSummary('')
    openFirstEmailComposer()
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
    const actionLabel = suggestionActionLabel(suggestion)
    const reasonLabel = suggestionReasonLabel(suggestion)
    const action = actionLabel.toLowerCase()
    if (action.includes('follow') || action.includes('proposal') || action.includes('send') || action.includes('chase')) {
      setLogEmailSubject(actionLabel)
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
    setLogSummary(reasonLabel)
    openFirstNoteComposer()
  }

  function openFirstNoteComposer() {
    setLogType('note')
    setShowAiComposer(false)
    setLogError(null)
  }

  function continueFromActivity(activity: ActivityRecord) {
    setLogSummary(activityContinuationNote(activity))
    openFirstNoteComposer()
  }

  function openFirstMeetingComposer() {
    if (!meetingStartAt) {
      const start = new Date(Date.now() + 60 * 60 * 1000)
      const end = new Date(start.getTime() + 30 * 60 * 1000)
      setMeetingStartAt(toDateTimeLocalValue(start))
      setMeetingEndAt(toDateTimeLocalValue(end))
      setMeetingTitle(`Meeting with ${contactName}`)
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
    const focusTarget = field?.matches('input, select, textarea, button')
      ? field
      : field?.querySelector<HTMLElement>('input, select, textarea, button')
    focusTarget?.focus()
  }

  function focusCustomFields() {
    const section = customFieldsEditRef.current
    section?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    section?.querySelector<HTMLElement>('input, select, textarea')?.focus()
  }

  useEffect(() => {
    if (!logType) return

    const frame = window.requestAnimationFrame(() => {
      const composer = activityComposerRef.current
      composer?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      composer?.querySelector<HTMLElement>('input, textarea, select')?.focus()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [logType])

  async function handleLogActivity() {
    setLogSaving(true)
    setLogError(null)
    try {
      if (logType === 'email_sent') {
        if (!email.trim() || !logEmailSubject.trim() || !logSummary.trim()) return
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
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return
        const title = meetingTitle.trim() || `Meeting with ${contactName}`
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
        if (logType === 'call' && !phone.trim()) return
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
    setEnrollError('')
    setShowEnrollModal(true)
  }

  async function handleEnroll() {
    if (!enrollingSequenceId) return
    setEnrolling(true)
    setEnrollError('')
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
    } catch (err) {
      setEnrollError(err instanceof Error ? err.message : 'Enrollment failed')
    } finally {
      setEnrolling(false)
    }
  }

  async function handleUnenroll(enrollmentId: string) {
    const enrollment = enrollments.find((e) => e.id === enrollmentId)
    if (!enrollment?.sequenceId) return
    setUnenrollError('')
    try {
      const res = await fetch(`/api/v1/crm/sequences/${enrollment.sequenceId}/enrollments/${enrollmentId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Unenrollment failed')
      }
      setEnrollments((prev) => prev.filter((e) => e.id !== enrollmentId))
      setPendingUnenrollId(null)
    } catch (err) {
      setUnenrollError(err instanceof Error ? err.message : 'Unenrollment failed')
    }
  }

  if (loading) {
    return (
      <section
        role="status"
        aria-label="Contact detail loading state"
        className="space-y-6"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link
            href="/portal/contacts"
            className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] inline-flex items-center gap-1 transition-colors"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">arrow_back</span>
            Contacts
          </Link>
          <div className="flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)]">
            <span className="material-symbols-outlined text-[16px] text-[var(--color-pib-accent)]" aria-hidden="true">sync</span>
            Loading CRM relationship
          </div>
        </div>

        <div className="bento-card !p-6">
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)]">
                <div className="pib-skeleton h-8 w-8 rounded-md" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="eyebrow">Contact command center</p>
                <h1 className="mt-2 font-display text-3xl tracking-tight text-[var(--color-pib-text)] md:text-4xl">
                  Preparing contact command center
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  Loading relationship profile, owner coverage, activity, deals, and nurture context.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['Profile', 'Owner', 'Activity', 'Deals'].map((label) => (
                    <span key={label} className="pill">
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.03] p-4">
              <p className="eyebrow !text-[10px]">Relationship readiness</p>
              <div className="mt-4 space-y-3">
                {['Profile strength', 'Last touch', 'Email thread', 'Activity'].map((label) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[var(--color-pib-text-muted)]">{label}</span>
                    <span className="pib-skeleton h-3 w-16 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            ['Relationship profile', 'Identity, contact routes, company, and owner accountability.'],
            ['Activity timeline', 'Recent notes, calls, messages, and the next relationship move.'],
            ['Pipeline context', 'Deals, forecast value, sequence enrollment, and follow-up cadence.'],
          ].map(([title, body]) => (
            <div key={title} className="bento-card !p-5">
              <div className="mb-4 h-2 overflow-hidden rounded-full bg-[var(--color-pib-line-strong)]">
                <div className="h-full w-2/3 rounded-full bg-[var(--color-pib-accent)]" />
              </div>
              <h2 className="font-display text-lg text-[var(--color-pib-text)]">{title}</h2>
              <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{body}</p>
              <div className="mt-4 space-y-2">
                <div className="pib-skeleton h-3 w-full rounded-full" />
                <div className="pib-skeleton h-3 w-2/3 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </section>
    )
  }

  if (!contact) {
    if (contactFetchError) {
      return (
        <section className="bento-card border-amber-400/25 bg-amber-400/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-400/25 bg-amber-400/10 text-amber-200">
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">warning</span>
              </span>
              <div>
                <p className="eyebrow !text-[10px] text-amber-200">Source health</p>
                <h2 className="mt-1 font-display text-xl text-[var(--color-pib-text)]">
                  Contact details could not load
                </h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">{contactFetchError}</p>
                <p className="mt-3 text-xs leading-5 text-[var(--color-pib-text-muted)]">
                  Relationship profile, activity, scoring, and follow-up controls stay hidden until the contact source responds, so leaders do not mistake a data outage for a missing CRM relationship.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadContact()}
                aria-label="Retry loading contact details"
                className="cursor-pointer btn-pib-secondary flex items-center gap-1.5 text-sm"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">refresh</span>
                Retry
              </button>
              <Link href="/portal/contacts" className="btn-pib-secondary text-sm">
                <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_back</span>
                Back to contacts
              </Link>
            </div>
          </div>
        </section>
      )
    }

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
  const hasContactName = Boolean(name.trim() || contact.name?.trim())
  const contactName = name.trim() || contact.name?.trim() || 'Unnamed contact'
  const contactNeedsSetupReview = isContactSetupArtifact({ name: contactName, email })
  const linkedCompanyId = editCompanyId || contact.companyId || ''
  const companyNameValue = editCompanyName || contact.companyName || contact.company || ''
  const companyLabel = companyNameValue || 'No company linked'
  const hasLinkedCompany = Boolean(linkedCompanyId)
  const hasCompanyContext = Boolean(companyNameValue)
  const lastTouchDays = daysSince(contact.lastContactedAt)
  const createdDays = daysSince(contact.createdAt)
  const profileFields = [
    name,
    email,
    phone,
    jobTitle,
    department,
    hasLinkedCompany || hasCompanyContext ? companyLabel : '',
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
  const bestScoreLabel = hasAnyScore ? String(bestScore) : 'Not scored'
  const shouldPromptScoreRecompute = !hasAnyScore
  const recentActivityCount = activities.length
  const shouldPromptActivityLog = recentActivityCount === 0
  const sentEmailCount = emails.filter((item) => emailDirectionKind(item) === 'sent').length
  const receivedEmailCount = emails.filter((item) => emailDirectionKind(item) === 'received').length
  const shouldPromptFirstEmail = emails.length === 0 && !!email.trim()
  const nextSuggestion = suggestions[0]
  const missingFields = [
    !email.trim() ? 'email' : '',
    !phone.trim() ? 'phone' : '',
    !hasLinkedCompany ? 'company' : '',
    !assignedTo ? 'owner' : '',
    !website.trim() ? 'website' : '',
    !notes.trim() ? 'relationship notes' : '',
  ].filter(Boolean)
  const profileGapAction = !email.trim()
    ? { label: 'Add email', icon: 'alternate_email', ariaLabel: `Add email for ${contactName}`, fieldRef: emailFieldRef }
    : !phone.trim()
      ? { label: 'Add phone', icon: 'call', ariaLabel: `Add phone for ${contactName}`, fieldRef: phoneFieldRef }
      : !hasLinkedCompany
        ? { label: 'Link company', icon: 'add_business', ariaLabel: `Link company for ${contactName} from profile strength`, fieldRef: companyPickerRef }
        : !assignedTo
          ? { label: 'Assign owner', icon: 'assignment_ind', ariaLabel: `Assign owner for ${contactName} from profile strength`, fieldRef: ownerFieldRef }
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
  const lastTouchLabel = lastTouchDays === null ? 'No touch yet' : lastTouchDays === 0 ? 'Today' : `${lastTouchDays}d`
  const shouldPromptTouchLog = lastTouchDays === null || lastTouchDays > 30
  const shouldPromptLastContactedRefresh = lastTouchDays !== null && lastTouchDays > 30
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
      href: email.trim() ? `mailto:${email.trim()}` : '',
      empty: 'No email captured',
      actionLabel: 'Add email',
      actionAriaLabel: `Add email from details for ${contactName}`,
      onAction: () => focusProfileField(emailFieldRef),
    },
    {
      label: 'Phone',
      value: phone.trim(),
      href: phone.trim() ? `tel:${phone.trim()}` : '',
      empty: 'No phone captured',
      actionLabel: 'Add phone',
      actionAriaLabel: `Add phone from details for ${contactName}`,
      onAction: () => focusProfileField(phoneFieldRef),
    },
    {
      label: 'Linked company',
      value: hasLinkedCompany || hasCompanyContext ? companyLabel : '',
      empty: 'No company linked',
      actionLabel: 'Link company',
      actionAriaLabel: `Link company from details for ${contactName}`,
      onAction: focusCompanyPicker,
      needsActionWhenValued: !hasLinkedCompany,
    },
    {
      label: 'Website',
      value: website.trim(),
      href: websiteHref(website),
      external: true,
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
  const relationshipRiskItems = ([
    !assignedTo
      ? {
          title: 'No accountable owner',
          body: 'Assign a team member so follow-up has a named owner.',
          icon: 'assignment_ind',
          actionLabel: 'Assign owner',
          actionAriaLabel: `Assign owner for ${contactName} from relationship risk brief`,
          onAction: () => focusProfileField(ownerFieldRef),
        }
      : null,
    !hasLinkedCompany
      ? {
          title: 'No linked company',
          body: 'Link this person to an account so revenue, documents, and delivery context roll up.',
          icon: 'add_business',
          actionLabel: 'Link company',
          actionAriaLabel: `Link company for ${contactName} from relationship risk brief`,
          onAction: focusCompanyPicker,
        }
      : null,
    lastTouchDays === null
      ? {
          title: 'No relationship touch logged',
          body: 'Record the first note, call, email, or meeting so the team can see relationship history.',
          icon: 'edit_note',
          actionLabel: 'Log touch',
          actionAriaLabel: `Log relationship touch for ${contactName} from relationship risk brief`,
          onAction: openFirstNoteComposer,
        }
      : null,
    !hasAnyScore
      ? {
          title: 'No score available',
          body: 'Run scoring so leadership can compare this contact against pipeline quality.',
          icon: 'speed',
          actionLabel: 'Recompute score',
          actionAriaLabel: `Recompute score for ${contactName} from relationship risk brief`,
          onAction: handleRecomputeScore,
          disabled: scoreSaving,
        }
      : null,
  ] as Array<RelationshipRiskItem | null>).filter((item): item is RelationshipRiskItem => Boolean(item))

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

      {contactNeedsSetupReview && (
        <ContactSetupReviewCard
          contactName={contactName}
          onReviewProfile={() => focusProfileField(nameFieldRef)}
        />
      )}

      {archiveConfirmOpen && (
        <section
          role="alertdialog"
          aria-labelledby="portal-contact-archive-title"
          aria-describedby="portal-contact-archive-description"
          className="bento-card border border-red-500/30 bg-red-500/[0.04] !p-5"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl">
              <p className="eyebrow !text-[10px] text-red-300">Archive contact</p>
              <h2 id="portal-contact-archive-title" className="mt-2 font-display text-xl text-[var(--color-pib-text)]">Archive {contactName}?</h2>
              <p id="portal-contact-archive-description" className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                This contact will leave the active CRM list, but relationship history stays available for reporting and audit context.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setArchiveConfirmOpen(false)}
                disabled={archiving}
                className="btn-pib-secondary text-xs disabled:opacity-50"
                aria-label={`Cancel archive for ${contactName}`}
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
                  ref={nameFieldRef}
                  aria-label={`Rename ${contactName} from contact header`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-2 w-full border-0 bg-transparent p-0 font-display text-3xl tracking-tight text-[var(--color-pib-text)] outline-none md:text-4xl"
                  placeholder="Contact name"
                />
                {!hasContactName && (
                  <p className="mt-1 text-sm font-medium text-[var(--color-pib-accent)]">Unnamed contact</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--color-pib-text-muted)]">
                  {hasLinkedCompany ? (
                    <Link
                      href={`/portal/companies/${encodeURIComponent(linkedCompanyId)}`}
                      aria-label={`Open linked company ${companyLabel} from contact header`}
                      className="inline-flex items-center gap-1 text-[var(--color-pib-accent)] transition-colors hover:text-[var(--color-pib-text)]"
                    >
                      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">business</span>
                      {companyLabel}
                    </Link>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">business</span>
                      {companyLabel}
                    </span>
                  )}
                  {phone.trim() && (
                    <a
                      href={`tel:${phone.trim()}`}
                      aria-label={`Call ${phone.trim()} from contact header`}
                      className="inline-flex items-center gap-1 text-[var(--color-pib-accent)] transition-colors hover:text-[var(--color-pib-text)]"
                    >
                      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">call</span>
                      {phone.trim()}
                    </a>
                  )}
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
                    <a
                      href={`mailto:${email.trim()}`}
                      aria-label={`Email ${email.trim()} from contact header`}
                      className="inline-flex items-center gap-1 text-[var(--color-pib-accent)] transition-colors hover:text-[var(--color-pib-text)]"
                    >
                      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">alternate_email</span>
                      {email.trim()}
                    </a>
                  )}
                  {createdDays !== null && <span>{createdDays === 0 ? 'Created today' : `Created ${createdDays}d ago`}</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-label={`Edit lifecycle stage ${stageLabel} for ${contactName}`}
                onClick={() => focusProfileField(stageFieldRef)}
                className="pill cursor-pointer transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
              >
                {stageLabel}
              </button>
              <button
                type="button"
                aria-label={`Edit contact type ${typeLabel} for ${contactName}`}
                onClick={() => focusProfileField(typeFieldRef)}
                className="pill cursor-pointer transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
              >
                {typeLabel}
              </button>
              <button
                type="button"
                aria-label={`Log activity from relationship signal ${relationshipSignal} for ${contactName}`}
                onClick={openFirstNoteComposer}
                className="pill cursor-pointer transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
              >
                {relationshipSignal}
              </button>
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-label={`Edit tag ${t} for ${contactName}`}
                  onClick={() => focusProfileField(tagsFieldRef)}
                  className="pill cursor-pointer transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
                >
                  {t}
                </button>
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
            <p className={`mt-3 font-display text-[var(--color-pib-text)] ${hasAnyScore ? 'text-3xl' : 'text-2xl'}`}>
              {bestScoreLabel}
            </p>
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
            <p className={`mt-3 font-display text-[var(--color-pib-text)] ${lastTouchDays === null ? 'text-2xl' : 'text-3xl'}`}>
              {lastTouchLabel}
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

        {relationshipRiskItems.length > 0 && (
          <section className="bento-card !p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="eyebrow !text-[10px]">Leadership brief</p>
                <h2 className="mt-2 font-display text-xl text-[var(--color-pib-text)]">Relationship risk brief</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                  {relationshipRiskItems.length} open {relationshipRiskItems.length === 1 ? 'risk needs' : 'risks need'} attention before this relationship is leadership-ready.
                </p>
              </div>
              <span
                aria-hidden="true"
                className="material-symbols-outlined flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--color-pib-line)] bg-white/[0.04] text-[20px] text-[var(--color-pib-accent)]"
              >
                crisis_alert
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {relationshipRiskItems.map((item) => (
                <div key={item.title} className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.03] p-3">
                  <div className="flex items-start gap-2">
                    <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-[var(--color-pib-accent)]">{item.icon}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-pib-text)]">{item.title}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--color-pib-text-muted)]">{item.body}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={item.actionAriaLabel}
                    onClick={item.onAction}
                    disabled={item.disabled}
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--color-pib-line)] px-2 py-1.5 text-xs font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)] disabled:opacity-50"
                  >
                    {item.actionLabel}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

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
                    <p className="text-sm font-semibold text-[var(--color-pib-text)]">{suggestionActionLabel(nextSuggestion)}</p>
                    <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{suggestionReasonLabel(nextSuggestion)}</p>
                    <button
                      type="button"
                      onClick={() => startSuggestion(nextSuggestion)}
                      aria-label={`Act on top recommendation: ${suggestionActionLabel(nextSuggestion)} for ${contactName}`}
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
              companyId={linkedCompanyId}
              companyName={companyNameValue}
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
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    {row.href ? (
                      <a
                        href={row.href}
                        target={row.external ? '_blank' : undefined}
                        rel={row.external ? 'noreferrer' : undefined}
                        className="inline-flex max-w-full items-center gap-1 break-all text-[var(--color-pib-accent)] transition-colors hover:text-[var(--color-pib-text)]"
                      >
                        {row.value}
                        {row.external && <span className="material-symbols-outlined text-[13px]" aria-hidden="true">open_in_new</span>}
                      </a>
                    ) : (
                      <p className="text-[var(--color-pib-text)] break-words">{row.value}</p>
                    )}
                    {row.needsActionWhenValued && row.onAction && (
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
            {shouldPromptLastContactedRefresh && (
              <button
                type="button"
                aria-label={`Log fresh touch for ${contactName} from last contacted detail`}
                onClick={openFirstNoteComposer}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-1.5 text-[11px] font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
              >
                <span className="material-symbols-outlined text-[13px]" aria-hidden="true">edit_note</span>
                Log fresh touch
              </button>
            )}
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
                aria-label={`Contact name for ${contactName}`}
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
                  aria-label={`Email address for ${contactName}`}
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
                  aria-label={`Phone number for ${contactName}`}
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
                  aria-label={`Job title for ${contactName}`}
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
                  aria-label={`Department for ${contactName}`}
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
                  aria-label={`Timezone for ${contactName}`}
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
                  aria-label={`Website for ${contactName}`}
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
                <select ref={sourceFieldRef} aria-label={`Contact source for ${contactName}`} value={source} onChange={(e) => setSource(e.target.value)} className="pib-input w-full">
                  {SOURCE_OPTIONS.map((option) => <option key={option} value={option} className="bg-black">{displayLabel(option, SOURCE_LABELS)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Type</p>
                <select ref={typeFieldRef} aria-label={`Contact type for ${contactName}`} value={type} onChange={(e) => setType(e.target.value)} className="pib-input w-full">
                  {TYPE_OPTIONS.map((option) => <option key={option} value={option} className="bg-black">{displayLabel(option, TYPE_LABELS)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Stage</p>
                <select ref={stageFieldRef} aria-label={`Lifecycle stage for ${contactName}`} value={stage} onChange={(e) => setStage(e.target.value)} className="pib-input w-full">
                  {STAGE_OPTIONS.map((option) => <option key={option} value={option} className="bg-black">{displayLabel(option, STAGE_LABELS)}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-1 pt-1">
              <p className="text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">
                Owner
              </p>
              <select ref={ownerFieldRef} aria-label={`Relationship owner for ${contactName}`} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="pib-input w-full">
                <option value="" className="bg-black">Unassigned</option>
                {teamMembers.map((member) => {
                  const label = teamMemberDisplayLabel(member)
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
                ref={tagsFieldRef}
                aria-label={`Tags for ${contactName}`}
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
                ariaLabel={`Linked company for ${contactName}`}
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
                aria-label={`Relationship notes for ${contactName}`}
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
            <div className="flex flex-wrap justify-end gap-2">
              {dirty && (
                <button
                  type="button"
                  onClick={resetProfileEdits}
                  disabled={saving}
                  aria-label={`Discard unsaved profile edits for ${contactName}`}
                  className="btn-pib-secondary !py-2 !px-4 !text-sm disabled:opacity-40"
                >
                  Discard changes
                </button>
              )}
              <button
                type="button"
                onClick={saveChanges}
                disabled={!dirty || saving}
                aria-label={`Save profile changes for ${contactName}`}
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
                    aria-label={`Send first email to ${contactName}`}
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
                      title={emailDirectionLabel(e)}
                    >
                      {emailDirectionKind(e) === 'received' ? 'inbox' : 'send'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{emailSubjectLabel(e)}</p>
                      <p className="text-[11px] text-[var(--color-pib-text-muted)] font-mono mt-0.5">
                        {emailStatusLabel(e)} · {' '}
                        {emailTimeLabel(e)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEmailFollowUp(e)}
                      aria-label={`Follow up on ${emailSubjectLabel(e)} with ${contactName}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
                    >
                      <span className="material-symbols-outlined text-[13px]" aria-hidden="true">reply</span>
                      Follow up
                    </button>
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
                      <p className="text-sm font-medium">{suggestionActionLabel(s)}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)]">{suggestionReasonLabel(s)}</p>
                      <button
                        type="button"
                        onClick={() => startSuggestion(s)}
                        aria-label={`Start suggested action: ${suggestionActionLabel(s)} for ${contactName}`}
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
                  { type: 'call', icon: 'call', label: 'Call', command: `Log call with ${contactName}` },
                  { type: 'email_sent', icon: 'mail', label: 'Email', command: `Send email to ${contactName}` },
                  { type: 'note', icon: 'notes', label: 'Note', command: `Log note for ${contactName}` },
                  { type: 'sms', icon: 'sms', label: 'SMS', command: `Send SMS to ${contactName}` },
                  { type: 'meeting', icon: 'event', label: 'Meeting', command: `Schedule meeting with ${contactName}` },
                ] as const).map(({ type, icon, label, command }) => (
                  <button
                    key={type}
                    type="button"
                    aria-label={command}
                    aria-pressed={logType === type}
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
                <button
                  type="button"
                  aria-label={`Draft email with AI for ${contactName}`}
                  aria-pressed={showAiComposer}
                  onClick={() => setShowAiComposer((v) => !v)}
                  className="btn-pib-secondary text-xs flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]" aria-hidden="true">auto_awesome</span>
                  AI draft
                </button>
              </div>

              {logType && (
                <div ref={activityComposerRef} className="bento-card !p-4 mb-4 space-y-3">
                  {logType === 'email_sent' ? (
                    email.trim() ? (
                      <>
                        <input
                          aria-label={`Email subject for ${contactName}`}
                          placeholder="Subject…"
                          value={logEmailSubject}
                          onChange={(e) => setLogEmailSubject(e.target.value)}
                          className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                        />
                        <textarea
                          aria-label={`Email message for ${contactName}`}
                          rows={3}
                          placeholder="Message…"
                          value={logSummary}
                          onChange={(e) => setLogSummary(e.target.value)}
                          className="w-full text-sm bg-transparent border border-[var(--color-pib-line)] rounded-lg p-2 resize-none"
                        />
                      </>
                    ) : (
                      <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
                        <div className="flex gap-3">
                          <span
                            className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-pib-accent)]"
                            aria-hidden="true"
                          >
                            alternate_email
                          </span>
                          <div>
                            <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                              Email readiness
                            </p>
                            <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">
                              Add an email address before outreach
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                              Capture {contactName}&apos;s email address before the team sends outreach from CRM.
                            </p>
                            <button
                              type="button"
                              onClick={() => focusProfileField(emailFieldRef)}
                              className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
                              aria-label={`Add email before sending outreach to ${contactName}`}
                            >
                              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">mail</span>
                              Add email
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  ) : logType === 'sms' ? (
                    phone.trim() ? (
                      <textarea
                        aria-label={activityNotesFieldName(logType, contactName)}
                        rows={3}
                        placeholder="SMS message…"
                        value={logSummary}
                        onChange={(e) => setLogSummary(e.target.value)}
                        className="w-full text-sm bg-transparent border border-[var(--color-pib-line)] rounded-lg p-2 resize-none"
                      />
                    ) : (
                      <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
                        <div className="flex gap-3">
                          <span
                            className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-pib-accent)]"
                            aria-hidden="true"
                          >
                            add_call
                          </span>
                          <div>
                            <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                              SMS readiness
                            </p>
                            <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">
                              Add a phone number before SMS
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                              Capture {contactName}&apos;s phone number before the team tries to send a text message from CRM.
                            </p>
                            <button
                              type="button"
                              onClick={() => focusProfileField(phoneFieldRef)}
                              className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
                              aria-label={`Add phone before sending SMS to ${contactName}`}
                            >
                              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">call</span>
                              Add phone
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  ) : logType === 'call' ? (
                    phone.trim() ? (
                      <textarea
                        aria-label={activityNotesFieldName(logType, contactName)}
                        rows={3}
                        placeholder={activityNotesPlaceholder(logType)}
                        value={logSummary}
                        onChange={(e) => setLogSummary(e.target.value)}
                        className="w-full text-sm bg-transparent border border-[var(--color-pib-line)] rounded-lg p-2 resize-none"
                      />
                    ) : (
                      <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
                        <div className="flex gap-3">
                          <span
                            className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-pib-accent)]"
                            aria-hidden="true"
                          >
                            add_call
                          </span>
                          <div>
                            <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                              Call readiness
                            </p>
                            <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">
                              Add a phone number before calling
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                              Capture {contactName}&apos;s phone number before the team logs a call from CRM.
                            </p>
                            <button
                              type="button"
                              onClick={() => focusProfileField(phoneFieldRef)}
                              className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
                              aria-label={`Add phone before logging a call with ${contactName}`}
                            >
                              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">call</span>
                              Add phone
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  ) : logType === 'meeting' ? (
                    <>
                      <input
                        aria-label={`Meeting title for ${contactName}`}
                        placeholder="Meeting title…"
                        value={meetingTitle}
                        onChange={(e) => setMeetingTitle(e.target.value)}
                        className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="block text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Starts</span>
                          <input
                            aria-label={`Meeting start time for ${contactName}`}
                            type="datetime-local"
                            value={meetingStartAt}
                            onChange={(e) => setMeetingStartAt(e.target.value)}
                            className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[10px] uppercase tracking-widest text-[var(--color-pib-text-muted)] font-mono">Ends</span>
                          <input
                            aria-label={`Meeting end time for ${contactName}`}
                            type="datetime-local"
                            value={meetingEndAt}
                            onChange={(e) => setMeetingEndAt(e.target.value)}
                            className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                          />
                        </label>
                      </div>
                      <input
                        aria-label={`Meeting link for ${contactName}`}
                        placeholder="Meeting link (optional)…"
                        value={meetingUrl}
                        onChange={(e) => setMeetingUrl(e.target.value)}
                        className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                      />
                      {meetingTimingError && (
                        <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                          {meetingTimingError}
                        </p>
                      )}
                      <textarea
                        aria-label={`Meeting agenda or notes for ${contactName}`}
                        rows={3}
                        placeholder="Agenda or notes…"
                        value={logSummary}
                        onChange={(e) => setLogSummary(e.target.value)}
                        className="w-full text-sm bg-transparent border border-[var(--color-pib-line)] rounded-lg p-2 resize-none"
                      />
                    </>
                  ) : (
                    <textarea
                      aria-label={activityNotesFieldName(logType, contactName)}
                      rows={3}
                      placeholder={activityNotesPlaceholder(logType)}
                      value={logSummary}
                      onChange={(e) => setLogSummary(e.target.value)}
                      className="w-full text-sm bg-transparent border border-[var(--color-pib-line)] rounded-lg p-2 resize-none"
                    />
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleLogActivity}
                      disabled={
                        logSaving ||
                        (logType === 'email_sent'
                          ? !email.trim() || !logEmailSubject.trim() || !logSummary.trim()
                          : logType === 'meeting'
                          ? !meetingStartAt || !meetingEndAt || Boolean(meetingTimingError)
                          : logType === 'sms'
                          ? !phone.trim() || !logSummary.trim()
                          : logType === 'call'
                          ? !phone.trim() || !logSummary.trim()
                          : !logSummary.trim())
                      }
                      aria-label={activityComposerActionName(logType, contactName)}
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
                      type="button"
                      onClick={() => { setLogType(null); setLogSummary(''); setLogEmailSubject(''); setMeetingTitle(''); setMeetingStartAt(''); setMeetingEndAt(''); setMeetingUrl(''); setLogError(null) }}
                      aria-label={activityComposerCancelName(logType, contactName)}
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
                    aria-label={`AI email purpose for ${contactName}`}
                    placeholder="Purpose (e.g. Follow up after demo)"
                    value={aiPurpose}
                    onChange={(e) => setAiPurpose(e.target.value)}
                    className="w-full text-sm border border-[var(--color-pib-line)] rounded-lg p-2 bg-transparent"
                  />
                  <select
                    aria-label={`AI email tone for ${contactName}`}
                    value={aiTone}
                    onChange={(e) => setAiTone(e.target.value as 'professional' | 'friendly' | 'bold')}
                    className="text-sm border border-[var(--color-pib-line)] rounded p-1 bg-transparent"
                  >
                    <option value="professional">Professional</option>
                    <option value="friendly">Friendly</option>
                    <option value="bold">Bold</option>
                  </select>
                  <button
                    aria-label={`Generate AI email draft for ${contactName}`}
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
                        type="button"
                        aria-label={`Copy AI draft ${aiDraft.subject} for ${contactName}`}
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
                    aria-label={`Start activity trail for ${contactName}`}
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
                      <p className="text-sm text-[var(--color-pib-text)]">{activitySummaryLabel(a)}</p>
                      <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">
                        {activityActorLabel(a)} · {activityTimeLabel(a)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => continueFromActivity(a)}
                      aria-label={`Continue from activity ${activitySummaryLabel(a)} with ${contactName}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-pib-line)] px-2 py-1 text-[11px] font-medium text-[var(--color-pib-accent)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-text)]"
                    >
                      <span className="material-symbols-outlined text-[13px]" aria-hidden="true">edit_note</span>
                      Continue
                    </button>
                  </div>
                ))}
                {activities.length === 50 && (
                  <button
                    type="button"
                    onClick={loadMoreActivities}
                    aria-label={`Load more activity for ${contactName}`}
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
            contactName={contactName}
            orgId={typeof contact.orgId === 'string' ? contact.orgId : ''}
          />

          {/* C3: Sequence enrollment panel */}
          <div className="bento-card !p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="eyebrow !text-[10px]">Sequences</p>
              <button
                type="button"
                onClick={handleOpenEnrollModal}
                aria-label={`Open nurture enrollment for ${contactName}`}
                className="btn-pib-secondary text-xs flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">add</span>
                Enroll
              </button>
            </div>
            {enrollmentsLoading ? (
              <div
                role="status"
                aria-live="polite"
                aria-label={`Loading nurture workflow enrollment for ${contactName}`}
                className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4"
              >
                <div className="flex items-center gap-2 text-sm text-[var(--color-pib-text-muted)]">
                  <span className="material-symbols-outlined text-[18px] text-[var(--color-pib-accent)]" aria-hidden="true">
                    progress_activity
                  </span>
                  <span>Loading nurture workflow enrollment for {contactName}...</span>
                </div>
              </div>
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
              enrollments.map((e) => {
                const sequenceName = e.sequenceName?.trim()
                  || (e.sequenceId?.trim() ? 'Sequence identity missing' : 'Sequence enrollment missing')
                const enrollmentStatus = readableStatusLabel(e.status)
                return (
                  <div key={e.id} className="py-2 border-b border-[var(--color-pib-line)] last:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{sequenceName}</p>
                        <p className="text-xs text-[var(--color-pib-text-muted)]">Step {(e.currentStep ?? 0) + 1} · {enrollmentStatus}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingUnenrollId(e.id)
                          setUnenrollError('')
                        }}
                        aria-label={`Review unenrollment for ${contactName} from ${sequenceName}`}
                        className="text-xs text-[var(--color-pib-text-muted)] hover:text-red-400"
                      >
                        Unenroll
                      </button>
                    </div>
                    {pendingUnenrollId === e.id && (
                      <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                        <p className="text-[10px] font-label uppercase tracking-widest text-red-300">Sequence control</p>
                        <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Pause this nurture workflow?</h3>
                        <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                          Removing {sequenceName} stops the current sequence steps for {contactName}. The team can re-enroll them later if the follow-up cadence still applies.
                        </p>
                        {unenrollError && (
                          <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
                            {unenrollError}
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleUnenroll(e.id)}
                            aria-label={`Confirm unenroll ${contactName} from ${sequenceName}`}
                            className="btn-pib-accent text-xs"
                          >
                            Confirm unenroll
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingUnenrollId(null)
                              setUnenrollError('')
                            }}
                            className="btn-pib-secondary text-xs"
                          >
                            Keep enrolled
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      {/* C3: Enroll modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="portal-contact-enroll-title"
            aria-describedby="portal-contact-enroll-description"
            className="bento-card !p-6 w-full max-w-sm space-y-4"
          >
            <div>
              <p className="eyebrow !text-[10px]">Nurture workflow</p>
              <h2 id="portal-contact-enroll-title" className="mt-1 text-lg font-semibold text-[var(--color-pib-text)]">
                Enroll {contactName} in a nurture sequence
              </h2>
              <p id="portal-contact-enroll-description" className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                Choose an approved sequence so outreach steps, accountability, and follow-up timing are visible to the team from this contact record.
              </p>
            </div>
            {sequences.length === 0 && (
              <div className="rounded-lg border border-[var(--color-pib-line)] bg-white/[0.02] p-4">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined mt-0.5 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">
                    route
                  </span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">
                      Sequence setup
                    </p>
                    <h3 className="mt-1 text-sm font-semibold text-[var(--color-pib-text)]">Create a sequence before enrolling</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-pib-text-muted)]">
                      This workspace needs at least one nurture sequence before {contactName} can be enrolled from the contact record.
                    </p>
                    <Link
                      href="/portal/settings/sequences/new"
                      className="btn-pib-secondary mt-3 inline-flex items-center gap-1.5 text-xs"
                    >
                      <span className="material-symbols-outlined text-[14px]" aria-hidden="true">add</span>
                      Build first sequence
                    </Link>
                  </div>
                </div>
              </div>
            )}
            <select
              value={enrollingSequenceId}
              onChange={(e) => {
                setEnrollingSequenceId(e.target.value)
                setEnrollError('')
              }}
              aria-label={`Nurture sequence for ${contactName}`}
              className="w-full text-sm border border-[var(--color-pib-line)] rounded p-2 bg-transparent"
            >
              <option value="">Choose a sequence…</option>
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {enrollError && (
              <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
                {enrollError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleEnroll}
                disabled={!enrollingSequenceId || enrolling}
                aria-label={`Enroll ${contactName} in selected nurture sequence`}
                className="btn-pib-accent text-sm disabled:opacity-50"
              >
                {enrolling ? 'Enrolling…' : 'Enroll'}
              </button>
              <button
                type="button"
                onClick={() => setShowEnrollModal(false)}
                aria-label={`Cancel sequence enrollment for ${contactName}`}
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
