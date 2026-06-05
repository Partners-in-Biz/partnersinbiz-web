'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { OrgThemedFrame, useOrgBrand } from '@/components/admin/OrgThemedFrame'
import {
  CampaignBlogDetailWorkspace,
  type CampaignBlogCommentAnchor,
  type CampaignBlogDetailComment,
  type CampaignBlogDetailRecord,
} from '@/components/campaign-blog-detail/CampaignBlogDetailWorkspace'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function commentPayload(text: string, anchor: CampaignBlogCommentAnchor): AnyObj {
  const payload: AnyObj = { text: text.trim() }

  if (anchor.kind === 'text') {
    payload.anchor = { type: 'text', text: anchor.text }
    if (typeof anchor.offset === 'number') payload.anchor.offset = anchor.offset
  }

  if (anchor.kind === 'image') {
    payload.anchor = { type: 'image', mediaUrl: anchor.mediaUrl }
  }

  return payload
}

export default function BlogDetailPage() {
  const params = useParams()
  const slug = paramValue(params?.slug)
  const id = paramValue(params?.id)
  const blogId = paramValue(params?.blogId)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then(response => response.json())
      .then(body => {
        const org = (body.data ?? []).find((item: AnyObj) => item.slug === slug)
        if (org) {
          setOrgId(org.id)
          setOrgName(org.name)
        }
      })
      .catch(() => {})
  }, [slug])

  return (
    <OrgThemedFrame orgId={orgId} className="-m-6 p-6 min-h-screen">
      <Detail slug={slug} id={id} blogId={blogId} orgName={orgName} />
    </OrgThemedFrame>
  )
}

function Detail({
  slug,
  id,
  blogId,
  orgName,
}: {
  slug: string
  id: string
  blogId: string
  orgName: string
}) {
  const router = useRouter()
  const { brand } = useOrgBrand()
  const [blog, setBlog] = useState<CampaignBlogDetailRecord | null>(null)
  const [comments, setComments] = useState<CampaignBlogDetailComment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<null | 'approve' | 'comment' | 'save'>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/v1/campaigns/${id}/assets`).then(response => response.json()),
      fetch(`/api/v1/seo/content/${blogId}/comments`).then(response => response.json()),
    ])
      .then(([assetsBody, commentsBody]) => {
        const blogs = (assetsBody.data?.blogs ?? []) as CampaignBlogDetailRecord[]
        setBlog(blogs.find(item => item.id === blogId) ?? null)
        setComments((commentsBody.data ?? []) as CampaignBlogDetailComment[])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id, blogId])

  async function refreshComments() {
    const refreshed = await fetch(`/api/v1/seo/content/${blogId}/comments`).then(response => response.json())
    setComments((refreshed.data ?? []) as CampaignBlogDetailComment[])
  }

  async function postComment(text: string, anchor: CampaignBlogCommentAnchor) {
    if (!text.trim() || busy) return
    setBusy('comment')
    try {
      const response = await fetch(`/api/v1/seo/content/${blogId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(commentPayload(text, anchor)),
      })

      if (!response.ok) throw new Error('comment failed')
      await refreshComments()
    } finally {
      setBusy(null)
    }
  }

  async function approve(publishDate?: string) {
    if (busy) return
    setBusy('approve')
    try {
      const response = await fetch(`/api/v1/seo/content/${blogId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(publishDate ? { publishDate } : {}),
      })

      if (!response.ok) throw new Error('publish failed')
      router.refresh()
      router.push(`/admin/org/${slug}/social/${id}?tab=blogs`)
    } finally {
      setBusy(null)
    }
  }

  async function saveBody(markdown: string) {
    if (busy) return

    const draftId = blog?.draftPostId
    if (!draftId) return

    setBusy('save')
    try {
      const response = await fetch(`/api/v1/seo/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: markdown }),
      })

      if (!response.ok) throw new Error('save failed')

      const assetsBody = await fetch(`/api/v1/campaigns/${id}/assets`).then(result => result.json())
      const blogs = (assetsBody.data?.blogs ?? []) as CampaignBlogDetailRecord[]
      setBlog(blogs.find(item => item.id === blogId) ?? null)
    } finally {
      setBusy(null)
    }
  }

  const status = (blog?.status ?? '').toString()
  const isPublished = status === 'live' || status === 'published'
  const scheduledForFuture = (publishDate: string) => publishDate.length > 0 && publishDate > todayIsoDate()

  return (
    <CampaignBlogDetailWorkspace
      loading={loading}
      blog={blog}
      comments={comments}
      brand={brand}
      backHref={`/admin/org/${slug}/social/${id}?tab=blogs`}
      backLabel={orgName ? `${orgName} - Blog Posts` : 'Blog Posts'}
      statusLabel={isPublished ? 'Published' : 'Awaiting Review'}
      canComment={!isPublished}
      helper={
        !isPublished ? (
          <p>
            <strong>Highlight any text</strong> to leave an inline comment,{' '}
            <strong>click an image</strong> to comment on it, or{' '}
            <strong>click &quot;Edit body&quot;</strong> to make changes yourself. Agents and the writer see
            exactly what you flagged or changed.
          </p>
        ) : null
      }
      canEdit={!isPublished && !!blog?.draftPostId}
      editLabel="Edit body"
      saveBusy={busy === 'save'}
      onSaveBody={saveBody}
      onComment={postComment}
      commentBusy={busy === 'comment'}
      approval={{
        visible: !isPublished,
        title: 'Ready to ship?',
        noCommentsCopy: 'Approve to publish, or highlight text / click an image to leave inline feedback.',
        commentsCopy: count =>
          `${count} comment${count === 1 ? '' : 's'} pending. Approve to publish anyway, or wait for the writer to address them.`,
        busy: busy === 'approve',
        buttonLabel: publishDate =>
          scheduledForFuture(publishDate) ? `Schedule for ${publishDate}` : 'Approve & publish',
        busyLabel: publishDate => (scheduledForFuture(publishDate) ? 'Scheduling...' : 'Publishing...'),
        publishDate: {
          label: 'Publish date',
          hint: '(leave blank = publish now)',
        },
        onApprove: approve,
      }}
    />
  )
}
