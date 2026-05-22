'use client'

type AgentId = string

type Participant =
  | { kind: 'user'; uid: string; role: 'admin' | 'client'; displayName?: string }
  | { kind: 'agent'; agentId: AgentId; name: string }

interface ParticipantBarProps {
  participants: Participant[]
  className?: string
}

const AGENT_COLOR: Record<string, { dot: string; label: string }> = {
  violet:  { dot: 'bg-violet-400', label: 'text-violet-300' },
  sky:     { dot: 'bg-sky-400',    label: 'text-sky-300' },
  amber:   { dot: 'bg-amber-400',  label: 'text-amber-300' },
  emerald: { dot: 'bg-emerald-400',label: 'text-emerald-300' },
  rose:    { dot: 'bg-rose-400',   label: 'text-rose-300' },
}

// Agent ID → default color key (matches AgentTeamDoc.colorKey in Firestore)
const AGENT_DEFAULT_COLOR: Record<string, string> = {
  pip:   'violet',
  theo:  'sky',
  maya:  'amber',
  sage:  'emerald',
  nora:  'rose',
  ads:   'amber',
  'qa-release': 'emerald',
  support: 'sky',
  data: 'violet',
  docs: 'rose',
  seo:  'emerald',
}

function initials(name: string): string {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('')
}

export default function ParticipantBar({ participants, className = '' }: ParticipantBarProps) {
  if (!participants.length) return null

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {participants.map((p) => {
        if (p.kind === 'agent') {
          const colorKey = AGENT_DEFAULT_COLOR[p.agentId] ?? 'violet'
          const c = AGENT_COLOR[colorKey] ?? AGENT_COLOR.violet
          return (
            <span
              key={`agent-${p.agentId}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
              <span className={c.label}>{p.name}</span>
            </span>
          )
        }

        // User participant
        const name = p.displayName ?? p.uid.slice(0, 8)
        return (
          <span
            key={`user-${p.uid}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs"
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-white/40" />
            <span className="text-on-surface-variant">{name}</span>
          </span>
        )
      })}
    </div>
  )
}

// Also export initials helper for reuse
export { initials }
