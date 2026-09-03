'use client'

import { Icon } from '@/components/studio'
export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type EngagementType = 'comment' | 'mention' | 'reply' | 'dm' | 'like' | 'share' | 'follow'
type EngagementStatus = 'unread' | 'read' | 'replied' | 'archived'
type SentimentType = 'positive' | 'neutral' | 'negative' | null

interface InboxItem {
  id: string
  orgId: string
  platform: string
  type: EngagementType
  fromUser: {
    name: string
    username: string
    avatarUrl: string
    profileUrl: string
  }
  content: string
  postId: string | null
  platformItemId: string
  platformUrl: string
  status: EngagementStatus
  priority: 'high' | 'normal' | 'low'
  sentiment: SentimentType
  createdAt: any
  updatedAt: any
}

const PLATFORM_COLORS: Record<string, string> = {
  twitter: 'bg-black',
  x: 'bg-black',
  linkedin: 'bg-blue-700',
  facebook: 'bg-blue-600',
  instagram: 'bg-pink-600',
  threads: 'bg-gray-700',
}

const TYPE_LABELS: Record<EngagementType, string> = {
  comment: 'Comment',
  mention: 'Mention',
  reply: 'Reply',
  dm: 'Message',
  like: 'Like',
  share: 'Share',
  follow: 'Follow',
}

const TYPE_ICONS: Record<EngagementType, string> = {
  comment: '💬',
  mention: '@',
  reply: '↩',
  dm: '✉',
  like: '❤',
  share: '⤴',
  follow: '➕',
}

function tsToDate(ts: any): Date | null {
  if (!ts) return null
  if (ts._seconds) return new Date(ts._seconds * 1000)
  if (ts.seconds) return new Date(ts.seconds * 1000)
  return new Date(ts)
}

function timeAgo(ts: any): string {
  const date = tsToDate(ts)
  if (!date) return ' - '

  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString()
}

function PlatformBadge({ platform }: { platform: string }) {
  const color = PLATFORM_COLORS[platform.toLowerCase()] || 'bg-[var(--color-pib-line-strong)]'
  return (
    <div className={`w-3 h-3 rounded ${color}`} title={platform} />
  )
}

function SentimentDot({ sentiment }: { sentiment: SentimentType }) {
  if (!sentiment) return <div className="pib-status-dot" />
  const colors = {
    positive: 'pib-status-dot-success',
    neutral: '',
    negative: 'pib-status-dot-danger',
  }
  return <div className={`pib-status-dot ${colors[sentiment]}`} title={sentiment} />
}

function TypeBadge({ type }: { type: EngagementType }) {
  return (
    <span className="pib-pill pib-pill-rose">
      {TYPE_LABELS[type]}
    </span>
  )
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)
  const [pollMessage, setPollMessage] = useState('')
  const [selectedStatus, setSelectedStatus] = useState<EngagementStatus | null>(null)
  const [selectedType, setSelectedType] = useState<EngagementType | null>(null)
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null)
  const [replyingToId, setReplyingToId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replying, setReplying] = useState(false)

  const fetchInbox = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('limit', '100')
      if (selectedStatus) params.append('status', selectedStatus)
      if (selectedType) params.append('type', selectedType)
      if (selectedPlatform) params.append('platform', selectedPlatform)

      const res = await fetch(`/api/v1/social/inbox?${params.toString()}`)
      const body = await res.json()
      setItems(body.items || [])
    } catch (error) {
      console.error('Error fetching inbox:', error)
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [selectedStatus, selectedType, selectedPlatform])

  const handleRefresh = async () => {
    setPollMessage('')
    setPolling(true)
    try {
      const res = await fetch('/api/v1/social/inbox/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = await res.json()
      if (body.success) {
        setPollMessage(`Fetched ${body.data.newItems} new items from ${body.data.polled} accounts`)
        // Refresh the inbox list
        setTimeout(() => fetchInbox(), 500)
      } else {
        setPollMessage(`Error: ${body.error}`)
      }
    } catch (error) {
      console.error('Error triggering poll:', error)
      setPollMessage(`Error: ${String(error)}`)
    } finally {
      setPolling(false)
      // Clear message after 5 seconds
      setTimeout(() => setPollMessage(''), 5000)
    }
  }

  useEffect(() => {
    fetchInbox()
  }, [fetchInbox])

  const handleMarkRead = async (id: string) => {
    try {
      await fetch(`/api/v1/social/inbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'read' }),
      })
      await fetchInbox()
    } catch (error) {
      console.error('Error marking as read:', error)
    }
  }

  const handleArchive = async (id: string) => {
    try {
      await fetch(`/api/v1/social/inbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      })
      await fetchInbox()
    } catch (error) {
      console.error('Error archiving:', error)
    }
  }

  const handleReply = async (id: string) => {
    const text = replyText.trim()
    if (!text) return
    setReplying(true)
    setPollMessage('')
    try {
      const res = await fetch(`/api/v1/social/inbox/${id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const body = await res.json()
      if (!body.success) {
        setPollMessage(`Error: ${body.error || 'Failed to send reply'}`)
        return
      }
      setPollMessage('Reply posted')
      setReplyingToId(null)
      setReplyText('')
      await fetchInbox()
      setTimeout(() => setPollMessage(''), 5000)
    } catch (error) {
      console.error('Error replying:', error)
      setPollMessage(`Error: ${String(error)}`)
    } finally {
      setReplying(false)
    }
  }

  const handleMarkAllRead = async () => {
    try {
      for (const item of items.filter((i) => i.status === 'unread')) {
        await fetch(`/api/v1/social/inbox/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'read' }),
        })
      }
      await fetchInbox()
    } catch (error) {
      console.error('Error marking all as read:', error)
    }
  }

  const handleArchiveAllRead = async () => {
    try {
      for (const item of items.filter((i) => i.status === 'read')) {
        await fetch(`/api/v1/social/inbox/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'archived' }),
        })
      }
      await fetchInbox()
    } catch (error) {
      console.error('Error archiving:', error)
    }
  }

  // Stats
  const unreadCount = items.filter((i) => i.status === 'unread').length
  const commentCount = items.filter((i) => i.type === 'comment').length
  const mentionCount = items.filter((i) => i.type === 'mention').length
  const dmCount = items.filter((i) => i.type === 'dm').length

  // Get unique platforms
  const platforms = Array.from(new Set(items.map((i) => i.platform)))

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <header>
          <p className="sc-tiny">Social · Inbox</p>
          <h1 className="pib-page-title mt-2">Social Inbox</h1>
          <p className="pib-page-sub">Manage engagement and replies</p>
        </header>
        <button
          onClick={handleRefresh}
          disabled={polling}
          className="btn-pib-primary shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {polling ? (
            <>
              <span className="inline-block animate-spin">↻</span>
              Refreshing...
            </>
          ) : (
            <>
              ↻ Refresh
            </>
          )}
        </button>
      </div>

      {/* Poll Status Message */}
      {pollMessage && (
        <div className={`pib-card text-sm ${pollMessage.startsWith('Error') ? 'border-[var(--color-error)]/40 text-[var(--color-error)]' : 'text-[var(--color-pib-text)]'}`}>
          {pollMessage}
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="pib-stat-card">
          <p className="pib-label mb-1">Unread</p>
          <p className="text-2xl text-[var(--color-pib-text)]">{unreadCount}</p>
        </div>
        <div className="pib-stat-card">
          <p className="pib-label mb-1">Comments</p>
          <p className="text-2xl text-[var(--color-pib-text)]">{commentCount}</p>
        </div>
        <div className="pib-stat-card">
          <p className="pib-label mb-1">Mentions</p>
          <p className="text-2xl text-[var(--color-pib-text)]">{mentionCount}</p>
        </div>
        <div className="pib-stat-card">
          <p className="pib-label mb-1">Messages</p>
          <p className="text-2xl text-[var(--color-pib-text)]">{dmCount}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="pib-card space-y-4">
        <div>
          <p className="pib-label">Filters</p>
        </div>

        {/* Platform Filter */}
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] mb-2">Platform</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedPlatform(null)}
              className={`px-3 py-1.5 rounded text-sm font-label transition-colors ${
                selectedPlatform === null
                  ? 'bg-[var(--color-accent-v2)] text-black'
                  : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
              }`}
            >
              All
            </button>
            {platforms.map((platform) => (
              <button
                key={platform}
                onClick={() => setSelectedPlatform(platform)}
                className={`px-3 py-1.5 rounded text-sm font-label flex items-center gap-2 transition-colors ${
                  selectedPlatform === platform
                    ? 'bg-[var(--color-accent-v2)] text-black'
                    : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                }`}
              >
                <PlatformBadge platform={platform} />
                {platform}
              </button>
            ))}
          </div>
        </div>

        {/* Type Filter */}
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] mb-2">Type</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedType(null)}
              className={`px-3 py-1.5 rounded text-sm font-label transition-colors ${
                selectedType === null
                  ? 'bg-[var(--color-accent-v2)] text-black'
                  : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
              }`}
            >
              All
            </button>
            {['comment', 'mention', 'reply', 'dm'].map((t) => (
              <button
                key={t}
                onClick={() => setSelectedType(t as EngagementType)}
                className={`px-3 py-1.5 rounded text-sm font-label transition-colors ${
                  selectedType === t
                    ? 'bg-[var(--color-accent-v2)] text-black'
                    : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                }`}
              >
                {TYPE_LABELS[t as EngagementType]}
              </button>
            ))}
          </div>
        </div>

        {/* Status Filter */}
        <div>
          <p className="text-xs text-[var(--color-pib-text-muted)] mb-2">Status</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedStatus(null)}
              className={`px-3 py-1.5 rounded text-sm font-label transition-colors ${
                selectedStatus === null
                  ? 'bg-[var(--color-accent-v2)] text-black'
                  : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
              }`}
            >
              All
            </button>
            {['unread', 'read', 'replied', 'archived'].map((s) => (
              <button
                key={s}
                onClick={() => setSelectedStatus(s as EngagementStatus)}
                className={`px-3 py-1.5 rounded text-sm font-label transition-colors ${
                  selectedStatus === s
                    ? 'bg-[var(--color-accent-v2)] text-black'
                    : 'border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      {items.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={handleMarkAllRead}
            className="btn-pib-secondary text-sm"
          >
            Mark all read
          </button>
          <button
            onClick={handleArchiveAllRead}
            className="btn-pib-secondary text-sm"
          >
            Archive all read
          </button>
        </div>
      )}

      {/* Items List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="pib-skeleton h-16" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="pib-empty-state">
          <Icon name="inbox" />
          <h2 className="pib-empty-state-title">No inbox items</h2>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="pib-card hover:bg-[var(--color-row-hover)] transition-colors">
              {/* Main item row */}
              <div className="flex items-start gap-4 mb-3">
                {/* Platform indicator */}
                <PlatformBadge platform={item.platform} />

                {/* Avatar and user info */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {item.fromUser.avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.fromUser.avatarUrl}
                      alt={item.fromUser.name}
                      className="w-10 h-10 rounded shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-[var(--color-pib-text)]">{item.fromUser.name}</p>
                      <p className="text-sm text-[var(--color-pib-text-muted)]">@{item.fromUser.username}</p>
                      <TypeBadge type={item.type} />
                      <SentimentDot sentiment={item.sentiment} />
                    </div>
                    <p className="text-sm text-[var(--color-pib-text)] break-words line-clamp-2">{item.content}</p>
                  </div>
                </div>

                {/* Time and status */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <p className="text-xs text-[var(--color-pib-text-muted)]">{timeAgo(item.createdAt)}</p>
                  <span
                    className={`pib-pill ${
                      item.status === 'unread' ? 'pib-pill-blue' : ''
                    }`}
                  >
                    {item.status}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 ml-14">
                <a
                  href={item.platformUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-pib-ghost text-xs"
                >
                  View on {item.platform}
                </a>
                {item.status !== 'read' && (
                  <button
                    onClick={() => handleMarkRead(item.id)}
                    className="btn-pib-ghost text-xs"
                  >
                    Mark read
                  </button>
                )}
                {item.status !== 'archived' && (
                  <button
                    onClick={() => handleArchive(item.id)}
                    className="btn-pib-ghost text-xs"
                  >
                    Archive
                  </button>
                )}
                <button
                  onClick={() => setReplyingToId(item.id)}
                  className="btn-pib-primary text-xs"
                >
                  Reply
                </button>
              </div>

              {/* Reply input */}
              {replyingToId === item.id && (
                <div className="mt-3 ml-14 rounded-lg border border-[var(--color-pib-line)] p-3">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your reply..."
                    className="pib-textarea w-full"
                    rows={2}
                   aria-label="Type your reply..."/>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleReply(item.id)}
                      disabled={!replyText.trim() || replying}
                      className="btn-pib-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {replying ? 'Sending...' : 'Send Reply'}
                    </button>
                    <button
                      onClick={() => {
                        setReplyingToId(null)
                        setReplyText('')
                      }}
                      className="btn-pib-ghost text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
