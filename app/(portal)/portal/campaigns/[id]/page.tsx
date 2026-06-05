import type { CSSProperties } from 'react'
import { redirect, notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { loadCampaignWithAssets } from '@/lib/campaigns/load'
import type { PreviewBrand } from '@/components/campaign-preview'
import { toPreviewBrand, type BrandColorsLike } from '@/lib/organizations/toPreviewBrand'
import { PortalCampaignCockpitClient } from '@/components/campaign-cockpit/PortalCampaignCockpitClient'
import {
  resolvePortalCampaignUser,
  scopedPortalHref,
  scopeFromSearchParams,
  type PortalCampaignSearchParams,
} from '../portalCampaignScope'

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

export default async function PortalCampaignCockpitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<PortalCampaignSearchParams>
}) {
  const resolvedSearchParams = await searchParams
  const scope = scopeFromSearchParams(resolvedSearchParams)
  const user = await resolvePortalCampaignUser(scope.orgId)
  if (!user) redirect('/login')
  if (user.forbidden) notFound()

  const { id } = await params
  const loaded = await loadCampaignWithAssets(id)
  if (!loaded) notFound()

  const { campaign, assets } = loaded
  if (campaign.orgId !== user.orgId) notFound()

  const isEmailCampaign =
    Boolean(campaign.sequenceId) ||
    (!campaign.clientType && !campaign.research && !campaign.brandIdentity)
  if (isEmailCampaign) {
    redirect(scopedPortalHref(`/portal/campaigns/email/${id}`, scope))
  }

  const orgSnap = await adminDb.collection('organizations').doc(user.orgId!).get()
  const org = orgSnap.data() ?? {}
  const settings = (org.settings ?? {}) as Record<string, unknown>
  const brandColors = (settings.brandColors ?? undefined) as BrandColorsLike | undefined
  const orgName = typeof org.name === 'string' ? org.name : ''
  const previewBrand: PreviewBrand | undefined = toPreviewBrand(brandColors, org.brandProfile, orgName)
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
      <PortalCampaignCockpitClient
        campaignId={id}
        campaign={campaign}
        assets={assets}
        brand={previewBrand}
        orgName={orgName}
        monthLabel={monthLabel(campaign.createdAt)}
        shareToken={campaign.shareToken}
        shareEnabled={campaign.shareEnabled !== false}
      />
    </div>
  )
}
