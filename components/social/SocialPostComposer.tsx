'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import PlatformPreview from '@/components/social/PlatformPreview'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

const PLATFORM_CONFIG: Record<string, { label: string; bg: string; short: string; charLimit: number; supportsThreads: boolean }> = {
  twitter: { label: 'X (Twitter)', bg: 'bg-black', short: 'X', charLimit: 280, supportsThreads: true },
  linkedin: { label: 'LinkedIn', bg: 'bg-blue-700', short: 'LI', charLimit: 3000, supportsThreads: false },
  facebook: { label: 'Facebook', bg: 'bg-blue-600', short: 'FB', charLimit: 63206, supportsThreads: false },
  instagram: { label: 'Instagram', bg: 'bg-pink-600', short: 'IG', charLimit: 2200, supportsThreads: false },
  reddit: { label: 'Reddit', bg: 'bg-orange-600', short: 'RD', charLimit: 40000, supportsThreads: false },
  tiktok: { label: 'TikTok', bg: 'bg-gray-800', short: 'TT', charLimit: 2200, supportsThreads: false },
  pinterest: { label: 'Pinterest', bg: 'bg-red-700', short: 'PI', charLimit: 500, supportsThreads: false },
  bluesky: { label: 'Bluesky', bg: 'bg-sky-500', short: 'BS', charLimit: 300, supportsThreads: true },
  threads: { label: 'Threads', bg: 'bg-gray-700', short: 'TH', charLimit: 500, supportsThreads: true },
  youtube: { label: 'YouTube', bg: 'bg-red-600', short: 'YT', charLimit: 5000, supportsThreads: false },
  mastodon: { label: 'Mastodon', bg: 'bg-purple-600', short: 'MA', charLimit: 500, supportsThreads: true },
  dribbble: { label: 'Dribbble', bg: 'bg-pink-500', short: 'DR', charLimit: 500, supportsThreads: false },
}

interface Account {
  id: string
  platform: string
  displayName: string
  username: string
  status: string
}

interface MediaItem {
  id: string
  url: string
  type: 'image'
  altText: string
}

type SocialScope = 'org' | 'personal'

interface SocialPostComposerProps {
  scope?: SocialScope
  title?: string
  description?: string
  accountsHref?: string
  afterSaveHref?: string
  previewFallbackName?: string
  previewFallbackHandle?: string
  orgId?: string | null
}

export default function SocialPostComposer({
  scope = 'org',
  title = 'Compose Post',
  description = 'Create and schedule social media content',
  accountsHref = '/portal/social/accounts',
  afterSaveHref = '/portal/social',
  previewFallbackName = 'Your Brand',
  previewFallbackHandle = '@yourbrand',
  orgId,
}: SocialPostComposerProps) {
  const router = useRouter()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [content, setContent] = useState('')
  const [scheduledFor, setScheduledFor] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [hashtagInput, setHashtagInput] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([])
  const [uploadingImage, setUploadingImage] = useState(false)

  const socialApiPath = useCallback((path: string) => appendQueryParams(path, {
    scope: scope === 'personal' ? 'personal' : undefined,
    orgId,
  }), [orgId, scope])

  useEffect(() => {
    fetch(socialApiPath('/api/v1/social/accounts'))
      .then(r => r.json())
      .then(b => setAccounts((b.data ?? []).filter((a: Account) => a.status === 'active')))
      .catch(() => {})
  }, [socialApiPath])

  const togglePlatform = (p: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    )
  }

  const toggleAccount = (id: string) => {
    setSelectedAccounts(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  // Auto-select accounts when platforms change
  useEffect(() => {
    const matching = accounts
      .filter(a => selectedPlatforms.includes(a.platform))
      .map(a => a.id)
    setSelectedAccounts(matching)
  }, [selectedPlatforms, accounts])

  const charLimit = selectedPlatforms.length > 0
    ? Math.min(...selectedPlatforms.map(p => PLATFORM_CONFIG[p]?.charLimit ?? 5000))
    : 5000

  const availablePlatforms = [...new Set(accounts.map(a => a.platform))]

  const validate = useCallback(() => {
    const errs: Record<string, string> = {}
    if (!content.trim()) errs.content = 'Content cannot be empty.'
    if (selectedPlatforms.length === 0) errs.platforms = 'Select at least one platform.'
    if (selectedAccounts.length === 0) errs.accounts = 'Select at least one account.'
    if (content.length > charLimit) errs.content = `Content exceeds ${charLimit} character limit.`
    setErrors(errs)
    return Object.keys(errs).length === 0
  }, [content, selectedPlatforms, selectedAccounts, charLimit])

  const handleHashtagKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const val = hashtagInput.trim().replace(/^[#,]+|[,]+$/g, '')
      if (val && !hashtags.includes(val)) setHashtags(prev => [...prev, val])
      setHashtagInput('')
    }
  }

  const buildBody = (status: 'draft' | 'scheduled') => ({
    content: { text: content, platformOverrides: {} },
    platforms: selectedPlatforms,
    accountIds: selectedAccounts,
    status,
    scheduledAt: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
    media: mediaItems.map((item, index) => ({
      mediaId: item.id,
      type: item.type,
      url: item.url,
      thumbnailUrl: item.url,
      width: 0,
      height: 0,
      duration: null,
      altText: item.altText,
      order: index,
    })),
    hashtags,
    labels: [],
    source: 'ui',
  })

  const handleImageUpload = async (file: File | null) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setErrors({ upload: 'Only image uploads are supported here.' })
      return
    }

    setUploadingImage(true)
    setErrors(prev => {
      const next = { ...prev }
      delete next.upload
      return next
    })

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('altText', file.name.replace(/\.[^.]+$/, ''))

      const res = await fetch(socialApiPath('/api/v1/social/media/upload'), {
        method: 'POST',
        body: formData,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Image upload failed')

      setMediaItems(prev => [
        ...prev,
        {
          id: body.data.id,
          url: body.data.url,
          type: 'image',
          altText: file.name.replace(/\.[^.]+$/, ''),
        },
      ])
    } catch (err: unknown) {
      setErrors({ upload: err instanceof Error ? err.message : 'Image upload failed' })
    } finally {
      setUploadingImage(false)
    }
  }

  const removeMediaItem = (id: string) => {
    setMediaItems(prev => prev.filter(item => item.id !== id))
  }

  const handleSubmit = async (action: 'draft' | 'schedule' | 'publish') => {
    if (!validate()) return
    if (action === 'schedule' && !scheduledFor) {
      setErrors({ submit: 'Set a schedule date/time first.' })
      return
    }
    setSubmitting(true)
    try {
      const status = action === 'publish' ? 'draft' : action === 'schedule' ? 'scheduled' : 'draft'
      const res = await fetch(socialApiPath('/api/v1/social/posts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody(status)),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to create post')

      if (action === 'publish') {
        const postId = body.data?.id
        if (!postId) throw new Error('No post ID returned')
        const pubRes = await fetch(socialApiPath(`/api/v1/social/posts/${postId}/publish`), { method: 'POST' })
        const pubBody = await pubRes.json()
        if (!pubRes.ok) throw new Error(pubBody.error ?? 'Failed to publish')
        setSuccessMsg('Published successfully!')
      } else {
        setSuccessMsg(action === 'schedule' ? 'Post scheduled!' : 'Draft saved!')
      }
      setTimeout(() => router.push(afterSaveHref), 1200)
    } catch (err: unknown) {
      setErrors({ submit: err instanceof Error ? err.message : 'Something went wrong' })
    } finally {
      setSubmitting(false)
    }
  }

  const minDateTime = new Date().toISOString().slice(0, 16)

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,42rem)_minmax(22rem,1fr)]">
      <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-headline text-2xl font-bold tracking-tighter">{title}</h1>
        <p className="text-sm text-[var(--color-on-surface-variant)] mt-1">{description}</p>
      </div>

      {successMsg && (
        <div className="border border-green-400/40 p-4 text-green-300 text-sm">{successMsg}</div>
      )}
      {errors.submit && (
        <div className="border border-red-400/40 p-4 text-red-300 text-sm">{errors.submit}</div>
      )}

      {/* Platform Selection */}
      <div>
        <label className="block text-xs font-label uppercase tracking-widest text-[var(--color-on-surface-variant)] mb-2">Platforms</label>
        {availablePlatforms.length === 0 ? (
          <p className="text-[var(--color-on-surface-variant)] text-sm">No accounts connected. <a href={accountsHref} className="text-[var(--color-accent-v2)] underline">Connect an account</a> first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {availablePlatforms.map(p => {
              const cfg = PLATFORM_CONFIG[p]
              if (!cfg) return null
              const selected = selectedPlatforms.includes(p)
              return (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={`px-4 py-2 text-sm font-label font-bold uppercase tracking-widest border transition-colors ${
                    selected
                      ? 'pib-btn-primary'
                      : 'pib-btn-secondary'
                  }`}
                >
                  {cfg.label}
                </button>
              )
            })}
          </div>
        )}
        {errors.platforms && <p className="text-red-300 text-xs mt-1">{errors.platforms}</p>}
      </div>

      {/* Account Selection */}
      {selectedPlatforms.length > 0 && (
        <div>
          <label className="block text-xs font-label uppercase tracking-widest text-[var(--color-on-surface-variant)] mb-2">Accounts</label>
          <div className="space-y-2">
            {accounts
              .filter(a => selectedPlatforms.includes(a.platform))
              .map(acc => (
                <label key={acc.id} className="pib-card pib-card-hover p-3 cursor-pointer flex items-center gap-3 transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedAccounts.includes(acc.id)}
                    onChange={() => toggleAccount(acc.id)}
                    className="accent-[var(--color-accent-v2)]"
                  />
                  <span className={`${PLATFORM_CONFIG[acc.platform]?.bg ?? 'bg-gray-600'} text-white text-[10px] px-2 py-0.5 rounded font-bold`}>
                    {PLATFORM_CONFIG[acc.platform]?.short ?? acc.platform.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-sm text-[var(--color-on-surface)]">{acc.displayName}</span>
                  <span className="text-xs text-[var(--color-on-surface-variant)]">@{acc.username || acc.displayName}</span>
                </label>
              ))}
          </div>
          {errors.accounts && <p className="text-red-300 text-xs mt-1">{errors.accounts}</p>}
        </div>
      )}

      {/* Content */}
      <div>
        <label className="block text-xs font-label uppercase tracking-widest text-[var(--color-on-surface-variant)] mb-2">Content</label>
        <div className="pib-card p-3">
          <textarea
            rows={6}
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Write your post…"
            className="w-full bg-transparent text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)] resize-none outline-none"
          />
          <div className="flex justify-end mt-1">
            <span className={`text-xs ${content.length > charLimit ? 'text-red-400' : 'text-[var(--color-on-surface-variant)]'}`}>
              {content.length} / {charLimit}
            </span>
          </div>
        </div>
        {errors.content && <p className="text-red-300 text-xs mt-1">{errors.content}</p>}
      </div>

      {/* Media */}
      <div>
        <label className="block text-xs font-label uppercase tracking-widest text-[var(--color-on-surface-variant)] mb-2">Images</label>
        <div className="pib-card p-3 space-y-3">
          {mediaItems.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {mediaItems.map(media => (
                <div key={media.id} className="relative overflow-hidden border border-[var(--color-outline-variant)] bg-black/20">
                  <img src={media.url} alt={media.altText || 'Uploaded media'} className="h-32 w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeMediaItem(media.id)}
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center bg-black/70 text-sm font-bold text-white transition-colors hover:bg-red-600"
                    aria-label="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="flex cursor-pointer items-center justify-center border border-dashed border-[var(--color-outline-variant)] px-4 py-3 text-sm font-label font-bold uppercase tracking-widest text-[var(--color-on-surface-variant)] transition-colors hover:border-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)]">
            {uploadingImage ? 'Uploading...' : '+ Upload Image'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              disabled={uploadingImage}
              onChange={e => {
                handleImageUpload(e.target.files?.[0] ?? null)
                e.currentTarget.value = ''
              }}
              className="sr-only"
            />
          </label>
        </div>
        {errors.upload && <p className="text-red-300 text-xs mt-1">{errors.upload}</p>}
      </div>

      {/* Schedule */}
      <div>
        <label className="block text-xs font-label uppercase tracking-widest text-[var(--color-on-surface-variant)] mb-2">Schedule For</label>
        <input
          type="datetime-local"
          value={scheduledFor}
          min={minDateTime}
          onChange={e => setScheduledFor(e.target.value)}
          className="border border-[var(--color-outline-variant)] bg-transparent px-4 py-2.5 text-sm text-[var(--color-on-surface)] outline-none focus:border-[var(--color-on-surface-variant)] transition-colors"
        />
        <p className="text-xs text-[var(--color-on-surface-variant)] mt-1">Leave empty to save as draft.</p>
      </div>

      {/* Hashtags */}
      <div>
        <label className="block text-xs font-label uppercase tracking-widest text-[var(--color-on-surface-variant)] mb-2">Hashtags</label>
        <input
          type="text"
          value={hashtagInput}
          onChange={e => setHashtagInput(e.target.value)}
          onKeyDown={handleHashtagKey}
          placeholder="Type a hashtag and press Enter…"
          className="w-full border border-[var(--color-outline-variant)] bg-transparent px-4 py-2.5 text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)] outline-none focus:border-[var(--color-on-surface-variant)] transition-colors"
        />
        {hashtags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {hashtags.map(tag => (
              <span key={tag} className="flex items-center gap-1 px-2 py-0.5 border border-[var(--color-outline-variant)] text-[var(--color-on-surface-variant)] text-xs">
                #{tag}
                <button onClick={() => setHashtags(prev => prev.filter(t => t !== tag))} className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] ml-1">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 pt-2">
        <button
          onClick={() => handleSubmit('draft')}
          disabled={submitting}
          className="pib-btn-secondary disabled:opacity-50"
        >
          Save Draft
        </button>
        <button
          onClick={() => handleSubmit('schedule')}
          disabled={submitting || !scheduledFor}
          className="pib-btn-primary disabled:opacity-50"
        >
          Schedule
        </button>
        <button
          onClick={() => handleSubmit('publish')}
          disabled={submitting}
          className="pib-btn-secondary disabled:opacity-50"
        >
          Publish Now
        </button>
      </div>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <div>
          <h2 className="font-headline text-xl font-bold tracking-tighter">Preview</h2>
          <p className="text-sm text-[var(--color-on-surface-variant)] mt-1">Selected platforms render here as you compose.</p>
        </div>
        {selectedPlatforms.length === 0 ? (
          <div className="pib-card p-4 text-sm text-[var(--color-on-surface-variant)]">
            Select a connected platform to see its preview.
          </div>
        ) : (
          <div className="space-y-4">
            {selectedPlatforms.map(platform => {
              const account = accounts.find(a => a.platform === platform && selectedAccounts.includes(a.id))
                ?? accounts.find(a => a.platform === platform)
              return (
                <div key={platform} className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-label font-bold uppercase tracking-widest text-[var(--color-on-surface-variant)]">
                    <span className={`${PLATFORM_CONFIG[platform]?.bg ?? 'bg-gray-600'} text-white text-[10px] px-2 py-0.5 rounded font-bold`}>
                      {PLATFORM_CONFIG[platform]?.short ?? platform.slice(0, 2).toUpperCase()}
                    </span>
                    {PLATFORM_CONFIG[platform]?.label ?? platform}
                  </div>
                  <PlatformPreview
                    platform={platform}
                    content={content}
                    mediaItems={mediaItems}
                    charLimit={PLATFORM_CONFIG[platform]?.charLimit ?? 5000}
                    userName={account?.displayName || previewFallbackName}
                    userHandle={account?.username ? `@${account.username.replace(/^@/, '')}` : previewFallbackHandle}
                  />
                </div>
              )
            })}
          </div>
        )}
      </aside>
    </div>
  )
}
