// components/admin/email/ComposeForm.tsx
'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrmContact {
  id: string
  email: string
  firstName?: string
  lastName?: string
  name?: string
}

// ── Rich Text Editor ──────────────────────────────────────────────────────────

function RichTextEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (html: string) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isInternalUpdate = useRef(false)

  // Sync external value into editor only on initial mount
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      isInternalUpdate.current = true
      editorRef.current.innerHTML = value
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function exec(command: string, value?: string) {
    document.execCommand(command, false, value)
    editorRef.current?.focus()
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }

  function handleInput() {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML)
    }
  }

  function handleLink() {
    const url = window.prompt('Enter URL', 'https://')
    if (url) exec('createLink', url)
  }

  const toolbarBtnCls =
    'text-on-surface-variant hover:text-on-surface px-2 py-1 text-sm font-label select-none cursor-pointer transition-colors'

  return (
    <div className="border border-outline-variant">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-outline-variant px-1 py-0.5 bg-surface-container">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec('bold') }}
          className={`${toolbarBtnCls} font-bold`}
          title="Bold"
        >
          B
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec('italic') }}
          className={`${toolbarBtnCls} italic`}
          title="Italic"
        >
          I
        </button>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); exec('underline') }}
          className={`${toolbarBtnCls} underline`}
          title="Underline"
        >
          U
        </button>
        <div className="w-px h-4 bg-outline-variant mx-1" />
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); handleLink() }}
          className={toolbarBtnCls}
          title="Insert link"
        >
          Link
        </button>
      </div>

      {/* Editable content area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        className="min-h-[200px] p-3 text-on-surface focus:outline-none text-sm font-body"
        style={{ wordBreak: 'break-word' }}
      />
    </div>
  )
}

// ── CRM Contact Autocomplete ──────────────────────────────────────────────────

function ContactAutocomplete({
  value,
  onChange,
  inputCls,
}: {
  value: string
  onChange: (val: string) => void
  inputCls: string
}) {
  const [query, setQuery] = useState(value)
  const [suggestions, setSuggestions] = useState<CrmContact[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    try {
      const res = await fetch(
        `/api/v1/crm/contacts?search=${encodeURIComponent(q)}`,
        { headers: { 'content-type': 'application/json' } }
      )
      if (!res.ok) return
      const data = await res.json()
      // API may return { contacts: [...] } or a plain array
      const list: CrmContact[] = Array.isArray(data)
        ? data
        : Array.isArray(data.contacts)
        ? data.contacts
        : []
      setSuggestions(list.slice(0, 8))
      setOpen(list.length > 0)
    } catch {
      // silently ignore network errors in autocomplete
    }
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQuery(v)
    onChange(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(v), 300)
  }

  function handleSelect(contact: CrmContact) {
    const email = contact.email
    setQuery(email)
    onChange(email)
    setSuggestions([])
    setOpen(false)
  }

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  function displayName(c: CrmContact) {
    const full = c.name ?? [c.firstName, c.lastName].filter(Boolean).join(' ')
    return full ? `${full} <${c.email}>` : c.email
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        required
        value={query}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder="recipient@example.com or contact name"
        className={inputCls}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 top-full left-0 right-0 bg-surface-container border border-outline-variant text-sm text-on-surface max-h-48 overflow-y-auto">
          {suggestions.map((c) => (
            <li
              key={c.id}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(c) }}
              className="px-3 py-2 cursor-pointer hover:bg-black/30 font-body truncate"
            >
              {displayName(c)}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── ComposeForm ───────────────────────────────────────────────────────────────

export function ComposeForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const contactId = searchParams.get('contactId') ?? ''
  const orgId = searchParams.get('orgId') ?? ''
  const [form, setForm] = useState({
    to: searchParams.get('to') ?? '',
    cc: '',
    subject: searchParams.get('subject') ?? '',
    bodyText: '',
  })
  const [mode, setMode] = useState<'send' | 'schedule'>('send')
  const [scheduledFor, setScheduledFor] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  function setField(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setError('')

    const cc = form.cc
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const endpoint = mode === 'send' ? '/api/v1/email/send' : '/api/v1/email/schedule'
    const payload: Record<string, unknown> = {
      to: form.to,
      cc,
      subject: form.subject,
      bodyText: form.bodyText,
    }
    if (contactId) payload.contactId = contactId
    if (orgId) payload.orgId = orgId
    if (mode === 'schedule') payload.scheduledFor = scheduledFor

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed')
      router.push('/portal/email')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSending(false)
    }
  }

  const inputCls =
    'bg-transparent border border-outline-variant px-3 py-1.5 text-sm text-on-surface focus:outline-none focus:border-on-surface w-full'
  const labelCls = 'text-[10px] font-label uppercase tracking-widest text-on-surface-variant'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-2xl">
      {/* To — with CRM autocomplete */}
      <div className="flex flex-col gap-1">
        <label className={labelCls}>To *</label>
        <ContactAutocomplete
          value={form.to}
          onChange={(val) => setForm((f) => ({ ...f, to: val }))}
          inputCls={inputCls}
        />
      </div>

      {/* CC */}
      <div className="flex flex-col gap-1">
        <label className={labelCls}>CC (comma-separated)</label>
        <input
          type="text"
          value={form.cc}
          onChange={setField('cc')}
          placeholder="cc1@example.com, cc2@example.com"
          className={inputCls}
        />
      </div>

      {/* Subject */}
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Subject *</label>
        <input
          type="text"
          required
          value={form.subject}
          onChange={setField('subject')}
          className={inputCls}
        />
      </div>

      {/* Body — rich text editor */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className={labelCls}>Body *</label>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant hover:text-on-surface transition-colors"
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>
        </div>

        {showPreview ? (
          <div
            className="border border-outline-variant min-h-[200px] p-3 text-on-surface text-sm font-body prose prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: form.bodyText || '<span class="opacity-30">Nothing to preview.</span>' }}
          />
        ) : (
          <RichTextEditor
            value={form.bodyText}
            onChange={(html) => setForm((f) => ({ ...f, bodyText: html }))}
          />
        )}
      </div>

      {/* Send / Schedule toggle */}
      <div className="flex gap-3 items-center">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="mode"
            value="send"
            checked={mode === 'send'}
            onChange={() => setMode('send')}
            className="accent-on-surface"
          />
          <span className="text-sm text-on-surface-variant font-label">Send now</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="mode"
            value="schedule"
            checked={mode === 'schedule'}
            onChange={() => setMode('schedule')}
            className="accent-on-surface"
          />
          <span className="text-sm text-on-surface-variant font-label">Schedule for…</span>
        </label>
      </div>

      {/* Datetime picker — shown only in schedule mode */}
      {mode === 'schedule' && (
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Send at *</label>
          <input
            type="datetime-local"
            required
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className={inputCls}
          />
        </div>
      )}

      {error && (
        <p className="text-[11px]" style={{ color: 'var(--color-accent)' }}>{error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={sending}
          className="px-6 py-2 text-sm font-label text-black bg-on-surface hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {sending ? 'Sending…' : mode === 'send' ? 'Send Now' : 'Schedule Email'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/portal/email')}
          className="px-6 py-2 text-sm font-label text-on-surface-variant border border-outline-variant hover:text-on-surface transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
