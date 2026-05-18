'use client'

import { useEffect, useState, useCallback } from 'react'
import { AgentCard } from '@/components/agents/AgentCard'
import { AgentDetailPanel } from '@/components/agents/AgentDetailPanel'
import type { AgentTeamDoc } from '@/components/agents/AgentCard'
import type { HealthStatus } from '@/components/agents/AgentCard'

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

  const pingAllHealth = useCallback(async (agentList: AgentTeamDoc[]) => {
    // Set all to loading first
    setHealthMap(Object.fromEntries(agentList.map((a) => [a.agentId, 'loading' as HealthStatus])))

    // Ping in parallel — update map as each resolves
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
      const res  = await fetch('/api/v1/admin/agents')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load agents')
        return
      }
      const data: AgentTeamDoc[] = body.data ?? []
      setAgents(data)
      pingAllHealth(data)
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
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">
            Platform
          </p>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Agent Team</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Manage the 5 specialist agents that serve your clients.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isSuperAdmin && (
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="pib-btn-primary text-sm font-label flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              New Agent
            </button>
          )}
          <button
            onClick={() => loadAgents()}
            className="pib-btn-ghost text-sm font-label flex items-center gap-1.5"
            title="Refresh"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {isSuperAdmin && showCreate && (
        <form onSubmit={createAgent} className="pib-card p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Agent ID</span>
              <input className="pib-input w-full font-mono text-sm" value={newAgentId} onChange={(e) => setNewAgentId(e.target.value.toLowerCase())} placeholder="zara" required />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Name</span>
              <input className="pib-input w-full text-sm" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Zara" required />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Role</span>
              <input className="pib-input w-full text-sm" value={newRole} onChange={(e) => setNewRole(e.target.value)} required />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Provider / model</span>
              <div className="grid grid-cols-2 gap-2">
                <input className="pib-input w-full font-mono text-sm" value={newProvider} onChange={(e) => setNewProvider(e.target.value)} required />
                <input className="pib-input w-full font-mono text-sm" value={newModel} onChange={(e) => setNewModel(e.target.value)} required />
              </div>
            </label>
          </div>
          <label className="space-y-1 block">
            <span className="text-[10px] font-label uppercase tracking-wide text-on-surface-variant">Persona / SOUL seed</span>
            <textarea className="pib-input w-full min-h-24 resize-y text-sm" value={newPersona} onChange={(e) => setNewPersona(e.target.value)} placeholder="What this agent owns, how it behaves, and when Pip should use it." required />
          </label>
          {createError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{createError}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="pib-btn-ghost text-xs font-label">Cancel</button>
            <button type="submit" disabled={creating} className="pib-btn-primary text-xs font-label disabled:opacity-50">
              {creating ? 'Provisioning...' : 'Create on VPS'}
            </button>
          </div>
        </form>
      )}

      {topError && (
        <div className="pib-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          {topError}
        </div>
      )}

      {/* Agent grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="pib-card p-10 text-center text-sm text-on-surface-variant">
          No agents found. The agent team API may be unavailable.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={closePanel}
            aria-hidden
          />

          {/* Panel */}
          <div
            className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-[var(--color-pib-bg)] border-l border-white/10 shadow-2xl flex flex-col"
            style={{ animation: 'slideIn 0.2s ease-out' }}
          >
            <AgentDetailPanel
              agent={selected}
              onClose={closePanel}
              onSaved={handleSaved}
              canEdit={isSuperAdmin}
            />
          </div>
        </>
      )}

    </div>
  )
}
