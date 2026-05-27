'use client'
import { useState, useEffect } from 'react'
import type { AdCreative, AdCreativeType } from '@/lib/ads/types'
import { CreativeUploader } from './CreativeUploader'
import { PageTabs } from '@/components/ui/AppFoundation'

interface Props {
  open: boolean
  orgId: string
  /** Restrict listed types. Defaults to 'image'. */
  type?: AdCreativeType
  /** Multi-select for carousels. Defaults to single. */
  mode?: 'single' | 'multi'
  /** Callback when user selects creatives. */
  onSelect: (creativeIds: string[]) => void
  onClose: () => void
}

export function CreativePicker({
  open,
  orgId,
  type = 'image',
  mode = 'single',
  onSelect,
  onClose,
}: Props) {
  const [tab, setTab] = useState<'library' | 'upload'>('library')
  const [creatives, setCreatives] = useState<AdCreative[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    if (!open || tab !== 'library') return
    setLoading(true)
    fetch(`/api/v1/ads/creatives?type=${type}&status=READY`, {
      headers: { 'X-Org-Id': orgId },
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.success) setCreatives(body.data as AdCreative[])
      })
      .finally(() => setLoading(false))
  }, [open, tab, type, orgId])

  if (!open) return null

  function toggle(id: string) {
    if (mode === 'single') {
      setSelected([id])
    } else {
      setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="creative-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div className="w-full max-w-3xl rounded-lg border border-white/10 bg-[#0A0A0B] p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 id="creative-picker-title" className="text-lg font-semibold">
            Pick a creative
          </h2>
          <button type="button" className="text-sm text-white/40 underline" onClick={onClose}>
            Cancel
          </button>
        </div>

        <PageTabs
          className="mt-4"
          ariaLabel="Creative picker source"
          value={tab}
          onValueChange={(value) => setTab(value as 'library' | 'upload')}
          tabs={[
            { value: 'library', label: 'Library', badge: creatives.length },
            { value: 'upload', label: 'Upload new' },
          ]}
        />

        <div className="mt-4 max-h-96 overflow-y-auto">
          {tab === 'library' &&
            (loading ? (
              <p className="text-sm text-white/40">Loading…</p>
            ) : creatives.length === 0 ? (
              <p className="text-sm text-white/40">
                No creatives yet. Use the Upload tab to add your first.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3" role="list">
                {creatives.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="listitem"
                    onClick={() => toggle(c.id)}
                    className={`rounded border p-2 text-left ${
                      selected.includes(c.id)
                        ? 'border-[#F5A623] bg-[#F5A623]/5'
                        : 'border-white/10 hover:bg-white/5'
                    }`}
                  >
                    {c.previewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.previewUrl} alt={c.name} className="aspect-square w-full rounded object-cover" />
                    ) : (
                      <div className="aspect-square w-full rounded bg-white/5 flex items-center justify-center text-xs text-white/40">
                        {c.type}
                      </div>
                    )}
                    <div className="mt-2 truncate text-sm">{c.name}</div>
                    <div className="text-xs text-white/40">
                      {c.width ?? '?'}×{c.height ?? '?'}
                    </div>
                  </button>
                ))}
              </div>
            ))}

          {tab === 'upload' && (
            <CreativeUploader
              orgId={orgId}
              accept={type === 'video' ? 'video' : type === 'image' ? 'image' : 'both'}
              onUploaded={(newCreative) => {
                setCreatives((prev) => [newCreative, ...prev])
                setSelected([newCreative.id])
                setTab('library')
              }}
            />
          )}
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
          <div className="text-xs text-white/40">
            {selected.length} selected
          </div>
          <button
            type="button"
            className="btn-pib-accent text-sm"
            disabled={selected.length === 0}
            onClick={() => onSelect(selected)}
          >
            Use {selected.length === 1 ? 'this' : 'these'}
          </button>
        </div>
      </div>
    </div>
  )
}
