'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClientDocument, ClientDocumentVersion, DocumentBlock, DocumentComment } from '@/lib/client-documents/types'

import { DocumentBlockEditor } from './DocumentBlockEditor'
import { DocumentReviewRail } from './DocumentReviewRail'

type SaveState = 'saved' | 'dirty' | 'saving'

/** Strip HTML tags and collapse entities enough to count words. */
function countWordsIn(value: string): number {
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
  const matches = text.trim().match(/\S+/g)
  return matches ? matches.length : 0
}

function wordCount(blocks: DocumentBlock[]): number {
  return blocks.reduce((total, block) => {
    let count = 0
    if (typeof block.content === 'string') count += countWordsIn(block.content)
    if (typeof block.title === 'string') count += countWordsIn(block.title)
    return total + count
  }, 0)
}

export function DocumentEditorShell({
  document: doc,
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
  const [blocks, setBlocks] = useState<DocumentBlock[]>(version.blocks)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [fullscreen, setFullscreen] = useState(false)

  // Refs let the interval/unmount handlers read the freshest values without
  // re-subscribing on every keystroke.
  const blocksRef = useRef(blocks)
  const dirtyRef = useRef(false)

  useEffect(() => {
    blocksRef.current = blocks
  }, [blocks])

  // Re-seed local state if the version being edited changes.
  useEffect(() => {
    setBlocks(version.blocks)
    dirtyRef.current = false
    setSaveState('saved')
  }, [version.id, version.blocks])

  const persist = useCallback(
    async (nextBlocks: DocumentBlock[], changeSummary: string, useKeepalive = false) => {
      if (!documentId) return
      await fetch(`/api/v1/client-documents/${documentId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: useKeepalive,
        body: JSON.stringify({
          blocks: nextBlocks,
          theme: version.theme,
          changeSummary,
        }),
      })
    },
    [documentId, version.theme],
  )

  function handleBlockChange(updated: DocumentBlock) {
    setBlocks((current) => current.map((b) => (b.id === updated.id ? updated : b)))
    dirtyRef.current = true
    setSaveState('dirty')
  }

  const saveNow = useCallback(async () => {
    if (!documentId || !dirtyRef.current) return
    setSaveState('saving')
    dirtyRef.current = false
    try {
      await persist(blocksRef.current, 'Auto-saved draft')
      setSaveState('saved')
      onVersionSaved?.()
    } catch {
      // Restore the dirty flag so the next tick retries.
      dirtyRef.current = true
      setSaveState('dirty')
    }
  }, [documentId, persist, onVersionSaved])

  // Auto-save loop: flush any pending edits every 30 seconds.
  useEffect(() => {
    if (!documentId) return
    const interval = window.setInterval(() => {
      if (dirtyRef.current) void saveNow()
    }, 30000)
    return () => window.clearInterval(interval)
  }, [documentId, saveNow])

  // Best-effort final flush on unmount.
  useEffect(() => {
    return () => {
      if (documentId && dirtyRef.current) {
        void persist(blocksRef.current, 'Auto-saved draft', true)
      }
    }
  }, [documentId, persist])

  const totalWords = useMemo(() => wordCount(blocks), [blocks])

  const saveLabel =
    saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved changes' : 'Saved'

  const editorColumnClass = fullscreen
    ? 'fixed inset-0 z-50 min-w-0 overflow-y-auto bg-[#0A0A0B] px-5 py-12 md:px-10'
    : 'min-w-0 bg-[#0A0A0B] px-5 py-12 md:px-10'

  return (
    <div
      className={
        fullscreen
          ? 'min-h-screen'
          : 'grid min-h-screen lg:grid-cols-[minmax(0,1fr)_360px]'
      }
    >
      <div className={editorColumnClass}>
        <div className="mx-auto max-w-5xl pb-16">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-white/50">
              <span
                className={`inline-flex h-2 w-2 rounded-full ${
                  saveState === 'saved'
                    ? 'bg-emerald-400'
                    : saveState === 'saving'
                      ? 'bg-amber-400'
                      : 'bg-white/40'
                }`}
              />
              {saveLabel}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveNow()}
                disabled={saveState !== 'dirty'}
                className="inline-flex items-center gap-1.5 rounded border border-white/15 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-base">save</span>
                Save now
              </button>
              <button
                type="button"
                onClick={() => setFullscreen((current) => !current)}
                aria-pressed={fullscreen}
                className="inline-flex h-8 w-8 items-center justify-center rounded border border-white/15 text-white/80 transition hover:bg-white/10"
                title={fullscreen ? 'Exit full screen' : 'Full screen'}
                aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
              >
                <span className="material-symbols-outlined text-base">
                  {fullscreen ? 'fullscreen_exit' : 'fullscreen'}
                </span>
              </button>
            </div>
          </div>

          <header className="flex min-h-[20vh] flex-col justify-end border-b border-white/10 pb-10">
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">
              {doc.type.replaceAll('_', ' ')}
            </p>
            <h1 className="mt-4 text-4xl font-semibold text-white/90">{doc.title}</h1>
            <p className="mt-2 text-xs text-white/40">Version {version.versionNumber}</p>
          </header>
          <div className="pt-4">
            {blocks.map((block) => (
              <DocumentBlockEditor
                key={block.id}
                block={block}
                orgId={doc.orgId}
                onChange={handleBlockChange}
              />
            ))}
          </div>
        </div>

        <div className="sticky bottom-0 left-0 right-0 border-t border-white/10 bg-[#0A0A0B]/95 px-5 py-2 text-xs text-white/50 backdrop-blur md:px-10">
          {totalWords} {totalWords === 1 ? 'word' : 'words'} • {blocks.length}{' '}
          {blocks.length === 1 ? 'block' : 'blocks'}
        </div>
      </div>

      {!fullscreen && (
        <div className="border-l border-[var(--color-outline)] bg-[var(--color-surface)] p-4 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
          <DocumentReviewRail document={doc} comments={comments} onPublish={onPublish} />
        </div>
      )}
    </div>
  )
}
