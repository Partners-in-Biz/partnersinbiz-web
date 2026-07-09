'use client'

import type { ReactNode } from 'react'
import UnifiedChat from '@/components/chat/UnifiedChat'
import type { HermesMessagesShellProps, MessagesSurface } from './types'

const SURFACE_META: Record<MessagesSurface, {
  eyebrow: string
  title: string
  description: string
}> = {
  admin: {
    eyebrow: 'Workspace / Messages',
    title: 'Messages',
    description: 'Hermes-backed conversations with agents, runtime controls and team context.',
  },
  portal: {
    eyebrow: 'Client portal / Messages',
    title: 'Messages',
    description: 'Dense Hermes-style workspace for conversations with Pip and the Partners team.',
  },
}

function StatusPill({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'accent' | 'muted' }) {
  const toneClass = tone === 'accent'
    ? 'border-primary/25 bg-primary/10 text-primary'
    : tone === 'muted'
      ? 'border-white/10 bg-white/[0.03] text-on-surface-variant'
      : 'border-[var(--color-card-border)] bg-white/[0.04] text-on-surface-variant'
  return (
    <span className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] ${toneClass}`}>
      {children}
    </span>
  )
}

export function HermesMessagesShell({
  surface,
  orgId,
  currentUserUid,
  currentUserDisplayName,
  orgName,
  userRole,
  initialConvId,
  capabilities,
}: HermesMessagesShellProps) {
  const copy = SURFACE_META[surface]
  const runtimeMode = capabilities.allowAgentParticipants ? 'Agents enabled' : 'Human-only'

  return (
    <div
      data-testid="hermes-messages-shell"
      className="flex h-[calc(100dvh-88px)] min-h-[640px] min-w-0 flex-col overflow-hidden rounded-[22px] border border-[var(--color-card-border)] bg-[var(--color-card)]/55 shadow-[0_24px_80px_rgba(0,0,0,0.24)]"
    >
      <header
        data-testid="hermes-messages-shell-topbar"
        className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-card-border)] bg-black/[0.08] px-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="material-symbols-outlined grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[15px] text-primary">
            forum
          </span>
          <div className="min-w-0">
            <div className="truncate text-[10px] font-label uppercase tracking-[0.22em] text-on-surface-variant">
              {copy.eyebrow}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-sm font-semibold leading-tight text-on-surface">{copy.title}</h1>
              {orgName && <span className="hidden truncate text-xs text-on-surface-variant sm:inline">· {orgName}</span>}
            </div>
          </div>
        </div>

        <div className="hidden min-w-0 items-center gap-1.5 lg:flex">
          <StatusPill tone="accent">
            <span className="material-symbols-outlined text-[13px]">hub</span>
            {runtimeMode}
          </StatusPill>
          <StatusPill>
            <span className="material-symbols-outlined text-[13px]">shield_lock</span>
            Safe /v1 runs
          </StatusPill>
          {userRole && <StatusPill tone="muted">{userRole}</StatusPill>}
        </div>
      </header>

      <div className="sr-only" data-testid="hermes-messages-shell-description">
        {copy.description}
      </div>

      <section data-testid="hermes-messages-shell-body" className="min-h-0 min-w-0 flex-1 overflow-hidden p-2">
        <UnifiedChat
          orgId={orgId}
          currentUserUid={currentUserUid}
          currentUserDisplayName={currentUserDisplayName}
          orgName={orgName}
          initialConvId={initialConvId}
          allowDeleteConversations={surface === 'admin'}
          allowAgentParticipants={capabilities.allowAgentParticipants}
          allowStartConversations={capabilities.allowStartConversations}
          allowSendMessages={capabilities.allowSendMessages}
          allowArchiveConversations={capabilities.allowArchiveConversations}
        />
      </section>
    </div>
  )
}

export default HermesMessagesShell
