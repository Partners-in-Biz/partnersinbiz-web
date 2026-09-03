'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  BlogReaderCard,
  AssetActions,
  type PreviewSocialPost,
  type PreviewBlog,
  type PreviewBrand,
} from '@/components/campaign-preview'
import { SocialPlatformCard } from '@/components/campaign-preview/pickSocialCard'
import { SendToYouTubeStudioButton } from '@/components/youtube-studio/SendToYouTubeStudioButton'
import { VideoTriptych } from './VideoTriptych'

type Filter = 'all' | 'social' | 'blogs' | 'videos'
type ApprovalMode = 'direct' | 'client'

interface Props {
  campaignId: string
  brand?: PreviewBrand
  social: PreviewSocialPost[]
  blogs: PreviewBlog[]
  videos: PreviewSocialPost[]
  filter?: Filter
  readonly?: boolean
  approvalMode?: ApprovalMode
}

type ScopedAsset = { id: string; orgId?: unknown }

function withOrgScope(path: string, asset?: ScopedAsset): string {
  const orgId = typeof asset?.orgId === 'string' ? asset.orgId.trim() : ''
  if (!orgId) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}orgId=${encodeURIComponent(orgId)}`
}

export function AssetGrid({
  brand,
  social,
  blogs,
  videos,
  filter = 'all',
  readonly = false,
  approvalMode = 'direct',
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function approve(asset: ScopedAsset, type: 'social_post' | 'seo_content' | 'video') {
    if (readonly) return
    const assetId = asset.id
    setBusyId(assetId)
    try {
      if (type === 'seo_content') {
        const r = await fetch(withOrgScope(`/api/v1/seo/content/${encodeURIComponent(assetId)}/publish`, asset), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!r.ok) throw new Error('publish failed')
      } else {
        const routeAction = approvalMode === 'client' ? 'client-approve' : 'approve'
        const r = await fetch(withOrgScope(`/api/v1/social/posts/${encodeURIComponent(assetId)}/${routeAction}`, asset), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(approvalMode === 'client' ? {} : { action: 'approve' }),
        })
        if (!r.ok) throw new Error('approve failed')
      }
      startTransition(() => router.refresh())
    } finally {
      setBusyId(null)
    }
  }

  async function requestChanges(
    asset: ScopedAsset,
    type: 'social_post' | 'seo_content' | 'video',
    feedback: string,
  ) {
    if (readonly) return
    const assetId = asset.id
    setBusyId(assetId)
    try {
      const url =
        type === 'seo_content'
          ? `/api/v1/seo/content/${encodeURIComponent(assetId)}/comments`
          : `/api/v1/social/posts/${encodeURIComponent(assetId)}/comments`
      const r = await fetch(withOrgScope(url, asset), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: feedback }),
      })
      if (!r.ok) throw new Error('request changes failed')
      startTransition(() => router.refresh())
    } finally {
      setBusyId(null)
    }
  }

  function actionsFor(asset: ScopedAsset, type: 'social_post' | 'seo_content' | 'video', status: string) {
    if (readonly) return null
    const assetId = asset.id
    return (
      <AssetActions
        assetId={assetId}
        type={type}
        status={status}
        busy={busyId === assetId || isPending}
        onApprove={() => approve(asset, type)}
        onRequestChanges={(text: string) => requestChanges(asset, type, text)}
        onEdit={() => alert('Inline edit coming next.')}
      />
    )
  }

  const showSocial = filter === 'all' || filter === 'social'
  const showBlogs = filter === 'all' || filter === 'blogs'
  const showVideos = filter === 'all' || filter === 'videos'

  return (
    <div className="space-y-10">
      {showVideos && videos.length > 0 && (
        <section className="space-y-6">
          <h2 className="text-lg">Videos ({videos.length})</h2>
          <div className="space-y-8">
            {videos.map((post) => (
              <div key={post.id} className="card p-5 space-y-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-base font-medium">
                    {(post as unknown as { title?: string }).title ??
                      (typeof post.content === 'string' ? post.content.slice(0, 80) : undefined) ??
                      'Untitled video'}
                  </h3>
                  <span className="pib-pill pib-pill-rose">
                    {post.status ?? ' - '}
                  </span>
                </div>
                <VideoTriptych post={post} brand={brand} />
                <SendToYouTubeStudioButton
                  orgId={(post as unknown as { orgId?: string }).orgId}
                  title={
                    (post as unknown as { title?: string }).title ??
                    (typeof post.content === 'string' ? post.content.slice(0, 80) : 'Campaign video')
                  }
                  sourceUrl={
                    (post.media?.[0] as { urlYoutube?: string; url?: string } | undefined)?.urlYoutube ??
                    (post.media?.[0] as { url?: string } | undefined)?.url
                  }
                  mediaFormat="horizontal"
                  origin={{
                    type: (post as unknown as { campaignId?: string }).campaignId ? 'campaign' : 'social_post',
                    id: ((post as unknown as { campaignId?: string }).campaignId ?? post.id) as string,
                  }}
                />
                {actionsFor(post, 'video', post.status ?? 'draft')}
              </div>
            ))}
          </div>
        </section>
      )}

      {showBlogs && blogs.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg">Blogs ({blogs.length})</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {blogs.map((blog) => (
              <div key={blog.id} className="space-y-2">
                <BlogReaderCard blog={blog} brand={brand} />
                {actionsFor(blog, 'seo_content', blog.status ?? 'idea')}
              </div>
            ))}
          </div>
        </section>
      )}

      {showSocial && social.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg">Social ({social.length})</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {social.map((post) => (
              <div key={post.id} className="space-y-2">
                <SocialPlatformCard post={post} brand={brand} />
                {actionsFor(post, 'social_post', post.status ?? 'draft')}
              </div>
            ))}
          </div>
        </section>
      )}

      {social.length === 0 && blogs.length === 0 && videos.length === 0 && (
        <div className="card p-10 text-center text-sm text-[var(--color-pib-text-muted)]">
          No assets yet. Run the <code>content-engine</code> skill or attach existing posts/content with this campaignId.
        </div>
      )}
    </div>
  )
}
