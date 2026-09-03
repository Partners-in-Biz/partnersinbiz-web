'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/studio'
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
        <Link href="/portal/documents" className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
          ← Documents
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Documents · Templates</p>
            <h1 className="pib-page-title mt-2">Saved templates</h1>
            <p className="pib-page-sub">
              Reusable templates saved from your documents. Start a new document from any of these.
            </p>
          </div>
          <Link href="/portal/documents/new" className="btn-pib-primary shrink-0">
            New document
          </Link>
        </div>
      </header>

      {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="pib-skeleton h-40" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="bookmarks" />
          <h2 className="pib-empty-state-title">No saved templates yet</h2>
          <p className="pib-empty-state-description">
            Open a document and use “Save as template” to create one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {templates.map((template) => (
            <div key={template.id} className="pib-card flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-3">
                  <Icon name="bookmark" className="text-[18px]" />
                  <div className="min-w-0">
                    <p className="truncate text-sm">{template.name}</p>
                    <p className="pib-label mt-0.5">
                      {TYPE_LABELS[template.type] ?? template.type}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(template)}
                  disabled={deletingId === template.id}
                  aria-label="Delete template"
                  className="border border-[var(--color-pib-line)] p-1.5 text-[var(--color-pib-text-muted)] transition-colors hover:bg-[var(--color-row-hover)] hover:text-[var(--color-error)] disabled:opacity-50"
                >
                  <Icon name={deletingId === template.id ? 'hourglass_empty' : 'delete'} />
                </button>
              </div>

              {template.description && (
                <p className="text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{template.description}</p>
              )}

              <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11px] text-[var(--color-pib-text-muted)]">
                <span>{(template.blocks?.length ?? 0)} block{(template.blocks?.length ?? 0) === 1 ? '' : 's'}</span>
                {fmtDate(template.createdAt) && <span>Created {fmtDate(template.createdAt)}</span>}
              </div>

              <Link
                href={`/portal/documents/new?templateId=${template.id}`}
                className="btn-pib-secondary justify-center"
              >
                <Icon name="add" className="text-[16px]" />
                Use this template
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
