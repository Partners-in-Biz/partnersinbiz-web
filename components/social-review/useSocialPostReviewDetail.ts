'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  SocialPostReviewComment,
  SocialPostReviewPost,
} from '@/components/social-review/SocialPostReviewWorkspace'

type ReviewNotice = {
  type: 'success' | 'error' | 'info'
  text: string
}

export type SocialPostReviewBusyKey = 'approve' | 'reject' | 'comment' | 'manual'

type ReviewActionConfig = {
  busyKey: SocialPostReviewBusyKey
  path: string
  payload?: unknown
  successText?: string
  errorText: string
  onSuccess?: (body: unknown) => Promise<void> | void
}

type UseSocialPostReviewDetailOptions = {
  id: string
  postPath: string
  commentsPath: string
}

function bodyError(body: unknown): string | undefined {
  return typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
    ? body.error
    : undefined
}

function bodyData<T>(body: unknown): T | undefined {
  return typeof body === 'object' && body !== null && 'data' in body ? (body.data as T) : undefined
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}))
}

export function useSocialPostReviewDetail({ id, postPath, commentsPath }: UseSocialPostReviewDetailOptions) {
  const [post, setPost] = useState<SocialPostReviewPost | null>(null)
  const [comments, setComments] = useState<SocialPostReviewComment[]>([])
  const [loading, setLoading] = useState(true)
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<ReviewNotice | null>(null)
  const [busy, setBusy] = useState<SocialPostReviewBusyKey | null>(null)

  const showNotice = useCallback((next: ReviewNotice) => {
    setNotice(next)
    window.setTimeout(() => setNotice((current) => (current === next ? null : current)), 3500)
  }, [])

  const loadPost = useCallback(async () => {
    if (!id || !postPath) {
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetch(postPath)
      const body = await readJson(response)
      const error = bodyError(body)
      if (!response.ok || error) throw new Error(error ?? 'Failed to load post')

      const nextPost = bodyData<SocialPostReviewPost>(body) ?? (body as SocialPostReviewPost)
      setPost(nextPost ?? null)
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load post')
    } finally {
      setLoading(false)
    }
  }, [id, postPath])

  const loadComments = useCallback(async () => {
    if (!id || !commentsPath) {
      setCommentsLoading(false)
      return
    }

    setCommentsLoading(true)
    try {
      const response = await fetch(commentsPath)
      const body = await readJson(response)
      if (!response.ok) throw new Error(bodyError(body) ?? 'Failed to load comments')

      const nextComments = bodyData<SocialPostReviewComment[]>(body) ?? body
      setComments(Array.isArray(nextComments) ? nextComments : [])
    } catch {
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }, [id, commentsPath])

  const load = useCallback(async () => {
    await Promise.all([loadPost(), loadComments()])
  }, [loadComments, loadPost])

  useEffect(() => {
    load()
  }, [load])

  const runReviewAction = useCallback(
    async ({ busyKey, path, payload = {}, successText, errorText, onSuccess }: ReviewActionConfig) => {
      if (!id || !path || busy) return false

      setBusy(busyKey)
      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await readJson(response)
        if (!response.ok) throw new Error(bodyError(body) ?? errorText)

        if (successText) showNotice({ type: 'success', text: successText })
        await onSuccess?.(body)
        return true
      } catch (err: unknown) {
        showNotice({ type: 'error', text: err instanceof Error ? err.message : errorText })
        return false
      } finally {
        setBusy(null)
      }
    },
    [busy, id, showNotice],
  )

  const appendCommentFromBody = useCallback((body: unknown) => {
    const comment = bodyData<SocialPostReviewComment>(body)
    if (comment) setComments((current) => [...current, comment])
  }, [])

  return {
    post,
    comments,
    loading,
    commentsLoading,
    loadError,
    notice,
    busy,
    loadPost,
    loadComments,
    load,
    runReviewAction,
    appendCommentFromBody,
  }
}
