'use client'

import { chatContextReferenceKey, type ChatContextReference } from '@/lib/chat-context/types'

export interface ChatContextOption extends ChatContextReference { label: string; href?: string; summary?: string }

export function ContextSelector({ options, value, onChange }: { options: ChatContextOption[]; value: ChatContextReference; onChange: (value: ChatContextReference) => void }) {
  if (options.length < 2) return <span className="min-w-0 truncate text-xs font-medium text-on-surface">{options[0]?.label}</span>
  const optionValue = (item: ChatContextReference) => chatContextReferenceKey(item)
  return <select aria-label="Active context" value={optionValue(value)} onChange={(event) => {
    // Older persisted/browser values used a literal `kind:id` key. Continue
    // accepting them while the controlled value uses the unambiguous encoded
    // form required for IDs that themselves contain colons.
    const option = options.find((item) => (
      optionValue(item) === event.target.value
      || `${item.kind}:${item.id}` === event.target.value
    ))
    if (option) onChange({ kind: option.kind, id: option.id, ...(option.projectId ? { projectId: option.projectId } : {}), ...(option.workbenchPath ? { workbenchPath: option.workbenchPath } : {}) })
  }} className="min-h-11 min-w-0 max-w-[190px] truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs font-medium text-on-surface outline-none transition-colors focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/30 xl:min-h-0">
    {options.map((option) => <option key={chatContextReferenceKey(option)} value={optionValue(option)}>{option.label}</option>)}
  </select>
}
