'use client'
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
  if (!date) return '—'

  const now = new Date()
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return date.toLocaleDateString()
}

function PlatformBadge({ platform }: { platform: string }) {
  const color = PLATFORM_COLORS[platform.toLowerCase()] || 'bg-surface-container-high'
  return (
    <div className={`w-3 h-3 rounded-full ${color}`} title={platform} />
  )
}

function SentimentDot({ sentiment }: { sentiment: SentimentType }) {
  if (!sentiment) return <div className="w-2 h-2 rounded-full bg-gray-400" />
  const colors = {
    positive: 'bg-green-500',
    neutral: 'bg-gray-400',
    negative: 'bg-red-500',
  }
  return <div className={`w-2 h-2 rounded-full ${colors[sentiment]}`} title={sentiment} />
}

function TypeBadge({ type }: { type: EngagementType }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-medium">
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
    if (!replyText.trim()) return
    try {
      await fetch(`/api/v1/social/inbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'replied' }),
      })
      // TODO: Actually send the reply via the appropriate platform
      setReplyingToId(null)
      setReplyText('')
      await fetchInbox()
    } catch (error) {
      console.error('Error replying:', error)
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
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">Social Inbox</h1>
          <p className="text-sm text-on-surface-variant mt-1">Manage engagement and replies</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={polling}
          className="px-4 py-2 rounded-lg bg-primary text-on-primary font-medium text-sm hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
        <div className={`p-3 rounded-lg text-sm ${pollMessage.startsWith('Error') ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>
          {pollMessage}
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-lg bg-surface-container">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Unread</p>
          <p className="text-2xl font-bold text-on-surface">{unreadCount}</p>
        </div>
        <div className="p-4 rounded-lg bg-surface-container">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Comments</p>
          <p className="text-2xl font-bold text-on-surface">{commentCount}</p>
        </div>
        <div className="p-4 rounded-lg bg-surface-container">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Mentions</p>
          <p className="text-2xl font-bold text-on-surface">{mentionCount}</p>
        </div>
        <div className="p-4 rounded-lg bg-surface-container">
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-1">Messages</p>
          <p className="text-2xl font-bold text-on-surface">{dmCount}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="space-y-3 p-4 rounded-lg bg-surface-container">
        <div>
          <p className="text-xs font-medium text-on-surface-variant uppercase tracking-wide mb-2">Filters</p>
        </div>

        {/* Platform Filter */}
        <div>
          <p className="text-xs text-on-surface-variant mb-2">Platform</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedPlatform(null)}
              className={`px-3 py-1.5 rounded text-sm font-label ${
                selectedPlatform === null
                  ? 'bg-[#F59E0B] text-black'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All
            </button>
            {platforms.map((platform) => (
              <button
                key={platform}
                onClick={() => setSelectedPlatform(platform)}
                className={`px-3 py-1.5 rounded text-sm font-label flex items-center gap-2 ${
                  selectedPlatform === platform
                    ? 'bg-[#F59E0B] text-black'
                    : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
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
          <p className="text-xs text-on-surface-variant mb-2">Type</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedType(null)}
              className={`px-3 py-1.5 rounded text-sm font-label ${
                selectedType === null
                  ? 'bg-[#F59E0B] text-black'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All
            </button>
            {['comment', 'mention', 'reply', 'dm'].map((t) => (
              <button
                key={t}
                onClick={() => setSelectedType(t as EngagementType)}
                className={`px-3 py-1.5 rounded text-sm font-label ${
                  selectedType === t
                    ? 'bg-[#F59E0B] text-black'
                    : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {TYPE_LABELS[t as EngagementType]}
              </button>
            ))}
          </div>
        </div>

        {/* Status Filter */}
        <div>
          <p className="text-xs text-on-surface-variant mb-2">Status</p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedStatus(null)}
              className={`px-3 py-1.5 rounded text-sm font-label ${
                selectedStatus === null
                  ? 'bg-[#F59E0B] text-black'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
            >
              All
            </button>
            {['unread', 'read', 'replied', 'archived'].map((s) => (
              <button
                key={s}
                onClick={() => setSelectedStatus(s as EngagementStatus)}
                className={`px-3 py-1.5 rounded text-sm font-label ${
                  selectedStatus === s
                    ? 'bg-[#F59E0B] text-black'
                    : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
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
            className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-label text-sm hover:bg-surface-container-high transition-colors"
          >
            Mark all read
          </button>
          <button
            onClick={handleArchiveAllRead}
            className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-label text-sm hover:bg-surface-container-high transition-colors"
          >
            Archive all read
          </button>
        </div>
      )}

      {/* Items List */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-surface-container animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 rounded-lg bg-surface-container text-center">
          <p className="text-on-surface-variant">No inbox items</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="p-4 rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors">
              {/* Main item row */}
              <div className="flex items-start gap-4 mb-3">
                {/* Platform indicator */}
                <PlatformBadge platform={item.platform} />

                {/* Avatar and user info */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {item.fromUser.avatarUrl && (
                    <img
                      src={item.fromUser.avatarUrl}
                      alt={item.fromUser.name}
                      className="w-10 h-10 rounded-full shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-on-surface">{item.fromUser.name}</p>
                      <p className="text-sm text-on-surface-variant">@{item.fromUser.username}</p>
                      <TypeBadge type={item.type} />
                      <SentimentDot sentiment={item.sentiment} />
                    </div>
                    <p className="text-sm text-on-surface break-words line-clamp-2">{item.content}</p>
                  </div>
                </div>

                {/* Time and status */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <p className="text-xs text-on-surface-variant">{timeAgo(item.createdAt)}</p>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                      item.status === 'unread' ? 'bg-blue-900/30 text-blue-400' : 'bg-surface-container text-on-surface-variant'
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
                  className="text-xs px-2 py-1 rounded bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  View on {item.platform}
                </a>
                {item.status !== 'read' && (
                  <button
                    onClick={() => handleMarkRead(item.id)}
                    className="text-xs px-2 py-1 rounded bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    Mark read
                  </button>
                )}
                {item.status !== 'archived' && (
                  <button
                    onClick={() => handleArchive(item.id)}
                    className="text-xs px-2 py-1 rounded bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    Archive
                  </button>
                )}
                <button
                  onClick={() => setReplyingToId(item.id)}
                  className="text-xs px-2 py-1 rounded bg-[#F59E0B] text-black font-medium hover:bg-[#F59E0B]/90 transition-colors"
                >
                  Reply
                </button>
              </div>

              {/* Reply input */}
              {replyingToId === item.id && (
                <div className="mt-3 ml-14 p-3 rounded bg-surface-container-high">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your reply..."
                    className="w-full bg-surface-container text-on-surface placeholder-on-surface-variant rounded p-2 text-sm border border-outline-variant focus:outline-none focus:border-[#F59E0B]"
                    rows={2}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleReply(item.id)}
                      disabled={!replyText.trim()}
                      className="px-3 py-1.5 rounded bg-[#F59E0B] text-black font-label text-sm font-medium hover:bg-[#F59E0B]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Send Reply
                    </button>
                    <button
                      onClick={() => {
                        setReplyingToId(null)
                        setReplyText('')
                      }}
                      className="px-3 py-1.5 rounded bg-surface-container text-on-surface font-label text-sm hover:bg-surface-container-high transition-colors"
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
