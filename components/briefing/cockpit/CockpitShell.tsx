'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { DockedChat } from './DockedChat'
import type { Mode } from './cockpitTypes'
import type { PortalOrgRouteScope } from '@/lib/portal/scoped-routing'
import type { ContextReferenceSeed } from '@/lib/context-references/types'
import { ModuleShell } from '@/components/ui/ModuleShell'
import { HudChip, SignalMeter } from '@/components/ui/HudChip'

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
      tier={2}
      accent="cyan"
      shellTestId="briefings-room-shell"
      fieldTestId="briefings-neural-field"
      className="relative flex h-[calc(100dvh-88px)] min-h-[640px] min-w-0 flex-col overflow-hidden rounded-[22px] border border-[var(--color-card-border)] bg-[var(--color-card)]/55 shadow-[0_24px_80px_rgba(0,0,0,0.24)]"
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-card-border)] bg-black/[0.08] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="pib-icon-tint pib-icon-tint-cyan shrink-0"><span className="material-symbols-outlined text-[15px]">checklist</span></span>
          <div className="min-w-0">
            <div className="truncate pib-label">
              {mode === 'admin' ? 'Workspace / Briefings' : 'Client portal / Briefings'}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm font-semibold leading-tight text-[var(--color-pib-text)]">Briefings</h1>
              {orgName && <span className="hidden truncate text-xs text-[var(--color-pib-text-muted)] sm:inline">· {orgName}</span>}
            </div>
          </div>
          <div className="messages-info-constellation hidden lg:flex" aria-label="Briefings live signals">
            <HudChip live={loading}>Queue</HudChip>
            <HudChip>Open <strong>{itemCount}</strong></HudChip>
            {updatedLabel ? <HudChip>Updated <strong>{updatedLabel}</strong></HudChip> : null}
            <SignalMeter title="Briefings signal" />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <HudChip className="sm:hidden">{itemCount} open</HudChip>
          <button type="button" onClick={onRefresh} disabled={loading} title="Refresh briefings" className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-pib-text-muted)] transition hover:bg-white/[0.06] hover:text-[var(--color-pib-text)] disabled:opacity-50">
            <span className={`material-symbols-outlined text-[16px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
          </button>
          <button
            type="button"
            onClick={() => setShowChat((value) => !value)}
            className={`flex h-7 items-center gap-1 rounded-md px-2 text-xs transition ${showChat ? 'bg-primary/15 text-primary' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.06] hover:text-[var(--color-pib-text)]'}`}
            aria-label={showChat ? 'Close Pip briefing assistant' : 'Open Pip briefing assistant'}
          >
            <span className="material-symbols-outlined text-[15px]">smart_toy</span>
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
