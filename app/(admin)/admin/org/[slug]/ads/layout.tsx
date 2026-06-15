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
    <div className="px-6 py-6">
      <nav className="mb-6 flex gap-4 text-sm text-white/60">
        <Link href={`/admin/org/${slug}/ads`}>Dashboard</Link>
        <Link href={`/admin/org/${slug}/ads/connections`}>Connections</Link>
        <Link href={`/admin/org/${slug}/ads/creatives`}>Creatives</Link>
        <Link href={`/admin/org/${slug}/ads/audiences`}>Audiences</Link>
        <Link href={`/admin/org/${slug}/ads/saved-audiences`}>Saved</Link>
        <Link href={`/admin/org/${slug}/ads/insights`}>Insights</Link>
        <Link href={`/admin/org/${slug}/ads/pixel-config`}>Pixel &amp; CAPI</Link>
        <Link href={`/admin/org/${slug}/ads/campaigns`}>Campaigns</Link>
        <Link href={`/admin/org/${slug}/ads/budgets`}>Budgets</Link>
        <Link href={`/admin/org/${slug}/ads/experiments`}>Experiments</Link>
      </nav>
      <section className="mb-6 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-50">
        <p className="font-semibold">Admin ads command centre</p>
        <p className="mt-1 text-amber-100/80">
          These routes are for Partners in Biz operators. Client review happens in the portal, and paid-spend, launch, destructive, and provider-sync actions stay behind recorded approval gates.
        </p>
      </section>
      {children}
    </div>
  )
}
