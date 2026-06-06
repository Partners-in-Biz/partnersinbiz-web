'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  CampaignBlogCommentAnchor,
  CampaignBlogDetailComment,
  CampaignBlogDetailRecord,
} from '@/components/campaign-blog-detail/CampaignBlogDetailWorkspace'

type CommentResponseBody = {
  data?: {
    statusFlipped?: boolean
    [key: string]: unknown
  }
  error?: string
}

interface UseCampaignBlogDetailOptions {
  campaignId: string
  blogId: string
  assetsEndpoint: string
  commentsEndpoint: string
  notFoundMessage?: string
  assetsErrorMessage?: string
  commentsErrorMessage?: string
  loadErrorMessage?: string
  commentErrorMessage?: string
  onCommentPosted?: (body: CommentResponseBody) => void
}

function errorFromBody(body: unknown, fallback: string): string {
  return typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
    ? body.error
    : fallback
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}))
}

export function campaignBlogCommentPayload(text: string, anchor: CampaignBlogCommentAnchor) {
  const payload: {
    text: string
    anchor?: { type: 'text'; text: string; offset?: number } | { type: 'image'; mediaUrl: string }
  } = { text: text.trim() }

  if (anchor.kind === 'text') {
    payload.anchor = { type: 'text', text: anchor.text }
    if (typeof anchor.offset === 'number') payload.anchor.offset = anchor.offset
  }

  if (anchor.kind === 'image') {
    payload.anchor = { type: 'image', mediaUrl: anchor.mediaUrl }
  }

  return payload
}

export function useCampaignBlogDetail({
  campaignId,
  blogId,
  assetsEndpoint,
  commentsEndpoint,
  notFoundMessage = 'Blog post not found.',
  assetsErrorMessage = 'Campaign assets could not load.',
  commentsErrorMessage = 'Comments could not load.',
  loadErrorMessage = 'Blog post could not load.',
  commentErrorMessage = 'Comment could not be sent.',
  onCommentPosted,
}: UseCampaignBlogDetailOptions) {
  const [blog, setBlog] = useState<CampaignBlogDetailRecord | null>(null)
  const [comments, setComments] = useState<CampaignBlogDetailComment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'comment'>(null)

  const refreshComments = useCallback(async () => {
    const response = await fetch(commentsEndpoint)
    const body = await readJson(response)
    if (!response.ok) throw new Error(errorFromBody(body, commentsErrorMessage))
    const data = typeof body === 'object' && body !== null && 'data' in body ? body.data : []
    setComments(Array.isArray(data) ? data : [])
  }, [commentsEndpoint, commentsErrorMessage])

  const refreshBlog = useCallback(async () => {
    const response = await fetch(assetsEndpoint)
    const body = await readJson(response)
    if (!response.ok) throw new Error(errorFromBody(body, assetsErrorMessage))

    const blogs =
      typeof body === 'object' && body !== null && 'data' in body
        ? ((body.data as { blogs?: CampaignBlogDetailRecord[] } | undefined)?.blogs ?? [])
        : []
    setBlog(blogs.find((item) => item.id === blogId) ?? null)
  }, [assetsEndpoint, assetsErrorMessage, blogId])

  useEffect(() => {
    if (!campaignId || !blogId) {
      setLoading(false)
      setLoadError(notFoundMessage)
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setActionError(null)

    Promise.all([
      fetch(assetsEndpoint).then(async (response) => {
        const body = await readJson(response)
        if (!response.ok) throw new Error(errorFromBody(body, assetsErrorMessage))
        return body
      }),
      fetch(commentsEndpoint).then(async (response) => {
        const body = await readJson(response)
        if (!response.ok) throw new Error(errorFromBody(body, commentsErrorMessage))
        return body
      }),
    ])
      .then(([assetsBody, commentsBody]) => {
        if (cancelled) return

        const blogs =
          typeof assetsBody === 'object' && assetsBody !== null && 'data' in assetsBody
            ? ((assetsBody.data as { blogs?: CampaignBlogDetailRecord[] } | undefined)?.blogs ?? [])
            : []
        const nextComments =
          typeof commentsBody === 'object' && commentsBody !== null && 'data' in commentsBody
            ? commentsBody.data
            : []

        setBlog(blogs.find((item) => item.id === blogId) ?? null)
        setComments(Array.isArray(nextComments) ? nextComments : [])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : loadErrorMessage)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    assetsEndpoint,
    assetsErrorMessage,
    blogId,
    campaignId,
    commentsEndpoint,
    commentsErrorMessage,
    loadErrorMessage,
    notFoundMessage,
  ])

  const postComment = useCallback(
    async (text: string, anchor: CampaignBlogCommentAnchor) => {
      if (!text.trim() || busy) return

      setBusy('comment')
      setActionError(null)
      try {
        const response = await fetch(commentsEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(campaignBlogCommentPayload(text, anchor)),
        })
        const body = (await readJson(response)) as CommentResponseBody

        if (!response.ok) throw new Error(errorFromBody(body, commentErrorMessage))

        onCommentPosted?.(body)
        await refreshComments()
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : commentErrorMessage)
        throw err
      } finally {
        setBusy(null)
      }
    },
    [busy, commentErrorMessage, commentsEndpoint, onCommentPosted, refreshComments],
  )

  return {
    blog,
    setBlog,
    comments,
    loading,
    loadError,
    actionError,
    busy,
    refreshBlog,
    refreshComments,
    postComment,
  }
}
