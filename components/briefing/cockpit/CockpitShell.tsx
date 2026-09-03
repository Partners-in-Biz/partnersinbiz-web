'use client'

import { Icon } from '@/components/studio'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { DockedChat } from './DockedChat'
import type { Mode } from './cockpitTypes'
import type { PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type { ContextReferenceSeed } from '@/lib/context-references/types'
import { ModuleShell } from '@/components/ui/ModuleShell'
import { HudChip } from '@/components/ui/HudChip'
import '@/components/briefing/atmosphere/briefings-quiet.css'

export type CockpitShellProps = {
  mode: Mode
  portalScope?: PortalOrgRouteScope
  currentUser?: { uid: string; displayName: string }
  orgId: string
  orgName?: string
  itemCount: number
  generatedAt?: string | null
  loading?: boolean
  onRefresh: () => void
  selectedContextSeed?: ContextReferenceSeed | null
  workFeedContent?: ReactNode
}

export function CockpitShell({
  mode,
  portalScope,
  currentUser,
  orgId,
  orgName,
  itemCount,
  generatedAt,
  loading = false,
  onRefresh,
  selectedContextSeed,
  workFeedContent,
}: CockpitShellProps) {
  const [showChat, setShowChat] = useState(false)
  const resolvedChatOrgId = orgId || (mode === 'portal' ? portalScope?.orgId ?? '' : '')
  const updatedLabel = generatedAt
    ? new Date(generatedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <ModuleShell
      tier={0}
      accent="cyan"
      shellTestId="briefings-room-shell"
      data-briefings-experience="quiet-2026"
      style={{ background: '#000' }}
      className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-none border-0 bg-black shadow-none"
    >
      <header data-testid="briefings-shell-topbar" className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-card-border)] bg-black px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/[0.06] text-[var(--color-pib-text)]"><Icon name="radar" /></span>
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm leading-tight text-[var(--color-pib-text)]">Briefings</h1>
            {orgName && <span className="hidden truncate text-xs text-[var(--color-pib-text-muted)] sm:inline">· {orgName}</span>}
          </div>
          <div className="hidden items-center gap-2 text-xs text-[var(--color-pib-text-muted)] lg:flex" aria-label="Briefings live signals">
            <HudChip live={loading}>Queue</HudChip>
            <HudChip>Open <strong>{itemCount}</strong></HudChip>
            {updatedLabel ? <HudChip>Updated <strong>{updatedLabel}</strong></HudChip> : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <HudChip className="sm:hidden">{itemCount} open</HudChip>
          <button type="button" onClick={onRefresh} disabled={loading} title="Refresh briefings" className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.06] hover:text-[var(--color-pib-text)] disabled:opacity-50">
            <Icon name="refresh" className={loading ? 'animate-spin' : undefined} />
          </button>
          <button
            type="button"
            onClick={() => setShowChat((value) => !value)}
            className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs transition ${showChat ? 'bg-primary/15 text-primary' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]'}`}
            aria-label={showChat ? 'Close Pip briefing assistant' : 'Open Pip briefing assistant'}
          >
            <Icon name="smart_toy" />
            <span className="hidden sm:inline">Ask Pip</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1">
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden p-2">
          {workFeedContent ?? <div className="p-4 text-sm text-[var(--color-pib-text-muted)]">Loading briefings…</div>}
        </main>
        {showChat && (
          <aside className="w-[min(380px,100%)] shrink-0 border-l border-[var(--color-card-border)] bg-[var(--color-card)] max-lg:absolute max-lg:inset-y-11 max-lg:right-0 max-lg:z-30">
            <DockedChat
              orgId={resolvedChatOrgId}
              currentUserUid={currentUser?.uid ?? ''}
              currentUserDisplayName={currentUser?.displayName ?? ''}
              contextSeed={selectedContextSeed ?? {
                type: 'report',
                id: `briefings:${orgId || 'all'}`,
                orgId: resolvedChatOrgId || undefined,
                label: 'Current Briefings queue',
              }}
              onContextActionResolved={onRefresh}
              onClose={() => setShowChat(false)}
            />
          </aside>
        )}
      </div>
    </ModuleShell>
  )
}
