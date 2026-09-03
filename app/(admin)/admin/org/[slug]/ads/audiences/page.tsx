import Link from 'next/link'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listCustomAudiences } from '@/lib/ads/custom-audiences/store'
import { AudiencesPlatformTabs } from './AudiencesPlatformTabs'

interface Params { slug: string }

const STATUS_TINT: Record<string, string> = {
  BUILDING: 'pib-pill-info',
  READY: 'pib-pill-success',
  EMPTY: 'pib-pill',
  TOO_SMALL: 'pib-pill-warn',
  ERROR: 'pib-pill-danger',
}

export default async function AudiencesPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <p className="pib-page-sub">Org not found.</p>
  const cas = await listCustomAudiences({ orgId })

  const metaContent = (
    <>
      <header className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          {cas.length} {cas.length === 1 ? 'audience' : 'audiences'}. Used in ad-set targeting.
        </p>
        <Link href={`/admin/org/${slug}/ads/audiences/new`} className="btn-pib-primary text-sm">
          New Meta audience
        </Link>
      </header>

      {cas.length === 0 ? (
        <div className="pib-empty-state">
          
          <p className="pib-empty-state-description">No custom audiences yet.</p>
          <Link href={`/admin/org/${slug}/ads/audiences/new`} className="mt-3 inline-block text-sm text-[var(--color-pib-rose)] hover:underline">
            Create an admin audience draft →
          </Link>
        </div>
      ) : (
        <div className="pib-surface pib-surface-list">
          <ul className="divide-y divide-[var(--color-pib-line)]">
            {cas.map((ca) => (
              <li key={ca.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <Link href={`/admin/org/${slug}/ads/audiences/${ca.id}`} className="font-medium text-[var(--color-pib-text)] hover:text-[var(--color-pib-rose)]">
                    {ca.name}
                  </Link>
                  <div className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
                    {ca.type.toLowerCase().replace('_', ' ')}
                    {ca.approximateSize != null && ` · ~${ca.approximateSize.toLocaleString()} users`}
                  </div>
                </div>
                <span className={`pib-pill ${STATUS_TINT[ca.status] ?? STATUS_TINT.BUILDING}`}>
                  {ca.status.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )

  return (
    <section className="space-y-8">
      <header>
        <p className="eyebrow">Ads · Audiences</p>
        <h1 className="pib-page-title mt-2">Custom audiences</h1>
      </header>
      <AudiencesPlatformTabs orgId={orgId} orgSlug={slug} metaContent={metaContent} />
    </section>
  )
}
