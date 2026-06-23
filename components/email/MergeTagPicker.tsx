'use client'

// components/email/MergeTagPicker.tsx
//
// Merge-tag picker + per-field fallback editor for the campaign editor.
//   - lists available {{tags}} (click to insert via onInsert)
//   - lets the operator set a fallback string per tag (controlled via
//     value/onChange so the editor owns `mergeTagFallbacks` on the campaign doc)
//   - optionally shows which tags are currently used + whether each has a
//     fallback, so the operator can fix gaps before sending.
//
// Usage (in EmailCampaignEditor.tsx):
//   <MergeTagPicker
//     fallbacks={mergeTagFallbacks}
//     onChange={setMergeTagFallbacks}
//     onInsert={(tag) => insertAtCursor(`{{${tag}}}`)}
//     usedTags={extractMergeTags(subject, bodyHtml).used}
//   />

import { useState } from 'react'
import {
  MERGE_TAGS,
  type MergeTagFallbacks,
} from '@/lib/email/merge-tags'

interface Props {
  /** Controlled map of tag → fallback string. */
  fallbacks: MergeTagFallbacks
  onChange: (next: MergeTagFallbacks) => void
  /** Insert `{{tag}}` at the editor's cursor. When omitted the insert chips are hidden. */
  onInsert?: (tag: string) => void
  /** Tags currently referenced by the campaign content — drives the "needs fallback" hints. */
  usedTags?: string[]
  disabled?: boolean
}

// `email` always resolves (every contact has an address) → never needs a fallback.
const ALWAYS_RESOLVABLE = new Set(['email'])

export default function MergeTagPicker({
  fallbacks,
  onChange,
  onInsert,
  usedTags = [],
  disabled,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const usedSet = new Set(usedTags.map((t) => t.toLowerCase()))

  function setFallback(key: string, value: string) {
    onChange({ ...fallbacks, [key]: value })
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3 text-on-surface">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-amber-300">Merge tags</h3>
          <p className="text-xs text-on-surface-variant">
            Personalise with contact fields. Set a fallback for when a field is empty.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-amber-300 hover:underline"
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
      </div>

      {expanded && (
        <div className="space-y-3">
          {onInsert && (
            <div className="flex flex-wrap gap-2">
              {MERGE_TAGS.map((tag) => (
                <button
                  key={tag.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onInsert(tag.key)}
                  title={tag.description}
                  className="rounded-md bg-white/5 px-2.5 py-1.5 text-xs font-mono text-amber-200 hover:bg-white/10 disabled:opacity-40"
                >
                  {'{{'}{tag.key}{'}}'}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {MERGE_TAGS.map((tag) => {
              const isUsed = usedSet.has(tag.key)
              const fb = fallbacks[tag.key] ?? ''
              const needsFallback =
                isUsed && !ALWAYS_RESOLVABLE.has(tag.key) && fb.trim().length === 0
              return (
                <div
                  key={tag.key}
                  className={`grid grid-cols-[1fr_1.4fr] items-center gap-3 rounded-lg border px-3 py-2 ${
                    needsFallback ? 'border-amber-500/40 bg-amber-500/5' : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-amber-200">{'{{'}{tag.key}{'}}'}</span>
                      {isUsed && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-200">
                          in use
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-on-surface-variant" title={tag.description}>
                      {tag.label}
                    </div>
                  </div>
                  <div>
                    {ALWAYS_RESOLVABLE.has(tag.key) ? (
                      <span className="text-xs text-on-surface-variant italic">Always resolves — no fallback needed</span>
                    ) : (
                      <input
                        value={fb}
                        disabled={disabled}
                        placeholder={tag.defaultFallback ? `Fallback (e.g. "${tag.defaultFallback}")` : 'Fallback text'}
                        onChange={(e) => setFallback(tag.key, e.target.value)}
                        className={`w-full rounded-md border bg-black/50 px-3 py-1.5 text-sm ${
                          needsFallback ? 'border-amber-500/50' : 'border-white/10'
                        }`}
                      />
                    )}
                    {needsFallback && (
                      <p className="mt-1 text-[11px] text-amber-300">
                        Used in this campaign but has no fallback — contacts missing this field will see a gap.
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
