'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { OrgThemedFrame, useOrgBrand } from '@/components/admin/OrgThemedFrame'
import { CampaignBlogDetailWorkspace } from '@/components/campaign-blog-detail/CampaignBlogDetailWorkspace'
import { useCampaignBlogDetail } from '@/components/campaign-blog-detail/useCampaignBlogDetail'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function paramValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
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
  const [actionBusy, setActionBusy] = useState<null | 'approve' | 'save'>(null)
  const {
    blog,
    comments,
    loading,
    loadError,
    actionError,
    busy: commentBusy,
    refreshBlog,
    postComment,
  } = useCampaignBlogDetail({
    campaignId: id,
    blogId,
    assetsEndpoint: `/api/v1/campaigns/${id}/assets`,
    commentsEndpoint: `/api/v1/seo/content/${blogId}/comments`,
  })

  async function approve(publishDate?: string) {
    if (actionBusy) return
    setActionBusy('approve')
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
      setActionBusy(null)
    }
  }

  async function saveBody(markdown: string) {
    if (actionBusy) return

    const draftId = blog?.draftPostId
    if (!draftId) return

    setActionBusy('save')
    try {
      const response = await fetch(`/api/v1/seo/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: markdown }),
      })

      if (!response.ok) throw new Error('save failed')

      await refreshBlog()
    } finally {
      setActionBusy(null)
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
      loadError={loadError}
      actionError={actionError}
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
      saveBusy={actionBusy === 'save'}
      onSaveBody={saveBody}
      onComment={postComment}
      commentBusy={commentBusy === 'comment'}
      approval={{
        visible: !isPublished,
        title: 'Ready to ship?',
        noCommentsCopy: 'Approve to publish, or highlight text / click an image to leave inline feedback.',
        commentsCopy: count =>
          `${count} comment${count === 1 ? '' : 's'} pending. Approve to publish anyway, or wait for the writer to address them.`,
        busy: actionBusy === 'approve',
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
