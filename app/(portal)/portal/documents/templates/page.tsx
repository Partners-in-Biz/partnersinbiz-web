'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ClientDocumentType, UserDocumentTemplate } from '@/lib/client-documents/types'

type TemplateRecord = UserDocumentTemplate & { id: string }

const TYPE_LABELS: Record<ClientDocumentType, string> = {
  sales_proposal: 'Sales Proposal',
  build_spec: 'Build Spec',
  social_strategy: 'Social Strategy',
  content_campaign_plan: 'Content Campaign Plan',
  geo_seo_strategy: 'GEO / SEO Strategy',
  research_report: 'Research Report',
  monthly_report: 'Monthly Report',
  launch_signoff: 'Launch Sign-off',
  change_request: 'Change Request',
  canvas_draft: 'Canvas Draft',
}

function fmtDate(ts: unknown): string {
  if (!ts) return ''
  if (typeof ts === 'object' && ts !== null) {
    const candidate = ts as { seconds?: number; _seconds?: number; toDate?: () => Date }
    if (typeof candidate.toDate === 'function') return candidate.toDate().toLocaleDateString()
    const seconds = candidate.seconds ?? candidate._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000).toLocaleDateString()
  }
  if (typeof ts === 'string' || typeof ts === 'number') return new Date(ts).toLocaleDateString()
  return ''
}

export default function ManageTemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/client-documents/templates')
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? `Error ${res.status}`)
        return
      }
      const list = (body?.data ?? body) as TemplateRecord[]
      setTemplates(Array.isArray(list) ? list : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleDelete(template: TemplateRecord) {
    if (!window.confirm(`Delete template “${template.name}”? This cannot be undone.`)) return
    setDeletingId(template.id)
    setError(null)
    try {
      const res = await fetch(`/api/v1/client-documents/templates/${template.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? `Error ${res.status}`)
        return
      }
      setTemplates((prev) => prev.filter((t) => t.id !== template.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-2">
        <Link href="/portal/documents" className="text-xs text-on-surface-variant hover:text-on-surface">
          ← Documents
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Saved templates</h1>
            <p className="mt-1 text-sm text-on-surface-variant">
              Reusable templates saved from your documents. Start a new document from any of these.
            </p>
          </div>
          <Link
            href="/portal/documents/new"
            className="btn-pib-accent rounded-md px-4 py-2 text-sm font-medium"
          >
            New document
          </Link>
        </div>
      </header>

      {error && <p className="rounded bg-red-900/30 px-3 py-2 text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-on-surface-variant">Loading templates…</p>
      ) : templates.length === 0 ? (
        <div className="bento-card p-8 text-center">
          <span className="material-symbols-outlined text-[40px] text-on-surface-variant">bookmarks</span>
          <p className="mt-3 text-sm font-medium">No saved templates yet</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Open a document and use “Save as template” to create one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {templates.map((template) => (
            <div key={template.id} className="bento-card flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{template.name}</p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-wider text-on-surface-variant">
                    {TYPE_LABELS[template.type] ?? template.type}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(template)}
                  disabled={deletingId === template.id}
                  aria-label="Delete template"
                  className="rounded-md border border-white/10 p-1.5 text-on-surface-variant hover:bg-white/5 hover:text-red-400 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {deletingId === template.id ? 'hourglass_empty' : 'delete'}
                  </span>
                </button>
              </div>

              {template.description && (
                <p className="text-xs leading-relaxed text-on-surface-variant">{template.description}</p>
              )}

              <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11px] text-on-surface-variant">
                <span>{(template.blocks?.length ?? 0)} block{(template.blocks?.length ?? 0) === 1 ? '' : 's'}</span>
                {fmtDate(template.createdAt) && <span>Created {fmtDate(template.createdAt)}</span>}
              </div>

              <Link
                href={`/portal/documents/new?templateId=${template.id}`}
                className="flex items-center justify-center gap-1.5 rounded-md border border-white/10 px-3 py-2 text-xs font-medium text-on-surface hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Use this template
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
