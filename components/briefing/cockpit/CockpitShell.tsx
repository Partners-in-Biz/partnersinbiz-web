'use client'
import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useBriefingFeed } from './useBriefingFeed'
import { useTodayMeetings } from './useTodayMeetings'
import { useUnreadEmail } from './useUnreadEmail'
import { useRecentDrive } from './useRecentDrive'
import { computePulseCounts, computeSinceLastLooked } from './pulse'
import { PulseGrid } from './PulseGrid'
import { CatchUpNarrative } from './CatchUpNarrative'
import { TodayBand } from './TodayBand'
import { InboxPanel } from './InboxPanel'
import { DrivePanel } from './DrivePanel'
import { DockedChat } from './DockedChat'
import type { Mode } from './cockpitTypes'
import type { MailItem } from './useUnreadEmail'
import type { PortalOrgRouteScope } from '@/lib/portal/scoped-routing'

export type CockpitShellProps = {
  mode: Mode
  portalScope?: PortalOrgRouteScope
  currentUser?: { uid: string; displayName: string }
  /**
   * The existing lane-rail + feed-card list + action-panel render.
   * Task 12 passes BriefingControlDesk's inner render here so we don't have to
   * relocate thousands of lines of complex action-panel logic.
   */
  workFeedContent?: ReactNode
}

export function CockpitShell({ mode, portalScope, currentUser, workFeedContent }: CockpitShellProps) {
  const { orgs, orgId, setOrgId, priority, sourceType, feed } = useBriefingFeed(mode)

  // Portal mode: derive orgId from the route scope if the feed hook hasn't resolved one yet.
  useEffect(() => {
    if (mode === 'portal' && portalScope?.orgId && !orgId) {
      setOrgId(portalScope.orgId)
    }
  }, [mode, portalScope?.orgId, orgId, setOrgId])

  const calendar = useTodayMeetings(orgId || undefined)
  const inbox = useUnreadEmail(mode, orgId || undefined)
  const drive = useRecentDrive(orgId || undefined)

  // lastViewedAt from localStorage — drives the "since you last looked" narrative.
  const currentUserUid = currentUser?.uid ?? ''
  const lastViewedKey = `cockpit:lastViewed:${currentUserUid}:${mode}:${orgId || 'all'}`
  const [lastViewedAt, setLastViewedAt] = useState<string | null>(null)
  useEffect(() => {
    setLastViewedAt(window.localStorage.getItem(lastViewedKey))
  }, [lastViewedKey])
  useEffect(() => {
    if (!feed) return
    const t = window.setTimeout(() => {
      window.localStorage.setItem(lastViewedKey, new Date().toISOString())
    }, 4000)
    return () => window.clearTimeout(t)
  }, [feed, lastViewedKey])

  // Pulse counts + since-last-looked diff.
  const pulse = computePulseCounts(feed)
  const { changedCount, changed } = computeSinceLastLooked(feed, lastViewedAt)

  const pulseItems = [
    { label: 'Needs you', value: pulse.needsPeet, color: 'text-red-400', icon: 'priority_high' },
    { label: 'Approvals', value: pulse.approvals, color: 'text-amber-400', icon: 'approval' },
    { label: 'Review work', value: pulse.review, color: 'text-blue-400', icon: 'rate_review' },
    { label: 'Auto-moving', value: pulse.autoMoving, color: 'text-green-400', icon: 'autorenew' },
    { label: 'Inbox', value: inbox.unreadCount, color: 'text-on-surface', icon: 'inbox' },
    { label: 'Tickets', value: 0, color: 'text-on-surface', icon: 'confirmation_number' },
    { label: 'Overdue', value: 0, color: 'text-on-surface', icon: 'payments' },
    { label: 'Follow-up', value: pulse.followUp, color: 'text-on-surface', icon: 'follow_the_signs' },
  ]

  // Segment tabs.
  const [segment, setSegment] = useState<'work' | 'inbox' | 'drive'>('work')

  // Pre-filled chat prompts. DockedChat does not consume this yet (MVP) — a
  // follow-up wires it into UnifiedChat's currentPageContext.
  const [, setPendingChatPrompt] = useState<string | null>(null)

  const handleBriefMe = () => {
    const topItems = (feed?.items ?? [])
      .slice(0, 5)
      .map((c) => `• ${c.title}`)
      .join('\n')
    setPendingChatPrompt(
      `Brief me on the current state of operations. Here's a quick summary:\n${topItems}\n\nWhat should I prioritise?`,
    )
  }

  const handleAskPipReply = (mail: MailItem) => {
    setPendingChatPrompt(
      `Please draft a reply to this email from ${mail.from}: "${mail.subject}". The snippet is: "${mail.snippet}"`,
    )
    setSegment('work')
  }

  // Self-contained Snapshot (mirrors BriefingControlDesk.createSnapshot).
  const [snapshotting, setSnapshotting] = useState(false)
  const [snapshotFlash, setSnapshotFlash] = useState<string | null>(null)
  async function createSnapshot() {
    setSnapshotting(true)
    setSnapshotFlash(null)
    try {
      const res = await fetch('/api/v1/briefings/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: orgId || undefined, priority, sourceType, limit: 100, title: 'Mission control snapshot' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Snapshot failed')
      setSnapshotFlash('Snapshot saved')
    } catch (err) {
      setSnapshotFlash(err instanceof Error ? err.message : 'Snapshot failed')
    } finally {
      setSnapshotting(false)
      window.setTimeout(() => setSnapshotFlash(null), 4000)
    }
  }

  const resolvedChatOrgId = orgId || (mode === 'portal' ? portalScope?.orgId ?? '' : '')

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 64px)' }}>
      {/* HEADER */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-card-border)] bg-[var(--color-card)] px-4 py-2">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" aria-hidden="true" />
        <span className="text-sm font-bold text-on-surface">Mission Control</span>
        <span className="text-xs text-on-surface-variant">Live</span>
        {snapshotFlash && (
          <span className="text-[11px] text-on-surface-variant">· {snapshotFlash}</span>
        )}
        {mode === 'admin' && orgs.length > 0 && (
          <select
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            className="ml-auto rounded-md border border-[var(--color-card-border)] bg-[var(--color-card)] px-2 py-1 text-xs text-on-surface"
          >
            <option value="">All clients ({orgs.length})</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={createSnapshot}
          disabled={snapshotting}
          className={`pib-btn-secondary px-2.5 py-1 text-xs ${mode === 'admin' && orgs.length > 0 ? '' : 'ml-auto'}`}
        >
          <span className="material-symbols-outlined align-middle text-[15px]" aria-hidden="true">
            refresh
          </span>{' '}
          {snapshotting ? 'Saving…' : 'Snapshot'}
        </button>
      </div>

      {/* BRIEFING STRIP */}
      <div className="shrink-0 border-b border-[var(--color-card-border)] p-3">
        <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
          <CatchUpNarrative
            changedCount={changedCount}
            changed={changed}
            riskCount={pulse.risk}
            autoCount={pulse.autoMoving}
            onBriefMe={handleBriefMe}
          />
          <PulseGrid counts={pulseItems} />
        </div>
      </div>

      {/* TODAY BAND */}
      <TodayBand status={calendar.status} meetings={calendar.meetings} loading={calendar.loading} mode={mode} />

      {/* 3-COLUMN BODY */}
      <div className="flex min-h-0 flex-1">
        {/* CENTER — lane rail + work feed live inside workFeedContent (Task 12) */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* SEGMENT TABS */}
          <div className="flex shrink-0 gap-1 border-b border-[var(--color-card-border)] px-2 pt-2">
            <button
              onClick={() => setSegment('work')}
              className={`rounded-t-lg px-3 py-1.5 text-xs font-medium ${
                segment === 'work' ? 'bg-blue-500/20 text-blue-400' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined align-middle text-[14px]" aria-hidden="true">
                hub
              </span>{' '}
              Work feed
            </button>
            <button
              onClick={() => setSegment('inbox')}
              className={`rounded-t-lg px-3 py-1.5 text-xs font-medium ${
                segment === 'inbox' ? 'bg-blue-500/20 text-blue-400' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined align-middle text-[14px]" aria-hidden="true">
                inbox
              </span>{' '}
              Inbox
              {inbox.unreadCount > 0 && <span className="ml-0.5 text-[10px] opacity-70">{inbox.unreadCount}</span>}
            </button>
            <button
              onClick={() => setSegment('drive')}
              className={`rounded-t-lg px-3 py-1.5 text-xs font-medium ${
                segment === 'drive' ? 'bg-blue-500/20 text-blue-400' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined align-middle text-[14px]" aria-hidden="true">
                folder
              </span>{' '}
              Drive
            </button>
          </div>
          {/* SEGMENT CONTENT */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {segment === 'work' &&
              (workFeedContent ?? (
                <div className="p-4 text-sm text-on-surface-variant">Loading work feed…</div>
              ))}
            {segment === 'inbox' && (
              <InboxPanel
                status={inbox.status}
                messages={inbox.messages}
                unreadCount={inbox.unreadCount}
                loading={inbox.loading}
                onAskPipReply={handleAskPipReply}
              />
            )}
            {segment === 'drive' && (
              <DrivePanel status={drive.status} files={drive.files} loading={drive.loading} />
            )}
          </div>
        </div>

        {/* DOCKED CHAT */}
        <div className="hidden w-[320px] shrink-0 border-l border-[var(--color-card-border)] lg:block">
          <DockedChat
            orgId={resolvedChatOrgId}
            currentUserUid={currentUserUid}
            currentUserDisplayName={currentUser?.displayName ?? ''}
          />
        </div>
      </div>
    </div>
  )
}
