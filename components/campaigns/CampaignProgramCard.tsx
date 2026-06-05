import type { ReactNode } from 'react'
import Link from 'next/link'

type CampaignProgramRecord = {
  id?: string
  name?: string | null
  status?: string | null
  createdAt?: string | null
  heroImageUrl?: string | null
  heroUrl?: string | null
  coverImageUrl?: string | null
  assets?: Record<string, unknown> | null
  assetCounts?: Record<string, unknown> | null
}

type CampaignProgramCardProps = {
  campaign: CampaignProgramRecord
  href: string
  meta?: ReactNode
}

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-gray-700/30 text-gray-300 border border-gray-600/30',
  scheduled: 'bg-blue-700/30 text-blue-200 border border-blue-600/30',
  sending: 'bg-violet-700/30 text-violet-200 border border-violet-600/30',
  active: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  sent: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  in_review: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  approved: 'bg-emerald-700/30 text-emerald-200 border border-emerald-600/30',
  shipping: 'bg-violet-700/30 text-violet-200 border border-violet-600/30',
  paused: 'bg-amber-700/30 text-amber-200 border border-amber-600/30',
  completed: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30',
  failed: 'bg-red-700/30 text-red-200 border border-red-600/30',
  canceled: 'bg-zinc-700/30 text-zinc-300 border border-zinc-600/30',
  archived: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
}

function statusPill(status?: string | null): string {
  return STATUS_PILL[status ?? ''] ?? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
}

function formatMonth(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(d)
}

function count(value: unknown): number {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

export function CampaignProgramCard({ campaign, href, meta }: CampaignProgramCardProps) {
  const status = campaign.status ?? 'draft'
  const isAwaiting = status === 'in_review' || status === 'draft'
  const heroUrl = campaign.heroImageUrl ?? campaign.heroUrl ?? campaign.coverImageUrl ?? undefined
  const assets = campaign.assets ?? campaign.assetCounts ?? {}
  const socialCount = count(assets.social ?? assets.socialPosts)
  const blogCount = count(assets.blogs ?? assets.blogPosts)
  const videoCount = count(assets.videos ?? assets.shorts)
  const hasFooter = socialCount + blogCount + videoCount > 0

  return (
    <Link href={href} className="bento-card !p-0 group block overflow-hidden">
      <div className="relative aspect-[16/9] w-full overflow-hidden">
        {heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroUrl}
            alt=""
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background:
                'linear-gradient(135deg, var(--brand-accent, var(--color-pib-accent)) 0%, var(--brand-primary, var(--color-pib-accent-hover)) 50%, var(--brand-secondary, #0A0A0B) 100%)',
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0" />

        {isAwaiting && (
          <span className="absolute top-3 left-3 text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full bg-amber-500/90 text-amber-950 font-semibold backdrop-blur">
            Awaiting review
          </span>
        )}
        <span
          className={`absolute top-3 right-3 text-[10px] px-2 py-1 rounded uppercase tracking-wide backdrop-blur-sm ${statusPill(status)}`}
        >
          {status}
        </span>
      </div>

      <div className="p-5">
        <h3 className="font-headline text-base font-semibold leading-tight line-clamp-2">
          {campaign.name ?? 'Untitled campaign'}
        </h3>
        <p className="text-xs text-[var(--color-pib-text-muted)] mt-1.5">{formatMonth(campaign.createdAt)}</p>
        {meta && <div className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{meta}</div>}
        {hasFooter && (
          <p className="text-xs text-[var(--color-pib-text-muted)] mt-3 pt-3 border-t border-[var(--color-pib-line)]">
            {socialCount} social · {blogCount} blogs · {videoCount} videos
          </p>
        )}
      </div>
    </Link>
  )
}
