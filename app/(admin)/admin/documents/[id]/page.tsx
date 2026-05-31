'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { ClientDocument, ClientDocumentVersion, DocumentComment } from '@/lib/client-documents/types'
import { DocumentEditorShell } from '@/components/client-documents/DocumentEditorShell'
import { ShareSettingsPanel } from '@/components/client-documents/share/ShareSettingsPanel'

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

export default function DocumentEditorPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [document, setDocument] = useState<ClientDocument | null>(null)
  const [version, setVersion] = useState<ClientDocumentVersion | null>(null)
  const [comments, setComments] = useState<DocumentComment[]>([])
  const [loading, setLoading] = useState(true)
  const [titleValue, setTitleValue] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [signing, setSigning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    setPublishing(true)
    try {
      await fetch(`/api/v1/client-documents/${id}/publish`, { method: 'POST' })
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

  async function handleCountersign() {
    setSigning(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/client-documents/${id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Peet Stander',
          capacity: 'Founder',
          companyName: 'The Partners in Business',
          signatureText: 'Peet Stander',
        }),
      })
      if (!res.ok) throw new Error(`Failed to countersign document: ${res.status}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to countersign document')
    } finally {
      setSigning(false)
    }
  }

  if (loading) return <Skeleton />

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">{error}</p>
        <button onClick={load} className="mt-2 text-sm underline">
          Retry
        </button>
      </div>
    )
  }

  if (!document || !version) {
    return <p className="p-6 text-sm text-on-surface-variant">Document not found.</p>
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top action bar */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--color-outline)] bg-[var(--color-surface)] px-4 py-3">
        <Link
          href="/admin/documents"
          className="mr-2 text-xs text-on-surface-variant hover:text-on-surface"
        >
          ← Documents
        </Link>

        <input
          className="flex-1 bg-transparent text-base font-semibold outline-none focus:ring-0"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onBlur={handleTitleBlur}
          aria-label="Document title"
        />

        <span
          className={`shrink-0 rounded px-2 py-1 text-[10px] uppercase tracking-wide ${
            STATUS_PILL[document.status] ?? 'bg-gray-800 text-gray-300'
          }`}
        >
          {readable(document.status)}
        </span>

        <Link
          href={`/admin/documents/${id}/preview`}
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
            {publishing ? 'Publishing…' : 'Publish'}
          </button>
        )}

        {document.approvalMode === 'formal_acceptance' && document.latestPublishedVersionId && !document.providerSignature && (
          <button
            onClick={handleCountersign}
            disabled={signing}
            className="shrink-0 rounded bg-[var(--color-pib-accent)] px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
          >
            {signing ? 'Signing...' : 'Countersign'}
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

      {document.approvalMode === 'formal_acceptance' && (
        <div className="border-b border-[var(--color-outline)] bg-[var(--color-pib-surface)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-pib-text-muted)]">
            <span className="font-semibold uppercase tracking-wider text-[var(--color-pib-text)]">
              PiB countersignature
            </span>
            {document.providerSignature ? (
              <span>
                Signed by {document.providerSignature.name} as {document.providerSignature.capacity}.
              </span>
            ) : document.latestPublishedVersionId ? (
              <span>Ready for Peet to countersign the published agreement.</span>
            ) : (
              <span>Publish the agreement before countersigning.</span>
            )}
          </div>
        </div>
      )}

      {/* Share settings — collapsible under the top bar so it's near the existing Share button */}
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

      {/* Editor shell */}
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
  )
}
