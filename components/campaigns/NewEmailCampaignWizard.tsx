'use client'

// US-102 — Step 1 "Settings" of the new email campaign wizard.
//
// Collects name / subject / preview text / sender / recipient selector, creates
// a draft campaign via POST /api/v1/campaigns, persists subject+previewText via
// the same create body, then routes to the block editor (US-103) at
// /portal/campaigns/email/[id]/edit.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const SHARED_DOMAIN = 'partnersinbiz.online'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface DomainOption {
  id: string
  name: string
  status: string
}
interface SegmentOption {
  id: string
  name: string
}
interface TagOption {
  tag: string
  count: number
}
interface ContactOption {
  id: string
  name: string
  email: string
}

type RecipientMode = 'segment' | 'tag' | 'contacts'

interface Props {
  orgId: string
  backHref: string
  // Editor href with a `__ID__` placeholder substituted with the new campaign
  // id on the client. (Server components can't pass closures to client props.)
  editHrefTemplate: string
  defaultFromName?: string
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if ('data' in b) return (b.data as T) ?? null
    return b as unknown as T
  }
  return null
}

export function NewEmailCampaignWizard({ orgId, backHref, editHrefTemplate, defaultFromName }: Props) {
  const router = useRouter()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [subject, setSubject] = useState('')
  const [previewText, setPreviewText] = useState('')
  const [fromName, setFromName] = useState(defaultFromName ?? '')
  const [fromLocal, setFromLocal] = useState('campaigns')
  const [fromDomainId, setFromDomainId] = useState('') // '' = shared
  const [replyTo, setReplyTo] = useState('')

  const [recipientMode, setRecipientMode] = useState<RecipientMode>('segment')
  const [segmentId, setSegmentId] = useState('')
  const [tagId, setTagId] = useState('')
  const [contactIds, setContactIds] = useState<string[]>([])
  const [exclusionContactIds, setExclusionContactIds] = useState<string[]>([])

  const [domains, setDomains] = useState<DomainOption[]>([])
  const [segments, setSegments] = useState<SegmentOption[]>([])
  const [tags, setTags] = useState<TagOption[]>([])
  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [contactQuery, setContactQuery] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingOptions, setLoadingOptions] = useState(true)

  const orgQuery = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''

  // Load selector data
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingOptions(true)
      try {
        const [domRes, segRes, tagRes, conRes] = await Promise.all([
          fetch(`/api/v1/email/domains${orgQuery}`),
          fetch(`/api/v1/crm/segments${orgQuery}`),
          fetch(`/api/v1/crm/tags${orgQuery}`),
          fetch(`/api/v1/crm/contacts${orgQuery ? orgQuery + '&' : '?'}limit=100&sort=recent`),
        ])
        const [domBody, segBody, tagBody, conBody] = await Promise.all([
          domRes.json().catch(() => null),
          segRes.json().catch(() => null),
          tagRes.json().catch(() => null),
          conRes.json().catch(() => null),
        ])
        if (cancelled) return

        const domData = unwrap<DomainOption[]>(domBody)
        if (Array.isArray(domData)) {
          setDomains(domData.map((d) => ({ id: d.id, name: d.name, status: d.status })))
        }
        const segData = unwrap<{ segments?: SegmentOption[] }>(segBody)
        if (segData?.segments) setSegments(segData.segments.map((s) => ({ id: s.id, name: s.name })))
        const tagData = unwrap<{ tags?: TagOption[] }>(tagBody)
        if (tagData?.tags) setTags(tagData.tags)
        const conData = unwrap<ContactOption[]>(conBody)
        if (Array.isArray(conData)) {
          setContacts(
            conData.map((c) => ({
              id: c.id,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              name: (c as any).name || `${(c as any).firstName ?? ''} ${(c as any).lastName ?? ''}`.trim() || (c as any).email || 'Contact',
              email: c.email,
            })),
          )
        }
      } finally {
        if (!cancelled) setLoadingOptions(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [orgQuery])

  const fromDomainName = useMemo(() => {
    const d = domains.find((x) => x.id === fromDomainId)
    return d?.name ?? SHARED_DOMAIN
  }, [domains, fromDomainId])

  const filteredContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase()
    if (!q) return contacts.slice(0, 50)
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)).slice(0, 50)
  }, [contacts, contactQuery])

  const validate = useCallback((): string | null => {
    if (!name.trim()) return 'Campaign name is required.'
    if (!subject.trim()) return 'Subject line is required.'
    if (replyTo.trim() && !EMAIL_RE.test(replyTo.trim())) return 'Reply-to must be a valid email address.'
    if (recipientMode === 'segment' && !segmentId) return 'Select a segment, or switch recipient type.'
    if (recipientMode === 'tag' && !tagId) return 'Select a tag, or switch recipient type.'
    if (recipientMode === 'contacts' && contactIds.length === 0) return 'Pick at least one contact, or switch recipient type.'
    return null
  }, [name, subject, replyTo, recipientMode, segmentId, tagId, contactIds])

  async function handleSubmit() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        orgId,
        name: name.trim(),
        description: description.trim(),
        subject: subject.trim(),
        previewText: previewText.trim(),
        fromName: fromName.trim(),
        fromLocal: fromLocal.trim() || 'campaigns',
        fromDomainId,
        replyTo: replyTo.trim(),
        exclusionContactIds,
      }
      if (recipientMode === 'segment') payload.segmentId = segmentId
      if (recipientMode === 'tag') payload.tagId = tagId
      if (recipientMode === 'contacts') payload.contactIds = contactIds

      const res = await fetch('/api/v1/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && (body.error as string)) || 'Failed to create campaign.')
        return
      }
      const created = unwrap<{ id: string }>(body)
      const id = created?.id
      if (!id) {
        setError('Campaign created but no id was returned.')
        return
      }
      router.push(editHrefTemplate.replace('__ID__', encodeURIComponent(id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create campaign.')
    } finally {
      setSubmitting(false)
    }
  }

  function toggleContact(id: string) {
    setContactIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }
  function toggleExclusion(id: string) {
    setExclusionContactIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div className="space-y-8 pb-16 max-w-3xl">
      <header className="space-y-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_back</span>
          Campaigns
        </Link>
        <p className="eyebrow !text-[10px]">New email campaign · Step 1 of 2 · Settings</p>
        <h1 className="font-headline text-3xl md:text-4xl tracking-tight">Set up your campaign</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)] max-w-2xl">
          Name it, choose your sender and audience. Next you&apos;ll design the email and review before sending.
        </p>
      </header>

      {error && (
        <div className="pib-card !p-4 border border-rose-500/40 bg-rose-500/5 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Basics */}
      <section className="pib-card space-y-4">
        <p className="eyebrow !text-[10px]">Basics</p>
        <FieldRow label="Campaign name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Spring product launch"
            className="pib-input"
          />
        </FieldRow>
        <FieldRow label="Subject line" required>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Meet the new collection"
            className="pib-input"
          />
        </FieldRow>
        <FieldRow label="Preview text" hint="Shown after the subject in most inboxes.">
          <input
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            placeholder="A first look, just for you."
            className="pib-input"
          />
        </FieldRow>
        <FieldRow label="Internal description" hint="Only your team sees this.">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Q2 launch blast"
            className="pib-input"
          />
        </FieldRow>
      </section>

      {/* Sender */}
      <section className="pib-card space-y-4">
        <p className="eyebrow !text-[10px]">Sender</p>
        <FieldRow label="From name">
          <input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="Your Brand"
            className="pib-input"
          />
        </FieldRow>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <FieldRow label="From address">
            <div className="flex items-center gap-2">
              <input
                value={fromLocal}
                onChange={(e) => setFromLocal(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
                placeholder="campaigns"
                className="pib-input !w-36"
              />
              <span className="text-[var(--color-pib-text-muted)]">@</span>
              <span className="font-mono text-sm text-[var(--color-pib-text)] truncate">{fromDomainName}</span>
            </div>
          </FieldRow>
        </div>
        <FieldRow label="Sending domain">
          <select value={fromDomainId} onChange={(e) => setFromDomainId(e.target.value)} className="pib-input">
            <option value="">Shared — {SHARED_DOMAIN} (always available)</option>
            {domains.map((d) => (
              <option key={d.id} value={d.id} disabled={d.status !== 'verified'}>
                {d.name} {d.status === 'verified' ? '· verified' : `· ${d.status} (not usable yet)`}
              </option>
            ))}
          </select>
        </FieldRow>
        {fromDomainId && domains.find((d) => d.id === fromDomainId)?.status !== 'verified' && (
          <p className="text-xs text-amber-300">
            This domain isn&apos;t verified yet — sends will fall back to the shared domain until DNS is confirmed.
          </p>
        )}
        <FieldRow label="Reply-to" hint="Optional. Where replies should land.">
          <input
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            placeholder="hello@yourbrand.com"
            className="pib-input"
          />
        </FieldRow>
      </section>

      {/* Recipients */}
      <section className="pib-card space-y-4">
        <p className="eyebrow !text-[10px]">Recipients</p>
        <div className="flex flex-wrap gap-2">
          {(['segment', 'tag', 'contacts'] as RecipientMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setRecipientMode(m)}
              className={[
                'px-3 py-1.5 rounded-full text-sm border transition-colors',
                recipientMode === m
                  ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)] border-[var(--color-pib-accent)]'
                  : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]',
              ].join(' ')}
            >
              {m === 'segment' ? 'Segment' : m === 'tag' ? 'Tag' : 'Specific contacts'}
            </button>
          ))}
        </div>

        {loadingOptions && <p className="text-xs text-[var(--color-pib-text-muted)]">Loading audience options…</p>}

        {recipientMode === 'segment' && (
          <FieldRow label="Segment">
            {segments.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">No segments found. Create one in CRM, or pick a tag / contacts.</p>
            ) : (
              <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className="pib-input">
                <option value="">Select a segment…</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}
          </FieldRow>
        )}

        {recipientMode === 'tag' && (
          <FieldRow label="Tag">
            {tags.length === 0 ? (
              <p className="text-sm text-[var(--color-pib-text-muted)]">No tags found. Tag contacts in CRM first.</p>
            ) : (
              <select value={tagId} onChange={(e) => setTagId(e.target.value)} className="pib-input">
                <option value="">Select a tag…</option>
                {tags.map((t) => (
                  <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>
                ))}
              </select>
            )}
          </FieldRow>
        )}

        {recipientMode === 'contacts' && (
          <div className="space-y-2">
            <input
              value={contactQuery}
              onChange={(e) => setContactQuery(e.target.value)}
              placeholder="Search contacts by name or email…"
              className="pib-input"
            />
            <p className="text-xs text-[var(--color-pib-text-muted)]">{contactIds.length} selected</p>
            <div className="max-h-56 overflow-y-auto border border-[var(--color-pib-line)] rounded-md divide-y divide-[var(--color-pib-line)]">
              {filteredContacts.length === 0 ? (
                <p className="text-sm text-[var(--color-pib-text-muted)] p-3">No contacts match.</p>
              ) : (
                filteredContacts.map((c) => (
                  <label key={c.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--color-pib-surface-2)]">
                    <input type="checkbox" checked={contactIds.includes(c.id)} onChange={() => toggleContact(c.id)} />
                    <span className="text-sm text-[var(--color-pib-text)]">{c.name}</span>
                    <span className="text-xs text-[var(--color-pib-text-muted)] ml-auto truncate">{c.email}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        {/* Exclusion list */}
        <details className="border-t border-[var(--color-pib-line)] pt-3">
          <summary className="cursor-pointer text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
            Exclude specific contacts ({exclusionContactIds.length})
          </summary>
          <div className="mt-3 max-h-48 overflow-y-auto border border-[var(--color-pib-line)] rounded-md divide-y divide-[var(--color-pib-line)]">
            {contacts.slice(0, 80).map((c) => (
              <label key={c.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[var(--color-pib-surface-2)]">
                <input type="checkbox" checked={exclusionContactIds.includes(c.id)} onChange={() => toggleExclusion(c.id)} />
                <span className="text-sm text-[var(--color-pib-text)]">{c.name}</span>
                <span className="text-xs text-[var(--color-pib-text-muted)] ml-auto truncate">{c.email}</span>
              </label>
            ))}
          </div>
        </details>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="btn-pib-primary disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Continue to design'}
          <span className="material-symbols-outlined text-base">arrow_forward</span>
        </button>
        <Link href={backHref} className="btn-pib-secondary">Cancel</Link>
      </div>

      <style jsx>{`
        :global(.pib-input) {
          width: 100%;
          background: var(--color-pib-surface-2);
          border: 1px solid var(--color-pib-line);
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 14px;
          color: var(--color-pib-text);
          outline: none;
        }
        :global(.pib-input:focus) {
          border-color: var(--color-pib-accent);
        }
      `}</style>
    </div>
  )
}

function FieldRow({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-[var(--color-pib-text)]">
        {label} {required && <span className="text-rose-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-[var(--color-pib-text-muted)]">{hint}</p>}
    </div>
  )
}
