import Link from 'next/link'
import { resolveOrgIdBySlug } from '@/lib/organizations/resolve-by-slug'
import { getCreative } from '@/lib/ads/creatives/store'
import { listAds } from '@/lib/ads/ads/store'

interface Params {
  slug: string
  id: string
}

export default async function CreativeDetailPage({
  params,
}: {
  params: Promise<Params>
}) {
  const { slug, id } = await params
  const orgId = await resolveOrgIdBySlug(slug)
  if (!orgId) return <p className="pib-page-sub">Org not found.</p>
  const c = await getCreative(id)
  if (!c || c.orgId !== orgId) return <p className="pib-page-sub">Creative not found.</p>
  const allAds = await listAds({ orgId })
  const usingAds = allAds.filter((a) => a.creativeIds.includes(id))

  return (
    <article className="space-y-8">
      <header>
        <Link
          href={`/admin/org/${slug}/ads/creatives`}
          className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
        >
          ← Creative library
        </Link>
        <p className="eyebrow mt-3">Ads · Creative</p>
        <h1 className="pib-page-title mt-2">{c.name}</h1>
        <p className="pib-page-sub">
          {c.type} · {c.status.toLowerCase()} · {(c.fileSize / 1024).toFixed(0)} KB
          {c.width != null && c.height != null && ` · ${c.width}×${c.height}`}
          {c.duration != null && c.duration > 0 && ` · ${c.duration}s`}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="pib-label">Preview</h2>
        <div>
          {c.type === 'video' ? (
            <video src={c.sourceUrl} controls className="max-h-96 rounded-[10px] border border-[var(--color-pib-line)]" />
          ) : c.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.previewUrl} alt={c.name} className="max-h-96 rounded-[10px] border border-[var(--color-pib-line)]" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.sourceUrl} alt={c.name} className="max-h-96 rounded-[10px] border border-[var(--color-pib-line)]" />
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="pib-label">Platform sync</h2>
        <dl className="space-y-1 text-sm">
          {(['meta', 'google', 'linkedin', 'tiktok'] as const).map((p) => {
            const ref = c.platformRefs[p]
            return (
              <div key={p} className="flex items-center gap-2">
                <dt className="capitalize w-24 text-[var(--color-pib-text-muted)]">{p}</dt>
                <dd>
                  {ref ? (
                    <code className="text-xs text-[var(--color-pib-text)]">{ref.creativeId}</code>
                  ) : (
                    <span className="text-xs text-[var(--color-pib-text-muted)] opacity-70">not synced</span>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="pib-label">
          Used by {usingAds.length} {usingAds.length === 1 ? 'ad' : 'ads'}
        </h2>
        {usingAds.length === 0 ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">Not yet referenced by any ad.</p>
        ) : (
          <div className="pib-surface pib-surface-list">
            <ul className="divide-y divide-[var(--color-pib-line)]">
              {usingAds.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <Link
                    href={`/admin/org/${slug}/ads/ads/${a.id}`}
                    className="text-[var(--color-pib-text)] hover:text-[var(--st-danger)]"
                  >
                    {a.name}
                  </Link>
                  <span className="pib-pill">{a.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {c.lastError && (
        <section className="pib-card border-[var(--color-error)]/30">
          <div className="font-medium text-[var(--color-error)]">Last error</div>
          <div className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{c.lastError}</div>
        </section>
      )}
    </article>
  )
}
