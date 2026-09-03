'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useRef, useState, type ReactNode } from 'react'

type SaveState = 'saved' | 'dirty' | 'saving'

type Props = {
  chapterId: string
  initialMarkdown: string
  readOnly: boolean
  /**
   * Persist the chapter markdown. The editor ignores the resolved value —
   * callers (the chapters panel) may return a success flag for their own
   * post-save logic (e.g. status promotion).
   */
  onSave: (chapterId: string, markdown: string) => Promise<unknown> | unknown
}

const AUTOSAVE_DELAY_MS = 2000

/**
 * TipTap editor for a single book chapter. Mirrors components/blog-editor/BlogEditor.tsx
 * (extension config + markdown round-trip via tiptap-markdown), but adds
 * debounced autosave + a save-state indicator instead of an explicit Save button,
 * since chapters live in a sidebar-driven multi-chapter workspace.
 */
export function ChapterEditor({ chapterId, initialMarkdown, readOnly, onSave }: Props) {
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingMarkdownRef = useRef<string | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({
        placeholder: 'Write this chapter. Markdown shortcuts work.',
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: true,
        breaks: false,
      }),
    ],
    content: initialMarkdown,
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: () => {
      setSaveState('dirty')
      scheduleAutosave()
    },
    editorProps: {
      attributes: {
        class:
          'tiptap-prose prose-invert max-w-none min-h-[320px] outline-none px-1 py-3 text-[16px] leading-[1.7]',
      },
    },
  })

  function getMarkdown(): string {
    if (!editor) return ''
    // tiptap-markdown attaches storage.markdown.getMarkdown() on the editor
    const storage = editor.storage as { markdown?: { getMarkdown?: () => string } }
    const md = storage.markdown?.getMarkdown?.()
    return (md ?? editor.getText()).trim()
  }

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  async function flush() {
    clearTimer()
    const markdown = pendingMarkdownRef.current
    if (markdown === null) return
    pendingMarkdownRef.current = null
    setSaveState('saving')
    try {
      await onSave(chapterId, markdown)
      setSaveState('saved')
    } catch {
      // Leave as dirty-ish; surface via 'Unsaved changes' so the user can retry.
      setSaveState('dirty')
    }
  }

  function scheduleAutosave() {
    if (readOnly) return
    pendingMarkdownRef.current = getMarkdown()
    clearTimer()
    timerRef.current = setTimeout(() => {
      void flush()
    }, AUTOSAVE_DELAY_MS)
  }

  function handleBlur() {
    if (readOnly) return
    if (pendingMarkdownRef.current !== null) {
      void flush()
    }
  }

  // Keep editable state in sync with the readOnly prop.
  useEffect(() => {
    if (editor) editor.setEditable(!readOnly)
  }, [editor, readOnly])

  // Flush any pending save on unmount. The panel renders this component with
  // key={chapter.id}, so switching chapters unmounts the old instance — this
  // cleanup is THE mechanism that persists in-flight edits on chapter switch
  // (and on navigating away entirely).
  useEffect(() => {
    return () => {
      clearTimer()
      if (pendingMarkdownRef.current !== null) {
        void onSave(chapterId, pendingMarkdownRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!editor) {
    return <div className="pib-skeleton h-80 rounded-[6px]" />
  }

  const Btn = ({
    onClick,
    active,
    label,
    children,
  }: {
    onClick: () => void
    active?: boolean
    label: string
    children: ReactNode
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={readOnly}
      aria-label={label}
      aria-pressed={Boolean(active)}
      title={label}
      className={[
        'h-8 px-2 rounded text-sm font-medium transition-colors disabled:opacity-40',
        active
          ? 'bg-[var(--org-accent,var(--color-pib-accent))] text-black'
          : 'text-on-surface hover:bg-[var(--color-surface)]',
      ].join(' ')}
    >
      {children}
    </button>
  )

  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved changes' : 'Saved'

  return (
    <div className="pib-card overflow-hidden">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 px-3 py-2 border-b border-[var(--org-border,var(--color-pib-line))] bg-[var(--color-surface)]">
        <Btn
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive('heading', { level: 1 })}
          label="Heading 1"
        >
          H1
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          label="Heading 2"
        >
          H2
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          label="Heading 3"
        >
          H3
        </Btn>
        <span className="w-px h-6 bg-[var(--org-border,var(--color-pib-line))] mx-1" />
        <Btn
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          label="Bold"
        >
          <strong>B</strong>
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          label="Italic"
        >
          <em>I</em>
        </Btn>
        <span className="w-px h-6 bg-[var(--org-border,var(--color-pib-line))] mx-1" />
        <Btn
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          label="Bullet list"
        >
          • List
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          label="Numbered list"
        >
          1. List
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive('blockquote')}
          label="Quote"
        >
          &ldquo;Quote&rdquo;
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          label="Divider"
        >
          ―
        </Btn>
        <span className="w-px h-6 bg-[var(--org-border,var(--color-pib-line))] mx-1" />
        <Btn onClick={() => editor.chain().focus().undo().run()} label="Undo">
          ↶
        </Btn>
        <Btn onClick={() => editor.chain().focus().redo().run()} label="Redo">
          ↷
        </Btn>
        <span className="flex-1" />
        <span className="text-xs text-[var(--color-pib-text-muted)]" role="status">
          {saveLabel}
        </span>
      </div>

      <div className="px-6 py-6 bg-white text-[#1F1F1F]" onBlur={handleBlur}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
