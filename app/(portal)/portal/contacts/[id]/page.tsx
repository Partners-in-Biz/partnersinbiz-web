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
import type { CustomFieldDefinition } from '@/lib/customFields/types'

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
  createdAt?: unknown
  metadata?: Record<string, unknown>
}

const ACTIVITY_ICONS: Record<string, string> = {
  note: 'notes',
  email_sent: 'mail',
  email_received: 'inbox',
  sequence_enrolled: 'route',
  sequence_completed: 'route',
  contact_captured: 'add_circle',
  call: 'call',
  stage_change: 'swap_horiz',
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
        setActivities(b.data ?? [])
        setActivitiesLoading(false)
      })
      .catch(() => setActivitiesLoading(false))
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

          <div className="pib-card-section">
            <div className="px-5 py-3.5 border-b border-[var(--color-pib-line)] bg-white/[0.02] flex items-center justify-between">
              <p className="eyebrow !text-[10px]">Activity</p>
              <span className="text-[11px] text-[var(--color-pib-text-muted)] font-mono">
                {activitiesLoading ? '…' : `${activities.length} record${activities.length === 1 ? '' : 's'}`}
              </span>
            </div>
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
              <div className="divide-y divide-[var(--color-pib-line)]">
                {activities.map((a) => {
                  const icon = ACTIVITY_ICONS[String(a.type ?? '')] ?? 'circle'
                  const campaignId = (a.metadata as { campaignId?: string } | undefined)?.campaignId
                  return (
                    <div key={a.id} className="px-5 py-3 flex items-center gap-4">
                      <span
                        className="material-symbols-outlined text-[18px] text-[var(--color-pib-text-muted)] shrink-0"
                        title={a.type || 'activity'}
                      >
                        {icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{a.summary || a.type || '(activity)'}</p>
                        <p className="text-[11px] text-[var(--color-pib-text-muted)] font-mono mt-0.5">
                          {fmtTimestamp(a.createdAt) || ''}
                          {campaignId ? ` · Campaign: ${campaignId}` : ''}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <ContactDealsPanel contactId={id} />
        </section>
      </div>
    </div>
  )
}
