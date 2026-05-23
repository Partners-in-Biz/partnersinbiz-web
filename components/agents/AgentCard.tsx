'use client'

export interface AgentTeamDoc {
  agentId: string
  name: string
  role: string
  persona: string
  defaultModel: string
  iconKey: string
  colorKey: string
  enabled: boolean
  baseUrl: string
  apiKey: string
  lastHealthCheck?: string
  lastHealthStatus?: 'ok' | 'degraded' | 'unreachable'
  skillPolicy?: {
    mode: 'hard_allowlist'
    policyVersion: string
    catalogVersion?: string
    pibSkills: string[]
    runtimeSkills?: string[]
    globalSkills: string[]
    deniedSkills: string[]
    capabilities?: string[]
    approvalGates?: string[]
    primaryOwnerOf?: string[]
    mayRequestFrom?: string[]
    reviewerAgentId?: string | null
    vpsExternalDir: string
    appliedVersion?: string | null
    appliedAt?: string | null
    appliedBy?: string | null
    driftStatus?: 'unknown' | 'in_sync' | 'drifted' | 'not_applied'
  }
  responsibilities: string[]
  skills: string[]
  cronWatchLoops: string[]
  allowedScopes: string[]
  exampleTaskTypes: string[]
}

export type HealthStatus = 'ok' | 'degraded' | 'unreachable' | 'loading'

const COLOR_BORDER: Record<string, string> = {
  violet:  'border-violet-500',
  sky:     'border-sky-500',
  amber:   'border-amber-500',
  emerald: 'border-emerald-500',
  rose:    'border-rose-500',
}

const COLOR_ICON_BG: Record<string, string> = {
  violet:  'bg-violet-500/15 text-violet-400',
  sky:     'bg-sky-500/15 text-sky-400',
  amber:   'bg-amber-500/15 text-amber-400',
  emerald: 'bg-emerald-500/15 text-emerald-400',
  rose:    'bg-rose-500/15 text-rose-400',
}

const HEALTH_PILL: Record<HealthStatus, { label: string; className: string }> = {
  ok:          { label: 'Online',      className: 'bg-emerald-500/15 text-emerald-400' },
  degraded:    { label: 'Degraded',    className: 'bg-amber-500/15 text-amber-400' },
  unreachable: { label: 'Unreachable', className: 'bg-red-500/15 text-red-400' },
  loading:     { label: 'Checking…',   className: 'bg-white/10 text-on-surface-variant' },
}

interface AgentCardProps {
  agent: AgentTeamDoc
  onClick: () => void
  healthStatus?: HealthStatus
}

export function AgentCard({ agent, onClick, healthStatus = 'loading' }: AgentCardProps) {
  const borderClass = COLOR_BORDER[agent.colorKey] ?? 'border-white/20'
  const iconClass   = COLOR_ICON_BG[agent.colorKey] ?? 'bg-white/10 text-on-surface-variant'
  const pill        = HEALTH_PILL[healthStatus]

  return (
    <button
      onClick={onClick}
      className={`pib-card border-l-4 ${borderClass} p-5 text-left w-full cursor-pointer transition-all duration-150 hover:bg-white/5 hover:scale-[1.01] active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>
          <span className="material-symbols-outlined text-[22px]">{agent.iconKey}</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-on-surface leading-tight">{agent.name}</span>
            {/* Enabled / disabled dot */}
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${agent.enabled ? 'bg-emerald-400' : 'bg-white/20'}`}
              title={agent.enabled ? 'Enabled' : 'Disabled'}
            />
          </div>
          <p className="text-xs text-on-surface-variant mt-0.5 leading-snug">{agent.role}</p>
        </div>

        {/* Health pill */}
        <span className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${pill.className}`}>
          {pill.label}
        </span>
      </div>

      {/* Persona */}
      <p className="text-xs text-on-surface-variant mt-3 leading-relaxed line-clamp-2">
        {agent.persona}
      </p>

      {agent.exampleTaskTypes?.length > 0 && (
        <p className="mt-2 text-[10px] text-on-surface-variant/70 line-clamp-1">
          Example: {agent.exampleTaskTypes[0]}
        </p>
      )}

      {/* Footer row */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] font-mono text-on-surface-variant/60 truncate">
          {agent.defaultModel}
        </span>
        <span className="text-on-surface-variant/30 text-[10px]">·</span>
        <span className={`text-[10px] font-label ${agent.enabled ? 'text-emerald-400/80' : 'text-on-surface-variant/40'}`}>
          {agent.enabled ? 'active' : 'disabled'}
        </span>
      </div>
    </button>
  )
}
