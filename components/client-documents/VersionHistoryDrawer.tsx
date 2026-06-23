'use client'

import { useEffect, useMemo, useState } from 'react'

import { fmtTimestamp } from '@/lib/format/timestamp'
import type { ClientDocumentVersion, DocumentBlock } from '@/lib/client-documents/types'

export interface VersionHistoryDrawerProps {
  documentId: string
  currentVersionId: string
  onRestored?: () => void
  onClose?: () => void
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

function readableType(type: string) {
  return type.replaceAll('_', ' ')
}

function blockPreviewText(block: DocumentBlock): string {
  const content = block.content
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (typeof content === 'number' || typeof content === 'boolean') return String(content)

  if (Array.isArray(content)) {
    return content
      .map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
      .join('\n')
  }

  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>
    // Common text-ish fields used across block types.
    const textual = ['headline', 'description', 'body', 'text', 'eyebrow', 'subtitle']
      .map((key) => obj[key])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    if (textual.length > 0) return textual.join('\n')
    try {
      return JSON.stringify(content, null, 2)
    } catch {
      return ''
    }
  }

  return ''
}

function VersionPreview({ version, label }: { version: ClientDocumentVersion | null; label: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">{label}</p>
      {!version ? (
        <p className="text-xs text-on-surface-variant">Select a version to preview.</p>
      ) : (
        <div className="space-y-3">
          {version.blocks.length === 0 ? (
            <p className="text-xs text-on-surface-variant">No content blocks.</p>
          ) : (
            version.blocks.map((block) => {
              const preview = blockPreviewText(block)
              return (
                <div key={block.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-wider text-on-surface-variant">
                      {readableType(block.type)}
                    </span>
                    {block.visibility && block.visibility !== 'client-visible' ? (
                      <span className="text-[9px] uppercase tracking-wider text-amber-300/80">
                        {block.visibility.replace('-', ' ')}
                      </span>
                    ) : null}
                  </div>
                  {block.title ? (
                    <p className="mt-1 text-sm font-medium text-on-surface">{block.title}</p>
                  ) : null}
                  {preview ? (
                    <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-xs text-on-surface-variant">
                      {preview.length > 600 ? `${preview.slice(0, 600)}…` : preview}
                    </pre>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

export function VersionHistoryDrawer({
  documentId,
  currentVersionId,
  onRestored,
  onClose,
}: VersionHistoryDrawerProps) {
  const [state, setState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [versions, setVersions] = useState<ClientDocumentVersion[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setState('loading')
      setError(null)
      try {
        const res = await fetch(`/api/v1/client-documents/${documentId}/versions`, {
          headers: { Accept: 'application/json' },
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          const message =
            (body && typeof body === 'object' && (body.error || body.message)) || 'Failed to load version history'
          throw new Error(String(message))
        }
        const data = (body && typeof body === 'object' && 'data' in body ? body.data : body) as
          | ClientDocumentVersion[]
          | null
        const list = Array.isArray(data) ? data : []
        const sorted = [...list].sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0))
        if (cancelled) return
        setVersions(sorted)
        setState('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load version history')
        setState('error')
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [documentId])

  const currentVersion = useMemo(
    () => versions.find((v) => v.id === currentVersionId) ?? null,
    [versions, currentVersionId],
  )
  const selectedVersion = useMemo(
    () => (selectedId ? versions.find((v) => v.id === selectedId) ?? null : null),
    [versions, selectedId],
  )

  async function handleRestore(versionId: string, versionNumber: number) {
    if (restoringId) return
    const confirmed = window.confirm(
      `Restore version ${versionNumber}? This creates a new version with its content and makes it current. Existing versions are preserved.`,
    )
    if (!confirmed) return

    setRestoringId(versionId)
    setError(null)
    try {
      const res = await fetch(`/api/v1/client-documents/${documentId}/versions/${versionId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const message =
          (body && typeof body === 'object' && (body.error || body.message)) || 'Failed to restore version'
        throw new Error(String(message))
      }
      onRestored?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore version')
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" role="dialog" aria-modal="true" aria-label="Version history">
      <button
        type="button"
        aria-label="Close version history"
        className="flex-1 cursor-default"
        onClick={onClose}
      />
      <div className="flex h-full w-full max-w-3xl flex-col border-l border-white/10 bg-[var(--color-pib-surface,#0A0A0B)] shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[var(--color-pib-accent)]" aria-hidden>
              history
            </span>
            <h2 className="font-display text-lg">Version history</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-on-surface-variant hover:bg-white/5 hover:text-on-surface"
          >
            <span className="material-symbols-outlined" aria-hidden>
              close
            </span>
          </button>
        </header>

        {error ? (
          <div className="mx-5 mt-4 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[260px_1fr]">
          {/* Version list */}
          <div className="min-h-0 overflow-y-auto border-b border-white/10 md:border-b-0 md:border-r">
            {state === 'loading' ? (
              <p className="px-5 py-4 text-xs text-on-surface-variant">Loading versions…</p>
            ) : state === 'error' ? (
              <p className="px-5 py-4 text-xs text-on-surface-variant">Could not load versions.</p>
            ) : versions.length === 0 ? (
              <p className="px-5 py-4 text-xs text-on-surface-variant">No versions yet.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {versions.map((version) => {
                  const isCurrent = version.id === currentVersionId
                  const isSelected = version.id === selectedId
                  return (
                    <li key={version.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(version.id)}
                        className={[
                          'block w-full px-4 py-3 text-left transition-colors',
                          isSelected ? 'bg-[var(--color-pib-accent)]/10' : 'hover:bg-white/5',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-on-surface">v{version.versionNumber}</span>
                          {isCurrent ? (
                            <span className="rounded-full bg-[var(--color-pib-accent)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-black">
                              Current
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-[11px] text-on-surface-variant">{fmtTimestamp(version.createdAt)}</p>
                        <p className="mt-0.5 text-[11px] text-on-surface-variant">By {version.createdBy}</p>
                        {version.changeSummary ? (
                          <p className="mt-1 text-xs text-on-surface-variant line-clamp-2">{version.changeSummary}</p>
                        ) : null}
                        {!isCurrent ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleRestore(version.id, version.versionNumber)
                            }}
                            disabled={restoringId !== null}
                            className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/5 disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[14px]" aria-hidden>
                              restore
                            </span>
                            {restoringId === version.id ? 'Restoring…' : 'Restore this version'}
                          </button>
                        ) : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Side-by-side preview */}
          <div className="min-h-0 overflow-y-auto px-5 py-4">
            {!selectedVersion ? (
              <p className="text-xs text-on-surface-variant">Select a version on the left to compare it with the current version.</p>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <VersionPreview
                  version={selectedVersion}
                  label={
                    selectedVersion.id === currentVersionId
                      ? `Selected · v${selectedVersion.versionNumber} (current)`
                      : `Selected · v${selectedVersion.versionNumber}`
                  }
                />
                <VersionPreview
                  version={currentVersion}
                  label={currentVersion ? `Current · v${currentVersion.versionNumber}` : 'Current'}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
