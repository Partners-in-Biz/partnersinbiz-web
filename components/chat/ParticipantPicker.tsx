'use client'

import { Icon } from '@/components/studio'
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
  department?: string
  jobTitle?: string
}

interface WorkforceBlueprintResponse {
  matchSource: 'department' | 'job_title' | 'default'
  member: { jobTitle: string | null; department: string | null }
  blueprint: {
    id: string
    label: string
    summary: string
    recommendedAgentIds: string[]
    specialistGaps: Array<{ id: string; label: string; reason: string }>
  }
  policyEvidence: {
    policyReady: boolean
    policyVersion: string
    agents: Array<{
      agentId: string
      policyDefined: boolean
      policyLabel: string
      expectedSkillCount: number
      approvalGates: string[]
    }>
    skillCoverage: Array<{
      skillId: string
      coveredByAgentIds: string[]
    }>
  }
  recommendationStatus: 'ready_for_owner_review'
  requiresOwnerApproval: true
}

type DepartmentName = string

const AGENT_COLOR: Record<string, { dot: string; label: string; icon: string }> = {
  violet:  { dot: 'bg-[color-mix(in_srgb,var(--st-info)_14%,transparent)]', label: 'text-[var(--st-info)]',  icon: 'text-[var(--st-info)]' },
  sky:     { dot: 'bg-sky-400',    label: 'text-sky-300',     icon: 'text-sky-300' },
  amber:   { dot: 'bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]',  label: 'text-[var(--st-warning)]',   icon: 'text-[var(--st-warning)]' },
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

function normalizeDepartment(value: string | undefined): DepartmentName {
  return value?.trim() || 'Unassigned'
}

function departmentSortKey(department: DepartmentName): string {
  return department.toLowerCase()
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
  workforceBlueprintId?: string | null
}

const MAX_SELECTIONS = 12

export default function ParticipantPicker({
  orgId,
  onSelect,
  className = '',
  showAgents = true,
  allowedAgentIds = null,
  agentsUnavailableReason = null,
  runtimeTargetId = null,
  initialAgentIds = [],
  workforceBlueprintId = null,
}: ParticipantPickerProps) {
  const [agents, setAgents] = useState<AgentTeamDoc[]>([])
  const [contacts, setContacts] = useState<OrgContact[]>([])
  const [workforce, setWorkforce] = useState<WorkforceBlueprintResponse | null>(null)
  const [selected, setSelected] = useState<SelectedParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [peopleWarning, setPeopleWarning] = useState<string | null>(null)
  const initialSelectionAppliedRef = useRef(false)
  const [expandedDepartments, setExpandedDepartments] = useState<Set<DepartmentName>>(new Set())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setPeopleWarning(null)
    setWorkforce(null)

    const agentsUrl = `/api/v1/orgs/${orgId}/visible-agents${
      runtimeTargetId ? `?runtimeTarget=${encodeURIComponent(runtimeTargetId)}` : ''
    }`
    // Prefer /people - some privacy filters block paths containing "contacts".
    const peopleUrl = `/api/v1/orgs/${orgId}/people`
    const workforceBlueprintParam = workforceBlueprintId ? `?blueprint=${encodeURIComponent(workforceBlueprintId)}` : ''
    const workforceUrl = `/api/v1/orgs/${orgId}/workforce-blueprint${workforceBlueprintParam}`

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

    async function loadWorkforce(): Promise<WorkforceBlueprintResponse | null> {
      if (!showAgents) return null
      const response = await fetch(workforceUrl)
      const body = await readJsonResponse(response)
      if (!response.ok || !body.data || typeof body.data !== 'object') return null
      return body.data as WorkforceBlueprintResponse
    }

    // Load independently so a people-list failure (or a privacy filter) cannot
    // hide agents that the caller is allowed to start a conversation with.
    Promise.allSettled([loadAgents(), loadPeople(), loadWorkforce()])
      .then(([agentResult, peopleResult, workforceResult]) => {
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

        setWorkforce(workforceResult.status === 'fulfilled' ? workforceResult.value : null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [orgId, runtimeTargetId, showAgents, workforceBlueprintId])

  const visibleAgents = useMemo(
    () => filterAgentsByGate(agents, allowedAgentIds),
    [agents, allowedAgentIds],
  )
  const recommendedAgentIds = useMemo(
    () => new Set(workforce?.blueprint.recommendedAgentIds ?? []),
    [workforce],
  )
  const orderedAgents = useMemo(() => {
    const recommendedOrder = new Map(
      (workforce?.blueprint.recommendedAgentIds ?? []).map((agentId, index) => [agentId, index]),
    )
    return visibleAgents
      .map((agent, index) => ({ agent, index }))
      .sort((left, right) => {
        const leftOrder = recommendedOrder.get(left.agent.agentId)
        const rightOrder = recommendedOrder.get(right.agent.agentId)
        if (leftOrder != null && rightOrder != null) return leftOrder - rightOrder
        if (leftOrder != null) return -1
        if (rightOrder != null) return 1
        return left.index - right.index
      })
      .map(({ agent }) => agent)
  }, [visibleAgents, workforce])

  const peopleByDepartment = useMemo(() => {
    const byDepartment = new Map<DepartmentName, OrgContact[]>()
    for (const contact of contacts) {
      const department = normalizeDepartment(contact.department)
      const bucket = byDepartment.get(department) ?? []
      bucket.push(contact)
      byDepartment.set(department, bucket)
    }
    return Array.from(byDepartment.entries())
      .sort(([left], [right]) => departmentSortKey(left).localeCompare(departmentSortKey(right)))
      .map(([department, members]) => ({
        department,
        members,
      }))
  }, [contacts])

  const selectedUserIds = useMemo(
    () => new Set(selected.filter((participant): participant is Extract<SelectedParticipant, { kind: 'user' }> => participant.kind === 'user').map((participant) => participant.uid)),
    [selected],
  )

  const selectedDepartmentIds = useMemo(() => {
    const map = new Map<DepartmentName, { total: number; selected: number }>()
    for (const { department, members } of peopleByDepartment) {
      const selectedCount = members.reduce((count, member) => count + (selectedUserIds.has(member.uid) ? 1 : 0), 0)
      map.set(department, { total: members.length, selected: selectedCount })
    }
    return map
  }, [peopleByDepartment, selectedUserIds])

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

  useEffect(() => {
    if (expandedDepartments.size > 0 || peopleByDepartment.length === 0) return
    setExpandedDepartments(new Set(peopleByDepartment.map(({ department }) => department)))
  }, [peopleByDepartment, expandedDepartments.size])

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

  function toggleDepartmentSelection(department: DepartmentName, members: OrgContact[]) {
    setSelected((prev) => {
      const departmentSelected = members.every((member) => selectedUserIds.has(member.uid))
      if (departmentSelected) {
        return prev.filter((participant) => {
          return !(participant.kind === 'user' && members.some((member) => member.uid === participant.uid))
        })
      }

      const next = [...prev]
      const availableSlots = Math.max(0, MAX_SELECTIONS - next.length)
      if (availableSlots <= 0) return prev
      let remaining = availableSlots
      for (const member of members) {
        if (selectedUserIds.has(member.uid)) continue
        if (remaining <= 0) break
        next.push({ kind: 'user', uid: member.uid, displayName: contactLabel(member) })
        remaining -= 1
      }
      return next
    })
  }

  function removeSelected(p: SelectedParticipant) {
    setSelected((prev) => {
      if (p.kind === 'agent') return prev.filter((s) => !(s.kind === 'agent' && s.agentId === p.agentId))
      return prev.filter((s) => !(s.kind === 'user' && s.uid === p.uid))
    })
  }

  const showAgentSection = showAgents
  const agentsBlocked = showAgentSection && visibleAgents.length === 0 && Boolean(agentsUnavailableReason)
  const recommendedAvailableCount = workforce
    ? workforce.blueprint.recommendedAgentIds.filter((agentId) => visibleAgents.some((agent) => agent.agentId === agentId)).length
    : 0
  const recommendedMissingCount = workforce
    ? Math.max(0, workforce.blueprint.recommendedAgentIds.length - recommendedAvailableCount)
    : 0
  const missingCoverage = useMemo(
    () => workforce?.policyEvidence.skillCoverage.filter((coverage) => coverage.coveredByAgentIds.length === 0) ?? [],
    [workforce],
  )
  const missingPolicies = useMemo(
    () => workforce?.policyEvidence.agents.filter((agent) => !agent.policyDefined) ?? [],
    [workforce],
  )
  const policyByAgent = useMemo(
    () => new Map(workforce?.policyEvidence.agents.map((agent) => [agent.agentId, agent]) ?? []),
    [workforce],
  )
  const skillCoverageByAgent = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!workforce) return map
    for (const coverage of workforce.policyEvidence.skillCoverage) {
      for (const agentId of coverage.coveredByAgentIds) {
        const current = map.get(agentId) ?? []
        current.push(coverage.skillId)
        map.set(agentId, current)
      }
    }
    return map
  }, [workforce])

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

  return (
    <div className={`space-y-3 ${className}`} data-testid="participant-picker">
      {/*
        Selected chips sit in normal flow (not sticky). Sticky chips inside a nested
        overflow region reflow height on first pick and, with browser focus/scroll
        anchoring, shoved the whole New conversation dialog off the top of the screen.
      */}
      {selected.length > 0 && (
        <div
          data-testid="participant-picker-chips"
          className="-mx-1 flex flex-wrap gap-1.5 px-1 py-1"
        >
          {selected.map((p) => {
            const label = p.kind === 'agent' ? p.name : p.displayName
            return (
              <span
                key={p.kind === 'agent' ? p.agentId : p.uid}
                className="inline-flex items-center gap-1 rounded-[4px] bg-primary/20 border border-primary/40 px-2.5 py-0.5 text-xs text-[var(--color-pib-text)]"
              >
                {label}
                <button
                  type="button"
                  onClick={() => removeSelected(p)}
                  onMouseDown={(event) => event.preventDefault()}
                  className="ml-0.5 hover:text-red-300 transition-colors"
                  aria-label={`Remove ${label}`}
                >
                  <Icon name="close" className="text-[12px]" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      {selected.length >= MAX_SELECTIONS && (
        <p className="text-xs text-[var(--st-warning)]">Max {MAX_SELECTIONS} participants.</p>
      )}

      {error && (
        <p className="px-1 text-xs text-[var(--st-warning)]" data-testid="participants-agents-warning">
          {error}
        </p>
      )}
      {peopleWarning && (
        <p className="px-1 text-xs text-[var(--st-warning)]" data-testid="participants-people-warning">
          {peopleWarning}
        </p>
      )}

      {/* Agents section - after context + machine in the parent modal */}
      {showAgentSection && (
        <div>
          {workforce && (
            <div
              data-testid="workforce-blueprint"
              className="mb-3 rounded-[6px] border border-primary/20 bg-primary/[0.06] px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <p className="text-xs font-medium text-[var(--color-pib-text)]">
                  Recommended for {workforce.blueprint.label}
                </p>
                <span className="rounded-[4px] bg-white/[0.06] px-2 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">
                  {recommendedAvailableCount}/{workforce.blueprint.recommendedAgentIds.length} available here
                </span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
                {workforce.blueprint.summary}
              </p>
              <p className="mt-1.5 text-[10px] text-[var(--color-pib-text-muted)]">
                Policy ready: {workforce.policyEvidence.policyReady ? 'yes' : 'no'}
                {` • policy v${workforce.policyEvidence.policyVersion}`}
              </p>
              {!workforce.policyEvidence.policyReady && missingCoverage.length > 0 && (
                <p className="mt-1 text-[10px] text-[var(--st-warning)]">
                  Skill coverage gaps: {missingCoverage.map((coverage) => coverage.skillId).join(', ')}
                </p>
              )}
              {missingPolicies.length > 0 && (
                <p className="mt-1 text-[10px] text-[var(--st-warning)]">
                  {missingPolicies.length} recommended agents are missing policy definitions.
                </p>
              )}
              {recommendedMissingCount > 0 && (
                <p className="mt-1.5 text-[10px] text-[var(--st-warning)]">
                  {recommendedMissingCount} recommended {recommendedMissingCount === 1 ? 'agent needs' : 'agents need'} an owner grant or ready runtime.
                </p>
              )}
              {workforce.blueprint.specialistGaps.map((gap) => (
                <p key={gap.id} className="mt-1.5 text-[10px] text-[var(--st-warning)]" title={gap.reason}>
                  Gap: {gap.label} is not provisioned yet.
                </p>
              ))}
              <p className="mt-1.5 text-[10px] text-[var(--color-pib-text-muted)]">
                Recommendations do not change your access.
              </p>
            </div>
          )}
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)] mb-2 px-1">Agents</p>
          {agentsBlocked ? (
            <p data-testid="agents-unavailable-reason" className="px-1 text-xs text-[var(--color-pib-text-muted)]">
              {agentsUnavailableReason}
            </p>
          ) : visibleAgents.length > 0 ? (
            <div className="space-y-1" role="group" aria-label="Agents">
              {orderedAgents.map((agent) => {
                const isChecked = selected.some((s) => s.kind === 'agent' && s.agentId === agent.agentId)
                const c = AGENT_COLOR[agent.colorKey] ?? AGENT_COLOR.violet
                const disabled = !isChecked && selected.length >= MAX_SELECTIONS
                const policy = policyByAgent.get(agent.agentId)
                const coverage = skillCoverageByAgent.get(agent.agentId) ?? []
                // Use a button (not a native checkbox) so pick focus cannot
                // scrollIntoView parent dialog containers off-screen.
                return (
                  <button
                    key={agent.agentId}
                    type="button"
                    role="checkbox"
                    aria-checked={isChecked}
                    aria-label={`${agent.name} ${agent.role}`.trim()}
                    disabled={disabled}
                    onMouseDown={(event) => {
                      // Prevent focus transfer → scroll jump of the dialog.
                      event.preventDefault()
                    }}
                    onClick={() => {
                      if (!disabled) toggleAgent(agent)
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${ isChecked ? 'bg-white/8 border border-white/15' : 'hover:bg-white/5 border border-transparent' } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="w-7 h-7 rounded-[4px] bg-white/8 flex items-center justify-center shrink-0">
                      <Icon name={agent.iconKey ?? 'smart_toy'} className={`text-[15px] ${c.icon}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className={`truncate text-sm font-medium ${c.label}`}>{agent.name}</p>
                        {recommendedAgentIds.has(agent.agentId) && (
                          <span className="shrink-0 rounded-[4px] border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                            Recommended
                          </span>
                        )}
                        {policy && !policy.policyDefined && (
                          <span className="shrink-0 rounded-[4px] border border-red-300/35 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-medium text-red-200">
                            Policy missing
                          </span>
                        )}
                        {policy && policy.policyDefined && policy.approvalGates.length > 0 && !policy.approvalGates.includes('approve') && (
                          <span className="shrink-0 rounded-[4px] border border-amber-300/25 bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--st-warning)]">
                            Approval gated
                          </span>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{agent.role}</p>
                        {policy && policy.policyDefined && coverage.length > 0 && (
                          <span className="rounded-[4px] bg-white/[0.08] px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">
                            Covers {coverage.length} required skill{coverage.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>
                    {agent.lastHealthStatus && (
                      <span
                        className={`w-1.5 h-1.5 rounded-[4px] shrink-0 ${ agent.lastHealthStatus === 'ok' ? 'bg-emerald-400' : agent.lastHealthStatus === 'degraded' ? 'bg-[color-mix(in_srgb,var(--st-warning)_14%,transparent)]' : 'bg-red-400' }`}
                      />
                    )}
                    {isChecked && (
                      <Icon name="check_circle" className="text-primary text-[18px]" />
                    )}
                  </button>
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
          <div className="space-y-2">
            {peopleByDepartment.map(({ department, members }) => {
              const selectedCount = selectedDepartmentIds.get(department)?.selected ?? 0
              const totalCount = members.length
              const allSelected = totalCount > 0 && selectedCount === totalCount
              const someSelected = selectedCount > 0
              const groupDisabled = selected.length >= MAX_SELECTIONS && !allSelected
              const isExpanded = expandedDepartments.has(department)
              return (
                <div key={department} className="space-y-1.5 rounded-[6px] border border-white/[0.08] px-2 py-2">
                  <label
                    onMouseDown={(event) => {
                      if (!groupDisabled) event.preventDefault()
                    }}
                    className={`flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors ${ allSelected || someSelected ? 'bg-white/8 border border-white/15' : 'hover:bg-white/5 border border-transparent' } ${groupDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(element) => {
                        if (element) element.indeterminate = Boolean(someSelected && !allSelected)
                      }}
                      disabled={groupDisabled}
                      onChange={() => toggleDepartmentSelection(department, members)}
                      aria-label={`Select department ${department} (${selectedCount}/${totalCount})`}
                      className="sr-only"
                    />
                    <Icon name={isExpanded ? 'expand_less' : 'expand_more'} className="text-sm text-[var(--color-pib-text-muted)]" />
                    <span className="min-w-0 flex-1">
                      <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--color-pib-text)]">
                        {department}
                      </span>
                      <span className="text-[10px] text-[var(--color-pib-text-muted)]">
                        {selectedCount}/{totalCount} selected
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedDepartments((current) => {
                        const next = new Set(current)
                        if (next.has(department)) next.delete(department)
                        else next.add(department)
                        return next
                      })}
                      className="pib-icon-button text-[11px] text-primary"
                      aria-label={`Toggle ${department} contacts`}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      <Icon name={isExpanded ? 'unfold_less' : 'unfold_more'} className="text-[16px]" />
                    </button>
                  </label>
                  {isExpanded && (
                    <div className="space-y-1">
                      {members.map((contact) => {
                        const isChecked = selected.some((s) => s.kind === 'user' && s.uid === contact.uid)
                        const disabled = !isChecked && selected.length >= MAX_SELECTIONS
                        const label = contactLabel(contact)
                        const roleLabel = contact.jobTitle
                          || contact.department
                          || (contact.role === 'admin' ? 'Admin' : 'Member')
                        const inits = initials(label)
                        return (
                          <button
                            key={contact.uid}
                            type="button"
                            role="checkbox"
                            aria-checked={isChecked}
                            aria-label={label}
                            disabled={disabled}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              if (!disabled) toggleContact(contact)
                            }}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${ isChecked ? 'bg-white/8 border border-white/15' : 'hover:bg-white/5 border border-transparent' } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] bg-[color-mix(in_srgb,var(--sc-ink)_6%,transparent)] text-xs font-medium text-[#93C5FD]">
                              {inits || '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-[var(--color-pib-text)]">{label}</p>
                              {contact.email && <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{contact.email}</p>}
                              <p className="text-[11px] text-[var(--color-pib-text-muted)] truncate">{roleLabel}</p>
                            </div>
                            {isChecked && (
                              <Icon name="check_circle" className="text-primary text-[18px]" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
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
