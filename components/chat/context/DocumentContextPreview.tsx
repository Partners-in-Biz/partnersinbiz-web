'use client'

import { useEffect, useState } from 'react'
import { DocumentRenderer } from '@/components/client-documents/DocumentRenderer'
import type { ClientDocument, ClientDocumentVersion } from '@/lib/client-documents/types'

export function DocumentContextPreview({ documentId }: { documentId: string }) {
  const [document, setDocument] = useState<ClientDocument | null>(null)
  const [version, setVersion] = useState<ClientDocumentVersion | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    Promise.all([
      fetch(`/api/v1/client-documents/${encodeURIComponent(documentId)}`, { signal: controller.signal }),
      fetch(`/api/v1/client-documents/${encodeURIComponent(documentId)}/versions`, { signal: controller.signal }),
    ]).then(async ([documentResponse, versionsResponse]) => {
      if (!documentResponse.ok || !versionsResponse.ok) throw new Error('Document preview unavailable')
      const documentBody = await documentResponse.json()
      const versionsBody = await versionsResponse.json()
      const nextDocument = (documentBody.data ?? documentBody) as ClientDocument
      const versions = (versionsBody.data ?? []) as ClientDocumentVersion[]
      const nextVersion = versions.find((item) => item.id === nextDocument.currentVersionId)
        ?? versions.find((item) => item.status === 'published')
        ?? versions.at(-1)
        ?? null
      if (!nextVersion) throw new Error('Document version unavailable')
      setDocument(nextDocument)
      setVersion(nextVersion)
      setState('ready')
    }).catch((cause) => {
      if (controller.signal.aborted) return
      void cause
      setState('error')
    })
    return () => controller.abort()
  }, [documentId])

  if (state === 'loading') return <div className="grid min-h-48 place-items-center rounded-xl border border-[var(--color-card-border)] bg-black/10 text-xs text-[var(--color-pib-text-muted)]"><span className="inline-flex items-center gap-2"><span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>Loading document preview…</span></div>
  if (state === 'error' || !document || !version) return <div role="status" className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-4 text-xs text-amber-100">The document preview is unavailable. Open the full document workspace to continue.</div>

  return (
    <div data-testid="context-document-renderer" className="max-h-[58dvh] overflow-auto rounded-xl border border-[var(--color-card-border)] bg-black/15 [&_article]:!min-h-0 [&_article]:!rounded-none [&_article]:!px-4 [&_article]:!py-5 [&_h1]:!text-2xl [&_h2]:!text-xl">
      <DocumentRenderer document={document} version={version} />
    </div>
  )
}
