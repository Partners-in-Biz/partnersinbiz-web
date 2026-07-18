'use client'

import type { ContextReference } from '@/lib/context-references/types'

type AgentId = string

type Participant =
  | { kind: 'user'; uid: string; role: 'admin' | 'client'; displayName?: string }
  | { kind: 'agent'; agentId: AgentId; name: string }

export interface Conversation {
  id: string
  orgId: string
  participants: Participant[]
  participantUids: string[]
  participantAgentIds: AgentId[]
  accessVersion?: number
  orchestration?: {
    mode: 'pip-orchestrator'
    dispatcherAgentId: AgentId
    requestedAgentIds: AgentId[]
  }
  startedBy: string
  title: string
  scope?: string
  scopeRefId?: string
  workspaceContext?: {
    workspaceId: string
    orgName: string
    runtimeTarget: string
    runtimeLabel: string
    companyId?: string | null
    companyName?: string
    folderScope?: 'organisation' | 'company' | 'project'
    projectId?: string
    projectName?: string
    shareMode?: string
    ownerUserId?: string
  }
  contextRefs?: ContextReference[]
  lastMessagePreview?: string
  lastMessageRole?: string
  lastMessageAt?: { seconds?: number; _seconds?: number } | string
  messageCount: number
  archived: boolean
}

interface ConversationListItemProps {
  conversation: Conversation
  active: boolean
  onClick: () => void
  currentUserUid: string
  density?: 'comfortable' | 'compact'
  pinned?: boolean
}

const AGENT_COLORS: Record<string, string> = {
  pip:   'bg-violet-400',
  theo:  'bg-sky-400',
  maya:  'bg-amber-400',
  sage:  'bg-emerald-400',
  nora:  'bg-rose-400',
  ads:   'bg-amber-400',
  'qa-release': 'bg-emerald-400',
  support: 'bg-sky-400',
  data: 'bg-violet-400',
  docs: 'bg-rose-400',
  seo:  'bg-emerald-400',
}

function tsSeconds(ts: Conversation['lastMessageAt']): number {
  if (!ts) return 0
  if (typeof ts === 'string') return Date.parse(ts) / 1000
  return ts.seconds ?? ts._seconds ?? 0
}

function relativeTime(ts: Conversation['lastMessageAt']): string {
  const secs = tsSeconds(ts)
  if (!secs) return ''
  const diff = Math.floor(Date.now() / 1000 - secs)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(secs * 1000).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' })
}

function initials(name: string): string {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')
}

function primaryAgent(conversation: Conversation): Participant | null {
  return conversation.participants.find((participant) => participant.kind === 'agent') ?? null
}

function runtimeBadge(conversation: Conversation): string | null {
  const workspace = conversation.workspaceContext
  if (!workspace) return null
  if (workspace.runtimeLabel?.trim()) return workspace.runtimeLabel.trim()
  if (workspace.runtimeTarget === 'local') return 'Local'
  if (workspace.runtimeTarget === 'vps') return 'VPS'
  return workspace.runtimeTarget?.toUpperCase() ?? null
}

function visibilityBadge(conversation: Conversation): string | null {
  const mode = conversation.workspaceContext?.shareMode
  if (!mode) return null
  if (mode === 'org') return 'Organisation'
  if (mode === 'shared') return 'Shared'
  return 'Private'
}

function contextGlyph(conversation: Conversation): { icon: string; label: string } | null {
  const context = conversation.contextRefs?.[0]
  if (!context) return null
  const icons: Partial<Record<ContextReference['type'], string>> = {
    project: 'rocket_launch',
    studio: 'design_services',
    studio_artifact: 'draft',
    company: 'business',
    contact: 'person',
  }
  return { icon: icons[context.type] ?? 'label', label: context.label }
}

export default function ConversationListItem({
  conversation: c,
  active,
  onClick,
  density = 'comfortable',
  pinned = false,
}: ConversationListItemProps) {
  const compact = density === 'compact'
  const preview = c.lastMessagePreview
    ? c.lastMessagePreview.slice(0, 60) + (c.lastMessagePreview.length > 60 ? '…' : '')
    : null
  const leadAgent = primaryAgent(c)
  const leadAgentDot = leadAgent?.kind === 'agent' ? (AGENT_COLORS[leadAgent.agentId] ?? 'bg-white/40') : 'bg-white/30'
  const workspaceRuntime = runtimeBadge(c)
  const workspaceVisibility = visibilityBadge(c)
  const context = contextGlyph(c)

  if (compact) {
    return (
      <button
        type="button"
        data-testid={`conversation-row-${c.id}`}
        onClick={onClick}
        className={`group w-full rounded-md px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${
          active
            ? 'bg-white/[0.08] text-[var(--color-pib-text)] ring-1 ring-white/[0.06]'
            : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.045] hover:text-[var(--color-pib-text)]'
        }`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${leadAgentDot}`} />
          {context && (
            <span className="material-symbols-outlined shrink-0 text-[13px] text-primary/85" title={`Context: ${context.label}`} aria-label={`Context: ${context.label}`}>
              {context.icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-4 text-[var(--color-pib-text)]">
            {c.title || 'Untitled'}
          </span>
          {pinned && (
            <span className="material-symbols-outlined shrink-0 text-[12px] text-primary" title="Pinned session">
              keep
            </span>
          )}
          {workspaceRuntime && (
            <span className="shrink-0 pib-pill pib-pill-blue !px-1 !py-0 !text-[8px] !leading-3" title={`Workspace runtime: ${workspaceRuntime}`}>
              {workspaceRuntime}
            </span>
          )}
          {workspaceVisibility && (
            <span className="shrink-0 font-mono text-[8px] uppercase leading-3 text-[var(--color-pib-text-muted)]" title={`Workspace visibility: ${workspaceVisibility}`}>
              {workspaceVisibility}
            </span>
          )}
          {c.lastMessageAt && (
            <span className="shrink-0 font-mono text-[9px] leading-4 text-[var(--color-pib-text-muted)]/80">
              {relativeTime(c.lastMessageAt)}
            </span>
          )}
        </div>

        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-[var(--color-pib-text-muted)]/85">
          {leadAgent?.kind === 'agent' && (
            <span className="shrink-0 truncate font-medium text-[var(--color-pib-text-muted)]/90">{leadAgent.name}</span>
          )}
          {leadAgent?.kind === 'agent' && preview && <span aria-hidden="true" className="shrink-0">·</span>}
          {c.workspaceContext?.orgName && (
            <>
              <span className="shrink-0 truncate text-primary/90">{c.workspaceContext.orgName}</span>
              {preview && <span aria-hidden="true" className="shrink-0">·</span>}
            </>
          )}
          {preview ? (
            <span className="min-w-0 flex-1 truncate">{preview}</span>
          ) : c.orchestration?.mode === 'pip-orchestrator' ? (
            <span className="min-w-0 flex-1 truncate text-primary/90">Orchestrated session</span>
          ) : (
            <span className="min-w-0 flex-1 truncate">{c.messageCount} messages</span>
          )}
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      data-testid={`conversation-row-${c.id}`}
      onClick={onClick}
      className={`w-full text-left outline-none transition-colors group focus-visible:ring-2 focus-visible:ring-primary/60 ${compact ? 'rounded-md px-2 py-1.5' : 'rounded-lg px-3 py-2.5'} ${
        active
          ? 'bg-[var(--color-card-active,rgba(255,255,255,0.08))] text-[var(--color-pib-text)]'
          : 'text-[var(--color-pib-text-muted)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.04))]'
      }`}
    >
      {/* Participant chips */}
      {c.participants.length > 0 && (
        <div className={compact ? 'mb-1 flex min-w-0 items-center gap-1 overflow-hidden' : 'flex flex-wrap gap-1 mb-1.5'}>
          {c.participants.slice(0, 4).map((p) => {
            if (p.kind === 'agent') {
              const dotColor = AGENT_COLORS[p.agentId] ?? 'bg-white/40'
              return (
                <span
                  key={`agent-${p.agentId}`}
                  className="inline-flex min-w-0 items-center gap-1 text-[10px]"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                  <span className="truncate text-[var(--color-pib-text-muted)] font-medium">{p.name}</span>
                </span>
              )
            }
            const name = p.displayName ?? p.uid.slice(0, 8)
            return (
              <span
                key={`user-${p.uid}`}
                className="inline-flex min-w-0 items-center gap-1 text-[10px] text-[var(--color-pib-text-muted)]"
              >
                <span className={`${compact ? 'h-4 w-4 text-[8px]' : 'w-5 h-5 text-[9px]'} rounded-full bg-white/10 font-bold flex items-center justify-center shrink-0`}>
                  {initials(name)}
                </span>
                <span className="truncate">{name}</span>
              </span>
            )
          })}
          {c.participants.length > 4 && (
            <span className="text-[10px] text-[var(--color-pib-text-muted)]">+{c.participants.length - 4}</span>
          )}
          {c.orchestration?.mode === 'pip-orchestrator' && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-primary"
              title="Pip is routing this multi-agent conversation"
            >
              <span className="material-symbols-outlined text-[12px]">hub</span>
              Orchestrated
            </span>
          )}
          {workspaceRuntime && (
            <span
              className="pib-pill pib-pill-blue !px-1.5 !py-0.5"
              title={`Workspace runtime: ${workspaceRuntime}`}
            >
              {workspaceRuntime}
            </span>
          )}
          {workspaceVisibility && (
            <span
              className="inline-flex items-center rounded-full border border-[var(--color-card-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]"
              title={`Workspace visibility: ${workspaceVisibility}`}
            >
              {workspaceVisibility}
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <div className={`line-clamp-1 font-medium text-[var(--color-pib-text)] ${compact ? 'text-[13px]' : 'text-sm'}`}>
        {c.title || 'Untitled'}
      </div>

      {/* Preview + time */}
      <div className="flex items-center justify-between gap-2 mt-0.5">
        {preview ? (
          <div className={`line-clamp-1 text-[var(--color-pib-text-muted)] flex-1 min-w-0 ${compact ? 'text-[11px]' : 'text-xs'}`}>{preview}</div>
        ) : (
          <div className="flex-1" />
        )}
        {c.lastMessageAt && (
          <span className="text-[10px] text-[var(--color-pib-text-muted)] shrink-0 font-mono">
            {relativeTime(c.lastMessageAt)}
          </span>
        )}
      </div>
    </button>
  )
}
