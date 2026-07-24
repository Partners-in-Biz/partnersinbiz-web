'use client'

import { useState } from 'react'
import type { WorkbenchFileNode, WorkbenchFilePreview } from '@/lib/messages/workbench/types'

function FileNodeRow({
  node,
  depth,
  selectedPath,
  onSelectPath,
}: {
  node: WorkbenchFileNode
  depth: number
  selectedPath?: string | null
  onSelectPath?: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isDirectory = node.kind === 'directory'
  const isSelected = !isDirectory && node.path === selectedPath

  return (
    <div>
      <button
        type="button"
        onClick={() => (isDirectory ? setExpanded((value) => !value) : onSelectPath?.(node.path))}
        className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left text-[12px] hover:bg-white/[0.05] ${
          isSelected ? 'bg-primary/10 text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text)]'
        }`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        aria-expanded={isDirectory ? expanded : undefined}
        aria-pressed={isDirectory ? undefined : isSelected}
      >
        {isDirectory ? (
          <span aria-hidden="true" className="material-symbols-outlined w-[15px] text-[15px] text-[var(--color-pib-text-muted)]">
            {expanded ? 'expand_more' : 'chevron_right'}
          </span>
        ) : (
          <span className="w-[15px] shrink-0" />
        )}
        <span aria-hidden="true" className={`material-symbols-outlined text-[14px] ${isDirectory ? 'text-primary' : 'text-[var(--color-pib-text-muted)]'}`}>
          {isDirectory ? 'folder' : 'description'}
        </span>
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {isDirectory && expanded && node.children?.map((child) => (
        <FileNodeRow key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelectPath={onSelectPath} />
      ))}
    </div>
  )
}

function FilePreviewPane({ preview }: { preview: WorkbenchFilePreview }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--color-card-border)]">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-card-border)] px-2.5 py-1.5">
        <span aria-hidden="true" className="material-symbols-outlined text-[13px] text-[var(--color-pib-text-muted)]">description</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--color-pib-text-muted)]">{preview.path}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {preview.loading ? (
          <p className="text-[11px] text-[var(--color-pib-text-muted)]">Loading…</p>
        ) : preview.error ? (
          <p className="text-[11px] text-red-300">{preview.error}</p>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[var(--color-pib-text-muted)] [overflow-wrap:anywhere]">
            {preview.content ?? ''}
          </pre>
        )}
      </div>
    </div>
  )
}

export interface WorkbenchFilesPanelProps {
  tree: WorkbenchFileNode[]
  selectedPath?: string | null
  onSelectPath?: (path: string) => void
  preview?: WorkbenchFilePreview | null
}

export function WorkbenchFilesPanel({ tree, selectedPath, onSelectPath, preview }: WorkbenchFilesPanelProps) {
  if (tree.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-[var(--color-pib-text-muted)]">folder_off</span>
        <p className="text-xs font-medium text-[var(--color-pib-text)]">No files detected yet</p>
        <p className="text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
          Without a linked-computer sync, this tree is inferred from tool activity in the conversation — file paths
          mentioned in read, write, edit and list-directory calls. Nothing has been touched yet in this run.
        </p>
      </div>
    )
  }

  return (
    <div data-testid="workbench-files-panel" className="flex h-full min-h-0 flex-col">
      <div className={`min-h-0 overflow-y-auto p-2 text-[var(--color-pib-text)] ${preview ? 'max-h-[45%] shrink-0 border-b border-[var(--color-card-border)]' : 'flex-1'}`}>
        {tree.map((node) => (
          <FileNodeRow key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelectPath={onSelectPath} />
        ))}
      </div>
      {preview && <FilePreviewPane preview={preview} />}
    </div>
  )
}

export default WorkbenchFilesPanel
