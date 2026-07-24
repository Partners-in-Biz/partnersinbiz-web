'use client'

import { useState } from 'react'
import type { WorkbenchFileNode } from '@/lib/messages/workbench/types'

function FileNodeRow({ node, depth }: { node: WorkbenchFileNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isDirectory = node.kind === 'directory'

  return (
    <div>
      <button
        type="button"
        onClick={() => isDirectory && setExpanded((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left text-[12px] text-[var(--color-pib-text)] hover:bg-white/[0.05]"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        aria-expanded={isDirectory ? expanded : undefined}
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
        <FileNodeRow key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function WorkbenchFilesPanel({ tree }: { tree: WorkbenchFileNode[] }) {
  if (tree.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <span aria-hidden="true" className="material-symbols-outlined text-[28px] text-[var(--color-pib-text-muted)]">folder_off</span>
        <p className="text-xs font-medium text-[var(--color-pib-text)]">No files detected yet</p>
        <p className="text-[11px] leading-relaxed text-[var(--color-pib-text-muted)]">
          Phase 1 derives this tree from tool activity in the conversation — file paths mentioned in read, write, edit
          and list-directory calls. Nothing has been touched yet in this run.
        </p>
      </div>
    )
  }

  return (
    <div data-testid="workbench-files-panel" className="h-full space-y-0.5 overflow-y-auto p-2 text-[var(--color-pib-text)]">
      {tree.map((node) => (
        <FileNodeRow key={node.path} node={node} depth={0} />
      ))}
    </div>
  )
}

export default WorkbenchFilesPanel
