'use client'

import type { ClientDocument, ClientDocumentVersion, DocumentBlock, DocumentComment } from '@/lib/client-documents/types'

import { DocumentBlockEditor } from './DocumentBlockEditor'
import { DocumentReviewRail } from './DocumentReviewRail'

export function DocumentEditorShell({
  document,
  version,
  comments,
  documentId,
  onPublish,
  onVersionSaved,
}: {
  document: ClientDocument
  version: ClientDocumentVersion
  comments: DocumentComment[]
  documentId?: string
  onPublish?: () => void
  onVersionSaved?: () => void
}) {
  async function handleBlockChange(updated: DocumentBlock) {
    if (!documentId) return
    const updatedBlocks = version.blocks.map((b) => (b.id === updated.id ? updated : b))
    await fetch(`/api/v1/client-documents/${documentId}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks: updatedBlocks,
        theme: version.theme,
        changeSummary: `Edited block: ${updated.title ?? updated.type}`,
      }),
    })
    onVersionSaved?.()
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 bg-[#0A0A0B] px-5 py-12 md:px-10">
        <div className="mx-auto max-w-5xl">
          <header className="flex min-h-[20vh] flex-col justify-end border-b border-white/10 pb-10">
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">
              {document.type.replaceAll('_', ' ')}
            </p>
            <h1 className="mt-4 text-4xl font-semibold text-white/90">{document.title}</h1>
            <p className="mt-2 text-xs text-white/40">Version {version.versionNumber}</p>
          </header>
          <div className="pt-4">
            {version.blocks.map((block) => (
              <DocumentBlockEditor
                key={block.id}
                block={block}
                orgId={document.orgId}
                onChange={handleBlockChange}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="border-l border-[var(--color-outline)] bg-[var(--color-surface)] p-4 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <DocumentReviewRail document={document} comments={comments} onPublish={onPublish} />
      </div>
    </div>
  )
}
