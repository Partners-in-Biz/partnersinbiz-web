'use client'

import { Icon } from '@/components/studio'
import { useEffect, useRef, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { DocumentRenderer } from '@/components/client-documents/DocumentRenderer'
import type { ClientDocument, ClientDocumentVersion } from '@/lib/client-documents/types'
import { db } from '@/lib/firebase/client'
import { usePreviewLiveReloadKey } from './usePreviewLiveReload'

export function DocumentContextPreview({
  documentId,
  refreshRevision = 0,
}: {
  documentId: string
  refreshRevision?: number
}) {
  const [document, setDocument] = useState<ClientDocument | null>(null)
  const [version, setVersion] = useState<ClientDocumentVersion | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [liveVersionHint, setLiveVersionHint] = useState(0)
  const reload = usePreviewLiveReloadKey(documentId)
  const currentVersionIdRef = useRef<string | null>(null)

  // Live Firestore: when agent writes a new currentVersionId, soft-refresh without leaving the dock.
  useEffect(() => {
    if (!documentId || !db) return
    currentVersionIdRef.current = null
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = onSnapshot(
        doc(db, 'client_documents', documentId),
        (snapshot) => {
          if (!snapshot.exists()) return
          const data = snapshot.data()
          const nextVersionId = typeof data?.currentVersionId === 'string' ? data.currentVersionId : null
          if (!nextVersionId) return
          if (currentVersionIdRef.current === null) {
            currentVersionIdRef.current = nextVersionId
            return
          }
          if (currentVersionIdRef.current !== nextVersionId) {
            currentVersionIdRef.current = nextVersionId
            setLiveVersionHint((value) => value + 1)
          }
        },
        () => {
          /* ignore permission/offline - HTTP reload still works via refreshRevision */
        },
      )
    } catch {
      return
    }
    return () => {
      try { unsubscribe?.() } catch { /* noop */ }
    }
  }, [documentId])

  useEffect(() => {
    const controller = new AbortController()
    const initial = reload.isInitialLoad()
    reload.beginLoad()
    if (initial) setState('loading')
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
      if (typeof nextDocument.currentVersionId === 'string') {
        currentVersionIdRef.current = nextDocument.currentVersionId
      }
      setDocument(nextDocument)
      setVersion(nextVersion)
      setState('ready')
      reload.endLoadSuccess()
    }).catch((cause) => {
      if (controller.signal.aborted) return
      void cause
      reload.endLoadError()
      if (initial) setState('error')
    })
    return () => controller.abort()
    // reload helpers are stable for a given documentId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, liveVersionHint, refreshRevision])

  if (state === 'loading') {
    return (
      <div className="grid min-h-48 place-items-center rounded-[6px] border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] text-xs text-[var(--color-pib-text-muted)]">
        <span className="inline-flex items-center gap-2">
          <Icon name="progress_activity" className="animate-spin text-[18px]" />
          Loading document preview…
        </span>
      </div>
    )
  }
  if (state === 'error' || !document || !version) {
    return (
      <div role="status" className="rounded-[6px] border border-amber-400/20 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] px-3 py-4 text-xs text-[var(--st-warning)]">
        The document preview is unavailable. Open the full document workspace to continue.
      </div>
    )
  }

  return (
    <div
      data-testid="context-document-renderer"
      className="relative max-h-[58dvh] overflow-auto rounded-[6px] border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] [&_article]:!min-h-0 [&_article]:!rounded-none [&_article]:!px-4 [&_article]:!py-5 [&_h1]:!text-2xl [&_h2]:!text-xl"
    >
      {reload.softRefreshing && (
        <div className="sticky top-0 z-10 flex justify-end p-1" aria-live="polite">
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-[var(--color-card-border)] bg-[var(--color-pib-surface)] px-2 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">
            <Icon name="progress_activity" className="animate-spin text-[12px]" />
            Updating…
          </span>
        </div>
      )}
      <DocumentRenderer document={document} version={version} />
    </div>
  )
}
