// app/(admin)/admin/org/[slug]/ads/layout.tsx
import type { ReactNode } from 'react'
import Link from 'next/link'

export default async function AdsAdminLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return (
    <div className="px-6 py-6 space-y-6">
      <nav className="pib-tabs" aria-label="Ads admin sections">
        <Link href={`/admin/org/${slug}/ads`} className="pib-tab">Dashboard</Link>
        <Link href={`/admin/org/${slug}/ads/connections`} className="pib-tab">Connections</Link>
        <Link href={`/admin/org/${slug}/ads/creatives`} className="pib-tab">Creatives</Link>
        <Link href={`/admin/org/${slug}/ads/audiences`} className="pib-tab">Audiences</Link>
        <Link href={`/admin/org/${slug}/ads/saved-audiences`} className="pib-tab">Saved</Link>
        <Link href={`/admin/org/${slug}/ads/insights`} className="pib-tab">Insights</Link>
        <Link href={`/admin/org/${slug}/ads/pixel-config`} className="pib-tab">Pixel &amp; CAPI</Link>
        <Link href={`/admin/org/${slug}/ads/campaigns`} className="pib-tab">Campaigns</Link>
        <Link href={`/admin/org/${slug}/ads/budgets`} className="pib-tab">Budgets</Link>
        <Link href={`/admin/org/${slug}/ads/experiments`} className="pib-tab">Experiments</Link>
      </nav>
      <section className="pib-card">
        <p className="pib-label mb-1">Admin ads command centre</p>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          These routes are for Partners in Biz operators. Client review happens in the portal, and paid-spend, launch, destructive, and provider-sync actions stay behind recorded approval gates.
        </p>
      </section>
      {children}
    </div>
  )
}
