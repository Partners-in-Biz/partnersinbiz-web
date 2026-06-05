'use client'

// Visual block-based email composer. Two-pane layout: block list on the left,
// live iframe preview on the right with properties panel underneath.
//
// State model: a single `doc` (EmailDocument) is the source of truth. All
// edits go through immutable updates. The preview is debounced 400ms.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AiAssistantPanel from '@/components/email/AiAssistantPanel'
import { BlockIcon, blockLabel } from './BlockIcon'
import {
  ButtonBlockForm,
  ColumnsBlockForm,
  DividerBlockForm,
  FooterBlockForm,
  HeadingBlockForm,
  HeroBlockForm,
  ImageBlockForm,
  ParagraphBlockForm,
  SpacerBlockForm,
} from './blocks/forms'
import { Field, Select, TextArea, TextInput } from './blocks/shared'
import type { EmailTemplate, TemplateCategory } from '@/lib/email-builder/templates'
import type {
  Block,
  BlockType,
  ButtonBlockProps,
  ColumnsBlockProps,
  DividerBlockProps,
  EmailDocument,
  FooterBlockProps,
  HeadingBlockProps,
  HeroBlockProps,
  ImageBlockProps,
  ParagraphBlockProps,
  SpacerBlockProps,
  ThemeConfig,
} from '@/lib/email-builder/types'
import { makeBlockId } from '@/lib/email-builder/types'

const BLOCK_TYPES: BlockType[] = ['hero', 'heading', 'paragraph', 'button', 'image', 'divider', 'spacer', 'columns', 'footer']

const CATEGORIES: { value: TemplateCategory; label: string }[] = [
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'welcome', label: 'Welcome' },
  { value: 'product-launch', label: 'Product launch' },
  { value: 'reengagement', label: 'Re-engagement' },
  { value: 'transactional', label: 'Transactional' },
  { value: 'custom', label: 'Custom' },
]

const FONT_OPTIONS = [
  { value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", label: 'System' },
  { value: "'Inter', -apple-system, sans-serif", label: 'Inter' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Serif' },
]

function defaultBlock(type: BlockType): Block {
  const id = makeBlockId()
  switch (type) {
    case 'hero':
      return { id, type: 'hero', props: { backgroundColor: '#0A0A0B', headline: 'Big idea goes here', subhead: 'Supporting line.', textColor: '#FFFFFF' } }
    case 'heading':
      return { id, type: 'heading', props: { text: 'New heading', level: 2, align: 'left' } }
    case 'paragraph':
      return { id, type: 'paragraph', props: { html: 'Write something here.', align: 'left' } }
    case 'button':
      return { id, type: 'button', props: { text: 'Click me', url: 'https://', color: '#F5A623', textColor: '#0A0A0B', align: 'center', fullWidth: false } }
    case 'image':
      return { id, type: 'image', props: { src: 'https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?w=1200', alt: 'Image', width: 552, align: 'center' } }
    case 'divider':
      return { id, type: 'divider', props: { color: '#E5E7EB', thickness: 1 } }
    case 'spacer':
      return { id, type: 'spacer', props: { height: 24 } }
    case 'columns':
      return {
        id,
        type: 'columns',
        props: {
          columns: [
            [{ id: makeBlockId(), type: 'paragraph', props: { html: 'Left column.', align: 'left' } }],
            [{ id: makeBlockId(), type: 'paragraph', props: { html: 'Right column.', align: 'left' } }],
          ],
        },
      }
    case 'footer':
      return {
        id,
        type: 'footer',
        props: {
          orgName: '{{orgName}}',
          address: 'Cape Town, South Africa',
          unsubscribeUrl: '{{unsubscribeUrl}}',
        },
      }
    case 'amp-carousel':
      return {
        id,
        type: 'amp-carousel',
        props: {
          slides: [
            { imageUrl: 'https://images.unsplash.com/photo-1499951360447-b19be8fe80f5?w=1200', alt: 'Slide 1' },
            { imageUrl: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=1200', alt: 'Slide 2' },
          ],
          autoAdvance: 5,
        },
      }
    case 'amp-accordion':
      return {
        id,
        type: 'amp-accordion',
        props: {
          items: [
            { heading: 'Frequently asked question 1', bodyHtml: 'Answer goes here.' },
            { heading: 'Frequently asked question 2', bodyHtml: 'Another answer.' },
          ],
        },
      }
    case 'amp-form':
      return {
        id,
        type: 'amp-form',
        props: {
          fields: [{ key: 'email', label: 'Email', type: 'email' }],
          submitUrl: 'https://partnersinbiz.online/api/v1/capture-sources/<source_id>/submit',
          successMessage: 'Thanks for subscribing!',
          buttonText: 'Subscribe',
        },
      }
    case 'amp-live-data':
      return {
        id,
        type: 'amp-live-data',
        props: {
          endpoint: 'https://example.com/live-data.json',
          template: '<p>Current: {{value}}</p>',
        },
      }
  }
}

interface Props {
  template: EmailTemplate
}

export default function TemplateEditor({ template }: Props) {
  const router = useRouter()
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description)
  const [category, setCategory] = useState<TemplateCategory>(template.category)
  const [doc, setDoc] = useState<EmailDocument>(template.document)
  const [selectedId, setSelectedId] = useState<string | null>(doc.blocks[0]?.id ?? null)
  const [previewHtml, setPreviewHtml] = useState<string>('')
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [varsJson, setVarsJson] = useState(
    JSON.stringify({ firstName: 'Friend', orgName: 'Your Brand', unsubscribeUrl: 'https://example.com/unsub', invoiceNumber: '1234', itemDescription: 'Pro plan', quantity: '1', subtotal: 'R 499.00', vat: 'R 74.85', total: 'R 573.85', invoiceUrl: '#' }, null, 2),
  )
  const [saving, setSaving] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)

  // Debounced preview render
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderPreview = useCallback(async () => {
    try {
      let vars = {}
      try {
        vars = JSON.parse(varsJson)
      } catch {
        vars = {}
      }
      const res = await fetch('/api/v1/email-builder/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: doc, vars }),
      })
      const body = await res.json()
      if (body?.data?.html) setPreviewHtml(body.data.html)
    } catch {
      /* ignore */
    }
  }, [doc, varsJson])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(renderPreview, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [doc, varsJson, renderPreview])

  useEffect(() => {
    // First load — render immediately
    renderPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Immutable helpers
  function updateBlock(id: string, newBlock: Block) {
    setDoc((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? newBlock : b)) }))
  }

  function addBlock(type: BlockType) {
    const nb = defaultBlock(type)
    setDoc((d) => ({ ...d, blocks: [...d.blocks, nb] }))
    setSelectedId(nb.id)
  }

  function deleteBlock(id: string) {
    setDoc((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) }))
    if (selectedId === id) setSelectedId(null)
  }

  function moveBlock(id: string, dir: -1 | 1) {
    setDoc((d) => {
      const i = d.blocks.findIndex((b) => b.id === id)
      if (i === -1) return d
      const j = i + dir
      if (j < 0 || j >= d.blocks.length) return d
      const next = d.blocks.slice()
      const [tmp] = next.splice(i, 1)
      next.splice(j, 0, tmp)
      return { ...d, blocks: next }
    })
  }

  // Drag and drop (HTML5)
  const [dragId, setDragId] = useState<string | null>(null)
  function onDragStart(id: string) {
    setDragId(id)
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
  }
  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return
    setDoc((d) => {
      const from = d.blocks.findIndex((b) => b.id === dragId)
      const to = d.blocks.findIndex((b) => b.id === targetId)
      if (from === -1 || to === -1) return d
      const next = d.blocks.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...d, blocks: next }
    })
    setDragId(null)
  }

  const selectedBlock = useMemo(() => doc.blocks.find((b) => b.id === selectedId) ?? null, [doc.blocks, selectedId])

  const updateTheme = (patch: Partial<ThemeConfig>) => setDoc((d) => ({ ...d, theme: { ...d.theme, ...patch } }))

  async function save() {
    if (template.isStarter) {
      setStatusMsg('Starter templates are read-only. Duplicate first.')
      return
    }
    setSaving(true)
    setStatusMsg(null)
    try {
      const res = await fetch(`/api/v1/email-templates/${template.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, category, document: doc }),
      })
      const body = await res.json()
      if (res.ok) {
        setStatusMsg('Saved.')
      } else {
        setStatusMsg('Error: ' + (body?.error ?? 'unknown'))
      }
    } catch (e) {
      setStatusMsg('Error: ' + String(e))
    } finally {
      setSaving(false)
      setTimeout(() => setStatusMsg(null), 3000)
    }
  }

  async function sendTest() {
    if (!testEmail.trim()) {
      setStatusMsg('Enter a test email address')
      return
    }
    setSendingTest(true)
    setStatusMsg(null)
    try {
      let vars = {}
      try {
        vars = JSON.parse(varsJson)
      } catch {
        vars = {}
      }
      // Render via preview, then send via /email/send
      const renderRes = await fetch('/api/v1/email-builder/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: doc, vars }),
      })
      const rendered = await renderRes.json()
      if (!renderRes.ok || !rendered?.data?.html) {
        setStatusMsg('Failed to render preview: ' + (rendered?.error ?? 'unknown'))
        return
      }
      const sendRes = await fetch('/api/v1/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: testEmail.trim(),
          subject: rendered.data.subject,
          html: rendered.data.html,
          text: rendered.data.text,
        }),
      })
      const body = await sendRes.json()
      if (sendRes.ok) {
        setStatusMsg('Test sent.')
      } else {
        setStatusMsg('Send failed: ' + (body?.error ?? 'unknown'))
      }
    } finally {
      setSendingTest(false)
      setTimeout(() => setStatusMsg(null), 4000)
    }
  }

  const previewWidth = previewMode === 'desktop' ? doc.theme.contentWidth + 48 : 380

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant bg-surface-container">
        <button onClick={() => router.push('/admin/email-templates')} className="text-sm text-on-surface-variant hover:text-on-surface">← Back</button>
        <div className="flex-1 flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={template.isStarter}
            className="px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 font-medium w-64 disabled:opacity-60"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as TemplateCategory)}
            disabled={template.isStarter}
            className="px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 disabled:opacity-60"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        {statusMsg && <span className="text-xs text-on-surface-variant">{statusMsg}</span>}
        <div className="flex items-center gap-2">
          <input
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="test@example.com"
            className="px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 w-48"
          />
          <button onClick={() => setAiOpen(true)} className="px-3 py-1.5 rounded-md bg-primary-container text-on-primary-container text-sm font-medium">
            ✨ Generate with AI
          </button>
          <button onClick={sendTest} disabled={sendingTest} className="px-3 py-1.5 rounded-md bg-surface-container-high text-on-surface text-sm font-medium disabled:opacity-50">
            {sendingTest ? 'Sending...' : 'Send test'}
          </button>
          <button
            onClick={save}
            disabled={saving || template.isStarter}
            className="px-4 py-1.5 rounded-md bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
          >
            {template.isStarter ? 'Read only' : saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: block list */}
        <aside className="w-72 flex-shrink-0 overflow-y-auto border-r border-outline-variant bg-surface p-3">
          <div className="mb-3">
            <Field label="Subject"><TextInput value={doc.subject} onChange={(v) => setDoc((d) => ({ ...d, subject: v }))} /></Field>
            <Field label="Preheader"><TextInput value={doc.preheader} onChange={(v) => setDoc((d) => ({ ...d, preheader: v }))} /></Field>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Field label="Primary color"><input type="color" value={doc.theme.primaryColor} onChange={(e) => updateTheme({ primaryColor: e.target.value })} className="w-full h-9 rounded border border-zinc-700 bg-zinc-900" /></Field>
            <Field label="Background"><input type="color" value={doc.theme.backgroundColor} onChange={(e) => updateTheme({ backgroundColor: e.target.value })} className="w-full h-9 rounded border border-zinc-700 bg-zinc-900" /></Field>
          </div>
          <Field label="Font">
            <Select
              value={doc.theme.fontFamily}
              onChange={(v) => updateTheme({ fontFamily: v })}
              options={FONT_OPTIONS}
            />
          </Field>

          <div className="border-t border-zinc-800 pt-3 mt-3">
            <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide mb-2">Blocks</div>
            <ul className="space-y-1">
              {doc.blocks.map((b, i) => (
                <li
                  key={b.id}
                  draggable
                  onDragStart={() => onDragStart(b.id)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(b.id)}
                  onClick={() => setSelectedId(b.id)}
                  className={`flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer ${
                    selectedId === b.id ? 'bg-primary/20 ring-1 ring-primary' : 'hover:bg-zinc-800'
                  }`}
                >
                  <span className="text-zinc-500 cursor-grab text-xs">⋮⋮</span>
                  <BlockIcon type={b.type} />
                  <span className="flex-1 text-sm text-zinc-100">{blockLabel(b.type)}</span>
                  <button onClick={(e) => { e.stopPropagation(); moveBlock(b.id, -1) }} disabled={i === 0} className="text-zinc-400 hover:text-zinc-100 px-1 disabled:opacity-30">↑</button>
                  <button onClick={(e) => { e.stopPropagation(); moveBlock(b.id, 1) }} disabled={i === doc.blocks.length - 1} className="text-zinc-400 hover:text-zinc-100 px-1 disabled:opacity-30">↓</button>
                  <button onClick={(e) => { e.stopPropagation(); deleteBlock(b.id) }} className="text-zinc-400 hover:text-rose-400 px-1">✕</button>
                </li>
              ))}
            </ul>
            <AddBlockDropdown onAdd={addBlock} />
          </div>
        </aside>

        {/* Right: preview + properties */}
        <main className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
          <div className="border-b border-outline-variant bg-surface-container px-4 py-2 flex items-center gap-2">
            <span className="text-xs text-on-surface-variant">Preview:</span>
            <button onClick={() => setPreviewMode('desktop')} className={`text-xs px-2 py-1 rounded ${previewMode === 'desktop' ? 'bg-primary text-on-primary' : 'bg-zinc-800 text-zinc-300'}`}>Desktop</button>
            <button onClick={() => setPreviewMode('mobile')} className={`text-xs px-2 py-1 rounded ${previewMode === 'mobile' ? 'bg-primary text-on-primary' : 'bg-zinc-800 text-zinc-300'}`}>Mobile</button>
          </div>
          <div className="flex-1 overflow-auto p-4 flex justify-center">
            <iframe
              title="Email preview"
              srcDoc={previewHtml}
              style={{ width: previewWidth, height: '100%', border: '1px solid #27272a', borderRadius: 8, background: '#fff' }}
            />
          </div>

          {/* Properties + vars panel */}
          <div className="border-t border-outline-variant bg-surface p-4 max-h-[40%] overflow-y-auto grid grid-cols-2 gap-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant mb-3">
                {selectedBlock ? `${blockLabel(selectedBlock.type)} properties` : 'Select a block'}
              </div>
              {selectedBlock && <BlockPropertyForm block={selectedBlock} onChange={(b) => updateBlock(selectedBlock.id, b)} />}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant mb-3">Test variables (JSON)</div>
              <TextArea value={varsJson} onChange={setVarsJson} rows={10} />
              <p className="text-xs text-on-surface-variant mt-2">These values replace <code className="text-zinc-300">&#123;&#123;variable&#125;&#125;</code> tokens in the preview.</p>
              <Field label="Description (for the library)">
                <TextInput value={description} onChange={setDescription} />
              </Field>
            </div>
          </div>
        </main>
      </div>
      {aiOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setAiOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="h-full">
            <AiAssistantPanel
              mode={template.category === 'newsletter' ? 'newsletter' : 'email'}
              orgId={template.orgId ?? undefined}
              onClose={() => setAiOpen(false)}
              onApply={(r) => {
                if (r.document) {
                  setDoc(r.document)
                } else if (r.subject || r.bodyHtml) {
                  setDoc((d) => ({
                    ...d,
                    subject: r.subject ?? d.subject,
                    preheader: r.preheader ?? d.preheader,
                  }))
                }
                setAiOpen(false)
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function AddBlockDropdown({ onAdd }: { onAdd: (t: BlockType) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative mt-3">
      <button onClick={() => setOpen((v) => !v)} className="w-full px-3 py-2 rounded-md bg-primary text-on-primary text-sm font-medium">
        + Add block
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-md overflow-hidden z-10">
          {BLOCK_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => { onAdd(t); setOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left text-zinc-100 hover:bg-zinc-800"
            >
              <BlockIcon type={t} />
              {blockLabel(t)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BlockPropertyForm({ block, onChange }: { block: Block; onChange: (b: Block) => void }) {
  switch (block.type) {
    case 'hero':
      return <HeroBlockForm props={block.props} onChange={(p: HeroBlockProps) => onChange({ ...block, props: p })} />
    case 'heading':
      return <HeadingBlockForm props={block.props} onChange={(p: HeadingBlockProps) => onChange({ ...block, props: p })} />
    case 'paragraph':
      return <ParagraphBlockForm props={block.props} onChange={(p: ParagraphBlockProps) => onChange({ ...block, props: p })} />
    case 'button':
      return <ButtonBlockForm props={block.props} onChange={(p: ButtonBlockProps) => onChange({ ...block, props: p })} />
    case 'image':
      return <ImageBlockForm props={block.props} onChange={(p: ImageBlockProps) => onChange({ ...block, props: p })} />
    case 'divider':
      return <DividerBlockForm props={block.props} onChange={(p: DividerBlockProps) => onChange({ ...block, props: p })} />
    case 'spacer':
      return <SpacerBlockForm props={block.props} onChange={(p: SpacerBlockProps) => onChange({ ...block, props: p })} />
    case 'columns':
      return <ColumnsBlockForm props={block.props} onChange={(p: ColumnsBlockProps) => onChange({ ...block, props: p })} />
    case 'footer':
      return <FooterBlockForm props={block.props} onChange={(p: FooterBlockProps) => onChange({ ...block, props: p })} />
  }
}
