'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { filterAgentsByGate } from '@/lib/conversations/new-conversation-agent-gate'

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

async function readJsonResponse(response: Response): Promise<{ data?: unknown; error?: string }> {
  try {
    return await response.json() as { data?: unknown; error?: string }
  } catch {
    return {}
  }
}

function formatLoadError(error: unknown, fallback: string): string {
  if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
    return 'Could not reach the server. Check your connection, disable privacy blockers for this site, then retry.'
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

interface ParticipantPickerProps {
  orgId: string
  onSelect: (selected: SelectedParticipant[]) => void
  className?: string
  showAgents?: boolean
  /**
   * Extra filter after org-visible agents load.
   * null = no machine filter (platform / general chat).
   * [] = show no agents (awaiting computer, or empty inventory).
   */
  allowedAgentIds?: string[] | null
  agentsUnavailableReason?: string | null
  runtimeTargetId?: string | null
  initialAgentIds?: string[]
}

const MAX_SELECTIONS = 5

export default function ParticipantPicker({
  orgId,
  onSelect,
  className = '',
  showAgents = true,
  allowedAgentIds = null,
  agentsUnavailableReason = null,
  runtimeTargetId = null,
  initialAgentIds = [],
}: ParticipantPickerProps) {
  const [agents, setAgents] = useState<AgentTeamDoc[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [selected, setSelected] = useState<SelectedParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [peopleWarning, setPeopleWarning] = useState<string | null>(null)
  const initialSelectionAppliedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPeopleWarning(null)

    const agentsUrl = `/api/v1/orgs/${orgId}/visible-agents${
      runtimeTargetId ? `?runtimeTarget=${encodeURIComponent(runtimeTargetId)}` : ''
    }`
    // Prefer /people — some privacy filters block paths containing "contacts".
    const peopleUrl = `/api/v1/orgs/${orgId}/people`

    async function loadAgents(): Promise<AgentTeamDoc[]> {
      if (!showAgents) return []
      const response = await fetch(agentsUrl)
      const body = await readJsonResponse(response)
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' && body.error.trim()
          ? body.error
          : `Could not load agents (${response.status})`)
      }
      return Array.isArray(body.data) ? body.data as AgentTeamDoc[] : []
    }

    async function loadPeople(): Promise<OrgContact[]> {
      const response = await fetch(peopleUrl)
      const body = await readJsonResponse(response)
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' && body.error.trim()
          ? body.error
          : `Could not load people (${response.status})`)
      }
      return Array.isArray(body.data) ? body.data as OrgContact[] : []
    }

    // Load independently so a people-list failure (or a privacy filter) cannot
    // hide agents that the caller is allowed to start a conversation with.
    Promise.allSettled([loadAgents(), loadPeople()])
      .then(([agentResult, peopleResult]) => {
        if (cancelled) return

        if (agentResult.status === 'fulfilled') {
          setAgents(agentResult.value)
        } else {
          setAgents([])
          setError(formatLoadError(agentResult.reason, 'Failed to load agents'))
        }

        if (peopleResult.status === 'fulfilled') {
          setContacts(peopleResult.value)
          setPeopleWarning(null)
        } else {
          setContacts([])
          // Soft-fail people so agents remain selectable.
          setPeopleWarning(formatLoadError(peopleResult.reason, 'Could not load people'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [orgId, runtimeTargetId, showAgents])

  const visibleAgents = useMemo(
    () => filterAgentsByGate(agents, allowedAgentIds),
    [agents, allowedAgentIds],
  )

  useEffect(() => {
    if (initialSelectionAppliedRef.current || loading) return
    const initialIds = new Set(initialAgentIds)
    if (initialIds.size === 0) {
      initialSelectionAppliedRef.current = true
      return
    }
    if (!visibleAgents.some((agent) => initialIds.has(agent.agentId))) return
    initialSelectionAppliedRef.current = true
    setSelected(visibleAgents
      .filter((agent) => initialIds.has(agent.agentId))
      .slice(0, MAX_SELECTIONS)
      .map((agent) => ({ kind: 'agent' as const, agentId: agent.agentId, name: agent.name })))
  }, [initialAgentIds, loading, visibleAgents])

  // Drop agent selections that are no longer allowed after context/machine changes.
  useEffect(() => {
    setSelected((prev) => {
      const next = prev.filter((participant) => {
        if (participant.kind !== 'agent') return true
        if (!showAgents) return false
        if (allowedAgentIds == null) return visibleAgents.some((agent) => agent.agentId === participant.agentId)
        return allowedAgentIds.includes(participant.agentId)
      })
      if (next.length === prev.length && next.every((item, index) => item === prev[index])) return prev
      return next
    })
  }, [allowedAgentIds, showAgents, visibleAgents])

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

  // Only hard-fail the whole panel when agents could not load and there are no
  // people either. Agents alone remain usable after a soft people failure.
  if (error && visibleAgents.length === 0 && contacts.length === 0) {
    return (
      <div className={`text-xs text-red-300 ${className}`} data-testid="participants-load-error">
        {error}
      </div>
    )
  }

  const showAgentSection = showAgents
  const agentsBlocked = showAgentSection && visibleAgents.length === 0 && Boolean(agentsUnavailableReason)

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Selected chips — sticky so adding a pick does not shove the list off-screen */}
      {selected.length > 0 && (
        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1.5 bg-[var(--color-surface,#1c1c1c)]/95 px-1 py-1 backdrop-blur-sm">
          {selected.map((p) => {
            const label = p.kind === 'agent' ? p.name : p.displayName
            return (
              <span
                key={p.kind === 'agent' ? p.agentId : p.uid}
                className="inline-flex items-center gap-1 rounded-full bg-primary/20 border border-primary/40 px-2.5 py-0.5 text-xs text-[var(--color-pib-text)]"
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

      {error && (
        <p className="px-1 text-xs text-amber-200" data-testid="participants-agents-warning">
          {error}
        </p>
      )}
      {peopleWarning && (
        <p className="px-1 text-xs text-amber-200" data-testid="participants-people-warning">
          {peopleWarning}
        </p>
      )}

      {/* Agents section — after context + machine in the parent modal */}
      {showAgentSection && (
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-2 px-1">Agents</p>
          {agentsBlocked ? (
            <p data-testid="agents-unavailable-reason" className="px-1 text-xs text-[var(--color-pib-text-muted)]">
              {agentsUnavailableReason}
            </p>
          ) : visibleAgents.length > 0 ? (
            <div className="space-y-1">
              {visibleAgents.map((agent) => {
                const isChecked = selected.some((s) => s.kind === 'agent' && s.agentId === agent.agentId)
                const c = AGENT_COLOR[agent.colorKey] ?? AGENT_COLOR.violet
                const disabled = !isChecked && selected.length >= MAX_SELECTIONS
                return (
                  <label
                    key={agent.agentId}
                    onMouseDown={(event) => {
                      // Keep focus from scrolling parent dialog containers off-screen.
                      if (!disabled) event.preventDefault()
                    }}
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
                      <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{agent.role}</p>
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
          ) : (
            <p className="px-1 text-xs text-[var(--color-pib-text-muted)]">No agents available for this organisation.</p>
          )}
        </div>
      )}

      {/* People section */}
      {contacts.length > 0 && (
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-2 px-1 mt-2">People</p>
          <div className="space-y-1">
            {contacts.map((contact) => {
              const isChecked = selected.some((s) => s.kind === 'user' && s.uid === contact.uid)
              const disabled = !isChecked && selected.length >= MAX_SELECTIONS
              const label = contactLabel(contact)
              const inits = initials(label)
              return (
                <label
                  key={contact.uid}
                  onMouseDown={(event) => {
                    if (!disabled) event.preventDefault()
                  }}
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
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-pib-blue-soft)] text-xs font-bold text-[#93C5FD]">
                    {inits || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-pib-text)]">{label}</p>
                    {contact.email && <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{contact.email}</p>}
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

      {(!showAgentSection || visibleAgents.length === 0) && contacts.length === 0 && !agentsBlocked && (
        <p className="text-xs text-[var(--color-pib-text-muted)] px-1">No participants available.</p>
      )}
    </div>
  )
}
