'use client'

import { Icon } from '@/components/studio'
import { useCallback, useEffect, useState } from 'react'
import { WorkbenchFilesPanel } from '@/components/messages/workbench/WorkbenchFilesPanel'
import { mergeWorkbenchDirectory, runConversationWorkbenchJob, workbenchEntriesToTree, workbenchJobResult } from '@/lib/messages/workbench/client'
import type { WorkbenchFileNode } from '@/lib/messages/workbench/types'

type WorkbenchEntry = { path: string; type: 'file' | 'directory'; size?: number }

/**
 * A linked-folder pin is a live, conversation-scoped filesystem reference.
 * Reuse the Files panel so its preview behaves exactly like the Workbench
 * rather than presenting a stale metadata-only summary.
 */
export function LinkedWorkbenchFolderPreview({ conversationId, path }: { conversationId: string; path: string }) {
  const [tree, setTree] = useState<WorkbenchFileNode[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const loadFolder = useCallback(async () => {
    setLoading(true)
    try {
      const job = await runConversationWorkbenchJob(conversationId, { kind: 'fs.list', path })
      const result = workbenchJobResult<{ entries: WorkbenchEntry[] }>(job)
      setTree(workbenchEntriesToTree(result.entries))
      setMessage(null)
    } catch (error) {
      setTree([])
      setMessage(error instanceof Error ? error.message : 'Unable to load this linked folder')
    } finally {
      setLoading(false)
    }
  }, [conversationId, path])

  const expandDirectory = useCallback(async (directoryPath: string) => {
    try {
      const job = await runConversationWorkbenchJob(conversationId, { kind: 'fs.list', path: directoryPath })
      const result = workbenchJobResult<{ entries: WorkbenchEntry[] }>(job)
      setTree((current) => mergeWorkbenchDirectory(current, directoryPath, result.entries))
      setMessage(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Unable to load ${directoryPath}`)
    }
  }, [conversationId])

  useEffect(() => { void loadFolder() }, [loadFolder])

  return (
    <section aria-label="Linked folder contents" className="overflow-hidden rounded-[6px] border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-card-border)] px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-[10px] font-label uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">Linked folder</h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-pib-text)]">{path}</p>
        </div>
        <button type="button" aria-label="Refresh linked folder" onClick={() => { void loadFolder() }} disabled={loading} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)] disabled:opacity-50">
          <Icon name="refresh" className={`text-[16px] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="h-72">
        {loading && tree.length === 0
          ? <div role="status" className="grid h-full place-items-center text-xs text-[var(--color-pib-text-muted)]">Loading folder structure…</div>
          : <WorkbenchFilesPanel tree={tree} message={message} onExpandDirectory={(directoryPath) => { void expandDirectory(directoryPath) }} />}
      </div>
    </section>
  )
}
