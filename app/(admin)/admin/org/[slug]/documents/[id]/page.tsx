'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { OrgThemedFrame } from '@/components/admin/OrgThemedFrame'
import { DocumentEditorShell } from '@/components/client-documents/DocumentEditorShell'
import {
  DocumentRelationshipChips,
  DocumentRelationshipPanel,
  getClientVisibleOrgIds,
} from '@/components/client-documents/DocumentRelationshipPanel'
import { ShareSettingsPanel } from '@/components/client-documents/share/ShareSettingsPanel'
import type { ClientDocument, ClientDocumentVersion, DocumentComment } from '@/lib/client-documents/types'

type OrganizationSummary = { id: string; slug?: string }

const STATUS_PILL: Record<string, string> = {
  internal_draft: 'bg-gray-700 text-gray-100',
  internal_review: 'bg-amber-700 text-amber-50',
  client_review: 'bg-blue-700 text-blue-50',
  changes_requested: 'bg-orange-700 text-orange-50',
  approved: 'bg-emerald-700 text-emerald-50',
  accepted: 'bg-violet-700 text-violet-50',
  archived: 'bg-zinc-800 text-zinc-300',
}

function readable(s: string) {
  return s.replaceAll('_', ' ')
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      <div className="h-8 w-64 rounded bg-[var(--color-surface-variant)]" />
      <div className="h-4 w-32 rounded bg-[var(--color-surface-variant)]" />
      <div className="h-96 rounded bg-[var(--color-surface-variant)]" />
    </div>
  )
}

export default function OrgDocumentDetailPage() {
  const params = useParams<{ slug: string; id: string }>()
  const slug = params.slug
  const id = params.id

  const [orgId, setOrgId] = useState<string | null>(null)
  const [document, setDocument] = useState<ClientDocument | null>(null)
  const [version, setVersion] = useState<ClientDocumentVersion | null>(null)
  const [comments, setComments] = useState<DocumentComment[]>([])
  const [loading, setLoading] = useState(true)
  const [titleValue, setTitleValue] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then((r) => r.json())
      .then((body: { data?: OrganizationSummary[] }) => {
        const org = (body.data ?? []).find((o) => o.slug === slug)
        if (org) setOrgId(org.id)
      })
      .catch(() => {})
  }, [slug])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [docRes, versionsRes, commentsRes] = await Promise.all([
        fetch(`/api/v1/client-documents/${id}`),
        fetch(`/api/v1/client-documents/${id}/versions`),
        fetch(`/api/v1/client-documents/${id}/comments`),
      ])

      if (!docRes.ok) throw new Error(`Failed to load document: ${docRes.status}`)

      const docBody = await docRes.json()
      const docData: ClientDocument = docBody.data ?? docBody
      setDocument(docData)
      setTitleValue(docData.title)

      if (versionsRes.ok) {
        const versionsBody = await versionsRes.json()
        const versionsData: ClientDocumentVersion[] = versionsBody.data ?? versionsBody ?? []
        const current =
          versionsData.find((v) => v.id === docData.currentVersionId) ?? versionsData[0] ?? null
        setVersion(current)
      }

      if (commentsRes.ok) {
        const commentsBody = await commentsRes.json()
        const commentsData: DocumentComment[] = commentsBody.data ?? commentsBody ?? []
        setComments(commentsData)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function handleTitleBlur() {
    if (!document || titleValue === document.title) return
    await fetch(`/api/v1/client-documents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleValue }),
    })
    setDocument((prev) => (prev ? { ...prev, title: titleValue } : prev))
  }

  async function handlePublish() {
    if (!document) return
    const clientVisibleOrgCount = getClientVisibleOrgIds(document).length
    if (clientVisibleOrgCount > 1) {
      const confirmed = window.confirm(
        'Client-visible warning: this document is linked to more than one client organisation. Publish only if each organisation should be able to see it.',
      )
      if (!confirmed) return
    }

    setPublishing(true)
    try {
      const publishBody = clientVisibleOrgCount > 1
        ? { acknowledgeMultiOrgPublish: true }
        : {}
      await fetch(`/api/v1/client-documents/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(publishBody),
      })
      await load()
    } finally {
      setPublishing(false)
    }
  }

  async function handleShare() {
    if (!document) return
    const url = `${window.location.origin}/d/${document.shareToken}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <OrgThemedFrame orgId={orgId} className="-m-6 min-h-screen">
      {loading ? (
        <Skeleton />
      ) : error ? (
        <div className="p-6">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={load} className="mt-2 text-sm underline">
            Retry
          </button>
        </div>
      ) : !document || !version ? (
        <p className="p-6 text-sm text-on-surface-variant">Document not found.</p>
      ) : (
        <div className="flex flex-col min-h-screen">
          <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--color-outline)] bg-[var(--color-surface)] px-4 py-3">
            <Link
              href={`/admin/org/${slug}/documents`}
              className="mr-2 text-xs text-on-surface-variant hover:text-on-surface"
            >
              ← Documents
            </Link>

            <input
              className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none focus:ring-0"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleTitleBlur}
              aria-label="Document title"
            />

            <DocumentRelationshipChips document={document} />

            <span
              className={`shrink-0 rounded px-2 py-1 text-[10px] uppercase tracking-wide ${
                STATUS_PILL[document.status] ?? 'bg-gray-800 text-gray-300'
              }`}
            >
              {readable(document.status)}
            </span>

            <span className="hidden max-w-xs text-[11px] leading-4 text-on-surface-variant xl:inline">
              Admin drafting/review. Client-visible changes require the send-for-review or share gate.
            </span>

            <Link
              href={`/admin/org/${slug}/documents/${id}/preview`}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--color-pib-line)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-2)]"
            >
              Preview
            </Link>

            {document.status === 'internal_review' && (
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="shrink-0 rounded bg-[var(--color-pib-accent)] px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
              >
                {publishing ? 'Sending…' : 'Send for client review'}
              </button>
            )}

            {document.shareEnabled && (
              <button
                onClick={handleShare}
                className="shrink-0 rounded border border-[var(--color-outline)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-row-hover)]"
              >
                {copied ? 'Copied!' : 'Share'}
              </button>
            )}
          </div>

          {getClientVisibleOrgIds(document).length > 1 && (
            <div className="border-b border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-200" role="alert">
              Client-visible warning: publishing this document would expose it to {getClientVisibleOrgIds(document).length} linked client organisations.
            </div>
          )}

          <details className="border-b border-[var(--color-outline)] bg-[var(--color-pib-surface)] px-4 py-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-[var(--color-pib-text-muted)]">
              Document relationships
            </summary>
            <div className="mt-3">
              <DocumentRelationshipPanel document={document} onChange={setDocument} />
            </div>
          </details>

          {/* Share settings — collapsible under the top bar so it sits near the existing Share button */}
          <details className="border-b border-[var(--color-outline)] bg-[var(--color-pib-surface)] px-4 py-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-[var(--color-pib-text-muted)]">
              Share settings
            </summary>
            <div className="mt-3">
              <ShareSettingsPanel
                document={document}
                baseUrl={process.env.NEXT_PUBLIC_APP_URL ?? ''}
                onChange={setDocument}
              />
            </div>
          </details>

          <div className="flex-1">
            <DocumentEditorShell
              document={document}
              version={version}
              comments={comments}
              documentId={id}
              onPublish={handlePublish}
              onVersionSaved={load}
            />
          </div>
        </div>
      )}
    </OrgThemedFrame>
  )
}
