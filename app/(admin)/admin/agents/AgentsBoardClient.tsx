'use client'
import { Icon } from '@/components/studio'

import { useEffect, useState, useCallback } from 'react'
import { AgentCard } from '@/components/agents/AgentCard'
import { AgentDetailPanel } from '@/components/agents/AgentDetailPanel'
import type { AgentTeamDoc } from '@/components/agents/AgentCard'
import type { HealthStatus } from '@/components/agents/AgentCard'
import { PageHeader } from '@/components/ui/AppFoundation'
import type { AgentOrgNode } from '@/lib/agent-org/types'

const PLATFORM_ORG_ID = 'pib-platform-owner'

interface SessionInfo {
  isSuperAdmin?: boolean
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

export default function AgentsBoardClient() {
  const [agents, setAgents]           = useState<AgentTeamDoc[]>([])
  const [loading, setLoading]         = useState(true)
  const [topError, setTopError]       = useState<string | null>(null)
  const [healthMap, setHealthMap]     = useState<Record<string, HealthStatus>>({})
  const [selected, setSelected]       = useState<AgentTeamDoc | null>(null)
  const [panelOpen, setPanelOpen]     = useState(false)
  const [showCreate, setShowCreate]   = useState(false)
  const [creating, setCreating]       = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newAgentId, setNewAgentId]   = useState('')
  const [newName, setNewName]         = useState('')
  const [newRole, setNewRole]         = useState('Specialist')
  const [newPersona, setNewPersona]   = useState('')
  const [newModel, setNewModel]       = useState('gpt-5.5')
  const [newProvider, setNewProvider] = useState('openai-codex')
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [orgNodes, setOrgNodes] = useState<AgentOrgNode[]>([])
  const enabledCount = agents.filter((agent) => agent.enabled).length
  const driftedPolicyCount = agents.filter((agent) => {
    const status = agent.skillPolicy?.driftStatus
    return status === 'drifted' || status === 'not_applied' || !agent.skillPolicy
  }).length
  const hardGateCount = agents.reduce((sum, agent) => sum + (agent.skillPolicy?.approvalGates?.length ?? 0), 0)
  const quinnReviewCount = agents.filter((agent) => agent.skillPolicy?.reviewerAgentId === 'qa-release').length
  const capabilityCount = new Set(agents.flatMap((agent) => agent.skillPolicy?.capabilities ?? [])).size
  const installedRuntimeSkillCount = agents.reduce((sum, agent) => sum + (agent.skillPolicy?.runtimeSkills?.length ?? agent.skillPolicy?.pibSkills?.length ?? 0), 0)

  const pingAllHealth = useCallback(async (agentList: AgentTeamDoc[]) => {
    // Set all to loading first
    setHealthMap(Object.fromEntries(agentList.map((a) => [a.agentId, 'loading' as HealthStatus])))

    // Ping in parallel - update map as each resolves
    await Promise.allSettled(
      agentList.map(async (agent) => {
        try {
          const res  = await fetch(`/api/v1/admin/agents/${agent.agentId}/health`)
          const body = await res.json()
          const status: HealthStatus = res.ok
            ? (body.data?.status as HealthStatus) ?? 'unreachable'
            : 'unreachable'
          setHealthMap((prev) => ({ ...prev, [agent.agentId]: status }))
        } catch {
          setHealthMap((prev) => ({ ...prev, [agent.agentId]: 'unreachable' }))
        }
      }),
    )
  }, [])

  const loadAgents = useCallback(async () => {
    setLoading(true)
    setTopError(null)
    try {
      const [agentsRes, orgRes] = await Promise.all([
        fetch('/api/v1/admin/agents'),
        fetch(`/api/v1/admin/agent-org?orgId=${encodeURIComponent(PLATFORM_ORG_ID)}`),
      ])
      const body = await agentsRes.json()
      if (!agentsRes.ok) {
        setTopError(body?.error ?? 'Failed to load agents')
        return
      }
      const data: AgentTeamDoc[] = body.data ?? []
      setAgents(data)
      pingAllHealth(data)

      if (orgRes.ok) {
        const orgBody = await orgRes.json().catch(() => ({}))
        setOrgNodes((orgBody.data?.nodes ?? []) as AgentOrgNode[])
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }, [pingAllHealth])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/verify')
      .then((res) => (res.ok ? res.json() : null))
      .then((session: SessionInfo | null) => {
        if (!cancelled) setIsSuperAdmin(Boolean(session?.isSuperAdmin))
      })
      .catch(() => {
        if (!cancelled) setIsSuperAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function openPanel(agent: AgentTeamDoc) {
    setSelected(agent)
    setPanelOpen(true)
  }

  function closePanel() {
    setPanelOpen(false)
    // Delay clearing selected so exit animation can finish
    setTimeout(() => setSelected(null), 300)
  }

  function handleSaved(updated: AgentTeamDoc) {
    setAgents((prev) => prev.map((a) => (a.agentId === updated.agentId ? updated : a)))
    setSelected(updated)
  }

  async function createAgent(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/v1/admin/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: newAgentId,
          name: newName,
          role: newRole,
          persona: newPersona,
          defaultModel: newModel,
          provider: newProvider,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to create agent (${res.status})`)
      const created = body.data?.agent as AgentTeamDoc
      setAgents((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setHealthMap((prev) => ({ ...prev, [created.agentId]: 'loading' }))
      setShowCreate(false)
      setNewAgentId('')
      setNewName('')
      setNewRole('Specialist')
      setNewPersona('')
      setNewModel('gpt-5.5')
      setNewProvider('openai-codex')
      openPanel(created)
      setTimeout(() => pingAllHealth([created]), 3000)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-module-accent="cyan">
      <PageHeader
        accent="cyan"
        eyebrow="Admin · Platform"
        title="Agent Team"
        description="Administer the specialist agents, runtime profiles, skill policy, health, logs, and gated configuration used by PiB operators. Client organisations only appear as scoped records being administered."
        actions={(
          <>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => setShowCreate((v) => !v)}
                className="st-btn st-btn--primary st-btn--sm font-label inline-flex items-center gap-1.5"
              >
                <Icon name="add" className="text-[16px]" />
                New Agent
              </button>
            )}
            <button
              type="button"
              onClick={() => loadAgents()}
              className="st-btn st-btn--ghost st-btn--sm font-label inline-flex items-center gap-1.5"
              title="Refresh"
            >
              <Icon name="refresh" className="text-[16px]" />
              Refresh
            </button>
          </>
        )}
      />

      {isSuperAdmin && showCreate && (
        <form onSubmit={createAgent} className="st-panel space-y-3 p-4">
          <div className="rounded-lg border border-[var(--color-pib-line)]/60 bg-[var(--color-pib-surface-2)] p-3 text-xs text-[var(--color-pib-text-muted)]">
            Creating an agent here asks Pip to provision the VPS profile, then registers the new profile with the platform dispatch config. You only need to ask Pip manually if this provisioning step fails or the agent needs a non-standard setup.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="sc-tiny">Agent ID</span>
              <input className="st-input w-full font-mono text-sm" value={newAgentId} onChange={(e) => setNewAgentId(e.target.value.toLowerCase())} placeholder="zara" required />
            </label>
            <label className="space-y-1">
              <span className="sc-tiny">Name</span>
              <input className="st-input w-full text-sm" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Zara" required />
            </label>
            <label className="space-y-1">
              <span className="sc-tiny">Role</span>
              <input className="st-input w-full text-sm" value={newRole} onChange={(e) => setNewRole(e.target.value)} required />
            </label>
            <label className="space-y-1">
              <span className="sc-tiny">Provider / model</span>
              <div className="grid grid-cols-2 gap-2">
                <input className="st-input w-full font-mono text-sm" value={newProvider} onChange={(e) => setNewProvider(e.target.value)} required />
                <input className="st-input w-full font-mono text-sm" value={newModel} onChange={(e) => setNewModel(e.target.value)} required />
              </div>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="sc-tiny">Persona / SOUL seed</span>
            <textarea className="st-input min-h-20 w-full resize-y text-sm" value={newPersona} onChange={(e) => setNewPersona(e.target.value)} placeholder="What this agent owns, how it behaves, and when Pip should use it." required />
          </label>
          {createError && <div className="st-panel p-3 text-xs text-[var(--color-error)]">{createError}</div>}
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setShowCreate(false)} className="st-btn st-btn--ghost st-btn--sm font-label">Cancel</button>
            <button type="submit" disabled={creating} className="st-btn st-btn--primary st-btn--sm font-label disabled:opacity-50">
              {creating ? 'Provisioning via Pip...' : 'Provision via Pip'}
            </button>
          </div>
        </form>
      )}

      {topError && (
        <div className="st-panel px-4 py-3 text-sm text-[var(--color-error)]">
          {topError}
        </div>
      )}

      {!loading && agents.length > 0 && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {[
            { label: 'Enabled', value: `${enabledCount}/${agents.length}`, icon: 'power_settings_new' },
            { label: 'Policy Drift', value: String(driftedPolicyCount), icon: 'rule_settings' },
            { label: 'Hard Gates', value: String(hardGateCount), icon: 'approval' },
            { label: 'Quinn Review', value: String(quinnReviewCount), icon: 'verified' },
            { label: 'Capabilities', value: String(capabilityCount), icon: 'admin_panel_settings' },
            { label: 'Runtime Skills', value: String(installedRuntimeSkillCount), icon: 'extension' },
          ].map((item) => (
            <div key={item.label} className="st-panel p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="sc-tiny">{item.label}</span>
                <span aria-hidden="true" className="!h-6 !w-6 !rounded-md">
                  <Icon name={item.icon} className="text-[14px]" />
                </span>
              </div>
              <div className="mt-2 text-lg font-medium text-[var(--color-pib-text)]">{item.value}</div>
            </div>
          ))}
        </section>
      )}

      {/* Agent grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-[6px]" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="st-panel p-6 text-center text-sm text-[var(--color-pib-text-muted)]">
          No agents found. The agent team API may be unavailable.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.agentId}
              agent={agent}
              onClick={() => openPanel(agent)}
              healthStatus={healthMap[agent.agentId] ?? 'loading'}
            />
          ))}
        </div>
      )}

      {/* Slide-over overlay */}
      {panelOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={closePanel}
            aria-hidden
          />

          {/* Panel */}
          <div
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]"
            data-module-accent="cyan"
            style={{ animation: 'slideIn 0.2s ease-out' }}
          >
            <AgentDetailPanel
              agent={selected}
              onClose={closePanel}
              onSaved={handleSaved}
              canEdit={isSuperAdmin}
              orgRole={selected ? {
                orgId: PLATFORM_ORG_ID,
                node: orgNodes.find((n) => n.agentId === selected.agentId) ?? null,
                nodes: orgNodes,
                onNodeSaved: (node) => {
                  if (!node) {
                    setOrgNodes((prev) => prev.filter((n) => n.agentId !== selected.agentId))
                    return
                  }
                  setOrgNodes((prev) => {
                    const idx = prev.findIndex((n) => n.id === node.id)
                    if (idx >= 0) {
                      const next = [...prev]
                      next[idx] = node
                      return next
                    }
                    return [...prev, node]
                  })
                },
                onNodeDeleted: () => {
                  setOrgNodes((prev) => prev.filter((n) => n.agentId !== selected.agentId))
                },
              } : null}
            />
          </div>
        </>
      )}

    </div>
  )
}
