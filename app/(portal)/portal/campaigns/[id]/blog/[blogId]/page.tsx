'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { BlogReaderCard } from '@/components/campaign-preview'
import {
  CommentComposer,
  CommentList,
  SelectionPopover,
  type AnchorTarget,
  type InlineComment,
} from '@/components/inline-comments'
import type { PreviewBlog } from '@/components/campaign-preview/types'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function toPreviewBlog(blog: AnyObj): PreviewBlog {
  return {
    id: blog.id,
    title: blog.title ?? 'Untitled',
    type: blog.type,
    publishDate: blog.publishDate,
    targetUrl: blog.targetUrl,
    status: blog.status,
    draft: {
      body: blog.draft?.body,
      metaDescription: blog.draft?.metaDescription,
      wordCount: blog.draft?.wordCount,
    },
    heroImageUrl: blog.heroImageUrl,
    authorName: blog.authorName,
    authorAvatarUrl: blog.authorAvatarUrl,
    readTimeMinutes: blog.readTimeMinutes,
  }
}

export default function PortalCampaignBlogDetailPage() {
  const params = useParams()
  const campaignId = paramValue(params?.id)
  const blogId = paramValue(params?.blogId)

  return <PortalCampaignBlogDetail campaignId={campaignId} blogId={blogId} />
}

function PortalCampaignBlogDetail({
  campaignId,
  blogId,
}: {
  campaignId: string
  blogId: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [blog, setBlog] = useState<AnyObj | null>(null)
  const [comments, setComments] = useState<InlineComment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'approve' | 'comment'>(null)
  const [composerAnchor, setComposerAnchor] = useState<AnchorTarget | null>(null)

  useEffect(() => {
    if (!campaignId || !blogId) {
      setLoading(false)
      setLoadError('Blog post not found.')
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setActionError(null)

    Promise.all([
      fetch(`/api/v1/campaigns/${campaignId}/assets`).then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error ?? 'Campaign assets could not load.')
        return body
      }),
      fetch(`/api/v1/seo/content/${blogId}/comments`).then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.error ?? 'Comments could not load.')
        return body
      }),
    ])
      .then(([assetsBody, commentsBody]) => {
        if (cancelled) return
        const blogs = (assetsBody.data?.blogs ?? []) as AnyObj[]
        setBlog(blogs.find((item) => item.id === blogId) ?? null)
        setComments((commentsBody.data ?? []) as InlineComment[])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Blog post could not load.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [campaignId, blogId])

  const previewBlog = useMemo(() => (blog ? toPreviewBlog(blog) : null), [blog])
  const campaignBlogsHref = scopedPortalPath(
    `/portal/campaigns/${campaignId}?tab=blogs`,
    scopeFromSearchParams(searchParams),
  )

  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target?.tagName === 'IMG') {
        const image = target as HTMLImageElement
        if (image.src) {
          event.preventDefault()
          setComposerAnchor({ kind: 'image', mediaUrl: image.src })
        }
      }
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [previewBlog])

  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    const images = root.querySelectorAll('img')
    images.forEach((image) => {
      image.style.cursor = 'pointer'
      image.title = 'Click to comment on this image'
    })
  }, [previewBlog])

  async function refreshComments() {
    const refreshed = await fetch(`/api/v1/seo/content/${blogId}/comments`).then((res) => res.json())
    setComments((refreshed.data ?? []) as InlineComment[])
  }

  async function postComment(text: string, anchor: AnchorTarget) {
    if (!text.trim() || busy) return
    setBusy('comment')
    setActionError(null)
    try {
      const payload: AnyObj = { text: text.trim() }
      if (anchor.kind === 'text') {
        payload.anchor = { type: 'text', text: anchor.text }
        if (typeof anchor.offset === 'number') payload.anchor.offset = anchor.offset
      } else if (anchor.kind === 'image') {
        payload.anchor = { type: 'image', mediaUrl: anchor.mediaUrl }
      }

      const res = await fetch(`/api/v1/seo/content/${blogId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Comment could not be sent.')

      if (body?.data?.statusFlipped) {
        setBlog((current: AnyObj | null) => current ? { ...current, status: 'idea' } : current)
      }
      await refreshComments()
      setComposerAnchor(null)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Comment could not be sent.')
    } finally {
      setBusy(null)
    }
  }

  function scrollToAnchor(comment: InlineComment) {
    const root = bodyRef.current
    if (!root || !comment.anchor) return
    if (comment.anchor.type === 'text') {
      const needle = comment.anchor.text.slice(0, 60)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node: Node | null = walker.currentNode
      while ((node = walker.nextNode())) {
        if ((node.textContent ?? '').includes(needle)) {
          const range = document.createRange()
          const index = node.textContent!.indexOf(needle)
          range.setStart(node, index)
          range.setEnd(node, Math.min(node.textContent!.length, index + needle.length))
          const rect = range.getBoundingClientRect()
          window.scrollTo({ top: rect.top + window.scrollY - 120, behavior: 'smooth' })
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
          window.setTimeout(() => selection?.removeAllRanges(), 1800)
          return
        }
      }
    }
    if (comment.anchor.type === 'image') {
      const imageUrl = comment.anchor.mediaUrl
      const images = root.querySelectorAll('img')
      const target = Array.from(images).find((image) => image.src === imageUrl)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.style.outline = '3px solid var(--org-accent, var(--color-pib-accent))'
        window.setTimeout(() => {
          target.style.outline = ''
        }, 1800)
      }
    }
  }

  async function approve() {
    if (busy || !blogId) return
    setBusy('approve')
    setActionError(null)
    try {
      const res = await fetch(`/api/v1/seo/content/${blogId}/client-approve`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? 'Approval could not be recorded.')
      setBlog((current: AnyObj | null) => current ? { ...current, status: body?.data?.status ?? 'client_approved' } : current)
      router.refresh()
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Approval could not be recorded.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="pib-skeleton h-96 max-w-7xl mx-auto rounded-2xl" />
  }

  if (loadError || !previewBlog) {
    return (
      <div className="pib-card max-w-4xl mx-auto p-10 text-center">
        <p className="text-sm text-on-surface-variant">{loadError ?? 'Blog post not found.'}</p>
        <Link
          href={campaignBlogsHref}
          className="text-xs underline mt-2 inline-block"
        >
          Back to Blog Posts
        </Link>
      </div>
    )
  }

  const status = (blog?.status ?? '').toString()
  const isPublished = status === 'live' || status === 'published'
  const isApproved = status === 'client_approved' || status === 'approved'
  const canReview = status === 'review'
  const anchoredCount = comments.filter((comment) => !!comment.anchor).length

  return (
    <div className="space-y-8 max-w-7xl mx-auto" style={{ color: 'var(--org-text, var(--color-pib-text))' }}>
      <header className="space-y-2">
        <Link
          href={campaignBlogsHref}
          className="text-xs text-[var(--org-text-muted,var(--color-pib-text-muted))] hover:text-[var(--org-text,var(--color-pib-text))] inline-flex items-center gap-1"
        >
          Back to Blog Posts
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p
            className="text-[10px] font-label uppercase tracking-[0.2em]"
            style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}
          >
            Blog Post
            {isPublished ? ' - Published' : isApproved ? ' - Approved' : canReview ? ' - Awaiting Review' : ''}
            {anchoredCount > 0 && (
              <span className="ml-2 normal-case tracking-normal text-on-surface-variant">
                - {anchoredCount} inline comment{anchoredCount === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </div>
      </header>

      {canReview && (
        <div
          className="pib-card p-4 text-xs leading-relaxed"
          style={{
            borderColor: 'var(--org-accent, var(--color-pib-accent))',
            background: 'rgba(245,166,35,0.06)',
          }}
        >
          Highlight any text to leave inline feedback, click an image to comment on it, or approve the post when it is ready.
        </div>
      )}

      {actionError && (
        <div className="pib-card p-4 text-sm text-red-300">
          {actionError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start relative">
        <div ref={bodyRef} className="relative w-full overflow-hidden">
          {canReview && (
            <SelectionPopover
              containerRef={bodyRef}
              onComment={(text) => setComposerAnchor({ kind: 'text', text })}
            />
          )}
          <BlogReaderCard blog={previewBlog} />
        </div>

        <aside className="lg:sticky lg:top-6 space-y-3">
          <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">
            Comments ({comments.length})
          </p>
          <CommentList comments={comments} onScrollToAnchor={scrollToAnchor} />
          <button
            type="button"
            onClick={() => setComposerAnchor({ kind: 'general' })}
            disabled={!canReview}
            className="w-full text-xs font-label px-3 py-2 rounded-md border border-[var(--org-border,var(--color-pib-line))] hover:bg-[var(--color-surface)] transition-colors disabled:opacity-50"
          >
            Add general comment
          </button>
        </aside>
      </div>

      {canReview && (
        <section className="pib-card sticky bottom-4 p-5 flex flex-col gap-3 backdrop-blur-md">
          <div>
            <p className="text-sm font-headline font-semibold">Ready to approve?</p>
            <p className="text-xs text-on-surface-variant">
              {comments.length === 0
                ? 'Approve this post for publishing, or leave feedback for the writer.'
                : `${comments.length} comment${comments.length === 1 ? '' : 's'} recorded. Approve anyway if the post is ready.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={approve}
              disabled={!!busy}
              className="text-sm font-label px-5 py-2 rounded-md transition-opacity disabled:opacity-50"
              style={{
                background: 'var(--org-accent, var(--color-pib-accent))',
                color: '#000',
              }}
            >
              {busy === 'approve' ? 'Approving...' : 'Approve this post'}
            </button>
          </div>
        </section>
      )}

      {!canReview && isApproved && (
        <section className="pib-card p-5 text-sm text-emerald-300">
          This blog post is approved and waiting for publishing.
        </section>
      )}

      {composerAnchor && (
        <CommentComposer
          anchor={composerAnchor}
          busy={busy === 'comment'}
          onCancel={() => setComposerAnchor(null)}
          onSubmit={(text) => postComment(text, composerAnchor)}
        />
      )}
    </div>
  )
}
