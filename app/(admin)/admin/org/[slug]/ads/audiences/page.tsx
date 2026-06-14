import Link from 'next/link'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { listCustomAudiences } from '@/lib/ads/custom-audiences/store'
import { AudiencesPlatformTabs } from './AudiencesPlatformTabs'

interface Params { slug: string }

const STATUS_TINT: Record<string, string> = {
  BUILDING: 'bg-sky-500/10 text-sky-300',
  READY: 'bg-emerald-500/10 text-emerald-300',
  EMPTY: 'bg-white/5 text-white/40',
  TOO_SMALL: 'bg-[#F5A623]/10 text-[#F5A623]',
  ERROR: 'bg-red-500/10 text-red-300',
}

export default async function AudiencesPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <div className="text-white/60">Org not found.</div>
  const cas = await listCustomAudiences({ orgId })

  const metaContent = (
    <>
      <header className="flex items-center justify-between">
        <p className="text-sm text-white/60">
          {cas.length} {cas.length === 1 ? 'audience' : 'audiences'}. Used in ad-set targeting.
        </p>
        <Link href={`/admin/org/${slug}/ads/audiences/new`} className="btn-pib-accent text-sm">
          New Meta audience
        </Link>
      </header>

      {cas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-8 text-center">
          <p className="text-white/60">No custom audiences yet.</p>
          <Link href={`/admin/org/${slug}/ads/audiences/new`} className="mt-3 inline-block text-sm text-[#F5A623] underline">
            Create an admin audience draft →
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {cas.map((ca) => (
            <li key={ca.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <Link href={`/admin/org/${slug}/ads/audiences/${ca.id}`} className="font-medium hover:text-[#F5A623]">
                  {ca.name}
                </Link>
                <div className="mt-0.5 text-xs text-white/40">
                  {ca.type.toLowerCase().replace('_', ' ')}
                  {ca.approximateSize != null && ` · ~${ca.approximateSize.toLocaleString()} users`}
                </div>
              </div>
              <span className={`rounded px-2 py-0.5 text-xs uppercase tracking-wide ${STATUS_TINT[ca.status] ?? STATUS_TINT.BUILDING}`}>
                {ca.status.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  )

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Custom audiences</h1>
      <AudiencesPlatformTabs orgId={orgId} orgSlug={slug} metaContent={metaContent} />
    </section>
  )
}
