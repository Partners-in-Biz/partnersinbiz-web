'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AdCreative } from '@/lib/ads/types'
import { CreativeUploader } from '@/components/ads/CreativeUploader'

interface Props {
  orgId: string
  orgSlug: string
  initialCreatives: AdCreative[]
}

const STATUS_TINT: Record<string, string> = {
  UPLOADING: 'pib-pill-info',
  PROCESSING: 'pib-pill-warn',
  READY: 'pib-pill-success',
  FAILED: 'pib-pill-danger',
  ARCHIVED: '',
}

export function CreativesPanelClient({ orgId, orgSlug, initialCreatives }: Props) {
  const router = useRouter()
  const [creatives] = useState(initialCreatives)
  const [showUploader, setShowUploader] = useState(false)

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium">Creative library</h1>
          <p className="text-sm text-white/60 mt-1">
            {creatives.length} {creatives.length === 1 ? 'creative' : 'creatives'}  -  used by ad sets when building campaigns.
          </p>
        </div>
        <button
          type="button"
          className="btn-pib-accent text-sm"
          onClick={() => setShowUploader((s) => !s)}
        >
          {showUploader ? 'Close' : 'Upload new'}
        </button>
      </header>

      {showUploader && (
        <div className="rounded-lg border border-white/10 p-4">
          <CreativeUploader
            orgId={orgId}
            accept="both"
            onUploaded={() => {
              setShowUploader(false)
              router.refresh()
            }}
            onCancel={() => setShowUploader(false)}
          />
        </div>
      )}

      {creatives.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-8 text-center">
          <p className="text-white/60">No creatives uploaded yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {creatives.map((c) => (
            <Link
              key={c.id}
              href={`/admin/org/${orgSlug}/ads/creatives/${c.id}`}
              className="rounded border border-white/10 p-2 hover:bg-white/5"
            >
              {c.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.previewUrl} alt={c.name} className="aspect-square w-full rounded object-cover" />
              ) : (
                <div className="aspect-square w-full rounded bg-white/5 flex items-center justify-center text-xs text-white/40">
                  {c.type}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                <div className="truncate text-sm" title={c.name}>{c.name}</div>
                <span className={`pib-pill ${STATUS_TINT[c.status]}`}>
                  {c.status.toLowerCase()}
                </span>
              </div>
              <div className="text-xs text-white/40">
                {c.width ?? '?'}×{c.height ?? '?'} · {c.type}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
