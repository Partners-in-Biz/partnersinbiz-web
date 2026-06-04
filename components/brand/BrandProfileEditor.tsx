'use client'

import { useState } from 'react'

export interface Persona {
  name: string
  role: string
  painPoints: string
}

export interface Competitor {
  url: string
  relationship: 'differentiate' | 'inspire'
}

export interface BrandProfile {
  logoUrl?: string
  logoMarkUrl?: string
  faviconUrl?: string
  bannerUrl?: string
  tagline?: string
  oneLiner?: string
  keyDifferentiators?: string[]
  toneOfVoice?: string
  targetAudience?: string
  personas?: Persona[]
  doWords?: string[]
  dontWords?: string[]
  designAesthetic?: string[]
  colorMode?: 'light' | 'dark' | 'both'
  competitors?: Competitor[]
  imageryTypes?: string[]
  imageryMoods?: string[]
  fonts?: {
    heading?: string
    body?: string
    mono?: string
    weights?: string
    headingScale?: 'large' | 'medium' | 'compact'
  }
  socialHandles?: Record<string, string>
  guidelines?: string
}

export interface BrandColors {
  primary?: string
  secondary?: string
  accent?: string
  background?: string
  surface?: string
  text?: string
  textMuted?: string
  border?: string
  success?: string
  warning?: string
  error?: string
  notes?: Record<string, string>
}

export interface BrandWorkspaceOrg {
  id: string
  name: string
  slug: string
}

export type BrandAssetField = 'logoUrl' | 'logoMarkUrl' | 'bannerUrl'

export interface BrandProfileSavePayload {
  brandProfile: BrandProfile
  brandColors: BrandColors
}

export interface BrandAssetUploadPayload {
  file: File
  field: BrandAssetField
  folder: string
}

interface BrandProfileEditorProps {
  org: BrandWorkspaceOrg
  brandProfile?: BrandProfile | null
  brandColors?: BrandColors | null
  description?: string
  onSave: (payload: BrandProfileSavePayload) => Promise<void>
  onUpload: (payload: BrandAssetUploadPayload) => Promise<string>
}

const SOCIAL_PLATFORMS = ['twitter', 'linkedin', 'instagram', 'facebook', 'tiktok', 'youtube']

const COLOR_DEFS = [
  { key: 'primary', label: 'Primary', hint: 'CTAs, key actions, brand highlights' },
  { key: 'secondary', label: 'Secondary', hint: 'Supporting accents, gradients' },
  { key: 'accent', label: 'Accent', hint: 'Hover states, interactive elements' },
  { key: 'background', label: 'Background', hint: 'Page / app background' },
  { key: 'surface', label: 'Surface / Card', hint: 'Cards, panels, containers' },
  { key: 'text', label: 'Text', hint: 'Primary body text' },
  { key: 'textMuted', label: 'Text Muted', hint: 'Secondary text, captions, labels' },
  { key: 'border', label: 'Border / Divider', hint: 'Lines, separators, outlines' },
  { key: 'success', label: 'Success', hint: 'Confirmations, positive states' },
  { key: 'warning', label: 'Warning', hint: 'Cautions, non-critical alerts' },
  { key: 'error', label: 'Error', hint: 'Errors, destructive actions' },
]

const AESTHETIC_OPTIONS = [
  'minimal', 'bold', 'editorial', 'playful', 'corporate',
  'luxury', 'tech', 'warm', 'dark', 'light', 'clean', 'gritty',
]
const IMAGERY_TYPES = ['photography', 'illustration', 'icons', '3D / CGI', 'mixed']
const IMAGERY_MOODS = ['clean', 'gritty', 'warm', 'cool', 'minimal', 'rich', 'dramatic', 'airy', 'moody']

const emptyProfile: BrandProfile = {
  logoUrl: '',
  logoMarkUrl: '',
  faviconUrl: '',
  bannerUrl: '',
  tagline: '',
  oneLiner: '',
  keyDifferentiators: [],
  toneOfVoice: '',
  targetAudience: '',
  personas: [],
  doWords: [],
  dontWords: [],
  designAesthetic: [],
  colorMode: 'light',
  competitors: [],
  imageryTypes: [],
  imageryMoods: [],
  fonts: { heading: '', body: '', mono: '', weights: '', headingScale: 'medium' },
  socialHandles: {},
  guidelines: '',
}

const inputCls = 'pib-input'
const labelCls = 'pib-label !mb-1'

function TagToggle({
  options,
  selected,
  onToggle,
  disabled,
}: {
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = selected.includes(option)
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(option)}
            className={[
              'rounded-full px-3 py-1 text-xs font-label transition-colors disabled:opacity-60',
              active
                ? 'bg-[var(--color-pib-accent)] text-black'
                : 'bg-[var(--color-pib-surface-2)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]',
            ].join(' ')}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  type?: string
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type={type}
        className={inputCls}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  )
}

function normalizeProfile(profile?: BrandProfile | null): BrandProfile {
  return {
    ...emptyProfile,
    ...(profile ?? {}),
    keyDifferentiators: profile?.keyDifferentiators ?? [],
    personas: profile?.personas ?? [],
    doWords: profile?.doWords ?? [],
    dontWords: profile?.dontWords ?? [],
    designAesthetic: profile?.designAesthetic ?? [],
    colorMode: profile?.colorMode ?? 'light',
    competitors: profile?.competitors ?? [],
    imageryTypes: profile?.imageryTypes ?? [],
    imageryMoods: profile?.imageryMoods ?? [],
    fonts: { ...emptyProfile.fonts, ...(profile?.fonts ?? {}) },
    socialHandles: profile?.socialHandles ?? {},
  }
}

function normalizeColors(brandColors?: BrandColors | null) {
  const loadedColors: Record<string, string> = {}
  for (const { key } of COLOR_DEFS) {
    loadedColors[key] = String((brandColors as Record<string, unknown> | null | undefined)?.[key] ?? '')
  }
  return loadedColors
}

export function BrandProfileEditor({
  org,
  brandProfile,
  brandColors,
  description,
  onSave,
  onUpload,
}: BrandProfileEditorProps) {
  const [formData, setFormData] = useState<BrandProfile>(() => normalizeProfile(brandProfile))
  const [colors, setColors] = useState<Record<string, string>>(() => normalizeColors(brandColors))
  const [colorNotes, setColorNotes] = useState<Record<string, string>>(() => brandColors?.notes ?? {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [logoUploading, setLogoUploading] = useState(false)
  const [logoMarkUploading, setLogoMarkUploading] = useState(false)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [diffInput, setDiffInput] = useState('')
  const [doWordInput, setDoWordInput] = useState('')
  const [dontWordInput, setDontWordInput] = useState('')
  const [competitorInput, setCompetitorInput] = useState('')
  const [competitorRel, setCompetitorRel] = useState<'differentiate' | 'inspire'>('differentiate')

  const set = <K extends keyof BrandProfile>(field: K, value: BrandProfile[K]) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setSuccess(false)
  }

  const toggleListValue = (field: 'designAesthetic' | 'imageryTypes' | 'imageryMoods', value: string) => {
    const current = formData[field] ?? []
    set(field, current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  }

  const addListValue = (field: 'keyDifferentiators' | 'doWords' | 'dontWords', value: string, reset: () => void) => {
    const next = value.trim()
    if (!next) return
    set(field, [...(formData[field] ?? []), next])
    reset()
  }

  async function persist(nextProfile = formData, opts: { showSuccess?: boolean } = {}) {
    const brandColors: BrandColors = { ...colors, notes: colorNotes }
    await onSave({ brandProfile: nextProfile, brandColors })
    if (opts.showSuccess !== false) {
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    }
  }

  async function handleUpload(
    event: React.ChangeEvent<HTMLInputElement>,
    field: 'logoUrl' | 'logoMarkUrl' | 'bannerUrl',
    folder: string,
    setUploading: (value: boolean) => void,
  ) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    setSuccess(false)
    try {
      const url = await onUpload({ file, field, folder })
      const nextProfile = { ...formData, [field]: url }
      setFormData(nextProfile)
      await persist(nextProfile, { showSuccess: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess(false)
    try {
      await persist()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save brand profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="eyebrow">Workspace / Brand</p>
        <h1 className="mt-1 font-headline text-2xl font-bold text-[var(--color-pib-text)]">Brand Profile</h1>
        <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
          {description ?? `Everything Partners in Biz agents and designers need to produce on-brand work for ${org.name}.`}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-[var(--color-pib-success)]/30 bg-[var(--color-pib-success)]/10 px-4 py-3 text-sm text-[var(--color-pib-success)]">
          Brand profile saved.
        </div>
      )}

      <div className="pib-card space-y-5">
        <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Brand Preview</h2>
        <div>
          <p className={labelCls}>Colour Palette</p>
          <div className="flex flex-wrap gap-2">
            {COLOR_DEFS.map(({ key, label }) => (
              <div key={key} className="flex flex-col items-center gap-1">
                <div
                  className="h-8 w-8 shrink-0 rounded-md border border-[var(--color-pib-line-strong)]"
                  style={{ background: colors[key] || 'var(--color-pib-surface-2)' }}
                />
                <span className="max-w-10 text-center text-[9px] capitalize leading-tight text-[var(--color-pib-text-muted)]">
                  {label.replace(' / ', '\n')}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className={labelCls}>Typography Sample</p>
          {formData.fonts?.heading || formData.fonts?.body ? (
            <div className="space-y-2 rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
              <p style={{ fontFamily: formData.fonts?.heading || 'inherit' }} className="text-lg text-[var(--color-pib-text)]">
                The quick brown fox
              </p>
              <p style={{ fontFamily: formData.fonts?.body || 'inherit' }} className="text-sm text-[var(--color-pib-text-muted)]">
                Jumps over the lazy dog. 0123456789.
              </p>
            </div>
          ) : (
            <p className="text-xs italic text-[var(--color-pib-text-muted)]">Set fonts below to see a type sample.</p>
          )}
        </div>
        {(formData.designAesthetic?.length ?? 0) > 0 && (
          <div>
            <p className={labelCls}>Design Aesthetic</p>
            <div className="flex flex-wrap gap-2">
              {(formData.designAesthetic ?? []).map((tag) => (
                <span key={tag} className="rounded-full bg-[var(--color-pib-accent)] px-3 py-1 text-xs font-label text-black">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <section className="pib-card space-y-4">
          <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Identity</h2>
          <TextField label="Tagline" value={formData.tagline ?? ''} onChange={(value) => set('tagline', value)} placeholder="e.g. Software your competitors will copy." disabled={saving} />
          <TextField label="One-liner / elevator pitch" value={formData.oneLiner ?? ''} onChange={(value) => set('oneLiner', value)} placeholder="We build X for Y so they can Z." disabled={saving} />
          <div>
            <label className={labelCls}>Key Differentiators</label>
            <div className="mb-2 flex gap-2">
              <input
                className={inputCls}
                value={diffInput}
                onChange={(event) => setDiffInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addListValue('keyDifferentiators', diffInput, () => setDiffInput(''))
                  }
                }}
                placeholder="e.g. EFT-first invoicing, no Stripe"
                disabled={saving}
              />
              <button type="button" className="pib-btn-secondary shrink-0 !px-3 !text-xs" disabled={saving} onClick={() => addListValue('keyDifferentiators', diffInput, () => setDiffInput(''))}>
                Add
              </button>
            </div>
            <div className="space-y-1">
              {(formData.keyDifferentiators ?? []).map((item, index) => (
                <div key={`${item}-${index}`} className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--color-pib-text-muted)]">-</span>
                  <span className="flex-1">{item}</span>
                  <button type="button" className="text-xs text-[var(--color-pib-text-muted)] hover:text-red-300" onClick={() => set('keyDifferentiators', (formData.keyDifferentiators ?? []).filter((_, itemIndex) => itemIndex !== index))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="pib-card space-y-4">
          <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Logo & Assets</h2>
          <AssetUpload title="Logo (full wordmark)" url={formData.logoUrl ?? ''} uploading={logoUploading} onUrlChange={(value) => set('logoUrl', value)} onUpload={(event) => handleUpload(event, 'logoUrl', 'brands/logos', setLogoUploading)} disabled={saving} />
          <AssetUpload title="Logo Mark (icon / symbol)" url={formData.logoMarkUrl ?? ''} uploading={logoMarkUploading} onUrlChange={(value) => set('logoMarkUrl', value)} onUpload={(event) => handleUpload(event, 'logoMarkUrl', 'brands/logos', setLogoMarkUploading)} disabled={saving} />
          <TextField label="Favicon URL" type="url" value={formData.faviconUrl ?? ''} onChange={(value) => set('faviconUrl', value)} placeholder="https://example.com/favicon.ico" disabled={saving} />
          <AssetUpload title="Banner / OG Image" url={formData.bannerUrl ?? ''} uploading={bannerUploading} onUrlChange={(value) => set('bannerUrl', value)} onUpload={(event) => handleUpload(event, 'bannerUrl', 'brands/banners', setBannerUploading)} disabled={saving} wide />
        </section>

        <section className="pib-card space-y-5">
          <div>
            <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Colour Palette</h2>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">Add a usage note per colour so agents know when to apply each one.</p>
          </div>
          <div>
            <label className={labelCls}>Colour Mode</label>
            <div className="flex gap-4">
              {(['light', 'dark', 'both'] as const).map((mode) => (
                <label key={mode} className="flex cursor-pointer items-center gap-1.5 text-sm capitalize">
                  <input type="radio" name="colorMode" value={mode} checked={formData.colorMode === mode} onChange={() => set('colorMode', mode)} disabled={saving} />
                  {mode}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            {COLOR_DEFS.map(({ key, label, hint }) => (
              <div key={key} className="space-y-2 rounded-lg border border-[var(--color-pib-line)] p-3">
                <div className="flex items-center gap-3">
                  <input type="color" value={colors[key] || '#000000'} onChange={(event) => setColors((previous) => ({ ...previous, [key]: event.target.value }))} className="h-9 w-12 shrink-0 cursor-pointer rounded" disabled={saving} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-label uppercase tracking-wide">{label}</span>
                      <span className="text-[10px] text-[var(--color-pib-text-muted)]">{hint}</span>
                    </div>
                    <input className="pib-input mt-1 !py-1 font-mono text-xs" value={colors[key] || ''} onChange={(event) => setColors((previous) => ({ ...previous, [key]: event.target.value }))} placeholder="#000000 or transparent" disabled={saving} />
                  </div>
                </div>
                <input className="pib-input !py-1 text-xs" value={colorNotes[key] || ''} onChange={(event) => setColorNotes((previous) => ({ ...previous, [key]: event.target.value }))} placeholder="Usage note (optional)" disabled={saving} />
              </div>
            ))}
          </div>
        </section>

        <section className="pib-card space-y-4">
          <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Design Aesthetic</h2>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Select all that apply. Agents use this to choose layout density, component style, and imagery treatment.</p>
          <TagToggle options={AESTHETIC_OPTIONS} selected={formData.designAesthetic ?? []} onToggle={(value) => toggleListValue('designAesthetic', value)} disabled={saving} />
        </section>

        <section className="pib-card space-y-4">
          <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Voice & Tone</h2>
          <div>
            <label className={labelCls}>Tone of Voice</label>
            <textarea className={inputCls} value={formData.toneOfVoice ?? ''} onChange={(event) => set('toneOfVoice', event.target.value)} rows={3} placeholder="e.g. Direct, confident, honest. No jargon." disabled={saving} />
          </div>
          <TextField label="Target Audience" value={formData.targetAudience ?? ''} onChange={(value) => set('targetAudience', value)} placeholder="e.g. Ambitious SMEs in South Africa, UK, and US" disabled={saving} />
          <PersonasEditor personas={formData.personas ?? []} disabled={saving} onChange={(personas) => set('personas', personas)} />
          <WordList label="Words to Use" value={doWordInput} words={formData.doWords ?? []} pillClass="bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent-hover)]" disabled={saving} onInput={setDoWordInput} onAdd={() => addListValue('doWords', doWordInput, () => setDoWordInput(''))} onRemove={(index) => set('doWords', (formData.doWords ?? []).filter((_, itemIndex) => itemIndex !== index))} />
          <WordList label="Words to Avoid" value={dontWordInput} words={formData.dontWords ?? []} pillClass="bg-red-400/10 text-red-200" disabled={saving} onInput={setDontWordInput} onAdd={() => addListValue('dontWords', dontWordInput, () => setDontWordInput(''))} onRemove={(index) => set('dontWords', (formData.dontWords ?? []).filter((_, itemIndex) => itemIndex !== index))} />
        </section>

        <section className="pib-card space-y-4">
          <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Typography</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Heading Font" value={formData.fonts?.heading ?? ''} onChange={(value) => set('fonts', { ...formData.fonts, heading: value })} placeholder="e.g. Instrument Serif" disabled={saving} />
            <TextField label="Body Font" value={formData.fonts?.body ?? ''} onChange={(value) => set('fonts', { ...formData.fonts, body: value })} placeholder="e.g. Geist Sans" disabled={saving} />
            <TextField label="Mono / Label Font" value={formData.fonts?.mono ?? ''} onChange={(value) => set('fonts', { ...formData.fonts, mono: value })} placeholder="e.g. Geist Mono" disabled={saving} />
            <TextField label="Font Weights in Use" value={formData.fonts?.weights ?? ''} onChange={(value) => set('fonts', { ...formData.fonts, weights: value })} placeholder="e.g. 400, 600, 700" disabled={saving} />
          </div>
          <div>
            <label className={labelCls}>Heading Scale Preference</label>
            <div className="flex gap-4">
              {(['large', 'medium', 'compact'] as const).map((scale) => (
                <label key={scale} className="flex cursor-pointer items-center gap-1.5 text-sm capitalize">
                  <input type="radio" value={scale} checked={(formData.fonts?.headingScale ?? 'medium') === scale} onChange={() => set('fonts', { ...formData.fonts, headingScale: scale })} disabled={saving} />
                  {scale}
                </label>
              ))}
            </div>
          </div>
        </section>

        <section className="pib-card space-y-4">
          <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Competitors & Inspiration</h2>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Add brands to differentiate from, and brands to draw visual or tone inspiration from.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input className={inputCls} value={competitorInput} onChange={(event) => setCompetitorInput(event.target.value)} placeholder="https://competitor.com" disabled={saving} />
            <select className="pib-select sm:w-40" value={competitorRel} onChange={(event) => setCompetitorRel(event.target.value as 'differentiate' | 'inspire')} disabled={saving}>
              <option value="differentiate">Differentiate</option>
              <option value="inspire">Inspire</option>
            </select>
            <button type="button" className="pib-btn-secondary shrink-0 !px-3 !text-xs" disabled={saving} onClick={() => {
              if (!competitorInput.trim()) return
              set('competitors', [...(formData.competitors ?? []), { url: competitorInput.trim(), relationship: competitorRel }])
              setCompetitorInput('')
            }}>
              Add
            </button>
          </div>
          <div className="space-y-2">
            {(formData.competitors ?? []).map((competitor, index) => (
              <div key={`${competitor.url}-${index}`} className="flex items-center gap-3 text-sm">
                <span className={['shrink-0 rounded-full px-2 py-0.5 text-[10px] font-label', competitor.relationship === 'inspire' ? 'bg-blue-400/10 text-blue-200' : 'bg-orange-400/10 text-orange-200'].join(' ')}>
                  {competitor.relationship}
                </span>
                <span className="flex-1 truncate font-mono text-xs text-[var(--color-pib-text-muted)]">{competitor.url}</span>
                <button type="button" className="text-xs text-[var(--color-pib-text-muted)] hover:text-red-300" onClick={() => set('competitors', (formData.competitors ?? []).filter((_, itemIndex) => itemIndex !== index))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="pib-card space-y-4">
          <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Imagery Style</h2>
          <div>
            <label className={labelCls}>Content Type</label>
            <TagToggle options={IMAGERY_TYPES} selected={formData.imageryTypes ?? []} onToggle={(value) => toggleListValue('imageryTypes', value)} disabled={saving} />
          </div>
          <div>
            <label className={labelCls}>Mood / Treatment</label>
            <TagToggle options={IMAGERY_MOODS} selected={formData.imageryMoods ?? []} onToggle={(value) => toggleListValue('imageryMoods', value)} disabled={saving} />
          </div>
        </section>

        <section className="pib-card space-y-4">
          <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Social Handles</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {SOCIAL_PLATFORMS.map((platform) => (
              <TextField
                key={platform}
                label={platform.charAt(0).toUpperCase() + platform.slice(1)}
                value={formData.socialHandles?.[platform] ?? ''}
                onChange={(value) => set('socialHandles', { ...formData.socialHandles, [platform]: value })}
                placeholder={platform === 'twitter' ? '@handle' : platform === 'linkedin' ? 'company/slug' : `@${platform}handle`}
                disabled={saving}
              />
            ))}
          </div>
        </section>

        <section className="pib-card space-y-3">
          <h2 className="text-sm font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Additional Guidelines</h2>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Free-form. Markdown supported. Anything that does not fit the fields above.</p>
          <textarea className={inputCls} value={formData.guidelines ?? ''} onChange={(event) => set('guidelines', event.target.value)} rows={6} placeholder="e.g. Never use stock photos. Always pair a stat with a source." disabled={saving} />
        </section>

        <div className="pb-8 pt-2">
          <button type="submit" className="pib-btn-primary text-sm font-label" disabled={saving}>
            {saving ? 'Saving...' : 'Save Brand Profile'}
          </button>
        </div>
      </form>
    </div>
  )
}

function AssetUpload({
  title,
  url,
  uploading,
  onUrlChange,
  onUpload,
  disabled,
  wide = false,
}: {
  title: string
  url: string
  uploading: boolean
  onUrlChange: (value: string) => void
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  disabled?: boolean
  wide?: boolean
}) {
  return (
    <div>
      <label className={labelCls}>{title}</label>
      <div className={wide ? 'space-y-2' : 'flex items-start gap-4'}>
        {url ? (
          <div className={wide ? 'h-28 w-full overflow-hidden rounded-lg bg-[var(--color-pib-surface-2)]' : 'flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--color-pib-surface-2)]'}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className={wide ? 'h-full w-full object-cover' : 'h-full w-full object-contain'} />
          </div>
        ) : !wide ? (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-[var(--color-pib-surface-2)] text-xs text-[var(--color-pib-text-muted)]">
            No asset
          </div>
        ) : null}
        <div className="flex-1 space-y-2">
          <label className={`inline-flex rounded-lg px-3 py-2 text-xs font-label ${uploading || disabled ? 'cursor-not-allowed opacity-50' : 'pib-btn-secondary'}`}>
            {uploading ? 'Uploading...' : 'Upload'}
            <input type="file" accept="image/*" className="hidden" disabled={uploading || disabled} onChange={onUpload} />
          </label>
          <input type="url" className={`${inputCls} text-xs`} value={url} onChange={(event) => onUrlChange(event.target.value)} placeholder="or paste URL" disabled={disabled} />
        </div>
      </div>
    </div>
  )
}

function PersonasEditor({
  personas,
  disabled,
  onChange,
}: {
  personas: Persona[]
  disabled?: boolean
  onChange: (personas: Persona[]) => void
}) {
  return (
    <div>
      <label className={labelCls}>Personas</label>
      <div className="mb-3 space-y-3">
        {personas.map((persona, index) => (
          <div key={index} className="space-y-2 rounded-lg border border-[var(--color-pib-line)] p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inputCls} value={persona.name} onChange={(event) => {
                const next = [...personas]
                next[index] = { ...next[index], name: event.target.value }
                onChange(next)
              }} placeholder="Name (e.g. The Founder)" disabled={disabled} />
              <input className={inputCls} value={persona.role} onChange={(event) => {
                const next = [...personas]
                next[index] = { ...next[index], role: event.target.value }
                onChange(next)
              }} placeholder="Role / title" disabled={disabled} />
            </div>
            <textarea className={inputCls} value={persona.painPoints} onChange={(event) => {
              const next = [...personas]
              next[index] = { ...next[index], painPoints: event.target.value }
              onChange(next)
            }} placeholder="Pain points, goals, what they care about" rows={2} disabled={disabled} />
            <button type="button" className="text-xs text-[var(--color-pib-text-muted)] hover:text-red-300" onClick={() => onChange(personas.filter((_, itemIndex) => itemIndex !== index))}>
              Remove persona
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="pib-btn-secondary !px-3 !text-xs" disabled={disabled} onClick={() => onChange([...personas, { name: '', role: '', painPoints: '' }])}>
        Add persona
      </button>
    </div>
  )
}

function WordList({
  label,
  value,
  words,
  pillClass,
  disabled,
  onInput,
  onAdd,
  onRemove,
}: {
  label: string
  value: string
  words: string[]
  pillClass: string
  disabled?: boolean
  onInput: (value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="mb-2 flex gap-2">
        <input
          className={inputCls}
          value={value}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onAdd()
            }
          }}
          placeholder="Type and press Enter"
          disabled={disabled}
        />
        <button type="button" className="pib-btn-secondary shrink-0 !px-3 !text-xs" disabled={disabled} onClick={onAdd}>
          Add
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {words.map((word, index) => (
          <span key={`${word}-${index}`} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${pillClass}`}>
            {word}
            <button type="button" className="opacity-60 hover:opacity-100" onClick={() => onRemove(index)}>
              x
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
