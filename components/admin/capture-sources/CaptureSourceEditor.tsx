'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  CaptureField,
  CaptureFieldType,
  CaptureSource,
  CaptureSourceBlockStats,
  CaptureSourceRateLimit,
  CaptureSubmission,
  CaptureWidgetTheme,
  DoubleOptInMode,
  WidgetDisplayConfig,
  WidgetDisplayMode,
  WidgetDisplayStep,
  WidgetPosition,
} from '@/lib/lead-capture/types'
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_BLOCK_STATS,
  DEFAULT_DISPLAY_CONFIG,
} from '@/lib/lead-capture/types'
import { PageTabs } from '@/components/ui/AppFoundation'
import type { Sequence } from '@/lib/sequences/types'
import type { Campaign } from '@/lib/campaigns/types'

type TabKey = 'setup' | 'fields' | 'routing' | 'widget' | 'display' | 'spam' | 'embed' | 'submissions'

const DISPLAY_MODES: { value: WidgetDisplayMode; label: string; help: string }[] = [
  { value: 'inline', label: 'Inline', help: 'Form renders next to the script tag.' },
  { value: 'popup', label: 'Popup modal', help: 'Full-screen modal triggered by delay or scroll.' },
  { value: 'slide-in', label: 'Slide-in toast', help: 'Small card sliding in from a corner.' },
  { value: 'exit-intent', label: 'Exit-intent', help: 'Popup that fires only when the visitor signals leaving.' },
  { value: 'multi-step', label: 'Multi-step', help: 'Progressive form — captures email first, then more fields.' },
]

const POSITIONS: WidgetPosition[] = [
  'center', 'bottom-right', 'bottom-left', 'top-right', 'top-left',
]

interface Props {
  source: CaptureSource
  submissions: CaptureSubmission[]
  sequences: Sequence[]
  campaigns: Campaign[]
  appUrl: string
}

interface EditableSource {
  name: string
  doubleOptIn: DoubleOptInMode
  confirmationSubject: string
  confirmationBodyHtml: string
  successMessage: string
  successRedirectUrl: string
  fields: CaptureField[]
  tagsToApply: string[]
  campaignIdsToEnroll: string[]
  sequenceIdsToEnroll: string[]
  notifyEmails: string[]
  widgetTheme: CaptureWidgetTheme
  active: boolean
  turnstileEnabled: boolean
  turnstileSiteKey: string
  honeypotEnabled: boolean
  blockDisposableEmails: boolean
  rateLimit: CaptureSourceRateLimit
}

function pluck(source: CaptureSource): EditableSource {
  return {
    name: source.name ?? '',
    doubleOptIn: source.doubleOptIn ?? 'off',
    confirmationSubject: source.confirmationSubject ?? '',
    confirmationBodyHtml: source.confirmationBodyHtml ?? '',
    successMessage: source.successMessage ?? '',
    successRedirectUrl: source.successRedirectUrl ?? '',
    fields: source.fields ?? [],
    tagsToApply: source.tagsToApply ?? [],
    campaignIdsToEnroll: source.campaignIdsToEnroll ?? [],
    sequenceIdsToEnroll: source.sequenceIdsToEnroll ?? [],
    notifyEmails: source.notifyEmails ?? [],
    widgetTheme: source.widgetTheme,
    active: source.active ?? true,
    turnstileEnabled: source.turnstileEnabled === true,
    turnstileSiteKey: source.turnstileSiteKey ?? '',
    honeypotEnabled: source.honeypotEnabled !== false,
    blockDisposableEmails: source.blockDisposableEmails !== false,
    rateLimit: source.rateLimit ?? { ...DEFAULT_RATE_LIMIT },
  }
}

const FIELD_TYPES: CaptureFieldType[] = ['text', 'email', 'tel', 'textarea', 'select']

export function CaptureSourceEditor(props: Props) {
  const router = useRouter()
  const [tab, setTab] = useState<TabKey>('setup')
  const [state, setState] = useState<EditableSource>(() => pluck(props.source))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const scriptSnippet = `<script src="${props.appUrl}/embed/newsletter/${props.source.id}/widget.js" async></script>`
  const iframeSnippet = `<iframe src="${props.appUrl}/embed/newsletter/${props.source.id}" width="100%" height="520" style="border:0; max-width:480px;" loading="lazy" title="${state.name || 'Subscribe'}"></iframe>`

  function update<K extends keyof EditableSource>(key: K, value: EditableSource[K]) {
    setState((s) => ({ ...s, [key]: value }))
    setSaved(false)
  }

  function updateTheme<K extends keyof CaptureWidgetTheme>(k: K, v: CaptureWidgetTheme[K]) {
    update('widgetTheme', { ...state.widgetTheme, [k]: v })
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/capture-sources/${props.source.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Save failed')
        return
      }
      setSaved(true)
      router.refresh()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err)
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function destroy() {
    if (!confirm('Delete this capture source? Existing submissions are preserved.')) return
    const res = await fetch(`/api/v1/capture-sources/${props.source.id}`, { method: 'DELETE' })
    if (res.ok) router.push('/admin/capture-sources')
    else alert('Delete failed')
  }

  function addField() {
    const next: CaptureField = {
      key: `field_${state.fields.length + 1}`,
      label: 'New field',
      type: 'text',
      required: false,
    }
    update('fields', [...state.fields, next])
  }
  function patchField(i: number, patch: Partial<CaptureField>) {
    update('fields', state.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }
  function removeField(i: number) {
    update('fields', state.fields.filter((_, idx) => idx !== i))
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-on-surface">{state.name || 'Capture source'}</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            {props.source.type} · {state.doubleOptIn === 'on' ? 'Double opt-in' : 'Single opt-in'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-on-surface-variant flex items-center gap-2">
            <input
              type="checkbox"
              checked={state.active}
              onChange={(e) => update('active', e.target.checked)}
            />
            Active
          </label>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </button>
          <button onClick={destroy} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm">
            Delete
          </button>
        </div>
      </div>
      {error ? <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-800 text-sm">{error}</div> : null}

      <Tabs tab={tab} setTab={setTab} submissionCount={props.submissions.length} />

      <div className="mt-6">
        {tab === 'setup' && (
          <SetupTab state={state} update={update} />
        )}
        {tab === 'fields' && (
          <FieldsTab
            fields={state.fields}
            onAdd={addField}
            onPatch={patchField}
            onRemove={removeField}
          />
        )}
        {tab === 'routing' && (
          <RoutingTab
            state={state}
            update={update}
            sequences={props.sequences}
            campaigns={props.campaigns}
          />
        )}
        {tab === 'widget' && (
          <WidgetTab
            theme={state.widgetTheme}
            updateTheme={updateTheme}
            previewUrl={`${props.appUrl}/embed/newsletter/${props.source.id}`}
          />
        )}
        {tab === 'spam' && (
          <SpamProtectionTab
            state={state}
            update={update}
            blockStats={props.source.stats?.blocked ?? DEFAULT_BLOCK_STATS}
          />
        )}
        {tab === 'embed' && (
          <EmbedTab scriptSnippet={scriptSnippet} iframeSnippet={iframeSnippet} />
        )}
        {tab === 'submissions' && (
          <SubmissionsTab submissions={props.submissions} />
        )}
      </div>
    </div>
  )
}

function Tabs(props: { tab: TabKey; setTab: (t: TabKey) => void; submissionCount: number }) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'setup', label: 'Setup' },
    { key: 'fields', label: 'Fields' },
    { key: 'routing', label: 'Routing' },
    { key: 'widget', label: 'Widget' },
    { key: 'spam', label: 'Spam protection' },
    { key: 'embed', label: 'Embed code' },
    { key: 'submissions', label: `Submissions (${props.submissionCount})` },
  ]
  return (
    <PageTabs
      ariaLabel="Capture source editor sections"
      value={props.tab}
      onValueChange={(value) => props.setTab(value as TabKey)}
      tabs={tabs.map((tab) => ({ label: tab.label, value: tab.key }))}
    />
  )
}

function Section(props: { title: string; children: React.ReactNode; description?: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-on-surface mb-1">{props.title}</h3>
      {props.description ? <p className="text-xs text-on-surface-variant mb-3">{props.description}</p> : null}
      {props.children}
    </div>
  )
}

function Input(props: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-on-surface-variant mb-1">{props.label}</span>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
      />
    </label>
  )
}

function TextArea(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-on-surface-variant mb-1">{props.label}</span>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        rows={props.rows ?? 5}
        className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm font-mono"
      />
    </label>
  )
}

function SetupTab(props: { state: EditableSource; update: <K extends keyof EditableSource>(k: K, v: EditableSource[K]) => void }) {
  const { state, update } = props
  return (
    <div>
      <Section title="Name & opt-in mode">
        <Input label="Name" value={state.name} onChange={(v) => update('name', v)} />
        <label className="block mb-3">
          <span className="block text-xs font-medium text-on-surface-variant mb-1">Opt-in mode</span>
          <select
            value={state.doubleOptIn}
            onChange={(e) => update('doubleOptIn', e.target.value as DoubleOptInMode)}
            className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
          >
            <option value="off">Single opt-in (immediate enrollment)</option>
            <option value="on">Double opt-in (confirmation email required)</option>
          </select>
        </label>
      </Section>

      {state.doubleOptIn === 'on' && (
        <Section
          title="Confirmation email"
          description="Sent to the subscriber. Use {{confirmUrl}} where you want the confirmation link."
        >
          <Input
            label="Subject"
            value={state.confirmationSubject}
            onChange={(v) => update('confirmationSubject', v)}
            placeholder="Please confirm your subscription"
          />
          <TextArea
            label="HTML body"
            value={state.confirmationBodyHtml}
            onChange={(v) => update('confirmationBodyHtml', v)}
            placeholder='<p>Click here to confirm: <a href="{{confirmUrl}}">confirm</a></p>'
            rows={8}
          />
        </Section>
      )}

      <Section title="Success behaviour" description="Shown after a successful submission.">
        <Input label="Success message" value={state.successMessage} onChange={(v) => update('successMessage', v)} />
        <Input label="Redirect URL (optional)" value={state.successRedirectUrl} onChange={(v) => update('successRedirectUrl', v)} placeholder="https://yoursite.com/thanks" />
      </Section>
    </div>
  )
}

function FieldsTab(props: {
  fields: CaptureField[]
  onAdd: () => void
  onPatch: (i: number, p: Partial<CaptureField>) => void
  onRemove: (i: number) => void
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-on-surface-variant">Email is always required and added automatically. Configure extra fields here.</p>
        <button onClick={props.onAdd} className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-sm">
          Add field
        </button>
      </div>
      <div className="space-y-2">
        {props.fields.length === 0 ? (
          <p className="text-sm text-on-surface-variant py-4">No additional fields. The form will collect email only.</p>
        ) : (
          props.fields.map((f, i) => (
            <div key={i} className="p-3 rounded-lg bg-surface-container space-y-2">
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
                  placeholder="key"
                  value={f.key}
                  onChange={(e) => props.onPatch(i, { key: e.target.value })}
                />
                <input
                  className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
                  placeholder="Label"
                  value={f.label}
                  onChange={(e) => props.onPatch(i, { label: e.target.value })}
                />
                <select
                  value={f.type}
                  onChange={(e) => props.onPatch(i, { type: e.target.value as CaptureFieldType })}
                  className="px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-sm text-on-surface-variant whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => props.onPatch(i, { required: e.target.checked })}
                  />
                  required
                </label>
                <button
                  onClick={() => props.onRemove(i)}
                  className="px-3 py-2 rounded-lg bg-red-100 text-red-700 text-sm"
                >
                  Remove
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
                  placeholder="placeholder (optional)"
                  value={f.placeholder ?? ''}
                  onChange={(e) => props.onPatch(i, { placeholder: e.target.value })}
                />
                {f.type === 'select' && (
                  <input
                    className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
                    placeholder="options, comma-separated"
                    value={(f.options ?? []).join(', ')}
                    onChange={(e) => props.onPatch(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ChipList(props: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('')
  function add() {
    const v = input.trim()
    if (!v) return
    if (props.values.includes(v)) { setInput(''); return }
    props.onChange([...props.values, v])
    setInput('')
  }
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={props.placeholder}
          className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
        />
        <button onClick={add} className="px-3 py-2 rounded-lg bg-primary text-on-primary text-sm">Add</button>
      </div>
      <div className="flex flex-wrap gap-1">
        {props.values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-container text-xs text-on-surface">
            {v}
            <button
              onClick={() => props.onChange(props.values.filter((x) => x !== v))}
              className="text-on-surface-variant hover:text-red-700"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

function MultiSelect(props: {
  label: string
  options: { id: string; label: string }[]
  values: string[]
  onChange: (v: string[]) => void
}) {
  function toggle(id: string) {
    if (props.values.includes(id)) props.onChange(props.values.filter((x) => x !== id))
    else props.onChange([...props.values, id])
  }
  return (
    <div className="mb-3">
      <span className="block text-xs font-medium text-on-surface-variant mb-1">{props.label}</span>
      {props.options.length === 0 ? (
        <p className="text-sm text-on-surface-variant">None available.</p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto rounded-lg border border-outline-variant p-2">
          {props.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm text-on-surface">
              <input type="checkbox" checked={props.values.includes(o.id)} onChange={() => toggle(o.id)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function RoutingTab(props: {
  state: EditableSource
  update: <K extends keyof EditableSource>(k: K, v: EditableSource[K]) => void
  sequences: Sequence[]
  campaigns: Campaign[]
}) {
  const { state, update } = props
  return (
    <div>
      <Section title="Auto-enroll into sequences" description="Direct sequence enrollment (no campaign). Active sequences only.">
        <MultiSelect
          label="Sequences"
          options={props.sequences.filter((s) => s.status === 'active').map((s) => ({ id: s.id, label: s.name }))}
          values={state.sequenceIdsToEnroll}
          onChange={(v) => update('sequenceIdsToEnroll', v)}
        />
      </Section>
      <Section title="Auto-enroll into campaigns">
        <MultiSelect
          label="Campaigns"
          options={props.campaigns.map((c) => ({ id: c.id, label: `${c.name} · ${c.status}` }))}
          values={state.campaignIdsToEnroll}
          onChange={(v) => update('campaignIdsToEnroll', v)}
        />
      </Section>
      <Section title="Tags applied to new contacts">
        <ChipList values={state.tagsToApply} onChange={(v) => update('tagsToApply', v)} placeholder="newsletter, leadmagnet…" />
      </Section>
      <Section title="Notify on submission" description="Org admins notified by email on every submission.">
        <ChipList values={state.notifyEmails} onChange={(v) => update('notifyEmails', v)} placeholder="admin@yourorg.com" />
      </Section>
    </div>
  )
}

function ColorInput(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-on-surface-variant mb-1">{props.label}</span>
      <div className="flex gap-2 items-center">
        <input
          type="color"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="h-9 w-12 rounded-lg border border-outline-variant"
        />
        <input
          type="text"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
        />
      </div>
    </label>
  )
}

function WidgetTab(props: {
  theme: CaptureWidgetTheme
  updateTheme: <K extends keyof CaptureWidgetTheme>(k: K, v: CaptureWidgetTheme[K]) => void
  previewUrl: string
}) {
  const previewKey = useMemo(() => JSON.stringify(props.theme), [props.theme])
  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <Input label="Heading" value={props.theme.headingText} onChange={(v) => props.updateTheme('headingText', v)} />
        <Input label="Subheading" value={props.theme.subheadingText} onChange={(v) => props.updateTheme('subheadingText', v)} />
        <Input label="Button text" value={props.theme.buttonText} onChange={(v) => props.updateTheme('buttonText', v)} />
        <ColorInput label="Primary color" value={props.theme.primaryColor} onChange={(v) => props.updateTheme('primaryColor', v)} />
        <ColorInput label="Text color" value={props.theme.textColor} onChange={(v) => props.updateTheme('textColor', v)} />
        <ColorInput label="Background color" value={props.theme.backgroundColor} onChange={(v) => props.updateTheme('backgroundColor', v)} />
        <label className="block mb-3">
          <span className="block text-xs font-medium text-on-surface-variant mb-1">Border radius (px)</span>
          <input
            type="number"
            min={0}
            value={props.theme.borderRadius}
            onChange={(e) => props.updateTheme('borderRadius', parseInt(e.target.value || '0', 10))}
            className="w-32 px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
          />
        </label>
        <p className="text-xs text-on-surface-variant mt-2">Save to refresh the preview.</p>
      </div>
      <div>
        <div className="rounded-xl bg-surface-container p-4">
          <p className="text-xs text-on-surface-variant mb-2">Live preview (iframe)</p>
          <iframe
            key={previewKey}
            src={props.previewUrl}
            width="100%"
            height="480"
            style={{ border: 0, background: 'transparent' }}
            title="Widget preview"
          />
        </div>
      </div>
    </div>
  )
}

function SpamProtectionTab(props: {
  state: EditableSource
  update: <K extends keyof EditableSource>(k: K, v: EditableSource[K]) => void
  blockStats: CaptureSourceBlockStats
}) {
  const { state, update, blockStats } = props
  const totalBlocked =
    (blockStats.honeypot ?? 0) +
    (blockStats.rateLimit ?? 0) +
    (blockStats.disposable ?? 0) +
    (blockStats.captcha ?? 0)

  return (
    <div>
      <Section
        title="Suspicious submissions"
        description="Counters of attempts blocked by each spam-protection gate."
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatTile label="Total blocked" value={totalBlocked} highlight />
          <StatTile label="Honeypot" value={blockStats.honeypot ?? 0} />
          <StatTile label="Rate limit" value={blockStats.rateLimit ?? 0} />
          <StatTile label="Disposable" value={blockStats.disposable ?? 0} />
          <StatTile label="CAPTCHA" value={blockStats.captcha ?? 0} />
        </div>
      </Section>

      <Section
        title="Cloudflare Turnstile"
        description="Privacy-friendly CAPTCHA. Requires TURNSTILE_SECRET_KEY env var on the server."
      >
        <label className="flex items-center gap-2 text-sm text-on-surface mb-3">
          <input
            type="checkbox"
            checked={state.turnstileEnabled}
            onChange={(e) => update('turnstileEnabled', e.target.checked)}
          />
          Require Cloudflare Turnstile on this form
        </label>
        <Input
          label="Turnstile site key (public, safe to embed)"
          value={state.turnstileSiteKey}
          onChange={(v) => update('turnstileSiteKey', v)}
          placeholder="0x4AAAAAAA..."
        />
        <p className="text-xs text-on-surface-variant">
          Set the matching secret key as the <code>TURNSTILE_SECRET_KEY</code> environment variable on the deployment. Without it, all submissions to a turnstile-enabled source will be rejected.
        </p>
      </Section>

      <Section
        title="Honeypot field"
        description="Adds a hidden _hp input — invisible to humans, often filled by bots. Recommended ON."
      >
        <label className="flex items-center gap-2 text-sm text-on-surface">
          <input
            type="checkbox"
            checked={state.honeypotEnabled}
            onChange={(e) => update('honeypotEnabled', e.target.checked)}
          />
          Enable honeypot trap (silent reject on fill)
        </label>
      </Section>

      <Section
        title="Block disposable email providers"
        description="Reject signups from mailinator / tempmail / etc. Reduces spam contacts in your CRM."
      >
        <label className="flex items-center gap-2 text-sm text-on-surface">
          <input
            type="checkbox"
            checked={state.blockDisposableEmails}
            onChange={(e) => update('blockDisposableEmails', e.target.checked)}
          />
          Reject known disposable / burner email domains
        </label>
      </Section>

      <Section
        title="Rate limiting"
        description="Per-IP hourly cap and per-email daily cap. Defaults to 10/hr/IP and 3/day/email."
      >
        <label className="flex items-center gap-2 text-sm text-on-surface mb-3">
          <input
            type="checkbox"
            checked={state.rateLimit.enabled}
            onChange={(e) =>
              update('rateLimit', { ...state.rateLimit, enabled: e.target.checked })
            }
          />
          Enable rate limiting
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-on-surface-variant mb-1">
              Max submissions per hour per IP
            </span>
            <input
              type="number"
              min={1}
              max={1000}
              value={state.rateLimit.maxPerHourPerIp}
              onChange={(e) =>
                update('rateLimit', {
                  ...state.rateLimit,
                  maxPerHourPerIp: Math.max(
                    1,
                    parseInt(e.target.value || '10', 10) || 10,
                  ),
                })
              }
              className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-on-surface-variant mb-1">
              Max submissions per day per email
            </span>
            <input
              type="number"
              min={1}
              max={1000}
              value={state.rateLimit.maxPerDayPerEmail}
              onChange={(e) =>
                update('rateLimit', {
                  ...state.rateLimit,
                  maxPerDayPerEmail: Math.max(
                    1,
                    parseInt(e.target.value || '3', 10) || 3,
                  ),
                })
              }
              className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface text-on-surface text-sm"
            />
          </label>
        </div>
      </Section>
    </div>
  )
}

function StatTile(props: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={`p-3 rounded-lg ${
        props.highlight ? 'bg-primary/10 border border-primary/30' : 'bg-surface-container'
      }`}
    >
      <div className="text-xs text-on-surface-variant">{props.label}</div>
      <div className="text-xl font-semibold text-on-surface mt-1">{props.value}</div>
    </div>
  )
}

function EmbedTab(props: { scriptSnippet: string; iframeSnippet: string }) {
  return (
    <div className="space-y-6">
      <Section title="Script tag" description="Drop into any HTML page. Renders inline next to the script.">
        <CodeBlock value={props.scriptSnippet} />
      </Section>
      <Section title="iframe" description="Embed via iframe for stricter style isolation.">
        <CodeBlock value={props.iframeSnippet} />
      </Section>
    </div>
  )
}

function CodeBlock(props: { value: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(props.value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }
  return (
    <div className="relative">
      <pre className="p-3 rounded-lg bg-surface-container text-xs overflow-x-auto whitespace-pre-wrap break-all">{props.value}</pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 px-2 py-1 rounded bg-primary text-on-primary text-xs"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function tsToDate(t: CaptureSubmission['createdAt']): string {
  const seconds = (t as { _seconds?: number; seconds?: number } | null)?._seconds
    ?? (t as { seconds?: number } | null)?.seconds
  if (!seconds) return '—'
  try {
    return new Date(seconds * 1000).toLocaleString()
  } catch {
    return '—'
  }
}

function SubmissionsTab(props: { submissions: CaptureSubmission[] }) {
  if (props.submissions.length === 0) {
    return <p className="text-sm text-on-surface-variant py-4">No submissions yet.</p>
  }
  const sorted = [...props.submissions].sort((a, b) => {
    const as = (a.createdAt as { _seconds?: number; seconds?: number } | null)?._seconds ?? 0
    const bs = (b.createdAt as { _seconds?: number; seconds?: number } | null)?._seconds ?? 0
    return bs - as
  })
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-on-surface-variant">
          <tr>
            <th className="py-2 pr-4">Email</th>
            <th className="py-2 pr-4">Data</th>
            <th className="py-2 pr-4">Confirmed</th>
            <th className="py-2 pr-4">Contact</th>
            <th className="py-2 pr-4">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={s.id} className="border-t border-outline-variant">
              <td className="py-2 pr-4 font-medium text-on-surface">{s.email}</td>
              <td className="py-2 pr-4 text-on-surface-variant">{Object.entries(s.data || {}).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}</td>
              <td className="py-2 pr-4">{s.confirmedAt ? <span className="text-green-700">Yes</span> : <span className="text-yellow-700">Pending</span>}</td>
              <td className="py-2 pr-4 text-on-surface-variant truncate max-w-[10ch]">{s.contactId}</td>
              <td className="py-2 pr-4 text-on-surface-variant">{tsToDate(s.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
