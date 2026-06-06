'use client'
/* eslint-disable react-hooks/static-components */

import { useMemo } from 'react'
import type { DocumentBlock, DocumentBlockVisibility } from '@/lib/client-documents/types'
import { ContextReferencePicker } from '@/components/context-references/ContextReferencePicker'
import { getEditor } from './blocks'

const VISIBILITY_OPTIONS: Array<{ value: DocumentBlockVisibility; label: string; help: string }> = [
  { value: 'client-visible', label: 'Client-visible', help: 'Rendered in client previews and share links.' },
  { value: 'internal-only', label: 'Internal-only', help: 'Shown in admin/internal preview only.' },
  { value: 'hidden', label: 'Hidden', help: 'Not rendered in previews.' },
]

export function DocumentBlockEditor({
  block,
  onChange,
  orgId,
}: {
  block: DocumentBlock
  onChange: (block: DocumentBlock) => void
  orgId?: string
}) {
  const Editor = useMemo(() => getEditor(block.type), [block.type])
  const visibility = block.visibility ?? 'client-visible'

  return (
    <div className="rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="pill !text-[10px] !py-0.5 !px-2">{block.type}</span>
          <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-0.5 text-[10px] text-white/60">
            {visibility.replace('-', ' ')}
          </span>
          {block.locked && <span className="text-[10px] text-amber-400">Locked</span>}
        </div>
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-white/45">
          Visibility
          <select
            aria-label={`Visibility for ${block.title ?? block.type}`}
            className="rounded border border-white/10 bg-black/20 px-2 py-1 text-xs normal-case tracking-normal text-white/80"
            value={visibility}
            onChange={(event) => onChange({ ...block, visibility: event.target.value as DocumentBlockVisibility })}
          >
            {VISIBILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-4 rounded-lg border border-white/10 bg-black/15 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/45">Internal CRM context</p>
            <p className="mt-1 text-xs text-white/45">
              Links stay attached to the block as internal chips and are not inserted into client-visible copy.
            </p>
          </div>
        </div>
        <ContextReferencePicker
          orgId={orgId}
          value={block.contextRefs ?? []}
          onChange={(contextRefs) => onChange({ ...block, contextRefs })}
          inputLabel={`Link CRM context to ${block.title ?? block.type}`}
          placeholder="@companies: @contacts: @projects:"
          compact
        />
      </div>

      <Editor block={block} onChange={onChange} />
    </div>
  )
}
