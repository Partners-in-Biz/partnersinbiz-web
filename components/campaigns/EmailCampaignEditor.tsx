'use client'

// US-103 — Block drag-drop editor for an email campaign. Reuses the real
// email-builder block model (lib/email-builder) and the shared block property
// forms from the admin email-builder. Loads the campaign's emailDocument,
// lets the user edit blocks, and saves via PUT /api/v1/campaigns/[id].
//
// US-104 — Test-send modal (calls /api/v1/email/campaigns/[id]/test-send).
// US-105 — "Review & send" opens the CampaignReviewPanel slide-over.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { BlockIcon, blockLabel } from '@/components/admin/email-builder/BlockIcon'
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
} from '@/components/admin/email-builder/blocks/forms'
import { Field, Select, TextInput } from '@/components/admin/email-builder/blocks/shared'
import {
  DEFAULT_THEME,
  makeBlockId,
  type Block,
  type BlockType,
  type ButtonBlockProps,
  type ColumnsBlockProps,
  type DividerBlockProps,
  type EmailDocument,
  type FooterBlockProps,
  type HeadingBlockProps,
  type HeroBlockProps,
  type ImageBlockProps,
  type ParagraphBlockProps,
  type SpacerBlockProps,
  type ThemeConfig,
} from '@/lib/email-builder/types'
import { CampaignReviewPanel } from '@/components/campaigns/CampaignReviewPanel'

const BLOCK_TYPES: BlockType[] = ['hero', 'heading', 'paragraph', 'button', 'image', 'divider', 'spacer', 'columns', 'footer']

const FONT_OPTIONS = [
  { value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", label: 'System' },
  { value: "'Inter', -apple-system, sans-serif", label: 'Inter' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Serif' },
]

const SAMPLE_VARS = {
  first_name: 'Alex',
  firstName: 'Alex',
  name: 'Alex Morgan',
  orgName: 'Your Brand',
  unsubscribeUrl: '#',
  preferencesUrl: '#',
}

interface CampaignSeed {
  id: string
  orgId: string
  name: string
  subject: string
  previewText: string
  status: string
  emailDocument: EmailDocument | null
  scheduledAtIso: string | null
  postalAddress: string
  hasVerifiedDomain: boolean
}

interface Props {
  campaign: CampaignSeed
  overviewHref: string
  brandPrimary?: string
  brandBackground?: string
}

function defaultBlock(type: BlockType, ctx: { orgName: string; address: string }): Block {
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
          orgName: ctx.orgName || '{{orgName}}',
          address: ctx.address || 'Pretoria, Gauteng, South Africa',
          unsubscribeUrl: '{{unsubscribeUrl}}',
        },
      }
    default:
      return { id, type: 'paragraph', props: { html: 'Write something here.', align: 'left' } }
  }
}

function seedDocument(campaign: CampaignSeed, theme: ThemeConfig): EmailDocument {
  if (campaign.emailDocument && Array.isArray(campaign.emailDocument.blocks)) {
    return campaign.emailDocument
  }
  // Build a sensible starter so the email always ships with an unsubscribe footer.
  return {
    subject: campaign.subject || campaign.name,
    preheader: campaign.previewText || '',
    theme,
    blocks: [
      { id: makeBlockId(), type: 'heading', props: { text: campaign.name || 'Hello there', level: 1, align: 'left' } },
      { id: makeBlockId(), type: 'paragraph', props: { html: 'Start writing your email here.', align: 'left' } },
      {
        id: makeBlockId(),
        type: 'footer',
        props: {
          orgName: '{{orgName}}',
          address: campaign.postalAddress || 'Pretoria, Gauteng, South Africa',
          unsubscribeUrl: '{{unsubscribeUrl}}',
        },
      },
    ],
  }
}

function unwrap<T>(body: unknown): T | null {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if ('data' in b) return (b.data as T) ?? null
    return b as unknown as T
  }
  return null
}

export function EmailCampaignEditor({ campaign, overviewHref, brandPrimary, brandBackground }: Props) {
  const initialTheme: ThemeConfig = useMemo(
    () => ({
      ...DEFAULT_THEME,
      primaryColor: brandPrimary || DEFAULT_THEME.primaryColor,
      backgroundColor: brandBackground || DEFAULT_THEME.backgroundColor,
    }),
    [brandPrimary, brandBackground],
  )

  const [doc, setDoc] = useState<EmailDocument>(() => seedDocument(campaign, initialTheme))
  const [subject, setSubject] = useState(campaign.subject || doc.subject)
  const [previewText, setPreviewText] = useState(campaign.previewText || doc.preheader)
  const [selectedId, setSelectedId] = useState<string | null>(doc.blocks[0]?.id ?? null)
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [status, setStatus] = useState(campaign.status)
  const [scheduledAtIso, setScheduledAtIso] = useState<string | null>(campaign.scheduledAtIso)

  const [testOpen, setTestOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  const readOnly = status === 'active' || status === 'completed'

  // Keep doc subject/preheader in sync with the top-level fields.
  const liveDoc = useMemo<EmailDocument>(
    () => ({ ...doc, subject, preheader: previewText }),
    [doc, subject, previewText],
  )

  // Debounced preview render
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const renderPreview = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/email-builder/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: liveDoc, vars: SAMPLE_VARS }),
      })
      const body = await res.json()
      const data = unwrap<{ html?: string }>(body)
      if (data?.html) setPreviewHtml(data.html)
    } catch {
      /* ignore */
    }
  }, [liveDoc])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(renderPreview, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [renderPreview])

  useEffect(() => {
    renderPreview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- block mutations ----
  function updateBlock(id: string, nb: Block) {
    setDoc((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? nb : b)) }))
  }
  function addBlock(type: BlockType) {
    const nb = defaultBlock(type, { orgName: '{{orgName}}', address: campaign.postalAddress })
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

  const [dragId, setDragId] = useState<string | null>(null)
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

  async function save(): Promise<boolean> {
    setSaving(true)
    setStatusMsg(null)
    try {
      const res = await fetch(`/api/v1/campaigns/${campaign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          previewText,
          emailDocument: liveDoc,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setStatusMsg('Error: ' + ((body && (body.error as string)) || 'save failed'))
        return false
      }
      setSavedAt(Date.now())
      setStatusMsg('Saved.')
      setTimeout(() => setStatusMsg(null), 2500)
      return true
    } catch (e) {
      setStatusMsg('Error: ' + String(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  async function openReview() {
    const ok = await save()
    if (ok) setReviewOpen(true)
  }

  const previewWidth = previewMode === 'desktop' ? doc.theme.contentWidth + 48 : 380

  return (
    <div className="space-y-5 pb-10">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={overviewHref}
            className="inline-flex items-center gap-1 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Overview
          </Link>
          <div className="min-w-0">
            <p className="eyebrow !text-[10px]">Designing email · {status}</p>
            <h1 className="font-headline text-2xl tracking-tight truncate">{campaign.name}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {statusMsg && <span className="text-xs text-[var(--color-pib-text-muted)]">{statusMsg}</span>}
          {savedAt && !statusMsg && (
            <span className="text-xs text-[var(--color-pib-text-muted)]">Saved {new Date(savedAt).toLocaleTimeString()}</span>
          )}
          <button onClick={() => setTestOpen(true)} className="btn-pib-secondary">
            <span className="material-symbols-outlined text-base">outgoing_mail</span>
            Send test
          </button>
          <button onClick={() => save()} disabled={saving || readOnly} className="btn-pib-secondary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={openReview} disabled={readOnly} className="btn-pib-primary disabled:opacity-50">
            Review &amp; send
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </div>
      </header>

      {readOnly && (
        <div className="pib-card !p-3 border border-amber-500/30 bg-amber-500/5 text-sm text-amber-200">
          This campaign is {status} and can no longer be edited.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
        {/* Left: settings + block list */}
        <aside className="space-y-4">
          <div className="pib-card space-y-3">
            <Field label="Subject"><TextInput value={subject} onChange={setSubject} /></Field>
            <Field label="Preview text"><TextInput value={previewText} onChange={setPreviewText} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Primary">
                <input type="color" value={doc.theme.primaryColor} onChange={(e) => updateTheme({ primaryColor: e.target.value })} className="w-full h-9 rounded border border-[var(--color-pib-line)] bg-transparent" />
              </Field>
              <Field label="Background">
                <input type="color" value={doc.theme.backgroundColor} onChange={(e) => updateTheme({ backgroundColor: e.target.value })} className="w-full h-9 rounded border border-[var(--color-pib-line)] bg-transparent" />
              </Field>
            </div>
            <Field label="Font">
              <Select value={doc.theme.fontFamily} onChange={(v) => updateTheme({ fontFamily: v })} options={FONT_OPTIONS} />
            </Field>
          </div>

          <div className="pib-card">
            <p className="eyebrow !text-[10px] mb-2">Blocks · drag to reorder</p>
            <ul className="space-y-1">
              {doc.blocks.map((b, i) => (
                <li
                  key={b.id}
                  draggable={!readOnly}
                  onDragStart={() => setDragId(b.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(b.id)}
                  onClick={() => setSelectedId(b.id)}
                  className={[
                    'flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer',
                    selectedId === b.id
                      ? 'bg-[var(--color-pib-accent-soft)] ring-1 ring-[var(--color-pib-accent)]'
                      : 'hover:bg-[var(--color-pib-surface-2)]',
                  ].join(' ')}
                >
                  <span className="text-[var(--color-pib-text-muted)] cursor-grab text-xs">⋮⋮</span>
                  <BlockIcon type={b.type} />
                  <span className="flex-1 text-sm text-[var(--color-pib-text)]">{blockLabel(b.type)}</span>
                  <button onClick={(e) => { e.stopPropagation(); moveBlock(b.id, -1) }} disabled={i === 0 || readOnly} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] px-1 disabled:opacity-30">↑</button>
                  <button onClick={(e) => { e.stopPropagation(); moveBlock(b.id, 1) }} disabled={i === doc.blocks.length - 1 || readOnly} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] px-1 disabled:opacity-30">↓</button>
                  <button onClick={(e) => { e.stopPropagation(); deleteBlock(b.id) }} disabled={readOnly} className="text-[var(--color-pib-text-muted)] hover:text-rose-400 px-1 disabled:opacity-30">✕</button>
                </li>
              ))}
            </ul>
            {!readOnly && <AddBlockDropdown onAdd={addBlock} />}
          </div>
        </aside>

        {/* Right: preview + properties */}
        <main className="space-y-4">
          <div className="pib-card !p-0 overflow-hidden">
            <div className="border-b border-[var(--color-pib-line)] px-4 py-2 flex items-center gap-2">
              <span className="text-xs text-[var(--color-pib-text-muted)]">Preview:</span>
              <button onClick={() => setPreviewMode('desktop')} className={`text-xs px-2 py-1 rounded ${previewMode === 'desktop' ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]' : 'text-[var(--color-pib-text-muted)]'}`}>Desktop</button>
              <button onClick={() => setPreviewMode('mobile')} className={`text-xs px-2 py-1 rounded ${previewMode === 'mobile' ? 'bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]' : 'text-[var(--color-pib-text-muted)]'}`}>Mobile</button>
            </div>
            <div className="p-4 flex justify-center bg-zinc-950/40" style={{ minHeight: 480 }}>
              <iframe
                title="Email preview"
                srcDoc={previewHtml}
                style={{ width: previewWidth, height: 560, border: '1px solid var(--color-pib-line)', borderRadius: 8, background: '#fff' }}
              />
            </div>
          </div>

          <div className="pib-card">
            <p className="eyebrow !text-[10px] mb-3">
              {selectedBlock ? `${blockLabel(selectedBlock.type)} properties` : 'Select a block to edit'}
            </p>
            {selectedBlock && !readOnly && (
              <BlockPropertyForm block={selectedBlock} onChange={(b) => updateBlock(selectedBlock.id, b)} />
            )}
            {selectedBlock && readOnly && (
              <p className="text-sm text-[var(--color-pib-text-muted)]">Editing is locked for {status} campaigns.</p>
            )}
          </div>
        </main>
      </div>

      {testOpen && (
        <TestSendModal
          campaignId={campaign.id}
          onClose={() => setTestOpen(false)}
          onSaveFirst={save}
        />
      )}

      {reviewOpen && (
        <CampaignReviewPanel
          campaignId={campaign.id}
          orgId={campaign.orgId}
          doc={liveDoc}
          subject={subject}
          status={status}
          scheduledAtIso={scheduledAtIso}
          hasVerifiedDomain={campaign.hasVerifiedDomain}
          onClose={() => setReviewOpen(false)}
          onStatusChange={(s) => {
            setStatus(s)
            if (s !== 'scheduled') setScheduledAtIso(null)
            // Refresh scheduled timestamp on schedule from input is set by panel; for simplicity reload on next open.
          }}
          doneHref={overviewHref}
        />
      )}
    </div>
  )
}

function AddBlockDropdown({ onAdd }: { onAdd: (t: BlockType) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative mt-3">
      <button onClick={() => setOpen((v) => !v)} className="btn-pib-secondary w-full justify-center">
        + Add block
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1 bg-[var(--color-pib-surface)] border border-[var(--color-pib-line)] rounded-md overflow-hidden z-10">
          {BLOCK_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => { onAdd(t); setOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left text-[var(--color-pib-text)] hover:bg-[var(--color-pib-surface-2)]"
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
    default:
      return null
  }
}

// US-104 — Test-send modal.
function TestSendModal({
  campaignId,
  onClose,
  onSaveFirst,
}: {
  campaignId: string
  onClose: () => void
  onSaveFirst: () => Promise<boolean>
}) {
  const [recipients, setRecipients] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const list = recipients
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (list.length === 0) {
      setError('Enter at least one email address.')
      return
    }
    setSending(true)
    setError(null)
    setResult(null)
    try {
      // Persist current content first so the test reflects on-screen edits.
      await onSaveFirst()
      const res = await fetch(`/api/v1/email/campaigns/${campaignId}/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: list }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && (body.error as string)) || 'Test send failed.')
        return
      }
      const data = unwrap<{ sent: number; failed: number; deliverabilityNote?: string }>(body)
      setResult(`Sent ${data?.sent ?? 0}${data?.failed ? `, ${data.failed} failed` : ''}. ${data?.deliverabilityNote ?? ''}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test send failed.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="pib-card w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-headline text-xl">Send a test</h2>
          <button onClick={onClose} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Sends a <strong>[TEST]</strong> copy with sample merge values (e.g. {'{{first_name}}'} → &quot;Alex&quot;).
          Up to 10 addresses, comma or space separated.
        </p>
        <input
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder="you@example.com, teammate@example.com"
          className="w-full bg-[var(--color-pib-surface-2)] border border-[var(--color-pib-line)] rounded-md px-3 py-2 text-sm text-[var(--color-pib-text)]"
        />
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {result && <p className="text-sm text-emerald-300">{result}</p>}
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onClose} className="btn-pib-secondary">Close</button>
          <button onClick={send} disabled={sending} className="btn-pib-primary disabled:opacity-50">
            {sending ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>
    </div>
  )
}
