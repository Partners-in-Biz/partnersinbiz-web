// components/admin/governance/ReportTemplatesManager.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'

interface TemplateRecord {
  id: string
  name: string
  eyebrow: string
  subject: string
  description: string
  body: string
  assignedOrgIds: string[]
  version: number
  source: 'builtin' | 'custom'
  isDefault: boolean
  createdAt: string | null
  updatedAt: string | null
}

interface OrgOption {
  id: string
  name: string
  slug: string
}

interface TemplateVersion {
  id: string
  version: number
  name: string
  subject: string
  changedBy: string
  changeNote: string
  createdAt: string | null
}

const inputClass =
  'mt-1 w-full rounded-lg border border-[var(--color-card-border)] bg-[var(--color-surface-container)] px-3 py-2 text-sm text-on-surface'

function fmt(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString().replace('T', ' ').slice(0, 16)
}

const EMPTY_FORM = { name: '', eyebrow: '', subject: '', description: '', body: '', changeNote: '' }

export function ReportTemplatesManager() {
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [assigned, setAssigned] = useState<string[]>([])

  const [versionsFor, setVersionsFor] = useState<string | null>(null)
  const [versions, setVersions] = useState<TemplateVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/reports/templates', { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load templates')
      const data = body.data ?? body
      setTemplates(data.templates ?? [])
      setOrgs(data.orgs ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load templates.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function resetForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setAssigned([])
  }

  function startEdit(t: TemplateRecord) {
    setEditingId(t.id)
    setForm({
      name: t.name,
      eyebrow: t.eyebrow,
      subject: t.subject,
      description: t.description,
      body: t.body,
      changeNote: '',
    })
    setAssigned(t.assignedOrgIds)
    setNotice(null)
  }

  function toggleOrg(id: string) {
    setAssigned((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const submit = useCallback(async () => {
    if (!form.name.trim()) {
      setNotice({ tone: 'err', text: 'Template name is required.' })
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const isEdit = editingId && !editingId.startsWith('builtin:')
      const res = await fetch('/api/v1/admin/reports/templates', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEdit ? { id: editingId } : {}),
          name: form.name,
          eyebrow: form.eyebrow,
          subject: form.subject,
          description: form.description,
          body: form.body,
          assignedOrgIds: assigned,
          changeNote: form.changeNote || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Save failed')
      setNotice({ tone: 'ok', text: isEdit ? 'Template updated.' : 'Template created.' })
      resetForm()
      await load()
    } catch (e) {
      setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Save failed.' })
    } finally {
      setBusy(false)
    }
  }, [form, assigned, editingId, load])

  const remove = useCallback(
    async (t: TemplateRecord) => {
      if (!window.confirm(`Delete template "${t.name}"? This also removes its version history.`)) return
      setBusy(true)
      setNotice(null)
      try {
        const res = await fetch(`/api/v1/admin/reports/templates?id=${encodeURIComponent(t.id)}`, {
          method: 'DELETE',
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body?.error || 'Delete failed')
        setNotice({ tone: 'ok', text: 'Template deleted.' })
        if (editingId === t.id) resetForm()
        await load()
      } catch (e) {
        setNotice({ tone: 'err', text: e instanceof Error ? e.message : 'Delete failed.' })
      } finally {
        setBusy(false)
      }
    },
    [editingId, load],
  )

  const showVersions = useCallback(async (t: TemplateRecord) => {
    if (t.source === 'builtin') return
    setVersionsFor(t.id)
    setVersionsLoading(true)
    setVersions([])
    try {
      const res = await fetch(`/api/v1/admin/reports/templates/${encodeURIComponent(t.id)}/versions`, {
        cache: 'no-store',
      })
      const body = await res.json()
      if (res.ok) setVersions((body.data ?? body).versions ?? [])
    } finally {
      setVersionsLoading(false)
    }
  }, [])

  function orgName(id: string): string {
    return orgs.find((o) => o.id === id)?.name ?? id
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Governance</p>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Report Templates</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Firestore-backed report templates with org assignment and full version history. Built-in defaults are
          read-only.
        </p>
      </div>

      {notice && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            notice.tone === 'ok'
              ? 'border-green-500/20 bg-green-500/10 text-green-300'
              : 'border-red-500/20 bg-red-500/10 text-red-300'
          }`}
        >
          {notice.text}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {/* Editor */}
      <div className="pib-card space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            {editingId && !editingId.startsWith('builtin:') ? 'Edit template' : 'New template'}
          </p>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-on-surface-variant">Name</label>
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-on-surface-variant">Eyebrow</label>
            <input className={inputClass} value={form.eyebrow} onChange={(e) => setForm({ ...form, eyebrow: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-on-surface-variant">Subject (use {'{org}'} and {'{period}'})</label>
            <input className={inputClass} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-on-surface-variant">Description</label>
            <input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-on-surface-variant">Body (optional intro copy)</label>
            <textarea
              rows={3}
              className={inputClass}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          {editingId && !editingId.startsWith('builtin:') && (
            <div className="sm:col-span-2">
              <label className="text-xs text-on-surface-variant">Change note (version history)</label>
              <input className={inputClass} value={form.changeNote} onChange={(e) => setForm({ ...form, changeNote: e.target.value })} />
            </div>
          )}
        </div>

        <div>
          <p className="text-xs text-on-surface-variant mb-2">Assign to organisations</p>
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {orgs.length === 0 ? (
              <span className="text-xs text-on-surface-variant">No accessible organisations.</span>
            ) : (
              orgs.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggleOrg(o.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    assigned.includes(o.id)
                      ? 'border-[var(--color-accent-v2)] bg-[var(--color-accent-v2)]/15 text-on-surface'
                      : 'border-[var(--color-card-border)] text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {o.name}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="rounded-lg bg-[var(--color-accent-v2)] px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {busy ? 'Saving…' : editingId && !editingId.startsWith('builtin:') ? 'Save changes' : 'Create template'}
          </button>
          {editingId?.startsWith('builtin:') && (
            <span className="text-xs text-on-surface-variant">
              Editing from a built-in default — saving creates a new custom template.
            </span>
          )}
        </div>
      </div>

      {/* Listing */}
      <div className="overflow-x-auto rounded-xl border border-[var(--color-card-border)]">
        <table className="w-full text-left text-sm text-on-surface">
          <thead>
            <tr className="border-b border-[var(--color-card-border)] bg-[var(--color-surface-container)]">
              {['Template', 'Subject', 'Assigned orgs', 'Version', 'Source', 'Updated', 'Actions'].map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-on-surface-variant">
                  Loading templates…
                </td>
              </tr>
            ) : (
              templates.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-[var(--color-card-border)] last:border-b-0 hover:bg-[var(--color-row-hover)] transition-colors align-top"
                >
                  <td className="px-3 py-2">
                    <p className="font-medium text-on-surface">{t.name}</p>
                    {t.isDefault && <span className="text-[11px] text-on-surface-variant">Default</span>}
                    {t.description && <p className="text-[11px] text-on-surface-variant mt-0.5 max-w-[260px]">{t.description}</p>}
                  </td>
                  <td className="px-3 py-2 text-xs text-on-surface-variant max-w-[220px] break-words">{t.subject}</td>
                  <td className="px-3 py-2 text-xs text-on-surface-variant max-w-[180px]">
                    {t.assignedOrgIds.length === 0 ? '—' : t.assignedOrgIds.map(orgName).join(', ')}
                  </td>
                  <td className="px-3 py-2 text-xs text-on-surface-variant">v{t.version}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                        t.source === 'builtin' ? 'bg-[var(--color-surface-container)] text-on-surface-variant' : 'bg-blue-500/15 text-blue-300'
                      }`}
                    >
                      {t.source}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-on-surface-variant whitespace-nowrap">{fmt(t.updatedAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        className="rounded-md border border-[var(--color-card-border)] px-2 py-1 text-xs text-on-surface hover:bg-[var(--color-row-hover)] transition-colors"
                      >
                        {t.source === 'builtin' ? 'Clone' : 'Edit'}
                      </button>
                      {t.source === 'custom' && (
                        <>
                          <button
                            type="button"
                            onClick={() => showVersions(t)}
                            className="rounded-md border border-[var(--color-card-border)] px-2 py-1 text-xs text-on-surface hover:bg-[var(--color-row-hover)] transition-colors"
                          >
                            History
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => remove(t)}
                            className="rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Version history */}
      {versionsFor && (
        <div className="pib-card space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Version history</p>
            <button
              type="button"
              onClick={() => setVersionsFor(null)}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Close
            </button>
          </div>
          {versionsLoading ? (
            <p className="text-sm text-on-surface-variant">Loading history…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-on-surface-variant">No version snapshots yet.</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => (
                <li key={v.id} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-on-surface">v{v.version}</span>
                    <span className="text-xs text-on-surface-variant">{v.changeNote}</span>
                    <span className="text-[11px] text-on-surface-variant ml-auto">{fmt(v.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant mt-1">
                    {v.name} · {v.subject} · by {v.changedBy || 'unknown'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
