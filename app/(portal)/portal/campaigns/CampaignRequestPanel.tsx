'use client'

import { useMemo, useState } from 'react'

type CampaignType = 'social' | 'email' | 'ads' | 'seo-content' | 'mixed'

const TYPE_OPTIONS: Array<{ key: CampaignType; label: string; icon: string; hint: string }> = [
  { key: 'social', label: 'Social', icon: 'forum', hint: 'Posts, reels, launches, community pushes' },
  { key: 'email', label: 'Email', icon: 'forward_to_inbox', hint: 'Newsletters, launches, nurture sequences' },
  { key: 'ads', label: 'Ads', icon: 'ads_click', hint: 'Meta, Google, LinkedIn, TikTok campaigns' },
  { key: 'seo-content', label: 'SEO', icon: 'article', hint: 'Blogs, landing pages, ranking content' },
  { key: 'mixed', label: 'Mixed', icon: 'hub', hint: 'Multi-channel campaign brief' },
]

const CHANNELS = ['Facebook', 'Instagram', 'LinkedIn', 'TikTok', 'YouTube', 'Email', 'Google Ads', 'Meta Ads', 'Blog', 'Website']

function typeQuestions(type: CampaignType) {
  if (type === 'social') {
    return [
      ['contentAngles', 'Content angles', 'Launch story, founder POV, proof points, objections, offer angle'],
      ['postFormats', 'Preferred formats', 'Static posts, carousels, reels, stories, short videos'],
      ['postingCadence', 'Posting cadence', 'Daily for 2 weeks, 3x per week, launch week only'],
    ]
  }
  if (type === 'email') {
    return [
      ['listSource', 'Audience/list source', 'CRM segment, imported list, past buyers, newsletter subscribers'],
      ['emailStructure', 'Email structure', 'One-off broadcast, 3-email launch sequence, nurture flow'],
      ['senderContext', 'Sender and reply handling', 'Who should it come from, and who handles replies?'],
    ]
  }
  if (type === 'ads') {
    return [
      ['platformPlan', 'Ad platforms', 'Meta, Google Search, Display, Shopping, LinkedIn, TikTok'],
      ['budgetSplit', 'Budget and timing', 'Daily/lifetime budget, dates, priority markets'],
      ['conversionEvent', 'Conversion event', 'Lead form, WhatsApp click, checkout, booking, call'],
    ]
  }
  if (type === 'seo-content') {
    return [
      ['keywordThemes', 'Keyword themes', 'Services, locations, comparisons, problems, alternatives'],
      ['targetPages', 'Pages to support', 'Homepage, service pages, blog hub, product pages'],
      ['authorityInputs', 'Proof and authority', 'Case studies, credentials, testimonials, data points'],
    ]
  }
  return [
    ['primaryChannel', 'Primary channel', 'Where should this campaign win first?'],
    ['campaignJourney', 'Customer journey', 'Awareness, lead capture, nurture, conversion, retention'],
    ['handoffNeeds', 'Assets and handoffs', 'Creative, copy, tracking, landing page, sales follow-up'],
  ]
}

export function CampaignRequestPanel({ orgId }: { orgId?: string }) {
  const [open, setOpen] = useState(false)
  const [campaignType, setCampaignType] = useState<CampaignType>('social')
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['Instagram'])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, string>>({})

  const questions = useMemo(() => typeQuestions(campaignType), [campaignType])

  function toggleChannel(channel: string) {
    setSelectedChannels((current) =>
      current.includes(channel) ? current.filter((item) => item !== channel) : [...current, channel],
    )
  }

  async function submit(formData: FormData) {
    setSubmitting(true)
    setMessage(null)
    setError(null)
    try {
      const payload = {
        campaignType,
        title: String(formData.get('title') ?? ''),
        goal: String(formData.get('goal') ?? ''),
        audience: String(formData.get('audience') ?? ''),
        offer: String(formData.get('offer') ?? ''),
        launchWindow: String(formData.get('launchWindow') ?? ''),
        budget: String(formData.get('budget') ?? ''),
        assetsAvailable: String(formData.get('assetsAvailable') ?? ''),
        approvalContact: String(formData.get('approvalContact') ?? ''),
        successMetric: String(formData.get('successMetric') ?? ''),
        notes: String(formData.get('notes') ?? ''),
        channels: selectedChannels,
        details,
      }
      const requestUrl = orgId
        ? `/api/v1/portal/campaign-requests?orgId=${encodeURIComponent(orgId)}`
        : '/api/v1/portal/campaign-requests'
      const res = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not submit request')
        return
      }
      setMessage('Campaign request sent. Your team can now turn this brief into the right campaign.')
      setDetails({})
      setOpen(false)
    } catch {
      setError('Could not submit request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="pib-card !p-0 overflow-hidden">
      <div className="p-5 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Request a campaign</p>
          <h2 className="font-headline text-xl md:text-2xl font-semibold mt-2">Tell us what you want to launch next</h2>
          <p className="text-sm text-[var(--color-pib-text-muted)] mt-1 max-w-2xl">
            Pick the campaign type and fill in the brief. The follow-up questions change based on what you need.
          </p>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} className="pib-btn-primary whitespace-nowrap">
          <span className="material-symbols-outlined text-[18px]">{open ? 'close' : 'add_task'}</span>
          {open ? 'Close brief' : 'New request'}
        </button>
      </div>

      {(message || error) && (
        <div className="px-5 md:px-6 pb-5">
          <p className={error ? 'text-sm text-red-300' : 'text-sm text-emerald-300'}>{error ?? message}</p>
        </div>
      )}

      {open && (
        <form action={submit} className="border-t border-[var(--color-pib-line)] p-5 md:p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {TYPE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setCampaignType(option.key)}
                className={[
                  'text-left rounded-lg border p-4 transition-colors',
                  campaignType === option.key
                    ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)]'
                    : 'border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] hover:bg-[var(--color-pib-surface-2)]',
                ].join(' ')}
              >
                <span className="material-symbols-outlined text-[20px] text-[var(--color-pib-accent)]">{option.icon}</span>
                <span className="block font-semibold text-sm mt-2">{option.label}</span>
                <span className="block text-xs text-[var(--color-pib-text-muted)] mt-1 leading-relaxed">{option.hint}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field name="title" label="Campaign name" placeholder="Winter lead-gen push" required />
            <Field name="launchWindow" label="Launch window" placeholder="First week of June, flexible" />
            <Textarea name="goal" label="Goal" placeholder="What should this campaign achieve?" required />
            <Textarea name="audience" label="Audience" placeholder="Who exactly are we trying to reach?" required />
            <Textarea name="offer" label="Offer or message" placeholder="Discount, appointment, demo, announcement, content theme" />
            <Field name="budget" label="Budget" placeholder="R5,000 ads, no paid spend, open to guidance" />
            <Field name="successMetric" label="Success metric" placeholder="Bookings, leads, sales, replies, traffic" />
            <Field name="approvalContact" label="Approval contact" placeholder="Name or email for final sign-off" />
          </div>

          <div>
            <p className="eyebrow !text-[10px] mb-3">Channels</p>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((channel) => (
                <button
                  key={channel}
                  type="button"
                  onClick={() => toggleChannel(channel)}
                  className={[
                    'rounded-full px-3 py-1.5 text-xs border transition-colors',
                    selectedChannels.includes(channel)
                      ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent-soft)] text-[var(--color-pib-accent)]'
                      : 'border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]',
                  ].join(' ')}
                >
                  {channel}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {questions.map(([key, label, placeholder]) => (
              <Textarea
                key={key}
                name={key}
                label={label}
                placeholder={placeholder}
                value={details[key] ?? ''}
                onChange={(value) => setDetails((current) => ({ ...current, [key]: value }))}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Textarea name="assetsAvailable" label="Assets available" placeholder="Photos, logo, product shots, testimonials, old posts, landing page" />
            <Textarea name="notes" label="Extra context" placeholder="Anything we must know before building the campaign" />
          </div>

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="pib-btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="pib-btn-primary disabled:opacity-50">
              <span className="material-symbols-outlined text-[18px]">send</span>
              {submitting ? 'Sending...' : 'Send request'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

function Field({
  name,
  label,
  placeholder,
  required,
}: {
  name: string
  label: string
  placeholder: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="eyebrow !text-[10px]">{label}</span>
      <input name={name} required={required} placeholder={placeholder} className="pib-input mt-2 w-full" />
    </label>
  )
}

function Textarea({
  name,
  label,
  placeholder,
  required,
  value,
  onChange,
}: {
  name: string
  label: string
  placeholder: string
  required?: boolean
  value?: string
  onChange?: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="eyebrow !text-[10px]">{label}</span>
      <textarea
        name={name}
        required={required}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        placeholder={placeholder}
        rows={4}
        className="pib-input mt-2 w-full resize-y"
      />
    </label>
  )
}
