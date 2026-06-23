'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PageHeader,
  Surface,
  StatusPill,
  EmptyState,
  DialogDrawer,
} from '@/components/ui/AppFoundation'
import { copyToClipboard } from '@/lib/utils/clipboard'

interface PersonaOption {
  key: string
  label: string
  description: string
}

interface DemoOrg {
  id: string
  name: string
  slug: string
  status: string
  persona: string | null
  personaLabel: string | null
  demoToken: string | null
  previewUrl: string | null
  seededAt: string | null
  resetAt: string | null
  seededContacts: number
}

interface OrgOption {
  id: string
  name: string
  slug: string
  type?: string
}

function unwrap<T>(body: unknown): T {
  const b = body as { data?: T }
  return (b?.data ?? body) as T
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function relativeFromNow(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return 'never'
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function DemoOrgsPage() {
  const [orgs, setOrgs] = useState<DemoOrg[]>([])
  const [personas, setPersonas] = useState<PersonaOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  // Tag modal state
  const [tagOpen, setTagOpen] = useState(false)
  const [allOrgs, setAllOrgs] = useState<OrgOption[]>([])
  const [tagOrgId, setTagOrgId] = useState('')
  const [tagPersona, setTagPersona] = useState('agency')
  const [tagging, setTagging] = useState(false)

  const flash = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 3000)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/admin/demo-orgs')
      const json = await res.json()
      if (!res.ok || json.success === false) throw new Error(json.error || 'Failed to load demo orgs')
      const data = unwrap<{ orgs: DemoOrg[]; personas: PersonaOption[] }>(json)
      setOrgs(data.orgs ?? [])
      setPersonas(data.personas ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load demo orgs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openTagModal = useCallback(async () => {
    setTagOpen(true)
    try {
      const res = await fetch('/api/v1/organizations')
      const json = await res.json()
      const list = unwrap<OrgOption[]>(json)
      const demoIds = new Set(orgs.map((o) => o.id))
      setAllOrgs((Array.isArray(list) ? list : []).filter((o) => o.type !== 'platform_owner' && !demoIds.has(o.id)))
    } catch {
      setAllOrgs([])
    }
  }, [orgs])

  const submitTag = useCallback(async () => {
    if (!tagOrgId) { flash('Pick an organisation first'); return }
    setTagging(true)
    try {
      const res = await fetch('/api/v1/admin/demo-orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: tagOrgId, persona: tagPersona }),
      })
      const json = await res.json()
      if (!res.ok || json.success === false) throw new Error(json.error || 'Failed to tag org')
      setTagOpen(false)
      setTagOrgId('')
      flash('Tagged as demo org')
      await load()
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Failed to tag org')
    } finally {
      setTagging(false)
    }
  }, [tagOrgId, tagPersona, flash, load])

  const runAction = useCallback(async (id: string, action: 'seed' | 'reset' | 'untag') => {
    if (action === 'untag' && !window.confirm('Untag this demo org and delete its seeded demo data?')) return
    setBusyId(id)
    try {
      const url = action === 'untag' ? `/api/v1/admin/demo-orgs/${id}` : `/api/v1/admin/demo-orgs/${id}/${action}`
      const res = await fetch(url, { method: action === 'untag' ? 'DELETE' : 'POST' })
      const json = await res.json()
      if (!res.ok || json.success === false) throw new Error(json.error || `Failed to ${action}`)
      flash(action === 'seed' ? 'Demo data seeded' : action === 'reset' ? 'Demo reset complete' : 'Untagged')
      await load()
    } catch (e) {
      flash(e instanceof Error ? e.message : `Failed to ${action}`)
    } finally {
      setBusyId(null)
    }
  }, [flash, load])

  const copyPreview = useCallback(async (url: string | null) => {
    if (!url) return
    const full = `${window.location.origin}${url}`
    try {
      await copyToClipboard(full)
      flash('Preview URL copied')
    } catch {
      flash(full)
    }
  }, [flash])

  const personaList = useMemo(() => personas.length ? personas : [
    { key: 'agency', label: 'Marketing Agency', description: '' },
    { key: 'ecommerce', label: 'E-commerce Brand', description: '' },
    { key: 'coach', label: 'Coach / Creator', description: '' },
    { key: 'saas', label: 'SaaS Startup', description: '' },
  ], [personas])

  return (
    <div className="px-4 py-6 md:px-8">
      <PageHeader
        eyebrow="Sales tooling"
        title="Demo organisations"
        description="Tag client orgs as demos, seed realistic sample data, reset on a 24h cycle, and share no-login preview links."
        actions={
          <button type="button" className="pib-btn-primary" onClick={openTagModal}>
            <span className="material-symbols-outlined text-[18px]">add</span>
            Tag as demo
          </button>
        }
      />

      {toast && (
        <div className="mb-4 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-accent-soft)] px-4 py-2 text-sm text-on-surface">
          {toast}
        </div>
      )}

      {error && (
        <Surface className="mb-4 border-[var(--color-pib-danger,#b00)]/40">
          <p className="text-sm text-on-surface">{error}</p>
        </Surface>
      )}

      {loading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="pib-skeleton h-24 rounded-xl" />)}
        </div>
      ) : orgs.length === 0 ? (
        <Surface>
          <EmptyState
            icon="science"
            title="No demo organisations yet"
            description="Tag an existing organisation as a demo to seed sample CRM data and generate a shareable preview link."
            action={<button type="button" className="pib-btn-primary" onClick={openTagModal}>Tag as demo</button>}
          />
        </Surface>
      ) : (
        <div className="grid gap-3">
          {orgs.map((org) => {
            const busy = busyId === org.id
            return (
              <Surface key={org.id}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-headline text-base text-on-surface">{org.name}</h3>
                      {org.personaLabel && <StatusPill tone="accent">{org.personaLabel}</StatusPill>}
                      <StatusPill tone={org.status === 'active' ? 'success' : 'neutral'} dot>{org.status}</StatusPill>
                    </div>
                    <p className="mt-1 font-label text-xs text-on-surface-variant">/{org.slug}</p>

                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-on-surface-variant sm:grid-cols-4">
                      <div>
                        <div className="font-label uppercase tracking-wide opacity-70">Seeded contacts</div>
                        <div className="text-on-surface">{org.seededContacts}</div>
                      </div>
                      <div>
                        <div className="font-label uppercase tracking-wide opacity-70">Last reset</div>
                        <div className="text-on-surface" title={fmtDate(org.resetAt)}>{relativeFromNow(org.resetAt)}</div>
                      </div>
                      <div>
                        <div className="font-label uppercase tracking-wide opacity-70">Seeded at</div>
                        <div className="text-on-surface">{fmtDate(org.seededAt)}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="font-label uppercase tracking-wide opacity-70">Preview</div>
                        {org.previewUrl ? (
                          <button
                            type="button"
                            onClick={() => copyPreview(org.previewUrl)}
                            className="truncate text-left text-[var(--color-pib-accent)] hover:underline"
                            title="Copy no-login preview URL"
                          >
                            Copy link
                          </button>
                        ) : <span>—</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button type="button" className="pib-btn-secondary" disabled={busy} onClick={() => runAction(org.id, 'seed')}>
                      <span className="material-symbols-outlined text-[18px]">database</span>
                      {busy ? '…' : 'Seed'}
                    </button>
                    <button type="button" className="pib-btn-secondary" disabled={busy} onClick={() => runAction(org.id, 'reset')}>
                      <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                      {busy ? '…' : 'Reset (24h)'}
                    </button>
                    <button type="button" className="pib-btn-ghost" disabled={busy} onClick={() => runAction(org.id, 'untag')}>
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                      Untag
                    </button>
                  </div>
                </div>
              </Surface>
            )
          })}
        </div>
      )}

      <DialogDrawer
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        title="Tag organisation as demo"
        description="Mark an existing org as a demo and assign a persona preset. A no-login preview token is generated automatically."
        footer={
          <>
            <button type="button" className="pib-btn-ghost" onClick={() => setTagOpen(false)}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={tagging} onClick={submitTag}>
              {tagging ? 'Tagging…' : 'Tag as demo'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-label text-xs uppercase tracking-wide text-on-surface-variant">Organisation</span>
            <select
              className="pib-input"
              value={tagOrgId}
              onChange={(e) => setTagOrgId(e.target.value)}
            >
              <option value="">Select an organisation…</option>
              {allOrgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name} (/{o.slug})</option>
              ))}
            </select>
            {allOrgs.length === 0 && <span className="text-xs text-on-surface-variant">No eligible (non-demo) orgs found.</span>}
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="font-label text-xs uppercase tracking-wide text-on-surface-variant">Persona</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {personaList.map((p) => (
                <label
                  key={p.key}
                  className={[
                    'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors',
                    tagPersona === p.key
                      ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)]'
                      : 'border-[var(--color-pib-line)] hover:border-[var(--color-pib-line-strong)]',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="persona"
                      value={p.key}
                      checked={tagPersona === p.key}
                      onChange={() => setTagPersona(p.key)}
                    />
                    <span className="font-headline text-sm text-on-surface">{p.label}</span>
                  </span>
                  {p.description && <span className="text-xs text-on-surface-variant">{p.description}</span>}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </DialogDrawer>
    </div>
  )
}
