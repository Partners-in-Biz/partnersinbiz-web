'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { BlogEditor } from '@/components/blog-editor/BlogEditor'
import { BlogReaderCard } from '@/components/campaign-preview'
import type { PreviewBlog, PreviewBrand } from '@/components/campaign-preview/types'
import {
  CommentComposer,
  CommentList,
  SelectionPopover,
  type AnchorTarget,
  type InlineComment,
} from '@/components/inline-comments'

export type CampaignBlogCommentAnchor = AnchorTarget
export type CampaignBlogDetailComment = InlineComment

export interface CampaignBlogDetailRecord {
  id: string
  title?: string
  type?: string
  publishDate?: string
  targetUrl?: string
  status?: string
  draftPostId?: string
  draft?: {
    body?: string
    metaDescription?: string
    wordCount?: number
  }
  heroImageUrl?: string
  authorName?: string
  authorAvatarUrl?: string
  readTimeMinutes?: number
}

type LabelResolver = string | ((publishDate: string) => string)

interface PublishDateConfig {
  label?: string
  hint?: string
  min?: string
}

interface ApprovalConfig {
  visible?: boolean
  title: string
  noCommentsCopy: string
  commentsCopy: (count: number) => string
  buttonLabel: LabelResolver
  busyLabel?: LabelResolver
  busy?: boolean
  disabled?: boolean
  publishDate?: PublishDateConfig
  onApprove: (publishDate?: string) => Promise<void> | void
}

interface CampaignBlogDetailWorkspaceProps {
  loading: boolean
  blog: CampaignBlogDetailRecord | null
  comments: CampaignBlogDetailComment[]
  backHref: string
  backLabel?: string
  brand?: PreviewBrand
  statusLabel?: string
  loadError?: string | null
  actionError?: string | null
  canComment: boolean
  helper?: ReactNode
  canEdit?: boolean
  editLabel?: string
  saveBusy?: boolean
  onSaveBody?: (markdown: string) => Promise<void> | void
  onComment: (text: string, anchor: CampaignBlogCommentAnchor) => Promise<void> | void
  commentBusy?: boolean
  approval?: ApprovalConfig
  approvedMessage?: string | null
}

function toPreviewBlog(blog: CampaignBlogDetailRecord): PreviewBlog {
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

function resolveLabel(label: LabelResolver | undefined, publishDate: string, fallback: string): string {
  if (!label) return fallback
  return typeof label === 'function' ? label(publishDate) : label
}

export function CampaignBlogDetailWorkspace({
  loading,
  blog,
  comments,
  backHref,
  backLabel = 'Blog Posts',
  brand,
  statusLabel,
  loadError,
  actionError,
  canComment,
  helper,
  canEdit = false,
  editLabel = 'Edit body',
  saveBusy = false,
  onSaveBody,
  onComment,
  commentBusy = false,
  approval,
  approvedMessage,
}: CampaignBlogDetailWorkspaceProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [composerAnchor, setComposerAnchor] = useState<CampaignBlogCommentAnchor | null>(null)
  const [editing, setEditing] = useState(false)
  const [publishDate, setPublishDate] = useState('')

  const previewBlog = useMemo(() => (blog ? toPreviewBlog(blog) : null), [blog])
  const anchoredCount = comments.filter(comment => !!comment.anchor).length
  const approvalVisible = approval?.visible ?? !!approval
  const publishDateMin = approval?.publishDate?.min ?? new Date().toISOString().slice(0, 10)

  useEffect(() => {
    const root = bodyRef.current
    if (!root || !canComment || editing) return
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target?.tagName !== 'IMG') return

      const image = target as HTMLImageElement
      if (!image.src) return

      event.preventDefault()
      setComposerAnchor({ kind: 'image', mediaUrl: image.src })
    }

    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [canComment, editing, previewBlog])

  useEffect(() => {
    const root = bodyRef.current
    if (!root || !canComment || editing) return

    const images = root.querySelectorAll('img')
    images.forEach(image => {
      image.style.cursor = 'pointer'
      image.title = 'Click to comment on this image'
    })
  }, [canComment, editing, previewBlog])

  function scrollToAnchor(comment: CampaignBlogDetailComment) {
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
      const target = Array.from(images).find(image => image.src === imageUrl)

      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.style.outline = '3px solid var(--org-accent, var(--color-pib-accent))'
        window.setTimeout(() => {
          target.style.outline = ''
        }, 1800)
      }
    }
  }

  async function submitComment(text: string, anchor: CampaignBlogCommentAnchor) {
    await onComment(text, anchor)
    setComposerAnchor(null)
  }

  async function saveBody(markdown: string) {
    if (!onSaveBody) return
    await onSaveBody(markdown)
    setEditing(false)
  }

  if (loading) {
    return <div className="pib-skeleton h-96 max-w-7xl mx-auto rounded-2xl" />
  }

  if (loadError || !previewBlog) {
    return (
      <div className="pib-card max-w-4xl mx-auto p-10 text-center">
        <p className="text-sm text-on-surface-variant">{loadError ?? 'Blog post not found.'}</p>
        <Link href={backHref} className="text-xs underline mt-2 inline-block">
          Back to {backLabel}
        </Link>
      </div>
    )
  }

  return (
    <div
      className="space-y-8 max-w-7xl mx-auto"
      style={{ color: 'var(--org-text, var(--color-pib-text))' }}
    >
      <header className="space-y-2">
        <Link
          href={backHref}
          className="text-xs text-[var(--org-text-muted,var(--color-pib-text-muted))] hover:text-[var(--org-text,var(--color-pib-text))] inline-flex items-center gap-1"
        >
          Back to {backLabel}
        </Link>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p
            className="text-[10px] font-label uppercase tracking-[0.2em]"
            style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}
          >
            Blog Post{statusLabel ? ` - ${statusLabel}` : ''}
            {anchoredCount > 0 && (
              <span className="ml-2 normal-case tracking-normal text-on-surface-variant">
                - {anchoredCount} inline comment{anchoredCount === 1 ? '' : 's'}
              </span>
            )}
          </p>
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs font-label px-3 py-1.5 rounded-md border border-[var(--org-border,var(--color-pib-line))] hover:bg-[var(--color-surface)] transition-colors"
            >
              {editLabel}
            </button>
          )}
        </div>
      </header>

      {helper && !editing ? (
        <div
          className="pib-card p-4 text-xs leading-relaxed"
          style={{
            borderColor: 'var(--org-accent, var(--color-pib-accent))',
            background: 'rgba(245,166,35,0.06)',
          }}
        >
          {helper}
        </div>
      ) : null}

      {actionError ? (
        <div className="pib-card p-4 text-sm text-red-300">
          {actionError}
        </div>
      ) : null}

      {editing && previewBlog.draft?.body !== undefined && onSaveBody ? (
        <BlogEditor
          initialMarkdown={previewBlog.draft.body ?? ''}
          busy={saveBusy}
          onSave={saveBody}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      {!editing ? (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 items-start relative">
          <div ref={bodyRef} className="relative w-full overflow-hidden">
            {canComment ? (
              <SelectionPopover
                containerRef={bodyRef}
                onComment={text => setComposerAnchor({ kind: 'text', text })}
              />
            ) : null}
            <BlogReaderCard blog={previewBlog} brand={brand} />
          </div>

          <aside className="lg:sticky lg:top-6 space-y-3">
            <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">
              Comments ({comments.length})
            </p>
            <CommentList comments={comments} onScrollToAnchor={scrollToAnchor} />
            <button
              type="button"
              onClick={() => setComposerAnchor({ kind: 'general' })}
              disabled={!canComment}
              className="w-full text-xs font-label px-3 py-2 rounded-md border border-[var(--org-border,var(--color-pib-line))] hover:bg-[var(--color-surface)] transition-colors disabled:opacity-50"
            >
              Add general comment
            </button>
          </aside>
        </div>
      ) : null}

      {approval && approvalVisible ? (
        <section className="pib-card sticky bottom-4 p-5 flex flex-col gap-3 backdrop-blur-md">
          <div>
            <p className="text-sm font-headline font-semibold">{approval.title}</p>
            <p className="text-xs text-on-surface-variant">
              {comments.length === 0 ? approval.noCommentsCopy : approval.commentsCopy(comments.length)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {approval.publishDate ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-on-surface-variant whitespace-nowrap">
                  {approval.publishDate.label ?? 'Publish date'}
                </label>
                <input
                  type="date"
                  value={publishDate}
                  min={publishDateMin}
                  onChange={event => setPublishDate(event.target.value)}
                  className="text-xs rounded-md px-2 py-1.5 bg-surface-container-high text-on-surface border border-[var(--org-border,var(--color-pib-line))] focus:outline-none"
                />
                {approval.publishDate.hint ? (
                  <span className="text-[10px] text-on-surface-variant">{approval.publishDate.hint}</span>
                ) : null}
              </div>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => approval.onApprove(publishDate || undefined)}
              disabled={approval.disabled || approval.busy}
              className="text-sm font-label px-5 py-2 rounded-md transition-opacity disabled:opacity-50"
              style={{
                background: 'var(--org-accent, var(--color-pib-accent))',
                color: '#000',
              }}
            >
              {approval.busy
                ? resolveLabel(approval.busyLabel, publishDate, 'Working...')
                : resolveLabel(approval.buttonLabel, publishDate, 'Approve')}
            </button>
          </div>
        </section>
      ) : null}

      {approvedMessage ? (
        <section className="pib-card p-5 text-sm text-emerald-300">
          {approvedMessage}
        </section>
      ) : null}

      {composerAnchor ? (
        <CommentComposer
          anchor={composerAnchor}
          busy={commentBusy}
          onCancel={() => setComposerAnchor(null)}
          onSubmit={text => submitComment(text, composerAnchor)}
        />
      ) : null}
    </div>
  )
}
