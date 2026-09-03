'use client'

import { Icon } from '@/components/studio'
import type { ContextReference } from '@/lib/context-references/types'
import type { BotInboxMeta } from '@/lib/messages/bot-channel'
import { HoverTip } from '@/components/ui/HoverTip'

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
    /** Linked-computer Workspace mapping chosen for this session. */
    mappingId?: string
    mappingLabel?: string
    companyId?: string | null
    companyName?: string
    folderScope?: 'organisation' | 'company' | 'project'
    folderRelativePath?: string
    browserProfileId?: string
    projectId?: string
    projectName?: string
    shareMode?: string
    ownerUserId?: string
  }
  channelKind?: string
  botInbox?: Partial<BotInboxMeta>
  contextRefs?: ContextReference[]
  lastMessageId?: string
  lastMessagePreview?: string
  lastMessageRole?: string
  lastMessageAt?: { seconds?: number; _seconds?: number } | string
  messageCount: number
  unreadCount?: number
  lastReadMessageId?: string
  lastReadMessageCount?: number
  archived: boolean
  /** Set when this conversation is the project command session. */
  commandSessionProjectId?: string
  goalState?: { status?: string; goal?: string | null } | null
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
  pip:   'bg-[color-mix(in_srgb,var(--st-info)_14%,transparent)]',
  theo:  'bg-sky-400',
  maya:  'bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]',
  sage:  'bg-emerald-400',
  nora:  'bg-rose-400',
  ads:   'bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]',
  'qa-release': 'bg-emerald-400',
  support: 'bg-sky-400',
  data: 'bg-[color-mix(in_srgb,var(--st-info)_14%,transparent)]',
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
  const machine = workspace.runtimeLabel?.trim()
    || (workspace.runtimeTarget === 'local'
      ? 'Local'
      : workspace.runtimeTarget === 'vps'
        ? 'VPS'
        : workspace.runtimeTarget?.toUpperCase() || null)
  if (!machine) return null
  const mapping = workspace.mappingLabel?.trim()
  return mapping ? `${machine} · ${mapping}` : machine
}

function projectBadge(conversation: Conversation): string | null {
  const workspace = conversation.workspaceContext
  const name = workspace?.projectName?.trim()
  if (name) return name
  if (conversation.scope === 'project') {
    const contextProject = conversation.contextRefs?.find((ref) => ref.type === 'project')
    return contextProject?.label?.trim() || null
  }
  return null
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
  const workspaceProject = projectBadge(c)
  const workspaceVisibility = visibilityBadge(c)
  const context = contextGlyph(c)

  if (compact) {
    const title = c.title?.trim() || 'Untitled'
    return (
      <button
        type="button"
        data-testid={`conversation-row-${c.id}`}
        aria-label={title}
        onClick={onClick}
        className={`group min-h-11 w-full overflow-hidden rounded-md py-1.5 pl-2 pr-12 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0 xl:pr-2 ${ active ? 'bg-white/[0.08] text-[var(--color-pib-text)] ring-1 ring-white/[0.06]' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.045] hover:text-[var(--color-pib-text)]' }`}
      >
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-[4px] ${leadAgentDot}`} />
          {context && (
            <span title={`Context: ${context.label}`}>
              <Icon name={context.icon} label={`Context: ${context.label}`} className="shrink-0 text-[13px] text-primary/85" />
            </span>
          )}
          <HoverTip label={title} side="right" className="min-w-0 flex-1">
            <span className="block min-w-0 truncate text-[12px] font-medium leading-4 text-[var(--color-pib-text)]">
              {title}
            </span>
          </HoverTip>
          {pinned && (
            <span title="Pinned session">
              <Icon name="keep" className="shrink-0 text-[12px] text-primary" />
            </span>
          )}
          {(c.unreadCount ?? 0) > 0 && (
            <span
              aria-label={`${c.unreadCount} unread message${c.unreadCount === 1 ? '' : 's'}`}
              className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[4px] bg-primary px-1 font-mono text-[9px] font-medium leading-none text-on-primary"
            >
              {c.unreadCount! > 99 ? '99+' : c.unreadCount}
            </span>
          )}
        </div>

        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] leading-3 text-[var(--color-pib-text-muted)]/85">
          {workspaceProject && (
            <HoverTip label={`Project: ${workspaceProject}`} side="right" className="max-w-[48%] shrink">
              <span
                data-testid={`conversation-project-badge-${c.id}`}
                className="block truncate font-medium text-[9px] leading-3 text-primary/90"
              >
                {workspaceProject}
              </span>
            </HoverTip>
          )}
          {workspaceRuntime && (
            <HoverTip label={`Workspace runtime: ${workspaceRuntime}`} side="right" className="max-w-[40%] shrink">
              <span className="block truncate pib-pill pib-pill-blue !px-1 !py-0 !text-[8px] !leading-3">
                {workspaceRuntime}
              </span>
            </HoverTip>
          )}
          {workspaceVisibility && (
            <span className="shrink-0 font-mono text-[8px] uppercase leading-3 text-[var(--color-pib-text-muted)]" title={`Workspace visibility: ${workspaceVisibility}`}>
              {workspaceVisibility}
            </span>
          )}
          {leadAgent?.kind === 'agent' && (
            <span className="min-w-0 max-w-[30%] shrink truncate font-medium text-[var(--color-pib-text-muted)]/90">{leadAgent.name}</span>
          )}
          {preview ? (
            <span className="min-w-0 flex-1 truncate">{preview}</span>
          ) : c.orchestration?.mode === 'pip-orchestrator' ? (
            <span className="min-w-0 flex-1 truncate text-primary/90">Orchestrated session</span>
          ) : (
            <span className="min-w-0 flex-1 truncate">{c.messageCount} messages</span>
          )}
          {c.lastMessageAt && (
            <span className="shrink-0 font-mono text-[9px] leading-3 text-[var(--color-pib-text-muted)]/80">
              {relativeTime(c.lastMessageAt)}
            </span>
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
      className={`group min-h-11 w-full overflow-hidden pr-12 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 xl:min-h-0 xl:pr-3 ${compact ? 'rounded-md py-1.5 pl-2' : 'rounded-lg py-2.5 pl-3'} ${ active ? 'bg-[var(--color-card-active,rgba(255,255,255,0.08))] text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)] hover:bg-[var(--color-card-hover,rgba(255,255,255,0.04))]' }`}
    >
      {/* Participant chips */}
      {c.participants.length > 0 && (
        <div className={compact ? 'mb-1 flex min-w-0 items-center gap-1 overflow-hidden' : 'mb-1.5 flex min-w-0 flex-wrap gap-1 overflow-hidden'}>
          {c.participants.slice(0, 4).map((p) => {
            if (p.kind === 'agent') {
              const dotColor = AGENT_COLORS[p.agentId] ?? 'bg-white/40'
              return (
                <span
                  key={`agent-${p.agentId}`}
                  className="inline-flex min-w-0 items-center gap-1 text-[10px]"
                >
                  <span className={`w-1.5 h-1.5 rounded-[4px] shrink-0 ${dotColor}`} />
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
                <span className={`${compact ? 'h-4 w-4 text-[8px]' : 'w-5 h-5 text-[9px]'} rounded-[4px] bg-white/10 font-medium flex items-center justify-center shrink-0`}>
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
              <Icon name="hub" className="text-[12px]" />
              Orchestrated
            </span>
          )}
          {workspaceRuntime && (
            <span
              className="max-w-full truncate pib-pill pib-pill-blue !px-1.5 !py-0.5"
              title={`Workspace runtime: ${workspaceRuntime}`}
            >
              {workspaceRuntime}
            </span>
          )}
          {workspaceVisibility && (
            <span
              className="inline-flex items-center rounded-[4px] border border-[var(--color-card-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]"
              title={`Workspace visibility: ${workspaceVisibility}`}
            >
              {workspaceVisibility}
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <div className="flex min-w-0 items-center gap-2">
        <HoverTip label={c.title || 'Untitled'} side="right" className="block min-w-0 flex-1">
          <div className={`line-clamp-1 overflow-hidden font-medium text-[var(--color-pib-text)] ${compact ? 'text-[13px]' : 'text-sm'}`}>
            {c.title || 'Untitled'}
          </div>
        </HoverTip>
        {(c.unreadCount ?? 0) > 0 && (
          <span
            aria-label={`${c.unreadCount} unread message${c.unreadCount === 1 ? '' : 's'}`}
            className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[4px] bg-primary px-1.5 font-mono text-[10px] font-medium leading-none text-on-primary"
          >
            {c.unreadCount! > 99 ? '99+' : c.unreadCount}
          </span>
        )}
      </div>

      {/* Preview + time */}
      <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2 overflow-hidden">
        {preview ? (
          <div className={`line-clamp-1 min-w-0 flex-1 overflow-hidden text-[var(--color-pib-text-muted)] ${compact ? 'text-[11px]' : 'text-xs'}`}>{preview}</div>
        ) : (
          <div className="flex-1" />
        )}
        {c.lastMessageAt && (
          <span className="shrink-0 font-mono text-[10px] text-[var(--color-pib-text-muted)]">
            {relativeTime(c.lastMessageAt)}
          </span>
        )}
      </div>
    </button>
  )
}
