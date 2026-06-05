'use client'

// Reusable AI assistant panel for the email builders.
// Drops into the BroadcastEditor, TemplateEditor, and SequenceEditor.
//
// Modes:
//   - 'email'      → Generate email, Subject variants, Rewrite
//   - 'sequence'   → Generate sequence (+ rewrite for a step)
//   - 'newsletter' → Generate newsletter document (stories + brand voice)

import { useCallback, useMemo, useState } from 'react'
import { PageTabs } from '@/components/ui/AppFoundation'
import type { EmailDocument } from '@/lib/email-builder/types'

interface BrandVoice {
  tone: 'professional' | 'friendly' | 'bold' | 'playful' | 'authoritative' | 'founder-led'
  audience: string
  doNotUseWords: string[]
  sampleLines: string[]
  signOff?: string
  ctaStyle?: 'soft' | 'direct'
}

interface GeneratedSequenceStep {
  stepNumber: number
  delayDays: number
  subject: string
  bodyHtml: string
  bodyText: string
}

interface ApplyPayload {
  subject?: string
  preheader?: string
  bodyHtml?: string
  bodyText?: string
  document?: EmailDocument
  steps?: GeneratedSequenceStep[]
}

interface Props {
  mode: 'email' | 'sequence' | 'newsletter'
  onApply: (result: ApplyPayload) => void
  defaultVoice?: BrandVoice
  /** Optional org id — sent on requests so the server can default voice. */
  orgId?: string
  /** Existing body, prefilled for the Rewrite tab. */
  existingBody?: string
  onClose?: () => void
}

const PRESETS = [
  { key: 'pib', label: 'PiB founder voice', tone: 'founder-led' as const },
  { key: 'warm', label: 'Warm professional', tone: 'professional' as const },
  { key: 'bold', label: 'Bold startup', tone: 'bold' as const },
  { key: 'clinical', label: 'Clinical authority', tone: 'authoritative' as const },
  { key: 'playful', label: 'Playful brand', tone: 'playful' as const },
  { key: 'custom', label: '(use org/default)', tone: 'founder-led' as const },
]

function presetToVoice(presetKey: string, fallback?: BrandVoice): BrandVoice | undefined {
  if (presetKey === 'custom') return fallback
  const preset = PRESETS.find((p) => p.key === presetKey)
  if (!preset) return fallback
  return {
    tone: preset.tone,
    audience:
      preset.key === 'pib'
        ? 'small SA business owners and operators who want fewer tools, not more'
        : preset.key === 'warm'
          ? 'clients of a service business — accountants, consultants, agencies'
          : preset.key === 'bold'
            ? 'founders and operators who get a hundred pitch emails a week'
            : preset.key === 'clinical'
              ? 'patients, clients, or counterparties of a law/health/finance practice'
              : 'consumers shopping for clothing, food, beauty, or lifestyle products',
    doNotUseWords: ['leverage', 'supercharge', 'synergy', 'unlock', 'delve'],
    sampleLines:
      preset.key === 'pib'
        ? [
            "Most agencies juggle five tools to do this. We don't think that's necessary.",
            'You should not need a developer to schedule a tweet.',
          ]
        : [],
    signOff: preset.key === 'pib' ? '— Peet' : '',
    ctaStyle: preset.tone === 'professional' || preset.tone === 'authoritative' ? 'soft' : 'direct',
  }
}

type Tab = 'email' | 'subjects' | 'sequence' | 'rewrite' | 'newsletter'

export default function AiAssistantPanel({
  mode,
  onApply,
  defaultVoice,
  orgId,
  existingBody,
  onClose,
}: Props) {
  const initialTab: Tab =
    mode === 'sequence' ? 'sequence' : mode === 'newsletter' ? 'newsletter' : 'email'
  const [tab, setTab] = useState<Tab>(initialTab)

  const tabs = useMemo<{ key: Tab; label: string }[]>(() => {
    if (mode === 'sequence') return [{ key: 'sequence', label: 'Generate sequence' }, { key: 'rewrite', label: 'Rewrite' }]
    if (mode === 'newsletter') return [{ key: 'newsletter', label: 'Generate newsletter' }, { key: 'subjects', label: 'Subject variants' }]
    return [
      { key: 'email', label: 'Generate email' },
      { key: 'subjects', label: 'Subject variants' },
      { key: 'rewrite', label: 'Rewrite' },
    ]
  }, [mode])

  return (
    <div className="h-full flex flex-col bg-surface border-l border-outline-variant w-[420px] max-w-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant bg-surface-container">
        <div>
          <h3 className="text-sm font-semibold text-on-surface">Pip · AI Assistant</h3>
          <p className="text-xs text-on-surface-variant">Generate, vary, and rewrite email content.</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface text-xl leading-none">
            ×
          </button>
        )}
      </div>

      <PageTabs
        className="border-x-0 border-t-0 px-2"
        ariaLabel="AI assistant mode"
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        tabs={tabs.map((item) => ({ label: item.label, value: item.key }))}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'email' && (
          <EmailTab
            onApply={onApply}
            defaultVoice={defaultVoice}
            orgId={orgId}
          />
        )}
        {tab === 'subjects' && (
          <SubjectsTab onApply={onApply} defaultVoice={defaultVoice} orgId={orgId} body={existingBody} />
        )}
        {tab === 'sequence' && (
          <SequenceTab onApply={onApply} defaultVoice={defaultVoice} orgId={orgId} />
        )}
        {tab === 'newsletter' && (
          <NewsletterTab onApply={onApply} defaultVoice={defaultVoice} orgId={orgId} />
        )}
        {tab === 'rewrite' && (
          <RewriteTab
            onApply={onApply}
            defaultVoice={defaultVoice}
            orgId={orgId}
            existingBody={existingBody}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared API helper
// ---------------------------------------------------------------------------

async function callGenerate(body: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch('/api/v1/email/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok || !json?.success) return { ok: false, error: json?.error ?? 'Request failed' }
    return { ok: true, data: json.data }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ---------------------------------------------------------------------------
// Email tab
// ---------------------------------------------------------------------------

function VoiceSelector({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-on-surface-variant mb-1">Voice</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
      >
        {PRESETS.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
      </select>
    </div>
  )
}

function PendingDots({ label }: { label: string }) {
  return (
    <div className="text-xs text-on-surface-variant italic">
      {label}
      <span className="inline-block ml-1 animate-pulse">…</span>
    </div>
  )
}

function EmailTab({
  onApply,
  defaultVoice,
  orgId,
}: {
  onApply: Props['onApply']
  defaultVoice?: BrandVoice
  orgId?: string
}) {
  const [goal, setGoal] = useState('')
  const [voiceKey, setVoiceKey] = useState('custom')
  const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium')
  const [audience, setAudience] = useState('')
  const [outputMode, setOutputMode] = useState<'document' | 'inline'>('document')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    subject: string
    preheader: string
    bodyHtml: string
    bodyText: string
    document?: EmailDocument
  } | null>(null)

  const generate = useCallback(async () => {
    if (!goal.trim()) return
    setBusy(true)
    setError(null)
    setResult(null)
    const voice = presetToVoice(voiceKey, defaultVoice)
    const r = await callGenerate({
      kind: 'email',
      orgId,
      input: {
        goal: goal.trim(),
        voice,
        audienceDescription: audience.trim() || undefined,
        contentLength: length,
        outputMode,
      },
    })
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? 'Generation failed')
      return
    }
    setResult(r.data as typeof result)
  }, [goal, voiceKey, defaultVoice, orgId, audience, length, outputMode])

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-on-surface-variant mb-1">Goal</label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          placeholder="e.g. follow up with a cold lead after a demo"
          className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-on-surface-variant mb-1">Audience (optional)</label>
        <input
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder="e.g. ops manager at a 20-person agency"
          className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <VoiceSelector value={voiceKey} onChange={setVoiceKey} />
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Length</label>
          <select
            value={length}
            onChange={(e) => setLength(e.target.value as typeof length)}
            className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
          >
            <option value="short">Short (~50w)</option>
            <option value="medium">Medium (~150w)</option>
            <option value="long">Long (~300w)</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-on-surface-variant mb-1">Output</label>
        <div className="flex gap-2 text-xs">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={outputMode === 'document'}
              onChange={() => setOutputMode('document')}
            />
            EmailDocument (builder)
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={outputMode === 'inline'}
              onChange={() => setOutputMode('inline')}
            />
            Inline subject + HTML
          </label>
        </div>
      </div>
      <button
        onClick={generate}
        disabled={busy || !goal.trim()}
        className="w-full px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Generating…' : 'Generate'}
      </button>
      {busy && <PendingDots label="Pip is writing your email" />}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {result && (
        <div className="space-y-2 border-t border-outline-variant pt-3">
          <div>
            <p className="text-xs text-on-surface-variant">Subject</p>
            <p className="text-sm text-on-surface font-medium">{result.subject}</p>
          </div>
          {result.preheader && (
            <div>
              <p className="text-xs text-on-surface-variant">Preheader</p>
              <p className="text-sm text-on-surface italic">{result.preheader}</p>
            </div>
          )}
          <div className="rounded-md border border-outline-variant p-3 max-h-64 overflow-auto bg-surface-container">
            <div
              className="prose prose-sm text-on-surface"
              dangerouslySetInnerHTML={{ __html: result.bodyHtml }}
            />
          </div>
          <button
            onClick={() => onApply(result)}
            className="w-full px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-medium"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subjects tab
// ---------------------------------------------------------------------------

function SubjectsTab({
  onApply,
  defaultVoice,
  orgId,
  body,
}: {
  onApply: Props['onApply']
  defaultVoice?: BrandVoice
  orgId?: string
  body?: string
}) {
  const [topic, setTopic] = useState('')
  const [voiceKey, setVoiceKey] = useState('custom')
  const [count, setCount] = useState(5)
  const [busy, setBusy] = useState(false)
  const [subjects, setSubjects] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(async () => {
    if (!topic.trim()) return
    setBusy(true)
    setError(null)
    setSubjects([])
    const voice = presetToVoice(voiceKey, defaultVoice)
    const r = await callGenerate({
      kind: 'subjects',
      orgId,
      input: { topic: topic.trim(), voice, count, body },
    })
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? 'Generation failed')
      return
    }
    const data = r.data as { subjects: string[] }
    setSubjects(data.subjects ?? [])
  }, [topic, voiceKey, defaultVoice, count, orgId, body])

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-on-surface-variant mb-1">Topic</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What is this email about?"
          className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <VoiceSelector value={voiceKey} onChange={setVoiceKey} />
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Count</label>
          <input
            type="number"
            min={2}
            max={10}
            value={count}
            onChange={(e) => setCount(Math.max(2, Math.min(10, Number(e.target.value) || 5)))}
            className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
          />
        </div>
      </div>
      <button
        onClick={generate}
        disabled={busy || !topic.trim()}
        className="w-full px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Generating…' : `Generate ${count} subjects`}
      </button>
      {busy && <PendingDots label="Pip is brainstorming subjects" />}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {subjects.length > 0 && (
        <ul className="space-y-1 border-t border-outline-variant pt-3">
          {subjects.map((s, i) => (
            <li
              key={i}
              className="flex items-center gap-2 px-2 py-2 rounded-md bg-surface-container hover:bg-surface-container-high"
            >
              <span className="flex-1 text-sm text-on-surface">{s}</span>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(s)
                }}
                className="text-xs text-on-surface-variant hover:text-on-surface"
                title="Copy"
              >
                Copy
              </button>
              <button
                onClick={() => onApply({ subject: s })}
                className="text-xs text-primary font-medium hover:underline"
              >
                Use
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sequence tab
// ---------------------------------------------------------------------------

function SequenceTab({
  onApply,
  defaultVoice,
  orgId,
}: {
  onApply: Props['onApply']
  defaultVoice?: BrandVoice
  orgId?: string
}) {
  const [goal, setGoal] = useState('')
  const [voiceKey, setVoiceKey] = useState('custom')
  const [steps, setSteps] = useState(4)
  const [cadence, setCadence] = useState<'aggressive' | 'normal' | 'patient'>('normal')
  const [audience, setAudience] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    name: string
    description: string
    steps: GeneratedSequenceStep[]
  } | null>(null)

  const generate = useCallback(async () => {
    if (!goal.trim()) return
    setBusy(true)
    setError(null)
    setResult(null)
    const voice = presetToVoice(voiceKey, defaultVoice)
    const r = await callGenerate({
      kind: 'sequence',
      orgId,
      input: {
        name: 'Sequence',
        goal: goal.trim(),
        voice,
        steps,
        cadence,
        audienceDescription: audience.trim() || undefined,
      },
    })
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? 'Generation failed')
      return
    }
    setResult(r.data as typeof result)
  }, [goal, voiceKey, defaultVoice, steps, cadence, audience, orgId])

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-on-surface-variant mb-1">Sequence goal</label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          placeholder="e.g. nurture a free-trial signup to a paid plan over two weeks"
          className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-on-surface-variant mb-1">Audience (optional)</label>
        <input
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <VoiceSelector value={voiceKey} onChange={setVoiceKey} />
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Steps</label>
          <input
            type="number"
            min={2}
            max={10}
            value={steps}
            onChange={(e) => setSteps(Math.max(2, Math.min(10, Number(e.target.value) || 4)))}
            className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Cadence</label>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as typeof cadence)}
            className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
          >
            <option value="aggressive">Aggressive</option>
            <option value="normal">Normal</option>
            <option value="patient">Patient</option>
          </select>
        </div>
      </div>
      <button
        onClick={generate}
        disabled={busy || !goal.trim()}
        className="w-full px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Generating…' : `Generate ${steps}-step sequence`}
      </button>
      {busy && <PendingDots label="Pip is drafting your sequence" />}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {result && (
        <div className="space-y-2 border-t border-outline-variant pt-3">
          <p className="text-xs text-on-surface-variant">{result.description}</p>
          <ol className="space-y-2">
            {result.steps.map((s) => (
              <li key={s.stepNumber} className="rounded-md border border-outline-variant p-2 bg-surface-container">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-on-surface-variant">
                    Step {s.stepNumber} · day {s.delayDays}
                  </span>
                </div>
                <p className="text-sm font-medium text-on-surface">{s.subject}</p>
                <details className="mt-1">
                  <summary className="text-xs text-on-surface-variant cursor-pointer">Preview body</summary>
                  <div
                    className="prose prose-xs text-on-surface mt-2 max-h-40 overflow-auto"
                    dangerouslySetInnerHTML={{ __html: s.bodyHtml }}
                  />
                </details>
              </li>
            ))}
          </ol>
          <button
            onClick={() => onApply({ steps: result.steps })}
            className="w-full px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-medium"
          >
            Apply to sequence
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Newsletter tab
// ---------------------------------------------------------------------------

function NewsletterTab({
  onApply,
  defaultVoice,
  orgId,
}: {
  onApply: Props['onApply']
  defaultVoice?: BrandVoice
  orgId?: string
}) {
  const [topic, setTopic] = useState('')
  const [orgName, setOrgName] = useState('')
  const [voiceKey, setVoiceKey] = useState('custom')
  const [stories, setStories] = useState<{ heading: string; bodyHint: string; ctaText: string; ctaUrl: string }[]>([
    { heading: '', bodyHint: '', ctaText: '', ctaUrl: '' },
    { heading: '', bodyHint: '', ctaText: '', ctaUrl: '' },
    { heading: '', bodyHint: '', ctaText: '', ctaUrl: '' },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ document: EmailDocument; subject: string; preheader: string } | null>(null)

  const updateStory = (i: number, patch: Partial<(typeof stories)[number]>) => {
    setStories((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  const generate = useCallback(async () => {
    const filledStories = stories
      .filter((s) => s.heading.trim() && s.bodyHint.trim())
      .map((s) => ({
        heading: s.heading.trim(),
        bodyHint: s.bodyHint.trim(),
        ctaText: s.ctaText.trim() || undefined,
        ctaUrl: s.ctaUrl.trim() || undefined,
      }))
    if (filledStories.length === 0) {
      setError('Add at least one story (heading + hint)')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    const voice = presetToVoice(voiceKey, defaultVoice)
    const r = await callGenerate({
      kind: 'newsletter',
      orgId,
      input: {
        topic: topic.trim() || 'Newsletter',
        orgName: orgName.trim() || 'Your Brand',
        voice,
        stories: filledStories,
      },
    })
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? 'Generation failed')
      return
    }
    setResult(r.data as typeof result)
  }, [stories, voiceKey, defaultVoice, topic, orgName, orgId])

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Topic</label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Monthly digest, product update…"
            className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Org name</label>
          <input
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
          />
        </div>
      </div>
      <VoiceSelector value={voiceKey} onChange={setVoiceKey} />
      <div className="space-y-2">
        <p className="text-xs font-medium text-on-surface-variant">Stories (up to 5)</p>
        {stories.map((s, i) => (
          <div key={i} className="rounded-md border border-outline-variant p-2 space-y-1 bg-surface-container">
            <input
              value={s.heading}
              onChange={(e) => updateStory(i, { heading: e.target.value })}
              placeholder={`Story ${i + 1} heading`}
              className="w-full px-2 py-1 rounded border border-outline-variant bg-surface text-on-surface text-xs"
            />
            <input
              value={s.bodyHint}
              onChange={(e) => updateStory(i, { bodyHint: e.target.value })}
              placeholder="What this story is about — Pip writes the prose"
              className="w-full px-2 py-1 rounded border border-outline-variant bg-surface text-on-surface text-xs"
            />
            <div className="grid grid-cols-2 gap-1">
              <input
                value={s.ctaText}
                onChange={(e) => updateStory(i, { ctaText: e.target.value })}
                placeholder="CTA text (optional)"
                className="px-2 py-1 rounded border border-outline-variant bg-surface text-on-surface text-xs"
              />
              <input
                value={s.ctaUrl}
                onChange={(e) => updateStory(i, { ctaUrl: e.target.value })}
                placeholder="CTA URL"
                className="px-2 py-1 rounded border border-outline-variant bg-surface text-on-surface text-xs"
              />
            </div>
          </div>
        ))}
        {stories.length < 5 && (
          <button
            onClick={() => setStories((prev) => [...prev, { heading: '', bodyHint: '', ctaText: '', ctaUrl: '' }])}
            className="text-xs text-primary hover:underline"
          >
            + Add story
          </button>
        )}
      </div>
      <button
        onClick={generate}
        disabled={busy}
        className="w-full px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Generating…' : 'Generate newsletter'}
      </button>
      {busy && <PendingDots label="Pip is composing your newsletter" />}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {result && (
        <div className="space-y-2 border-t border-outline-variant pt-3">
          <div>
            <p className="text-xs text-on-surface-variant">Subject</p>
            <p className="text-sm text-on-surface font-medium">{result.subject}</p>
          </div>
          <p className="text-xs text-on-surface-variant">
            {result.document.blocks.length} blocks generated.
          </p>
          <button
            onClick={() => onApply({ document: result.document, subject: result.subject, preheader: result.preheader })}
            className="w-full px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-medium"
          >
            Apply to template
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rewrite tab
// ---------------------------------------------------------------------------

function RewriteTab({
  onApply,
  defaultVoice,
  orgId,
  existingBody,
}: {
  onApply: Props['onApply']
  defaultVoice?: BrandVoice
  orgId?: string
  existingBody?: string
}) {
  const [body, setBody] = useState(existingBody ?? '')
  const [voiceKey, setVoiceKey] = useState('custom')
  const [instruction, setInstruction] = useState<'tighten' | 'expand' | 'soften' | 'sharpen' | 'translate-sa-english'>('tighten')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ bodyHtml: string; bodyText: string } | null>(null)

  const generate = useCallback(async () => {
    if (!body.trim()) return
    setBusy(true)
    setError(null)
    setResult(null)
    const voice = presetToVoice(voiceKey, defaultVoice)
    const r = await callGenerate({
      kind: 'rewrite',
      orgId,
      input: { body, voice, instruction },
    })
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? 'Generation failed')
      return
    }
    setResult(r.data as typeof result)
  }, [body, voiceKey, defaultVoice, instruction, orgId])

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-on-surface-variant mb-1">Original body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-xs font-mono"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <VoiceSelector value={voiceKey} onChange={setVoiceKey} />
        <div>
          <label className="block text-xs font-medium text-on-surface-variant mb-1">Instruction</label>
          <select
            value={instruction}
            onChange={(e) => setInstruction(e.target.value as typeof instruction)}
            className="w-full px-3 py-2 rounded-md border border-outline-variant bg-surface-container text-on-surface text-sm"
          >
            <option value="tighten">Tighten</option>
            <option value="expand">Expand</option>
            <option value="soften">Soften</option>
            <option value="sharpen">Sharpen</option>
            <option value="translate-sa-english">SA English</option>
          </select>
        </div>
      </div>
      <button
        onClick={generate}
        disabled={busy || !body.trim()}
        className="w-full px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Rewriting…' : 'Rewrite'}
      </button>
      {busy && <PendingDots label="Pip is rewriting" />}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {result && (
        <div className="space-y-2 border-t border-outline-variant pt-3">
          <div
            className="prose prose-sm text-on-surface rounded-md border border-outline-variant p-3 max-h-64 overflow-auto bg-surface-container"
            dangerouslySetInnerHTML={{ __html: result.bodyHtml }}
          />
          <button
            onClick={() => onApply({ bodyHtml: result.bodyHtml, bodyText: result.bodyText })}
            className="w-full px-4 py-2 rounded-md bg-primary text-on-primary text-sm font-medium"
          >
            Replace body
          </button>
        </div>
      )}
    </div>
  )
}
