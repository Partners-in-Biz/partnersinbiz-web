'use client'

import { useMemo, useRef, useState } from 'react'
import {
  filterContextReferenceMentionOptions,
  findActiveContextMention,
  findActiveContextTypePrompt,
  removeMentionToken,
  replaceTypePromptToken,
  type ContextReferenceMentionOption,
} from '@/lib/context-references/composer'
import {
  contextReferenceKey,
  MAX_CONTEXT_REFS,
  type ContextReference,
} from '@/lib/context-references/types'
import {
  ContextReferenceChips,
  contextReferenceDisplay,
  mergeContextReferences,
} from './ContextReferenceChips'

interface ContextReferencePickerProps {
  orgId?: string
  projectId?: string
  value: ContextReference[]
  onChange: (refs: ContextReference[]) => void
  inputLabel: string
  placeholder?: string
  disabled?: boolean
  compact?: boolean
}

function withProjectMetadata(ref: ContextReference, projectId?: string): ContextReference {
  if (ref.type !== 'task' || !projectId) return ref
  return {
    ...ref,
    metadata: {
      ...(ref.metadata ?? {}),
      projectId,
    },
  }
}

export function ContextReferencePicker({
  orgId,
  projectId,
  value,
  onChange,
  inputLabel,
  placeholder = '@contacts: @projects: @tasks:',
  disabled = false,
  compact = false,
}: ContextReferencePickerProps) {
  const [input, setInput] = useState('')
  const [results, setResults] = useState<ContextReference[]>([])
  const [loading, setLoading] = useState(false)
  const searchSeq = useRef(0)
  const activeMention = useMemo(() => findActiveContextMention(input), [input])
  const activeTypePrompt = useMemo(
    () => (activeMention ? null : findActiveContextTypePrompt(input)),
    [activeMention, input],
  )
  const contextTypeOptions = useMemo(
    () => (activeTypePrompt ? filterContextReferenceMentionOptions(activeTypePrompt.query) : []),
    [activeTypePrompt],
  )

  async function searchMention(nextInput: string) {
    const mention = findActiveContextMention(nextInput)
    if (!orgId || !mention) {
      setResults([])
      setLoading(false)
      return
    }

    const seq = searchSeq.current + 1
    searchSeq.current = seq
    const params = new URLSearchParams({
      orgId,
      type: mention.type,
      q: mention.query,
      limit: String(MAX_CONTEXT_REFS),
    })
    if (mention.type === 'task' && projectId) params.set('projectId', projectId)

    setLoading(true)
    try {
      const res = await fetch(`/api/v1/context-references/search?${params.toString()}`)
      const body = await res.json().catch(() => ({}))
      if (searchSeq.current !== seq) return
      const refs = Array.isArray(body?.data?.refs) ? body.data.refs : []
      setResults(refs.map((ref: ContextReference) => withProjectMetadata(ref, projectId)))
    } catch {
      if (searchSeq.current === seq) setResults([])
    } finally {
      if (searchSeq.current === seq) setLoading(false)
    }
  }

  function handleInputChange(nextInput: string) {
    setInput(nextInput)
    void searchMention(nextInput)
  }

  function chooseContextType(option: ContextReferenceMentionOption) {
    if (!activeTypePrompt) return
    const nextInput = replaceTypePromptToken(input, activeTypePrompt, option.namespace)
    setInput(nextInput)
    void searchMention(nextInput)
  }

  function addRef(ref: ContextReference) {
    onChange(mergeContextReferences(value, [withProjectMetadata(ref, projectId)]))
    setInput(activeMention ? removeMentionToken(input, activeMention) : '')
    setResults([])
  }

  function removeRef(ref: ContextReference) {
    const key = contextReferenceKey(ref)
    onChange(value.filter((item) => contextReferenceKey(item) !== key))
  }

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <ContextReferenceChips refs={value} onRemove={disabled ? undefined : removeRef} compact={compact} />
      <div className="relative">
        <input
          aria-label={inputLabel}
          value={input}
          disabled={disabled || !orgId}
          onChange={(event) => handleInputChange(event.target.value)}
          placeholder={placeholder}
          className={[
            'w-full rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] text-on-surface placeholder:text-on-surface-variant focus:border-[var(--color-accent-v2)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
            compact ? 'px-2.5 py-2 text-xs' : 'px-3 py-2 text-sm',
          ].join(' ')}
        />
        {orgId && activeTypePrompt && (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-sidebar)] shadow-xl">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-on-surface-variant">
              Reference types
            </div>
            {contextTypeOptions.length === 0 ? (
              <p className="px-3 py-2 text-xs text-on-surface-variant">No matching reference types</p>
            ) : (
              contextTypeOptions.map((option) => (
                <button
                  key={option.namespace}
                  type="button"
                  aria-label={`Use @${option.namespace}:`}
                  onClick={() => chooseContextType(option)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-on-surface hover:bg-[var(--color-surface-container)]"
                >
                  <span className="font-label uppercase tracking-wide text-on-surface-variant">{option.type}</span>
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="text-on-surface-variant">@{option.namespace}:</span>
                </button>
              ))
            )}
          </div>
        )}
        {orgId && activeMention && (results.length > 0 || loading) && (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-md border border-[var(--color-card-border)] bg-[var(--color-sidebar)] shadow-xl">
            {loading && results.length === 0 ? (
              <p className="px-3 py-2 text-xs text-on-surface-variant">Searching...</p>
            ) : (
              results.map((ref) => (
                <button
                  key={contextReferenceKey(ref)}
                  type="button"
                  aria-label={`Attach ${contextReferenceDisplay(ref)}`}
                  onClick={() => addRef(ref)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-on-surface hover:bg-[var(--color-surface-container)]"
                >
                  <span className="font-label uppercase tracking-wide text-on-surface-variant">{ref.type}</span>
                  <span className="min-w-0 flex-1 truncate">{contextReferenceDisplay(ref)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
