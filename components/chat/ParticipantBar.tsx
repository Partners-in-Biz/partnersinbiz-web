'use client'

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
              className="relative inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
              <span className={c.label}>{p.name}</span>
              {previewSkills.map((skill) => (
                <span
                  key={skill}
                  className="hidden sm:inline-flex rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-on-surface-variant"
                >
                  {skill}
                </span>
              ))}
              {skills.length > previewSkills.length && (
                <span className="hidden sm:inline text-[10px] text-on-surface-variant">+{skills.length - previewSkills.length}</span>
              )}
              {hasSkillInfo && (
                <>
                  <button
                    type="button"
                    aria-label={`Show ${p.name} skills`}
                    title={`Show ${p.name} skills`}
                    onClick={() => setOpenAgentId(isOpen ? null : p.agentId)}
                    className="-mr-1 grid h-5 w-5 place-items-center rounded-full text-on-surface-variant hover:bg-white/[0.08] hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-[13px]">psychology</span>
                  </button>
                  {isOpen && (
                    <span className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[80vw] rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-3 text-left shadow-xl">
                      <span className="block text-[10px] font-label uppercase tracking-wide text-on-surface-variant">
                        {p.name} skills
                      </span>
                      {skills.length > 0 && (
                        <span className="mt-2 flex flex-wrap gap-1">
                          {skills.map((skill) => (
                            <span key={skill} className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] text-on-surface">
                              {skill}
                            </span>
                          ))}
                        </span>
                      )}
                      {capabilities.length > 0 && (
                        <span className="mt-2 block text-[11px] text-on-surface-variant">
                          Capabilities: {capabilities.join(', ')}
                        </span>
                      )}
                      {approvalGates.length > 0 && (
                        <span className="mt-1 block text-[11px] text-on-surface-variant">
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
