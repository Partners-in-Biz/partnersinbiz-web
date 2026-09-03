'use client'

import { Icon } from '@/components/studio'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { useOrg } from '@/lib/contexts/OrgContext'

function ignoreBestEffortFailure() {
  return undefined
}

type SocialPlatform = 'twitter' | 'x' | 'linkedin' | 'facebook' | 'instagram' | 'reddit' | 'tiktok' | 'pinterest' | 'bluesky' | 'threads'
type SocialPostStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'published' | 'failed' | 'cancelled'
type SocialPostCategory = 'work' | 'personal' | 'ai' | 'sport' | 'sa' | 'other'

const CATEGORIES: SocialPostCategory[] = ['work', 'personal', 'ai', 'sport', 'sa', 'other']

const PLATFORM_COLORS: Record<string, { bg: string; label: string }> = {
  twitter: { bg: 'bg-black', label: 'X' },
  x: { bg: 'bg-black', label: 'X' },
  linkedin: { bg: 'bg-blue-700', label: 'LI' },
  facebook: { bg: 'bg-blue-600', label: 'FB' },
  instagram: { bg: 'bg-pink-600', label: 'IG' },
  reddit: { bg: 'bg-orange-600', label: 'RD' },
  tiktok: { bg: 'bg-gray-800', label: 'TT' },
  pinterest: { bg: 'bg-red-700', label: 'PI' },
  bluesky: { bg: 'bg-sky-500', label: 'BS' },
  threads: { bg: 'bg-gray-700', label: 'TH' },
}

const FILTER_PLATFORMS: { value: string; label: string }[] = [
  { value: 'all', label: 'All Platforms' },
  { value: 'twitter', label: 'X' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'bluesky', label: 'Bluesky' },
  { value: 'threads', label: 'Threads' },
]

interface SocialPost {
  id: string
  // Legacy: single platform string. New: platforms array
  platform?: SocialPlatform
  platforms?: SocialPlatform[]
  accountIds?: string[]
  // Legacy: content as string. New: content as { text, platformOverrides? }
  content: string | { text: string; platformOverrides?: Record<string, string> }
  threadParts?: string[]
  scheduledFor: any
  status: SocialPostStatus
  publishedAt: any | null
  externalId: string | null
  error: string | null
  category: SocialPostCategory
  tags: string[]
  createdBy: string
  createdAt: any
  updatedAt: any
  // Queue / retry fields
  retryCount?: number
  nextRetryAt?: any
}

function getPostText(post: any): string {
  if (typeof post.content === 'string') return post.content
  if (post.content?.text) return post.content.text
  return ''
}

function getPostPlatforms(post: any): string[] {
  if (post.platforms?.length) return post.platforms
  if (post.platform) return [post.platform]
  return []
}

function tsToDate(ts: any): Date | null {
  if (!ts) return null
  if (ts._seconds) return new Date(ts._seconds * 1000)   // Firestore REST serialization
  if (ts.seconds) return new Date(ts.seconds * 1000)     // Firestore SDK serialization
  return new Date(ts)
}

function fmtDateTime(ts: any) {
  const d = tsToDate(ts)
  return d ? d.toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ' - '
}

function StatusBadge({ status }: { status: SocialPostStatus }) {
  const styles: Record<SocialPostStatus, string> = {
    scheduled: 'pib-pill-blue',
    published: 'pib-pill-success',
    failed: 'pib-pill-danger',
    draft: '',
    pending_approval: 'pib-pill-warn',
    approved: 'pib-pill-cyan',
    cancelled: 'line-through opacity-60',
  }
  const displayLabel = status === 'pending_approval' ? 'Needs Approval' : status === 'approved' ? 'Approved' : status
  return (
    <span className={`pib-pill capitalize ${styles[status]}`}>
      {displayLabel}
    </span>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  const config = PLATFORM_COLORS[platform] ?? { bg: 'bg-[var(--color-pib-line-strong)]', label: platform.slice(0, 2).toUpperCase() }
  return (
    <span className={`${config.bg} text-white text-[10px] px-2 py-0.5 rounded `}>
      {config.label}
    </span>
  )
}

function RetryInfo({ post }: { post: SocialPost }) {
  if (post.status !== 'failed') return null
  const parts: string[] = []
  if (typeof post.retryCount === 'number' && post.retryCount > 0) {
    parts.push(`${post.retryCount} retries`)
  }
  if (post.nextRetryAt) {
    parts.push(`next: ${fmtDateTime(post.nextRetryAt)}`)
  }
  if (parts.length === 0) return null
  return (
    <span className="text-[9px] text-[var(--color-error)]/70">{parts.join(' · ')}</span>
  )
}

interface EditPanelProps {
  post: SocialPost
  onClose: () => void
  onSaved: () => void
}

function EditPanel({ post, onClose, onSaved }: EditPanelProps) {
  const { orgId } = useOrg()
  const [content, setContent] = useState(getPostText(post))
  const [scheduledFor, setScheduledFor] = useState(() => {
    const d = tsToDate(post.scheduledFor)
    return d ? d.toISOString().slice(0, 16) : ''
  })
  const [category, setCategory] = useState<SocialPostCategory>(post.category)
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>(post.tags ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const val = tagInput.trim().replace(/^,|,$/g, '')
      if (val && !tags.includes(val)) setTags((prev) => [...prev, val])
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag))

  const handleSave = async () => {
    if (!content.trim()) { setError('Content cannot be empty.'); return }
    setSaving(true)
    try {
      // Send content in the format the post originally used
      const body: any = {
        content: typeof post.content === 'string' ? content : { text: content },
        category,
        tags,
      }
      if (scheduledFor) body.scheduledFor = new Date(scheduledFor).toISOString()
      const res = await fetch(`/api/v1/social/posts/${post.id}${orgId ? `?orgId=${orgId}` : ''}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      onSaved()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const platforms = getPostPlatforms(post)

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-50 w-96 h-full bg-[var(--color-pib-bg)] border-l border-[var(--color-pib-line)] flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-pib-line)]">
          <div className="flex items-center gap-2">
            <h2 className="text-sm text-[var(--color-pib-text)]">Edit Post</h2>
            <div className="flex gap-1">
              {platforms.map((p) => (
                <PlatformBadge key={p} platform={p} />
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>

        <div className="p-5 space-y-5 flex-1">
          {error && (
            <div className="rounded-lg border border-[var(--color-error)]/40 px-3 py-2 text-xs text-[var(--color-error)]">{error}</div>
          )}

          <div>
            <label className="pib-label block mb-2">Content</label>
            <textarea
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="pib-textarea w-full resize-none"
             aria-label="Input"/>
          </div>

          <div>
            <label className="pib-label block mb-2">Schedule For</label>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="pib-input w-full"
             aria-label="Date and time"/>
          </div>

          <div>
            <label className="pib-label block mb-2">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as SocialPostCategory)}
              className="pib-select w-full capitalize"
             aria-label="Input">
              {CATEGORIES.map((c) => (
                <option key={c} value={c} className="capitalize">{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="pib-label block mb-2">Tags</label>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="Type tag + Enter…"
              className="pib-input w-full"
             aria-label="Type tag + Enter…"/>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="pib-pill flex items-center gap-1"
                  >
                    {tag}
                    <button onClick={() => removeTag(tag)} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[var(--color-pib-line)] flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-pib-primary disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            onClick={onClose}
            className="btn-pib-ghost"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export default function QueuePage() {
  const { orgId } = useOrg()
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'pending_approval' | 'scheduled' | 'failed'>('all')
  const [editPost, setEditPost] = useState<SocialPost | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [approving, setApproving] = useState<string | null>(null)

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/social/posts?limit=200${orgId ? `&orgId=${orgId}` : ''}`)
      const body = await res.json()
      setPosts(body.data ?? [])
    } catch {
      setPosts([])
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchPosts()
  }, [fetchPosts])

  const filtered = posts.filter((p) => {
    // Default: show draft + scheduled + pending_approval + failed
    if (statusFilter === 'all') {
      if (!['draft', 'scheduled', 'pending_approval', 'failed'].includes(p.status)) return false
    } else {
      if (p.status !== statusFilter) return false
    }
    if (platformFilter !== 'all') {
      const postPlatforms = getPostPlatforms(p)
      // Treat 'twitter' filter as matching both 'twitter' and 'x'
      const matchPlatforms = platformFilter === 'twitter' ? ['twitter', 'x'] : [platformFilter]
      if (!postPlatforms.some((pp) => matchPlatforms.includes(pp))) return false
    }
    return true
  })

  const handlePublish = async (post: SocialPost) => {
    setPublishing(post.id)
    // Optimistic update
    setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, status: 'published' } : p))
    try {
      await fetch(`/api/v1/social/posts/${post.id}/publish${orgId ? `?orgId=${orgId}` : ''}`, { method: 'POST' })
    } catch { ignoreBestEffortFailure() } finally {
      setPublishing(null)
      fetchPosts()
    }
  }

  const handleCancel = async (post: SocialPost) => {
    setCancelling(post.id)
    // Optimistic update
    setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, status: 'cancelled' } : p))
    try {
      await fetch(`/api/v1/social/posts/${post.id}${orgId ? `?orgId=${orgId}` : ''}`, { method: 'DELETE' })
    } catch { ignoreBestEffortFailure() } finally {
      setCancelling(null)
      fetchPosts()
    }
  }

  const handleApprove = async (post: SocialPost) => {
    setApproving(post.id)
    // Optimistic update
    setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, status: 'approved' } : p))
    try {
      await fetch(`/api/v1/social/posts/${post.id}/approve${orgId ? `?orgId=${orgId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
    } catch { ignoreBestEffortFailure() } finally {
      setApproving(null)
      fetchPosts()
    }
  }

  const handleRejectApproval = async (post: SocialPost) => {
    setApproving(post.id)
    // Optimistic update
    setPosts((prev) => prev.map((p) => p.id === post.id ? { ...p, status: 'draft' } : p))
    try {
      await fetch(`/api/v1/social/posts/${post.id}/approve${orgId ? `?orgId=${orgId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject' }),
      })
    } catch { ignoreBestEffortFailure() } finally {
      setApproving(null)
      fetchPosts()
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {editPost && (
        <EditPanel
          post={editPost}
          onClose={() => setEditPost(null)}
          onSaved={() => { setEditPost(null); fetchPosts() }}
        />
      )}

      <header>
        <p className="sc-tiny">Social · Queue</p>
        <h1 className="pib-page-title mt-2">Post Queue</h1>
        <p className="pib-page-sub">Manage drafts, scheduled, and failed posts</p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="pib-tabs pib-tabs-segmented flex-wrap">
          {FILTER_PLATFORMS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPlatformFilter(p.value)}
              className={`pib-tab ${platformFilter === p.value ? 'pib-tab-active' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="pib-tabs pib-tabs-segmented">
          {(['all', 'draft', 'pending_approval', 'scheduled', 'failed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`pib-tab capitalize ${statusFilter === s ? 'pib-tab-active' : ''}`}
            >
              {s === 'all' ? 'All' : s === 'pending_approval' ? 'Needs Approval' : s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="pib-skeleton h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="pending_actions" />
          <h2 className="pib-empty-state-title">No posts found.</h2>
        </div>
      ) : (
        <div className="pib-surface pib-surface-table overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[90px_1fr_90px_120px_80px_120px_160px] gap-3 px-4 py-2.5 border-b border-[var(--color-pib-line)]">
            {['Platforms', 'Content', 'Category', 'Scheduled For', 'Status', 'Tags', 'Actions'].map((h) => (
              <span key={h} className="pib-label">{h}</span>
            ))}
          </div>
          {/* Rows */}
          {filtered.map((post, i) => {
            const text = getPostText(post)
            const platforms = getPostPlatforms(post)
            return (
              <div
                key={post.id}
                className={`grid grid-cols-[90px_1fr_90px_120px_80px_120px_160px] gap-3 px-4 py-3 items-center hover:bg-[var(--color-row-hover)] ${i > 0 ? 'border-t border-[var(--color-pib-line)]' : ''}`}
              >
                <div className="flex flex-wrap gap-1">
                  {platforms.map((p) => (
                    <PlatformBadge key={p} platform={p} />
                  ))}
                </div>
                <p className="text-sm text-[var(--color-pib-text)] truncate min-w-0">
                  {text.slice(0, 60)}{text.length > 60 ? '…' : ''}
                </p>
                <span className="text-xs text-[var(--color-pib-text-muted)] capitalize">{post.category}</span>
                <span className="text-xs text-[var(--color-pib-text-muted)]">{fmtDateTime(post.scheduledFor)}</span>
                <div className="flex flex-col gap-0.5">
                  <StatusBadge status={post.status} />
                  <RetryInfo post={post} />
                </div>
                <div className="flex flex-wrap gap-1 min-w-0">
                  {(post.tags ?? []).slice(0, 2).map((t) => (
                    <span key={t} className="pib-pill">{t}</span>
                  ))}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {post.status === 'pending_approval' ? (
                    <>
                      <button
                        onClick={() => handleApprove(post)}
                        disabled={approving === post.id}
                        className="btn-pib-primary text-[10px] disabled:opacity-50"
                      >
                        {approving === post.id ? 'Approving…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleRejectApproval(post)}
                        disabled={approving === post.id}
                        className="btn-pib-ghost text-[10px] text-[var(--color-error)] disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handlePublish(post)}
                        disabled={publishing === post.id}
                        className="btn-pib-primary text-[10px] disabled:opacity-50"
                      >
                        Publish
                      </button>
                      <button
                        onClick={() => setEditPost(post)}
                        className="btn-pib-secondary text-[10px]"
                      >
                        Edit
                      </button>
                      {['draft', 'scheduled'].includes(post.status) && (
                        <button
                          onClick={() => handleCancel(post)}
                          disabled={cancelling === post.id}
                          className="btn-pib-ghost text-[10px] text-[var(--color-error)] disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
