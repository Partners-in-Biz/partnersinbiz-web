'use client'

import { useEffect, useState } from 'react'

type AgentId = string

export type SelectedParticipant =
  | { kind: 'agent'; agentId: AgentId; name: string }
  | { kind: 'user'; uid: string; displayName: string }

interface AgentTeamDoc {
  agentId: AgentId
  name: string
  role: string
  persona: string
  iconKey: string
  colorKey: string
  enabled: boolean
  baseUrl: string
  apiKey: string
  defaultModel: string
  lastHealthStatus?: 'ok' | 'degraded' | 'unreachable'
}

interface OrgContact {
  uid: string
  displayName?: string
  email?: string
  role: string
}

const AGENT_COLOR: Record<string, { dot: string; label: string; icon: string }> = {
  violet:  { dot: 'bg-violet-400', label: 'text-violet-300',  icon: 'text-violet-300' },
  sky:     { dot: 'bg-sky-400',    label: 'text-sky-300',     icon: 'text-sky-300' },
  amber:   { dot: 'bg-amber-400',  label: 'text-amber-300',   icon: 'text-amber-300' },
  emerald: { dot: 'bg-emerald-400',label: 'text-emerald-300', icon: 'text-emerald-300' },
  rose:    { dot: 'bg-rose-400',   label: 'text-rose-300',    icon: 'text-rose-300' },
}

function contactLabel(contact: OrgContact): string {
  return contact.displayName?.trim() || contact.email?.trim() || contact.uid
}

function initials(name?: string): string {
  return name
    ?.split(/[\s.@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '?'
}

interface ParticipantPickerProps {
  orgId: string
  onSelect: (selected: SelectedParticipant[]) => void
  className?: string
  showAgents?: boolean
}

const MAX_SELECTIONS = 5

export default function ParticipantPicker({ orgId, onSelect, className = '', showAgents = true }: ParticipantPickerProps) {
  const [agents, setAgents] = useState<AgentTeamDoc[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [selected, setSelected] = useState<SelectedParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      showAgents
        ? fetch(`/api/v1/orgs/${orgId}/visible-agents`).then((r) => r.json())
        : Promise.resolve({ data: [] }),
      fetch(`/api/v1/orgs/${orgId}/contacts`).then((r) => r.json()),
    ])
      .then(([agentBody, contactBody]) => {
        if (cancelled) return
        setAgents(agentBody.data ?? [])
        setContacts(contactBody.data ?? [])
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load participants')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [orgId, showAgents])

  // Notify parent whenever selection changes
  useEffect(() => {
    onSelect(selected)
  }, [selected, onSelect])

  function toggleAgent(agent: AgentTeamDoc) {
    setSelected((prev) => {
      const exists = prev.some((s) => s.kind === 'agent' && s.agentId === agent.agentId)
      if (exists) return prev.filter((s) => !(s.kind === 'agent' && s.agentId === agent.agentId))
      if (prev.length >= MAX_SELECTIONS) return prev
      return [...prev, { kind: 'agent', agentId: agent.agentId, name: agent.name }]
    })
  }

  function toggleContact(contact: OrgContact) {
    setSelected((prev) => {
      const exists = prev.some((s) => s.kind === 'user' && s.uid === contact.uid)
      if (exists) return prev.filter((s) => !(s.kind === 'user' && s.uid === contact.uid))
      if (prev.length >= MAX_SELECTIONS) return prev
      return [...prev, { kind: 'user', uid: contact.uid, displayName: contactLabel(contact) }]
    })
  }

  function removeSelected(p: SelectedParticipant) {
    setSelected((prev) => {
      if (p.kind === 'agent') return prev.filter((s) => !(s.kind === 'agent' && s.agentId === p.agentId))
      return prev.filter((s) => !(s.kind === 'user' && s.uid === p.uid))
    })
  }

  if (loading) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="pib-skeleton h-8 w-full" />
        <div className="pib-skeleton h-8 w-full" />
        <div className="pib-skeleton h-8 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={`text-xs text-red-300 ${className}`}>{error}</div>
    )
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => {
            const label = p.kind === 'agent' ? p.name : p.displayName
            return (
              <span
                key={p.kind === 'agent' ? p.agentId : p.uid}
                className="inline-flex items-center gap-1 rounded-full bg-primary/20 border border-primary/40 px-2.5 py-0.5 text-xs text-on-surface"
              >
                {label}
                <button
                  type="button"
                  onClick={() => removeSelected(p)}
                  className="ml-0.5 hover:text-red-300 transition-colors"
                  aria-label={`Remove ${label}`}
                >
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </span>
            )
          })}
        </div>
      )}

      {selected.length >= MAX_SELECTIONS && (
        <p className="text-xs text-amber-300">Max {MAX_SELECTIONS} participants.</p>
      )}

      {/* Agents section */}
      {showAgents && agents.length > 0 && (
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2 px-1">Agents</p>
          <div className="space-y-1">
            {agents.map((agent) => {
              const isChecked = selected.some((s) => s.kind === 'agent' && s.agentId === agent.agentId)
              const c = AGENT_COLOR[agent.colorKey] ?? AGENT_COLOR.violet
              const disabled = !isChecked && selected.length >= MAX_SELECTIONS
              return (
                <label
                  key={agent.agentId}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                    isChecked
                      ? 'bg-white/8 border border-white/15'
                      : 'hover:bg-white/5 border border-transparent'
                  } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={disabled}
                    onChange={() => toggleAgent(agent)}
                    className="sr-only"
                  />
                  <div className="w-7 h-7 rounded-full bg-white/8 flex items-center justify-center shrink-0">
                    <span className={`material-symbols-outlined text-[15px] ${c.icon}`}>
                      {agent.iconKey ?? 'smart_toy'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${c.label}`}>{agent.name}</p>
                    <p className="text-[11px] text-on-surface-variant truncate">{agent.role}</p>
                  </div>
                  {agent.lastHealthStatus && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        agent.lastHealthStatus === 'ok'
                          ? 'bg-emerald-400'
                          : agent.lastHealthStatus === 'degraded'
                          ? 'bg-amber-400'
                          : 'bg-red-400'
                      }`}
                    />
                  )}
                  {isChecked && (
                    <span className="material-symbols-outlined text-primary text-[18px]">check_circle</span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* People section */}
      {contacts.length > 0 && (
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-2 px-1 mt-2">People</p>
          <div className="space-y-1">
            {contacts.map((contact) => {
              const isChecked = selected.some((s) => s.kind === 'user' && s.uid === contact.uid)
              const disabled = !isChecked && selected.length >= MAX_SELECTIONS
              const label = contactLabel(contact)
              const inits = initials(label)
              return (
                <label
                  key={contact.uid}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                    isChecked
                      ? 'bg-white/8 border border-white/15'
                      : 'hover:bg-white/5 border border-transparent'
                  } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={disabled}
                    onChange={() => toggleContact(contact)}
                    className="sr-only"
                  />
                  <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-on-surface shrink-0">
                    {inits || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface">{label}</p>
                    {contact.email && <p className="text-[11px] text-on-surface-variant truncate">{contact.email}</p>}
                  </div>
                  {isChecked && (
                    <span className="material-symbols-outlined text-primary text-[18px]">check_circle</span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {agents.length === 0 && contacts.length === 0 && (
        <p className="text-xs text-on-surface-variant px-1">No participants available.</p>
      )}
    </div>
  )
}
