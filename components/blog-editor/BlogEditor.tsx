'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useState } from 'react'

interface Props {
  initialMarkdown: string
  busy?: boolean
  onSave: (markdown: string) => Promise<void> | void
  onCancel: () => void
}

/**
 * Minimal WYSIWYG editor for blog body markdown. Round-trips through the
 * tiptap-markdown serializer so the stored format stays markdown  -  what
 * publishes to /insights/[slug] keeps working without changes.
 */
export function BlogEditor({ initialMarkdown, busy, onSave, onCancel }: Props) {
  const [dirty, setDirty] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Defaults are fine. Placeholder is added separately so it shows on
        // empty paragraphs instead of just at the very top.
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({
        placeholder: 'Edit the body. Markdown shortcuts work.',
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
    immediatelyRender: false,
    onUpdate: () => setDirty(true),
    editorProps: {
      attributes: {
        class:
          'tiptap-prose prose-invert max-w-none min-h-[400px] outline-none px-1 py-3 text-[17px] leading-[1.7]',
      },
    },
  })

  // If parent reloads the markdown (e.g. after save), refresh editor content.
  useEffect(() => {
    if (!editor) return
    if (!dirty) {
      editor.commands.setContent(initialMarkdown, { emitUpdate: false })
    }
  }, [initialMarkdown, editor, dirty])

  if (!editor) {
    return (
      <div className="pib-skeleton h-96 rounded-md" />
    )
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    children: any
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={[
        'h-8 px-2 rounded text-sm font-medium transition-colors',
        active
          ? 'bg-[var(--org-accent,var(--color-pib-accent))] text-black'
          : 'text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface)]',
      ].join(' ')}
    >
      {children}
    </button>
  )

  async function handleSave() {
    if (busy || !editor) return
    // tiptap-markdown attaches storage.markdown.getMarkdown() on the editor
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const md = (editor.storage as any).markdown?.getMarkdown?.() as string | undefined
    const out = (md ?? editor.getText()).trim()
    await onSave(out)
    setDirty(false)
  }

  return (
    <div className="pib-card overflow-hidden">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 px-3 py-2 border-b border-[var(--org-border,var(--color-pib-line))] bg-[var(--color-pib-surface)]">
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
        <Btn
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          label="Strikethrough"
        >
          <s>S</s>
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive('code')}
          label="Inline code"
        >
          {`</>`}
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
          onClick={() => {
            const prev = editor.getAttributes('link').href as string | undefined
            const url = window.prompt('Link URL', prev ?? 'https://')
            if (url === null) return
            if (url === '') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run()
              return
            }
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
          }}
          active={editor.isActive('link')}
          label="Link"
        >
          🔗
        </Btn>
        <Btn
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          label="Divider"
        >
          ―
        </Btn>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="h-8 px-3 rounded text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !dirty}
          className="h-8 px-4 rounded text-xs font-label transition-opacity disabled:opacity-50"
          style={{
            background: 'var(--org-accent, var(--color-pib-accent))',
            color: '#000',
          }}
        >
          {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      {/* Editor surface */}
      <div className="px-6 py-6 bg-white text-[#1F1F1F]">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
