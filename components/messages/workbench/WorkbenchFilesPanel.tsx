'use client'

import { useEffect, useState } from 'react'
import type { WorkbenchFileNode, WorkbenchFilePreview } from '@/lib/messages/workbench/types'
import { Icon } from '@/components/studio'

function FileNodeRow({
  node,
  depth,
  selectedPath,
  onSelectPath,
  onExpandDirectory,
}: {
  node: WorkbenchFileNode
  depth: number
  selectedPath?: string | null
  onSelectPath?: (path: string) => void
  onExpandDirectory?: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 1 && Boolean(node.children?.length))
  const isDirectory = node.kind === 'directory'
  const isSelected = !isDirectory && node.path === selectedPath

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (!isDirectory) return onSelectPath?.(node.path)
          setExpanded((value) => {
            const next = !value
            if (next) onExpandDirectory?.(node.path)
            return next
          })
        }}
        className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left text-[12px] hover:bg-[var(--color-pib-surface-muted)] ${
          isSelected ? 'bg-primary/10 text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text)]'
        }`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        aria-expanded={isDirectory ? expanded : undefined}
        aria-pressed={isDirectory ? undefined : isSelected}
      >
        {isDirectory ? (
          <Icon name={expanded ? 'expand_more' : 'chevron_right'} className="w-[15px] text-[15px] text-[var(--color-pib-text-muted)]" />
        ) : (
          <span className="w-[15px] shrink-0" />
        )}
        <Icon name={isDirectory ? 'folder' : 'description'} className={`text-[14px] ${isDirectory ? 'text-primary' : 'text-[var(--color-pib-text-muted)]'}`} />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {isDirectory && expanded && node.children?.map((child) => (
        <FileNodeRow key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelectPath={onSelectPath} onExpandDirectory={onExpandDirectory} />
      ))}
    </div>
  )
}

function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  return ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', css: 'css', scss: 'scss', html: 'html', md: 'markdown', py: 'python', sh: 'shell', yml: 'yaml', yaml: 'yaml' } as Record<string, string>)[extension ?? ''] ?? 'text'
}

function FilePreviewPane({
  preview,
  onSave,
}: {
  preview: WorkbenchFilePreview
  onSave?: (path: string, content: string, expectedSha256?: string) => Promise<{ sha256?: string } | void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(preview.content ?? '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    setEditing(false)
    setDraft(preview.content ?? '')
    setSaveState('idle')
    setSaveError(null)
  }, [preview.content, preview.path])

  const save = async () => {
    if (!onSave) return
    setSaveState('saving')
    setSaveError(null)
    try {
      await onSave(preview.path, draft, preview.sha256)
      setSaveState('saved')
      setEditing(false)
    } catch (error) {
      setSaveState('error')
      setSaveError(error instanceof Error ? error.message : 'File save failed')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--color-card-border)]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-card-border)] px-2.5 py-1.5">
        <Icon name="description" className="text-[13px] text-[var(--color-pib-text-muted)]" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-pib-text-muted)]">{preview.path}</span>
        {!preview.loading && !preview.error && onSave && !editing && (
          <button type="button" aria-label="Edit file" onClick={() => setEditing(true)} className="rounded px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)]">Edit</button>
        )}
        {saveState === 'saved' && <span role="status" className="text-[10px] text-emerald-300">Saved</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {preview.loading ? (
          <p className="text-[11px] text-[var(--color-pib-text-muted)]">Loading…</p>
        ) : preview.error ? (
          <p className="text-[11px] text-red-300">{preview.error}</p>
        ) : editing ? (
          <div className="flex h-full min-h-[180px] flex-col gap-2">
            <textarea aria-label="File contents" value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-0 flex-1 resize-none rounded-md border border-[var(--color-card-border)] bg-[var(--color-pib-surface-muted)] p-2 font-mono text-[11px] leading-relaxed text-[var(--color-pib-text)] outline-none focus:border-primary/60" />
            {saveError && <p role="alert" className="text-[10px] text-red-300">{saveError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setEditing(false); setDraft(preview.content ?? ''); setSaveError(null) }} className="rounded-md px-2 py-1 text-[10px] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-pib-surface-muted)]">Cancel</button>
              <button type="button" onClick={() => { void save() }} disabled={saveState === 'saving' || draft === (preview.content ?? '')} className="rounded-md bg-primary px-2 py-1 text-[10px] text-black disabled:opacity-50">{saveState === 'saving' ? 'Saving…' : 'Approve & save'}</button>
            </div>
          </div>
        ) : (
          <pre data-testid="workbench-syntax-preview" data-language={languageForPath(preview.path)} className="whitespace-pre-wrap break-words rounded-md bg-[var(--color-pib-surface-muted)] p-2 font-mono text-[11px] leading-relaxed text-sky-100 [overflow-wrap:anywhere]">
            <code>{preview.content ?? ''}</code>
          </pre>
        )}
      </div>
    </div>
  )
}

export interface WorkbenchFilesPanelProps {
  tree: WorkbenchFileNode[]
  message?: string | null
  selectedPath?: string | null
  onSelectPath?: (path: string) => void
  onExpandDirectory?: (path: string) => void
  preview?: WorkbenchFilePreview | null
  onSave?: (path: string, content: string, expectedSha256?: string) => Promise<{ sha256?: string } | void>
}

export function WorkbenchFilesPanel({ tree, message, selectedPath, onSelectPath, onExpandDirectory, preview, onSave }: WorkbenchFilesPanelProps) {
  if (tree.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <Icon name="folder_off" className="text-[28px] text-[var(--color-pib-text-muted)]" />
        {message ? (
          <>
            <p className="text-xs font-medium text-red-200">Files could not be loaded</p>
            <p role="alert" className="text-[11px] leading-relaxed text-red-300">{message}</p>
          </>
        ) : (
          <>
            <p className="text-xs font-medium text-[var(--color-pib-text)]">No files found</p>
            <p className="text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
              The linked workspace returned an empty folder. Refresh after checking that this project is linked to the correct folder.
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div data-testid="workbench-files-panel" className="flex h-full min-h-0 flex-col">
      {message && (
        <p role="alert" className="shrink-0 border-b border-red-400/20 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">
          {message}
        </p>
      )}
      <div className={`min-h-0 overflow-y-auto p-2 text-[var(--color-pib-text)] ${preview ? 'max-h-[45%] shrink-0 border-b border-[var(--color-card-border)]' : 'flex-1'}`}>
        {tree.map((node) => (
          <FileNodeRow key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelectPath={onSelectPath} onExpandDirectory={onExpandDirectory} />
        ))}
      </div>
      {preview && <FilePreviewPane preview={preview} onSave={onSave} />}
    </div>
  )
}

export default WorkbenchFilesPanel
