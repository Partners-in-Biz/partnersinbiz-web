'use client'

import { useEffect, useRef, useState } from 'react'
import { ContextReferencePicker } from '@/components/context-references/ContextReferencePicker'
import type { ContextReference } from '@/lib/context-references/types'
import type { AnchorTarget } from './types'

function hasCrmRefs(refs: ContextReference[]) {
  return refs.some((ref) => ref.type === 'contact' || ref.type === 'company')
}

interface Props {
  anchor: AnchorTarget
  orgId?: string
  projectId?: string
  onCancel: () => void
  onSubmit: (text: string, contextRefs: ContextReference[], alsoLinkToDocument?: boolean) => Promise<void> | void
  busy?: boolean
}

/**
 * Modal-ish composer card for adding a comment. Used both for inline
 * text-anchored comments and image-anchored comments. Uses a centered
 * overlay so it works regardless of where the anchor lives.
 */
export function CommentComposer({ anchor, orgId, projectId, onCancel, onSubmit, busy }: Props) {
  const [text, setText] = useState('')
  const [contextRefs, setContextRefs] = useState<ContextReference[]>([])
  const [alsoLinkToDocument, setAlsoLinkToDocument] = useState(false)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const anchorPreview =
    anchor.kind === 'text'
      ? `"${anchor.text.slice(0, 200)}${anchor.text.length > 200 ? '…' : ''}"`
      : anchor.kind === 'image'
        ? 'Image'
        : 'General comment'

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="pib-card w-full max-w-lg p-5 space-y-3"
      >
        <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
          {anchor.kind === 'text'
            ? 'Comment on selection'
            : anchor.kind === 'image'
              ? 'Comment on image'
              : 'Add a comment'}
        </p>
        {anchor.kind === 'text' && (
          <blockquote
            className="text-sm border-l-2 pl-3 italic text-on-surface-variant max-h-24 overflow-y-auto"
            style={{ borderColor: 'var(--org-accent, var(--color-pib-accent))' }}
          >
            {anchorPreview}
          </blockquote>
        )}
        {anchor.kind === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={anchor.mediaUrl}
            alt=""
            className="rounded-md max-h-32 w-full object-cover border border-[var(--org-border,var(--color-pib-line))]"
          />
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          placeholder="What needs to change? Be specific so the writer knows what to fix."
          className="w-full text-sm bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-md px-3 py-2 text-on-surface placeholder:text-on-surface-variant focus:outline-none"
        />
        {orgId ? (
          <ContextReferencePicker
            orgId={orgId}
            projectId={projectId}
            value={contextRefs}
            onChange={(refs) => {
              setContextRefs(refs)
              if (!hasCrmRefs(refs)) setAlsoLinkToDocument(false)
            }}
            inputLabel="Add feedback context reference"
            placeholder="@projects: @tasks: @contacts: @companies:"
            disabled={busy}
            compact
          />
        ) : null}
        {hasCrmRefs(contextRefs) ? (
          <label className="flex items-start gap-2 rounded-md border border-[var(--color-outline)] bg-[var(--color-surface-variant)] px-2 py-1.5 text-xs text-on-surface-variant">
            <input
              type="checkbox"
              checked={alsoLinkToDocument}
              disabled={busy}
              onChange={(event) => setAlsoLinkToDocument(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Also link selected contacts/companies to this document
              <span className="block text-[10px] opacity-75">CRM refs stay as context tags and do not notify contacts or companies.</span>
            </span>
          </label>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-on-surface-variant hover:text-on-surface px-3 py-1.5"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(text, contextRefs, alsoLinkToDocument)}
            disabled={busy || text.trim().length === 0}
            className="text-sm font-label px-4 py-2 rounded-md transition-opacity disabled:opacity-50"
            style={{
              background: 'var(--org-accent, var(--color-pib-accent))',
              color: '#000',
            }}
          >
            {busy ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      </div>
    </div>
  )
}
