import type { CSSProperties } from 'react'
import { notFound } from 'next/navigation'
import { CampaignCockpitClient } from '@/components/campaign-cockpit/CampaignCockpitClient'
import { adminDb } from '@/lib/firebase/admin'
import { loadCampaignWithAssets } from '@/lib/campaigns/load'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import {
  toPreviewBrand,
  type BrandColorsLike,
} from '@/lib/organizations/toPreviewBrand'

export const dynamic = 'force-dynamic'

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return `#${m[1]}${a}`
}

function monthLabel(value: unknown): string {
  if (!value) return ''
  let date: Date | null = null
  if (value instanceof Date) date = value
  else if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) date = new Date(parsed)
  } else if (typeof value === 'object') {
    const timestamp = value as { seconds?: number; _seconds?: number }
    const seconds = timestamp.seconds ?? timestamp._seconds
    if (typeof seconds === 'number') date = new Date(seconds * 1000)
  }
  return date ? new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' }).format(date) : ''
}

export default async function OrgSocialCampaignPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) notFound()

  const loaded = await loadCampaignWithAssets(id)
  if (!loaded || loaded.campaign.orgId !== orgId) notFound()

  const orgSnap = await adminDb.collection('organizations').doc(orgId).get()
  const org = orgSnap.data() ?? {}
  const settings = (org.settings ?? {}) as Record<string, unknown>
  const brandColors = (settings.brandColors ?? undefined) as BrandColorsLike | undefined
  const orgName = typeof org.name === 'string' ? org.name : ''
  const previewBrand = toPreviewBrand(brandColors, org.brandProfile, orgName)
  const accent = brandColors?.accent ?? brandColors?.primary ?? '#F5A623'
  const styleVars = {
    '--org-bg': brandColors?.background ?? 'var(--color-pib-bg)',
    '--org-surface': brandColors?.surface ?? 'var(--color-pib-surface)',
    '--org-accent': accent,
    '--org-text': brandColors?.text ?? 'var(--color-pib-text)',
    '--org-text-muted': brandColors?.textMuted ?? 'var(--color-pib-text-muted)',
    '--org-border': brandColors?.border ?? 'var(--color-pib-line)',
    backgroundImage: `radial-gradient(1100px 480px at 0% -10%, ${withAlpha(accent, 0.08)} 0%, transparent 60%)`,
  } as CSSProperties

  return (
    <div className="-m-6 p-6 min-h-screen" style={styleVars}>
      <CampaignCockpitClient
        campaignId={id}
        campaign={loaded.campaign}
        assets={loaded.assets}
        brand={previewBrand}
        orgName={orgName}
        monthLabel={monthLabel(loaded.campaign.createdAt)}
        shareToken={loaded.campaign.shareToken}
        shareEnabled={loaded.campaign.shareEnabled !== false}
        backHref={`/admin/org/${slug}/social`}
        backLabel={orgName || 'All campaigns'}
        basePath={`/admin/org/${slug}/social/${id}`}
        blogHref={(blogId) => `/admin/org/${slug}/social/${id}/blog/${blogId}`}
        assetApprovalMode="direct"
      />
    </div>
  )
}
