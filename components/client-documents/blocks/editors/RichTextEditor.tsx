'use client'

import { useEffect, useRef } from 'react'
import type { DocumentBlock } from '@/lib/client-documents/types'

interface ToolbarAction {
  icon: string
  label: string
  run: () => void
}

/**
 * Wrap the current selection in an inline <code> element. execCommand has no
 * native inline-code command, so we do it manually via the Range API.
 */
function wrapSelectionInCode() {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (range.collapsed) return
  const code = document.createElement('code')
  try {
    range.surroundContents(code)
  } catch {
    // surroundContents throws if the range crosses element boundaries —
    // fall back to extracting and re-inserting the fragment.
    const fragment = range.extractContents()
    code.appendChild(fragment)
    range.insertNode(code)
  }
  selection.removeAllRanges()
}

export function RichTextEditor({
  block,
  onChange,
}: {
  block: DocumentBlock
  onChange: (b: DocumentBlock) => void
}) {
  const editorRef = useRef<HTMLDivElement | null>(null)

  // Seed the editable surface from block.content. After the initial mount the
  // div is uncontrolled so typing never wipes the cursor; we only re-seed when
  // the block identity changes (i.e. a different block is being edited).
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const incoming = typeof block.content === 'string' ? block.content : ''
    if (el.innerHTML !== incoming) {
      el.innerHTML = incoming
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id])

  function emitChange() {
    const el = editorRef.current
    if (!el) return
    onChange({ ...block, content: el.innerHTML })
  }

  function exec(command: string, value?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    emitChange()
  }

  function formatBlock(tag: string) {
    // Some browsers expect angle brackets around the formatBlock tag value.
    exec('formatBlock', `<${tag}>`)
  }

  const actions: ToolbarAction[] = [
    { icon: 'format_h1', label: 'Heading 1', run: () => formatBlock('h1') },
    { icon: 'format_h2', label: 'Heading 2', run: () => formatBlock('h2') },
    { icon: 'format_h3', label: 'Heading 3', run: () => formatBlock('h3') },
    { icon: 'format_bold', label: 'Bold', run: () => exec('bold') },
    { icon: 'format_italic', label: 'Italic', run: () => exec('italic') },
    { icon: 'format_underlined', label: 'Underline', run: () => exec('underline') },
    { icon: 'format_list_bulleted', label: 'Bullet list', run: () => exec('insertUnorderedList') },
    { icon: 'format_list_numbered', label: 'Numbered list', run: () => exec('insertOrderedList') },
    { icon: 'format_quote', label: 'Block quote', run: () => formatBlock('blockquote') },
    {
      icon: 'code',
      label: 'Inline code',
      run: () => {
        editorRef.current?.focus()
        wrapSelectionInCode()
        emitChange()
      },
    },
    { icon: 'horizontal_rule', label: 'Horizontal rule', run: () => exec('insertHorizontalRule') },
  ]

  const isEmpty = !(typeof block.content === 'string' && block.content.trim())

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={block.title ?? ''}
        onChange={(e) => onChange({ ...block, title: e.target.value })}
        placeholder="Section title (optional)"
        className="w-full rounded border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm text-white/90"
      />

      <div className="rounded border border-[var(--color-pib-line)]">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--color-pib-line)] bg-black/20 p-1">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              title={action.label}
              aria-label={action.label}
              onMouseDown={(e) => {
                // Keep the selection/focus inside the editor when the button is pressed.
                e.preventDefault()
              }}
              onClick={action.run}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <span className="material-symbols-outlined text-[18px]">{action.icon}</span>
            </button>
          ))}
        </div>

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Rich text body"
          data-placeholder="Free-form prose"
          onInput={emitChange}
          onBlur={emitChange}
          className={`rich-text-editable min-h-[180px] px-3 py-2 text-sm leading-7 text-white/90 outline-none ${
            isEmpty ? 'is-empty' : ''
          }`}
        />
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .rich-text-editable.is-empty::before {
          content: attr(data-placeholder);
          color: rgba(255, 255, 255, 0.35);
          pointer-events: none;
        }
        .rich-text-editable h1 { font-size: 1.6rem; font-weight: 600; margin: 0.6em 0 0.3em; }
        .rich-text-editable h2 { font-size: 1.35rem; font-weight: 600; margin: 0.6em 0 0.3em; }
        .rich-text-editable h3 { font-size: 1.15rem; font-weight: 600; margin: 0.6em 0 0.3em; }
        .rich-text-editable ul, .rich-text-editable ol { margin: 0.4em 0; padding-left: 1.4em; }
        .rich-text-editable ul { list-style: disc; }
        .rich-text-editable ol { list-style: decimal; }
        .rich-text-editable blockquote {
          border-left: 3px solid var(--color-pib-line);
          margin: 0.5em 0; padding-left: 0.9em; color: rgba(255, 255, 255, 0.7);
        }
        .rich-text-editable code {
          background: rgba(255, 255, 255, 0.1); border-radius: 3px;
          padding: 0.1em 0.35em; font-family: ui-monospace, monospace; font-size: 0.9em;
        }
        .rich-text-editable hr { border: none; border-top: 1px solid var(--color-pib-line); margin: 0.8em 0; }
      `,
        }}
      />
    </div>
  )
}
