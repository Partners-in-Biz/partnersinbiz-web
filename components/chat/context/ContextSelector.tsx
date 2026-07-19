'use client'

import type { ChatContextReference } from '@/lib/chat-context/types'

export interface ChatContextOption extends ChatContextReference { label: string; href?: string; summary?: string }

export function ContextSelector({ options, value, onChange }: { options: ChatContextOption[]; value: ChatContextReference; onChange: (value: ChatContextReference) => void }) {
  if (options.length < 2) return <span className="min-w-0 truncate text-xs font-semibold text-on-surface">{options[0]?.label}</span>
  const encoded = `${value.kind}:${value.id}`
  return <select aria-label="Active context" value={encoded} onChange={(event) => {
    const option = options.find((item) => `${item.kind}:${item.id}` === event.target.value)
    if (option) onChange({ kind: option.kind, id: option.id })
  }} className="min-w-0 max-w-[190px] truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs font-semibold text-on-surface outline-none transition-colors focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/30">
    {options.map((option) => <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>{option.label}</option>)}
  </select>
}
