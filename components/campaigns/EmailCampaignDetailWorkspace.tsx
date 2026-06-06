import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { EMPTY_STATS, type Campaign, type CampaignStats, type CampaignStatus } from '@/lib/campaigns/types'
import type { Sequence, SequenceStep } from '@/lib/sequences/types'
import type { Variant } from '@/lib/ab-testing/types'
import type { EmailDomain } from '@/lib/email/domains'

const SHARED_DOMAIN = 'partnersinbiz.online'

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
}

const STATUS_TONES: Record<CampaignStatus, { bg: string; border: string; dot: string; text: string }> = {
  draft: { bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.30)', dot: '#94A3B8', text: '#CBD5E1' },
  scheduled: { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.35)', dot: '#3B82F6', text: '#93C5FD' },
  active: { bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.35)', dot: '#4ADE80', text: '#86EFAC' },
  paused: { bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.35)', dot: '#FBBF24', text: '#FCD34D' },
  completed: { bg: 'rgba(161,161,170,0.10)', border: 'rgba(161,161,170,0.30)', dot: '#A1A1AA', text: '#D4D4D8' },
}

const AB_STATUS_LABEL: Record<string, string> = {
  inactive: 'Inactive',
  testing: 'Testing in progress',
  'winner-pending': 'Winner pending',
  'winner-sent': 'Winner sent',
  complete: 'Complete',
}

export interface EmailCampaignDetailBrand {
  brandName?: string
  primaryColor?: string
  accentColor?: string
  textColor?: string
  mutedTextColor?: string
}

export interface EmailCampaignDetailSegment {
  id: string
  name: string
}

export interface EmailCampaignDetailWorkspaceProps {
  campaign: Campaign
  sequence?: Sequence | null
  segment?: EmailCampaignDetailSegment | null
  domain?: EmailDomain | null
  brand?: EmailCampaignDetailBrand | null
  backHref: string
  backLabel?: string
  actions?: ReactNode
  setupPanel?: ReactNode
  reportHref?: string | null
}

function pct(num: number, denom: number): string {
  if (!denom) return '-'
  return `${((num / denom) * 100).toFixed(1)}%`
}

function snippet(step: SequenceStep, length = 140): string {
  const source = step.channel === 'sms' ? (step.smsBody ?? '') : (step.bodyText || step.bodyHtml || '')
  const cleaned = source.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length > length ? `${cleaned.slice(0, length).trim()}...` : cleaned
}

function campaignStats(campaign: Campaign): CampaignStats {
  return campaign.stats ?? EMPTY_STATS
}

export function EmailCampaignDetailWorkspace({
  campaign,
  sequence,
  segment,
  domain,
  brand,
  backHref,
  backLabel = 'Campaigns',
  actions,
  setupPanel,
  reportHref,
}: EmailCampaignDetailWorkspaceProps) {
  const stats = campaignStats(campaign)
  const status: CampaignStatus = campaign.status ?? 'draft'
  const tone = STATUS_TONES[status] ?? STATUS_TONES.draft
  const fromDomainName = domain?.name || SHARED_DOMAIN
  const fromLocal = campaign.fromLocal || 'campaigns'
  const fromName = campaign.fromName || brand?.brandName || ''
  const fromAddress = `${fromLocal}@${fromDomainName}`
  const triggerSourceCount = campaign.triggers?.captureSourceIds?.length ?? 0
  const triggerTagCount = campaign.triggers?.tags?.length ?? 0
  const stepsWithAb = (sequence?.steps ?? []).filter((s) => s.ab?.enabled)

  const themeStyle = {
    '--org-accent': brand?.accentColor || 'var(--color-pib-accent)',
    '--org-primary': brand?.primaryColor || brand?.accentColor || 'var(--color-pib-accent)',
    '--org-text': brand?.textColor || 'var(--color-pib-text)',
    '--org-muted': brand?.mutedTextColor || 'var(--color-pib-text-muted)',
  } as CSSProperties & Record<string, string>

  return (
    <div className="space-y-10 pb-16" style={themeStyle}>
      <header className="space-y-5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_back</span>
          {backLabel}
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6 items-start">
          <div className="space-y-3">
            <p
              className="text-[10px] font-label uppercase tracking-[0.18em]"
              style={{ color: 'var(--org-muted, var(--color-pib-text-muted))' }}
            >
              Email Campaign
              <span className="mx-2 opacity-40">-</span>
              <span style={{ color: tone.text }}>{STATUS_LABEL[status] ?? status}</span>
            </p>
            <h1 className="font-headline text-3xl md:text-5xl tracking-tight leading-[1.05]">
              {campaign.name || 'Untitled campaign'}
            </h1>
            {campaign.description && (
              <p className="text-base md:text-lg text-[var(--color-pib-text-muted)] max-w-2xl text-pretty">
                {campaign.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-label uppercase tracking-wide"
                style={{
                  background: tone.bg,
                  border: `1px solid ${tone.border}`,
                  color: tone.text,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.dot }} />
                {STATUS_LABEL[status] ?? status}
              </span>
              {sequence && (
                <span className="pill">
                  <span className="material-symbols-outlined text-[14px]">route</span>
                  {sequence.steps?.length ?? 0}-step sequence
                </span>
              )}
              {(campaign.contactIds?.length ?? 0) > 0 && !campaign.segmentId && (
                <span className="pill">
                  <span className="material-symbols-outlined text-[14px]">group</span>
                  {campaign.contactIds.length} contacts
                </span>
              )}
              {campaign.segmentId && segment && (
                <span className="pill">
                  <span className="material-symbols-outlined text-[14px]">filter_alt</span>
                  Segment: {segment.name}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 min-w-[260px] max-w-sm">
            {actions}
            <div
              className="pib-card !p-4"
              style={{ borderColor: 'var(--color-pib-line)' }}
            >
              <p className="eyebrow !text-[10px] mb-2">Sender</p>
              <p className="font-headline text-base leading-tight truncate">
                {fromName || fromLocal}
              </p>
              <p className="font-mono text-xs text-[var(--color-pib-text-muted)] mt-1 truncate">
                {fromAddress}
              </p>
              {campaign.replyTo && (
                <p className="text-[11px] text-[var(--color-pib-text-muted)] mt-2">
                  Replies to <span className="font-mono">{campaign.replyTo}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      <section
        aria-label="Performance"
        className="grid grid-cols-2 md:grid-cols-5 gap-3"
      >
        <KpiTile label="Enrolled" big={stats.enrolled.toLocaleString()} />
        <KpiTile label="Sent" big={stats.sent.toLocaleString()} />
        <KpiTile
          label="Open rate"
          big={pct(stats.opened, stats.sent)}
          hint={`${stats.opened.toLocaleString()} opens`}
          accent
        />
        <KpiTile
          label="Click rate"
          big={pct(stats.clicked, stats.sent)}
          hint={`${stats.clicked.toLocaleString()} clicks`}
        />
        <KpiTile
          label="Bounce rate"
          big={pct(stats.bounced, stats.sent)}
          hint={`${stats.bounced.toLocaleString()} bounced`}
        />
      </section>

      {setupPanel}

      <Section
        title="The journey"
        eyebrow="Sequence"
        description={
          sequence
            ? `${sequence.steps?.length ?? 0} touch${(sequence.steps?.length ?? 0) === 1 ? '' : 'es'} sent on a cadence designed to nurture without overwhelming.`
            : 'No sequence is linked to this campaign yet.'
        }
      >
        {sequence && sequence.steps?.length ? (
          <div className="pib-card-section">
            <ol>
              {sequence.steps.map((step, idx) => (
                <StepRow key={`${step.stepNumber}-${idx}`} step={step} index={idx} />
              ))}
            </ol>
          </div>
        ) : (
          <EmptyCard
            icon="route"
            label="No sequence configured"
            hint="Plan the cadence before launching this campaign."
          />
        )}
      </Section>

      <Section title="Audience" eyebrow="Who receives this">
        <div className="pib-card space-y-4">
          {campaign.segmentId ? (
            <>
              <div className="flex items-start gap-3">
                <span
                  className="material-symbols-outlined text-2xl mt-0.5"
                  style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}
                >
                  filter_alt
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-headline text-lg">{segment?.name ?? 'Segment'}</p>
                  <p className="text-sm text-[var(--color-pib-text-muted)] mt-0.5">
                    Segment-driven audience. Refreshed automatically as the segment changes.
                  </p>
                </div>
              </div>
              <div className="hairline" />
              <p className="text-xs text-[var(--color-pib-text-muted)]">
                Contacts that match the segment&apos;s rules are enrolled when they qualify and
                exit cleanly the moment they no longer fit.
              </p>
            </>
          ) : (campaign.contactIds?.length ?? 0) > 0 ? (
            <div className="flex items-start gap-3">
              <span
                className="material-symbols-outlined text-2xl mt-0.5"
                style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}
              >
                group
              </span>
              <div>
                <p className="font-headline text-lg">
                  {campaign.contactIds.length.toLocaleString()} contact
                  {campaign.contactIds.length === 1 ? '' : 's'}
                </p>
                <p className="text-sm text-[var(--color-pib-text-muted)] mt-0.5">
                  Manual list - handpicked recipients for this campaign.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              No audience configured yet.
            </p>
          )}

          {(triggerSourceCount > 0 || triggerTagCount > 0) && (
            <>
              <div className="hairline" />
              <div className="space-y-2">
                <p className="eyebrow !text-[10px]">Auto-enrollment triggers</p>
                <div className="flex flex-wrap gap-1.5">
                  {triggerSourceCount > 0 && (
                    <span className="pill">
                      <span className="material-symbols-outlined text-[14px]">capture</span>
                      {triggerSourceCount} capture source
                      {triggerSourceCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {(campaign.triggers?.tags ?? []).map((t) => (
                    <span key={t} className="pill">
                      <span className="material-symbols-outlined text-[14px]">sell</span>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </Section>

      <Section
        title="Sender & deliverability"
        eyebrow="Trust signals"
        description="Authenticated sending so messages land in the inbox, not spam."
      >
        <div className="pib-card space-y-5">
          <div>
            <p className="eyebrow !text-[10px] mb-2">From</p>
            <p className="font-mono text-base md:text-lg break-all">
              {fromName ? <span className="text-[var(--color-pib-text)]">{fromName} </span> : null}
              <span className="text-[var(--color-pib-text-muted)]">&lt;{fromAddress}&gt;</span>
            </p>
            {campaign.replyTo && (
              <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">
                Reply-to <span className="font-mono">{campaign.replyTo}</span>
              </p>
            )}
          </div>

          <div className="hairline" />

          <div className="flex flex-wrap gap-2 items-center">
            {!campaign.fromDomainId ? (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
                style={{
                  background: 'rgba(124,92,255,0.10)',
                  border: '1px solid rgba(124,92,255,0.35)',
                  color: '#C4B5FD',
                }}
              >
                <span className="material-symbols-outlined text-[14px]">cloud</span>
                Sending via shared {SHARED_DOMAIN}
              </span>
            ) : domain?.status === 'verified' ? (
              <>
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
                  style={{
                    background: 'rgba(74,222,128,0.10)',
                    border: '1px solid rgba(74,222,128,0.35)',
                    color: '#86EFAC',
                  }}
                >
                  <span className="material-symbols-outlined text-[14px]">verified</span>
                  Verified - {domain.name}
                </span>
                <span className="text-xs text-[#86EFAC]/90 font-mono">
                  SPF - DKIM - DMARC verified
                </span>
              </>
            ) : (
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
                style={{
                  background: 'rgba(251,191,36,0.10)',
                  border: '1px solid rgba(251,191,36,0.35)',
                  color: '#FCD34D',
                }}
              >
                <span className="material-symbols-outlined text-[14px]">pending</span>
                Domain pending verification
              </span>
            )}
          </div>

          <p className="text-xs text-[var(--color-pib-text-muted)]">
            Every message is authenticated, includes a one-click unsubscribe header, and is
            sent from a warm IP pool managed by the platform.
          </p>
        </div>
      </Section>

      {stepsWithAb.length > 0 && sequence && (
        <Section
          title="A/B testing"
          eyebrow="Optimisation"
          description="Live experiments on subject lines, copy, and send-time so the best-performing variant wins automatically."
        >
          <div className="space-y-4">
            {stepsWithAb.map((step) => {
              const ab = step.ab!
              const stepIndex = sequence.steps.findIndex((s) => s === step)
              return (
                <AbCard
                  key={stepIndex}
                  stepNumber={stepIndex + 1}
                  subject={step.subject}
                  variants={ab.variants}
                  winnerVariantId={ab.winnerVariantId}
                  status={ab.status}
                  metric={ab.winnerMetric}
                  testDurationMinutes={ab.testDurationMinutes}
                />
              )
            })}
          </div>
        </Section>
      )}

      <Section title="Engagement timeline" eyebrow="Reports">
        <div className="pib-card flex flex-col md:flex-row items-start md:items-center gap-4 justify-between">
          <div className="space-y-1.5">
            <p className="font-headline text-lg">Detailed analytics available</p>
            <p className="text-sm text-[var(--color-pib-text-muted)] max-w-lg">
              Open- and click-rate timeseries, geographic breakdown, device split, and link-level
              heatmaps for every send in this campaign.
            </p>
          </div>
          {reportHref && (
            <Link
              href={reportHref}
              className="btn-pib-secondary whitespace-nowrap"
              style={{
                borderColor: 'var(--org-accent, var(--color-pib-accent))',
                color: 'var(--org-accent, var(--color-pib-accent))',
              }}
            >
              View full report
              <span className="material-symbols-outlined text-base">arrow_forward</span>
            </Link>
          )}
        </div>
      </Section>

      {status === 'active' && (
        <Section title="What's next" eyebrow="Live">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <NextCard
              icon="autorenew"
              label="Next contact enrollment"
              value="Automatic"
              hint="Triggered the moment a contact qualifies for this campaign."
            />
            <NextCard
              icon="schedule_send"
              label="Next send window"
              value="Within 24 hours"
              hint="Scheduled per recipient using the configured cadence and time-zone rules."
            />
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({
  title,
  eyebrow,
  description,
  children,
}: {
  title: string
  eyebrow?: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1.5">
        {eyebrow && <p className="eyebrow !text-[10px]">{eyebrow}</p>}
        <h2 className="font-headline text-2xl tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-[var(--color-pib-text-muted)] max-w-2xl">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  )
}

function KpiTile({
  label,
  big,
  hint,
  accent,
}: {
  label: string
  big: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div className="pib-stat-card">
      <p className="eyebrow !text-[10px]">{label}</p>
      <p
        className="font-display text-3xl md:text-4xl tabular-nums mt-2 leading-none"
        style={accent ? { color: 'var(--org-accent, var(--color-pib-accent))' } : undefined}
      >
        {big}
      </p>
      {hint && (
        <p className="text-xs text-[var(--color-pib-text-muted)] mt-2 tabular-nums">
          {hint}
        </p>
      )}
    </div>
  )
}

function StepRow({ step, index }: { step: SequenceStep; index: number }) {
  const isSms = step.channel === 'sms'
  const subject = isSms
    ? step.smsBody?.split('\n')[0]?.slice(0, 80) || 'SMS message'
    : step.subject || '(no subject)'
  const body = snippet(step)
  const delayLabel = step.delayDays === 0 ? 'Send immediately' : `+${step.delayDays} day${step.delayDays === 1 ? '' : 's'}`
  return (
    <li className="grid grid-cols-[auto_1fr_auto] gap-4 items-start px-5 py-5 border-b border-[var(--color-pib-line)] last:border-b-0">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center font-headline text-sm"
        style={{
          background: 'var(--color-pib-surface-2)',
          border: '1px solid var(--color-pib-line)',
          color: 'var(--org-accent, var(--color-pib-accent))',
        }}
      >
        {index + 1}
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-headline text-base text-[var(--color-pib-text)] truncate">
            {subject}
          </p>
          <span
            className="inline-flex items-center gap-1 text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{
              background: isSms
                ? 'rgba(56,189,248,0.10)'
                : 'rgba(245,166,35,0.10)',
              border: isSms
                ? '1px solid rgba(56,189,248,0.35)'
                : '1px solid rgba(245,166,35,0.35)',
              color: isSms ? '#7DD3FC' : '#FCD34D',
            }}
          >
            <span className="material-symbols-outlined text-[12px]">
              {isSms ? 'sms' : 'mail'}
            </span>
            {isSms ? 'SMS' : 'Email'}
          </span>
          {step.ab?.enabled && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full"
              style={{
                background: 'rgba(168,85,247,0.10)',
                border: '1px solid rgba(168,85,247,0.35)',
                color: '#D8B4FE',
              }}
            >
              <span className="material-symbols-outlined text-[12px]">science</span>
              A/B {step.ab.variants?.length ?? 0} variants
            </span>
          )}
        </div>
        {body && (
          <p className="text-sm text-[var(--color-pib-text-muted)] line-clamp-2">
            {body}
          </p>
        )}
      </div>
      <span className="text-xs font-mono text-[var(--color-pib-text-muted)] whitespace-nowrap pt-2">
        {delayLabel}
      </span>
    </li>
  )
}

function AbCard({
  stepNumber,
  subject,
  variants,
  winnerVariantId,
  status,
  metric,
  testDurationMinutes,
}: {
  stepNumber: number
  subject: string
  variants: Variant[]
  winnerVariantId: string
  status: string
  metric: string
  testDurationMinutes: number
}) {
  const totalSent = variants.reduce((acc, v) => acc + (v.sent ?? 0), 0)
  return (
    <div className="pib-card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow !text-[10px]">Step {stepNumber}</p>
          <p className="font-headline text-lg mt-1">{subject || '(no subject)'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
            style={{
              background: 'rgba(168,85,247,0.10)',
              border: '1px solid rgba(168,85,247,0.35)',
              color: '#D8B4FE',
            }}
          >
            <span className="material-symbols-outlined text-[14px]">science</span>
            {AB_STATUS_LABEL[status] ?? status}
          </span>
          <span className="pill">
            <span className="material-symbols-outlined text-[14px]">flag</span>
            Winner by {metric.replace('-', ' ')}
          </span>
          {testDurationMinutes > 0 && (
            <span className="pill">
              <span className="material-symbols-outlined text-[14px]">timer</span>
              {testDurationMinutes >= 60
                ? `${Math.round(testDurationMinutes / 60)}h test window`
                : `${testDurationMinutes}m test window`}
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="text-left">
              <th className="eyebrow !text-[10px] py-2 px-2">Variant</th>
              <th className="eyebrow !text-[10px] py-2 px-2 text-right">Sent</th>
              <th className="eyebrow !text-[10px] py-2 px-2 text-right">Opens</th>
              <th className="eyebrow !text-[10px] py-2 px-2 text-right">Open rate</th>
              <th className="eyebrow !text-[10px] py-2 px-2 text-right">Clicks</th>
              <th className="eyebrow !text-[10px] py-2 px-2 text-right">Click rate</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => {
              const isWinner = winnerVariantId && v.id === winnerVariantId
              return (
                <tr
                  key={v.id}
                  className="border-t border-[var(--color-pib-line)]"
                  style={
                    isWinner
                      ? { background: 'rgba(74,222,128,0.06)' }
                      : undefined
                  }
                >
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      {isWinner && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-label uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                          style={{
                            background: 'rgba(74,222,128,0.15)',
                            border: '1px solid rgba(74,222,128,0.4)',
                            color: '#86EFAC',
                          }}
                        >
                          <span className="material-symbols-outlined text-[12px]">star</span>
                          Winner
                        </span>
                      )}
                      <span className="font-medium">{v.label}</span>
                    </div>
                  </td>
                  <td className="py-3 px-2 text-right tabular-nums">{(v.sent ?? 0).toLocaleString()}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{(v.opened ?? 0).toLocaleString()}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{pct(v.opened ?? 0, v.sent ?? 0)}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{(v.clicked ?? 0).toLocaleString()}</td>
                  <td className="py-3 px-2 text-right tabular-nums">{pct(v.clicked ?? 0, v.sent ?? 0)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalSent === 0 && (
        <p className="text-xs text-[var(--color-pib-text-muted)]">
          Variants will start collecting data on the first send.
        </p>
      )}
    </div>
  )
}

function NextCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: string
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="pib-card flex items-start gap-3">
      <span
        className="material-symbols-outlined text-2xl mt-0.5"
        style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}
      >
        {icon}
      </span>
      <div className="space-y-1">
        <p className="eyebrow !text-[10px]">{label}</p>
        <p className="font-headline text-lg">{value}</p>
        {hint && <p className="text-xs text-[var(--color-pib-text-muted)]">{hint}</p>}
      </div>
    </div>
  )
}

function EmptyCard({
  icon,
  label,
  hint,
}: {
  icon: string
  label: string
  hint?: string
}) {
  return (
    <div className="pib-card text-center py-10">
      <span
        className="material-symbols-outlined text-3xl"
        style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}
      >
        {icon}
      </span>
      <p className="font-headline text-lg mt-3">{label}</p>
      {hint && <p className="text-xs text-[var(--color-pib-text-muted)] mt-2">{hint}</p>}
    </div>
  )
}
