import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Ad } from '@/lib/ads/types'
import type { RsaAssets } from '@/lib/ads/providers/google/ads'

interface AdCreativeDetailWorkspaceProps {
  ad: Ad
  backHref: string
  backLabel: string
  commentsSlot?: ReactNode
}

function inferImageUrl(ad: Ad): string | null {
  if (ad.inlineImageUrl) return ad.inlineImageUrl
  const meta = (ad.providerData?.meta ?? {}) as Record<string, unknown>
  for (const key of ['imageUrl', 'image_url', 'preview_url', 'previewUrl']) {
    const value = meta[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return null
}

function formatValue(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ')
}

function getMetaIds(ad: Ad): { adId?: string; creativeId?: string } | undefined {
  return ad.providerData?.meta as { adId?: string; creativeId?: string } | undefined
}

function getRsaAssets(ad: Ad): RsaAssets | undefined {
  const providerData = ad.providerData as Ad['providerData'] & { google?: { rsaAssets?: RsaAssets } }
  return providerData.google?.rsaAssets
}

function RsaAssetList({
  label,
  limit,
  items,
}: {
  label: string
  limit: number
  items: Array<{ text: string }>
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
        {label} ({items.length})
      </h3>
      <ul className="space-y-1">
        {items.map((item, index) => (
          <li key={`${label}-${index}`} className="flex items-center gap-2 text-sm">
            <span className="w-4 text-right text-xs text-[var(--color-pib-text-muted)]">{index + 1}</span>
            <span className="text-[var(--color-pib-text)]">{item.text}</span>
            <span
              className={`ml-auto text-xs tabular-nums ${
                item.text.length > limit ? 'text-red-300' : 'text-[var(--color-pib-text-muted)]'
              }`}
            >
              {item.text.length}/{limit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function GoogleRsaPanel({ rsaAssets }: { rsaAssets?: RsaAssets }) {
  return (
    <section className="pib-card p-5">
      <h2 className="eyebrow mb-4 !text-[10px]">RSA assets</h2>
      {rsaAssets ? (
        <div className="space-y-5">
          <RsaAssetList label="Headlines" limit={30} items={rsaAssets.headlines} />
          <RsaAssetList label="Descriptions" limit={90} items={rsaAssets.descriptions} />

          {(rsaAssets.path1 ?? rsaAssets.path2) && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                Display URL paths
              </h3>
              <p className="text-sm text-[var(--color-pib-text)]">
                {[rsaAssets.path1, rsaAssets.path2].filter(Boolean).join(' / ')}
              </p>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
              Landing URLs
            </h3>
            <ul className="space-y-1">
              {rsaAssets.finalUrls.map((url, index) => (
                <li key={`${url}-${index}`} className="text-sm">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-[var(--color-pib-accent)] underline"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-[var(--color-pib-text-muted)]">
            Google RSA assets cannot be edited in place. To change assets, remove this ad and create a new one.
          </p>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          RSA assets are not stored locally. Query Google Ads API for live data.
        </p>
      )}
    </section>
  )
}

export function AdCreativeDetailWorkspace({
  ad,
  backHref,
  backLabel,
  commentsSlot,
}: AdCreativeDetailWorkspaceProps) {
  const imageUrl = inferImageUrl(ad)
  const metaIds = getMetaIds(ad)
  const isVideo = ad.format === 'SINGLE_VIDEO'
  const rsaAssets = getRsaAssets(ad)

  return (
    <article className="space-y-6">
      <header>
        <Link
          href={backHref}
          className="inline-flex items-center gap-2 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]"
        >
          <span aria-hidden="true">&larr;</span>
          {backLabel}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--color-pib-text)]">{ad.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--color-pib-text-muted)]">
          <span>{formatValue(ad.format)}</span>
          <span aria-hidden="true">&middot;</span>
          <span>{formatValue(ad.status)}</span>
          <span aria-hidden="true">&middot;</span>
          <span>{ad.platform}</span>
          {metaIds?.adId && (
            <>
              <span aria-hidden="true">&middot;</span>
              <span>
                Meta ad id <code className="text-[var(--color-pib-text-muted)]">{metaIds.adId}</code>
              </span>
            </>
          )}
        </div>
      </header>

      <section className="pib-card p-5">
        <h2 className="eyebrow mb-3 !text-[10px]">Creative preview</h2>
        <div className="rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4">
          {isVideo ? (
            <div className="flex h-48 items-center justify-center text-sm text-[var(--color-pib-text-muted)]">
              Video preview
            </div>
          ) : imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={ad.name} className="max-h-96 w-auto rounded" />
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-[var(--color-pib-text-muted)]">
              No creative preview available
            </div>
          )}
        </div>
      </section>

      <section className="pib-card p-5">
        <h2 className="eyebrow mb-4 !text-[10px]">Copy</h2>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
              Primary text
            </dt>
            <dd className="mt-1 whitespace-pre-wrap text-[var(--color-pib-text)]">{ad.copy.primaryText}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
              Headline
            </dt>
            <dd className="mt-1 text-[var(--color-pib-text)]">{ad.copy.headline}</dd>
          </div>
          {ad.copy.description && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                Description
              </dt>
              <dd className="mt-1 text-[var(--color-pib-text)]">{ad.copy.description}</dd>
            </div>
          )}
          {ad.copy.callToAction && (
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-pib-text-muted)]">
                Call to action
              </dt>
              <dd className="mt-1 text-[var(--color-pib-text)]">
                {formatValue(ad.copy.callToAction)}
                {ad.copy.destinationUrl && (
                  <>
                    {' -> '}
                    <a
                      href={ad.copy.destinationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-[var(--color-pib-accent)] underline"
                    >
                      {ad.copy.destinationUrl}
                    </a>
                  </>
                )}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {ad.platform === 'google' && <GoogleRsaPanel rsaAssets={rsaAssets} />}

      {commentsSlot && (
        <section className="pib-card p-5">
          <h2 className="eyebrow mb-4 !text-[10px]">Comments</h2>
          {commentsSlot}
        </section>
      )}
    </article>
  )
}
