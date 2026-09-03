'use client'

import { HudChip } from '@/components/ui/HudChip'

import { Icon } from '@/components/studio'

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
  runtimeModel?: {
    source: 'live_config' | 'registry'
    label: string
    primaryProvider?: string
    primaryModel?: string
    fallbackProvider?: string
    fallbackModel?: string
    registryDefaultModel?: string
    staleRegistry: boolean
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
  violet:  'bg-[color-mix(in_srgb,var(--sc-accent)_15%,transparent)] text-[var(--sc-accent)]',
  sky:     'bg-sky-500/15 text-sky-400',
  amber:   'bg-[color-mix(in_srgb,var(--st-warning)_15%,transparent)] text-[var(--st-warning)]',
  emerald: 'bg-emerald-500/15 text-emerald-400',
  rose:    'bg-rose-500/15 text-rose-400',
}

const HEALTH_PILL: Record<HealthStatus, { label: string; className: string }> = {
  ok:          { label: 'Online',      className: 'bg-emerald-500/15 text-emerald-400' },
  degraded:    { label: 'Degraded',    className: 'bg-[color-mix(in_srgb,var(--st-warning)_15%,transparent)] text-[var(--st-warning)]' },
  unreachable: { label: 'Unreachable', className: 'bg-red-500/15 text-[var(--st-danger)]' },
  loading:     { label: 'Checking…',   className: 'bg-white/10 text-[var(--color-pib-text-muted)]' },
}

interface AgentCardProps {
  agent: AgentTeamDoc
  onClick: () => void
  healthStatus?: HealthStatus
}

export function AgentCard({ agent, onClick, healthStatus = 'loading' }: AgentCardProps) {
  const borderClass = COLOR_BORDER[agent.colorKey] ?? 'border-white/20'
  const iconClass   = COLOR_ICON_BG[agent.colorKey] ?? 'bg-white/10 text-[var(--color-pib-text-muted)]'
  const pill        = HEALTH_PILL[healthStatus]
  const runtimeModel = agent.runtimeModel
  const modelLabel = runtimeModel?.label || agent.defaultModel
  const modelSourceLabel = runtimeModel?.source === 'live_config' ? 'Live config' : 'Registry'

  return (
    <button
      type="button"
      onClick={onClick}
      data-module-accent="cyan"
      className={`pib-card w-full cursor-pointer border-l-2 ${borderClass} p-3 text-left transition-colors hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30`}
    >
      {/* Header row */}
      <div className="flex items-start gap-2.5">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconClass}`}>
          <Icon name={agent.iconKey} className="text-[18px]" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium leading-tight text-[var(--color-pib-text)]">{agent.name}</span>
            <span
              className={`h-1.5 w-1.5 shrink-0  ${agent.enabled ? 'bg-emerald-400' : 'bg-white/20'}`}
              title={agent.enabled ? 'Enabled' : 'Disabled'}
            />
          </div>
          <p className="mt-0.5 text-xs leading-snug text-[var(--color-pib-text-muted)]">{agent.role}</p>
        </div>

        <HudChip live={healthStatus === 'ok'} tone={healthStatus === 'ok' ? 'live' : healthStatus === 'loading' ? 'default' : 'accent'} className={pill.className}>
          {pill.label}
        </HudChip>
      </div>

      {/* Persona */}
      <p className="text-xs text-[var(--color-pib-text-muted)] mt-3 leading-relaxed line-clamp-2">
        {agent.persona}
      </p>

      {agent.exampleTaskTypes?.length > 0 && (
        <p className="mt-2 text-[10px] text-[var(--color-pib-text-muted)]/70 line-clamp-1">
          Example: {agent.exampleTaskTypes[0]}
        </p>
      )}

      {/* Footer row */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono text-[var(--color-pib-text-muted)]/80 truncate" title={modelLabel}>
            {modelLabel}
          </span>
          <span className="text-[var(--color-pib-text-muted)]/30 text-[10px]">·</span>
          <span className={`text-[10px] font-label ${agent.enabled ? 'text-emerald-400/80' : 'text-[var(--color-pib-text-muted)]/40'}`}>
            {agent.enabled ? 'active' : 'disabled'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <HudChip tone={runtimeModel?.source === 'live_config' ? 'live' : 'default'} className={runtimeModel?.source === 'live_config' ? 'text-cyan-300' : undefined}>
            {modelSourceLabel}
          </HudChip>
          {runtimeModel?.staleRegistry && (
            <HudChip tone="accent" className="text-[var(--st-warning)]" title={`Stored registry label: ${runtimeModel.registryDefaultModel ?? agent.defaultModel}`}>
              Registry stale
            </HudChip>
          )}
        </div>
      </div>
    </button>
  )
}
