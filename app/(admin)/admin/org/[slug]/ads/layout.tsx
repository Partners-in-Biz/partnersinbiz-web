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
      </nav>
      {children}
    </div>
  )
}
