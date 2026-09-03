'use client'

import { Icon } from '@/components/studio'
import { useState } from 'react'
import {
  collectAgentApprovalGates,
  collectAgentCapabilities,
  collectAgentSkillNames,
  type AgentSkillSource,
} from '@/lib/chat/agent-skills'

type AgentId = string

type Participant =
  | { kind: 'user'; uid: string; role: 'admin' | 'client'; displayName?: string }
  | { kind: 'agent'; agentId: AgentId; name: string }

interface ParticipantBarProps {
  participants: Participant[]
  agentDetails?: Record<AgentId, AgentSkillSource>
  className?: string
}

const AGENT_COLOR: Record<string, { dot: string; label: string }> = {
  violet:  { dot: 'bg-[color-mix(in_srgb,var(--st-info)_14%,transparent)]', label: 'text-[var(--st-info)]' },
  sky:     { dot: 'bg-sky-400',    label: 'text-sky-300' },
  amber:   { dot: 'bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]',  label: 'text-[var(--st-warning)]' },
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
  sales: 'sky',
  ads:   'amber',
  'qa-release': 'emerald',
  support: 'sky',
  finance: 'violet',
  people: 'rose',
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

export default function ParticipantBar({ participants, agentDetails = {}, className = '' }: ParticipantBarProps) {
  const [openAgentId, setOpenAgentId] = useState<AgentId | null>(null)
  if (!participants.length) return null

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {participants.map((p) => {
        if (p.kind === 'agent') {
          const colorKey = AGENT_DEFAULT_COLOR[p.agentId] ?? 'violet'
          const c = AGENT_COLOR[colorKey] ?? AGENT_COLOR.violet
          const agent = agentDetails[p.agentId]
          const skills = collectAgentSkillNames(agent)
          const capabilities = collectAgentCapabilities(agent)
          const approvalGates = collectAgentApprovalGates(agent)
          const hasSkillInfo = skills.length > 0 || capabilities.length > 0 || approvalGates.length > 0
          const previewSkills = skills.slice(0, 2)
          const isOpen = openAgentId === p.agentId
          return (
            <span
              key={`agent-${p.agentId}`}
              className="relative inline-flex items-center gap-1.5 rounded-[4px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2.5 py-0.5 text-xs"
            >
              <span className={`w-1.5 h-1.5 rounded-[4px] shrink-0 ${c.dot}`} />
              <span className={c.label}>{p.name}</span>
              {previewSkills.map((skill) => (
                <span
                  key={skill}
                  className="hidden sm:inline-flex pib-pill pib-pill-blue !px-1.5 !py-0.5 !text-[10px] normal-case tracking-normal"
                >
                  {skill}
                </span>
              ))}
              {skills.length > previewSkills.length && (
                <span className="hidden sm:inline text-[10px] text-[var(--color-pib-text-muted)]">+{skills.length - previewSkills.length}</span>
              )}
              {hasSkillInfo && (
                <>
                  <button
                    type="button"
                    aria-label={`Show ${p.name} skills`}
                    title={`Show ${p.name} skills`}
                    onClick={() => setOpenAgentId(isOpen ? null : p.agentId)}
                    className="-mr-1 grid h-5 w-5 place-items-center rounded-[4px] text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-pib-text)]"
                  >
                    <Icon name="psychology" className="text-[13px]" />
                  </button>
                  {isOpen && (
                    <span className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[80vw] rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 text-left">
                      <span className="block text-[10px] font-label uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                        {p.name} skills
                      </span>
                      {skills.length > 0 && (
                        <span className="mt-2 flex flex-wrap gap-1">
                          {skills.map((skill) => (
                            <span key={skill} className="pib-pill pib-pill-blue !px-2 !py-0.5 !text-[11px] normal-case tracking-normal">
                              {skill}
                            </span>
                          ))}
                        </span>
                      )}
                      {capabilities.length > 0 && (
                        <span className="mt-2 block text-[11px] text-[var(--color-pib-text-muted)]">
                          Capabilities: {capabilities.join(', ')}
                        </span>
                      )}
                      {approvalGates.length > 0 && (
                        <span className="mt-1 block text-[11px] text-[var(--color-pib-text-muted)]">
                          Approval gates: {approvalGates.join(', ')}
                        </span>
                      )}
                    </span>
                  )}
                </>
              )}
            </span>
          )
        }

        // User participant
        const name = p.displayName ?? p.uid.slice(0, 8)
        return (
          <span
            key={`user-${p.uid}`}
            className="inline-flex items-center gap-1.5 rounded-[4px] border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2.5 py-0.5 text-xs"
          >
            <span className="pib-status-dot pib-status-dot-blue shrink-0" />
            <span className="text-[var(--color-pib-text-muted)]">{name}</span>
          </span>
        )
      })}
    </div>
  )
}

// Also export initials helper for reuse
export { initials }
