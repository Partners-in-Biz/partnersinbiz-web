'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  ButtonLink,
  Choice,
  Field,
  Input,
  Notice,
  Panel,
  Skeleton,
  Status,
  Table,
  THead,
  TR,
  TH,
  TD,
  Textarea,
  Toolbar,
} from '@/components/studio'

interface LegalVersion {
  id: string
  docType: string
  version: number
  title: string
  body: string
  status: 'draft' | 'published' | 'archived'
  effectiveDate: string | null
  publishedAt: string | null
  createdAt?: string
  updatedAt?: string
}

interface Acceptance {
  id: string
  orgId?: string
  userId?: string
  userEmail?: string
  docType?: string
  version?: number
  acceptedAt?: string
  ip?: string
}

const DOC_TABS: { key: string; label: string }[] = [
  { key: 'tos', label: 'Terms of Service' },
  { key: 'privacy', label: 'Privacy Policy' },
]

function statusTone(status: string): 'success' | 'warning' | 'info' | undefined {
  if (status === 'published') return 'success'
  if (status === 'draft') return 'warning'
  return 'info'
}

function dash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

export default function LegalPage() {
  const [docType, setDocType] = useState<string>('tos')
  const [versions, setVersions] = useState<LegalVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editEffective, setEditEffective] = useState('')

  const [acceptances, setAcceptances] = useState<Acceptance[]>([])
  const [acceptLoading, setAcceptLoading] = useState(false)

  const selected = useMemo(() => versions.find((v) => v.id === selectedId) ?? null, [versions, selectedId])

  const loadVersions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/legal?docType=${encodeURIComponent(docType)}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Failed to load')
      const data = body.data ?? body
      setVersions(data.versions ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load versions')
    } finally {
      setLoading(false)
    }
  }, [docType])

  const loadAcceptances = useCallback(async () => {
    setAcceptLoading(true)
    try {
      const res = await fetch(`/api/v1/admin/legal/acceptances?docType=${encodeURIComponent(docType)}&limit=200`)
      const body = await res.json()
      const data = body.data ?? body
      setAcceptances(res.ok ? data.acceptances ?? [] : [])
    } catch {
      setAcceptances([])
    } finally {
      setAcceptLoading(false)
    }
  }, [docType])

  useEffect(() => {
    setSelectedId(null)
    loadVersions()
    loadAcceptances()
  }, [loadVersions, loadAcceptances])

  useEffect(() => {
    if (selected) {
      setEditTitle(selected.title ?? '')
      setEditBody(selected.body ?? '')
      setEditEffective(selected.effectiveDate ? selected.effectiveDate.slice(0, 10) : '')
    }
  }, [selected])

  async function createDraft() {
    setBusy(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/legal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docType, title: `${docType === 'tos' ? 'Terms of Service' : 'Privacy Policy'} draft`, body: '' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Create failed')
      const data = body.data ?? body
      setFeedback(`Created draft v${data.version?.version}`)
      await loadVersions()
      setSelectedId(data.version?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveDraft() {
    if (!selected) return
    setBusy(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, body: editBody, effectiveDate: editEffective || null }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Save failed')
      setFeedback('Draft saved')
      await loadVersions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!selected) return
    setBusy(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/${selected.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effectiveDate: editEffective || undefined }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Publish failed')
      setFeedback('Version published')
      await loadVersions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setBusy(false)
    }
  }

  async function deleteDraft() {
    if (!selected) return
    if (!confirm(`Delete draft v${selected.version}?`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/admin/legal/${selected.id}`, { method: 'DELETE' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Delete failed')
      setFeedback('Draft deleted')
      setSelectedId(null)
      await loadVersions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Legal"
        title="Legal documents."
        description="Manage versioned Terms of Service and Privacy Policy documents, publish them, and audit user acceptances."
      />

      <Toolbar>
        {DOC_TABS.map((t) => (
          <Choice key={t.key} selected={docType === t.key} onClick={() => setDocType(t.key)}>
            {t.label}
          </Choice>
        ))}
      </Toolbar>

      {feedback ? <Notice tone="success">{feedback}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <Panel className="space-y-4 lg:col-span-2">
          <Toolbar>
            <p className="sc-tiny">Versions</p>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={createDraft}>
              New draft
            </Button>
          </Toolbar>
          {loading ? (
            <Skeleton height="6rem" />
          ) : versions.length === 0 ? (
            <EmptyState title="No versions yet." description="Create a draft to begin." />
          ) : (
            versions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedId(v.id)}
                className={`w-full rounded-[6px] border p-4 text-left transition-colors ${
                  selectedId === v.id
                    ? 'border-[var(--sc-accent)] bg-[color-mix(in_srgb,var(--sc-ink)_4%,transparent)]'
                    : 'border-[var(--sc-line)] hover:border-[var(--sc-line-strong)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="sc-body text-[var(--sc-ink)]">v{v.version}</span>
                  <Status tone={statusTone(v.status)}>{v.status}</Status>
                </div>
                <p className="sc-tiny mt-1 truncate">{v.title}</p>
                {v.effectiveDate ? (
                  <p className="sc-tiny mt-1">Effective {String(v.effectiveDate).slice(0, 10)}</p>
                ) : null}
              </button>
            ))
          )}
        </Panel>

        <Panel className="space-y-4 lg:col-span-3">
          <p className="sc-tiny">Editor</p>
          {!selected ? (
            <EmptyState title="Select a version." description="Pick a version, or create a new draft." />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="sc-body text-[var(--sc-ink)]">v{selected.version}</span>
                <Status tone={statusTone(selected.status)}>{selected.status}</Status>
              </div>
              <Field id="legal-title" label="Title">
                <Input aria-label="Title" id="legal-title"
                  value={editTitle}
                  disabled={selected.status !== 'draft' || busy}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </Field>
              <Field id="legal-body" label="Body (markdown / HTML)">
                <Textarea aria-label="Body (markdown / HTML)" id="legal-body"
                  value={editBody}
                  disabled={selected.status !== 'draft' || busy}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={14}
                  className="font-mono"
                />
              </Field>
              <Field id="legal-effective" label="Effective date">
                <Input aria-label="Effective date" id="legal-effective"
                  type="date"
                  value={editEffective}
                  disabled={busy}
                  onChange={(e) => setEditEffective(e.target.value)}
                />
              </Field>
              <Toolbar>
                {selected.status === 'draft' ? (
                  <>
                    <Button type="button" variant="secondary" disabled={busy} onClick={saveDraft}>
                      Save draft
                    </Button>
                    <Button type="button" disabled={busy} onClick={publish}>
                      Publish
                    </Button>
                    <Button type="button" variant="danger" disabled={busy} onClick={deleteDraft}>
                      Delete
                    </Button>
                  </>
                ) : (
                  <p className="sc-body text-[var(--sc-ink-soft)]">
                    {selected.status === 'published'
                      ? 'Published versions are read-only. Create a new draft to make changes.'
                      : 'Archived version (read-only).'}
                  </p>
                )}
              </Toolbar>
            </>
          )}
        </Panel>
      </div>

      <Panel className="space-y-4">
        <Toolbar>
          <p className="sc-tiny">Acceptance log</p>
          <ButtonLink
            href={`/api/v1/admin/legal/acceptances?docType=${encodeURIComponent(docType)}&format=csv`}
            variant="ghost"
            size="sm"
          >
            Download CSV
          </ButtonLink>
        </Toolbar>
        {acceptLoading ? (
          <Skeleton height="8rem" />
        ) : acceptances.length === 0 ? (
          <EmptyState title="No acceptances yet." description="No acceptance records for this document type." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Org</TH>
                <TH>Version</TH>
                <TH>Accepted</TH>
                <TH>IP</TH>
              </TR>
            </THead>
            <tbody>
              {acceptances.map((a) => (
                <TR key={a.id}>
                  <TD>{a.userEmail || a.userId || '-'}</TD>
                  <TD className="font-mono text-xs">{dash(a.orgId)}</TD>
                  <TD className="st-num">v{dash(a.version)}</TD>
                  <TD className="st-num">
                    {a.acceptedAt ? String(a.acceptedAt).slice(0, 19).replace('T', ' ') : '-'}
                  </TD>
                  <TD className="font-mono text-xs">{dash(a.ip)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  )
}
