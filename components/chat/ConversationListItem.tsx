'use client'

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
  orchestration?: {
    mode: 'pip-orchestrator'
    dispatcherAgentId: AgentId
    requestedAgentIds: AgentId[]
  }
  startedBy: string
  title: string
  scope?: string
  scopeRefId?: string
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

export default function ConversationListItem({
  conversation: c,
  active,
  onClick,
}: ConversationListItemProps) {
  const preview = c.lastMessagePreview
    ? c.lastMessagePreview.slice(0, 60) + (c.lastMessagePreview.length > 60 ? '…' : '')
    : null

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors group ${
        active
          ? 'bg-[var(--color-card-active,rgba(255,255,255,0.08))] text-on-surface'
          : 'text-on-surface-variant hover:bg-[var(--color-card-hover,rgba(255,255,255,0.04))]'
      }`}
    >
      {/* Participant chips */}
      {c.participants.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {c.participants.slice(0, 4).map((p) => {
            if (p.kind === 'agent') {
              const dotColor = AGENT_COLORS[p.agentId] ?? 'bg-white/40'
              return (
                <span
                  key={`agent-${p.agentId}`}
                  className="inline-flex items-center gap-1 text-[10px]"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                  <span className="text-on-surface-variant font-medium">{p.name}</span>
                </span>
              )
            }
            const name = p.displayName ?? p.uid.slice(0, 8)
            return (
              <span
                key={`user-${p.uid}`}
                className="inline-flex items-center gap-1 text-[10px] text-on-surface-variant"
              >
                <span className="w-5 h-5 rounded-full bg-white/10 text-[9px] font-bold flex items-center justify-center">
                  {initials(name)}
                </span>
                <span>{name}</span>
              </span>
            )
          })}
          {c.participants.length > 4 && (
            <span className="text-[10px] text-on-surface-variant">+{c.participants.length - 4}</span>
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
        </div>
      )}

      {/* Title */}
      <div className="line-clamp-1 text-sm font-medium text-on-surface">
        {c.title || 'Untitled'}
      </div>

      {/* Preview + time */}
      <div className="flex items-center justify-between gap-2 mt-0.5">
        {preview ? (
          <div className="line-clamp-1 text-xs text-on-surface-variant flex-1 min-w-0">{preview}</div>
        ) : (
          <div className="flex-1" />
        )}
        {c.lastMessageAt && (
          <span className="text-[10px] text-on-surface-variant shrink-0 font-mono">
            {relativeTime(c.lastMessageAt)}
          </span>
        )}
      </div>
    </button>
  )
}
