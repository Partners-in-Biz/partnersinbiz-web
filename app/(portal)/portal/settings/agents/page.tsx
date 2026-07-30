'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

type AgentRow = {
  agentId: string
  agentHandle?: string
  name: string
  role: string
  persona: string
  defaultModel?: string
  iconKey?: string
  colorKey?: string
  homeDeviceId?: string
  accessScope?: 'personal' | 'organization'
  canManage: boolean
  hasAccess: boolean
  provisioningStatus?: 'installing' | 'ready' | 'failed'
  provisioningError?: string | null
}

type DeviceRow = {
  deviceId: string
  label: string
  deviceKind: 'computer' | 'vps'
  ownerType: 'user' | 'organization'
  runtimeVersion?: string
  supportsCustomAgents?: boolean
}

type EditForm = {
  name: string
  role: string
  persona: string
  defaultModel: string
}

export default function OrganisationAgentsPage() {
  const searchParams = useSearchParams()
  const scope = useMemo(() => scopeFromSearchParams(searchParams), [searchParams])
  const endpoint = useCallback((path: string) => scopedApiPath(path, scope), [scope])
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({
    name: '',
    role: '',
    persona: '',
    defaultModel: 'auto',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    agentId: '',
    name: '',
    role: 'Specialist',
    persona: '',
    deviceId: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(endpoint('/api/v1/portal/settings/agents'))
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to load agents')
      setAgents(Array.isArray(body.data?.agents) ? body.data.agents : [])
      setDevices(Array.isArray(body.data?.devices) ? body.data.devices : [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => { void load() }, [load])

  function startEdit(agent: AgentRow) {
    setShowCreate(false)
    setEditingAgentId(agent.agentId)
    setEditForm({
      name: agent.name,
      role: agent.role,
      persona: agent.persona,
      defaultModel: agent.defaultModel || 'auto',
    })
    setMessage('')
  }

  function cancelEdit() {
    setEditingAgentId(null)
  }

  async function createAgent(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(endpoint('/api/v1/portal/settings/agents'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to create agent')
      setShowCreate(false)
      setForm({ agentId: '', name: '', role: 'Specialist', persona: '', deviceId: '' })
      await load()
      setMessage(`${body.data?.agent?.name ?? 'Agent'} is being installed and kept in sync on the selected computer.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to create agent')
    } finally {
      setSaving(false)
    }
  }

  async function saveAgent(event: FormEvent) {
    event.preventDefault()
    if (!editingAgentId) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(endpoint('/api/v1/portal/settings/agents'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: editingAgentId,
          action: 'update',
          name: editForm.name,
          role: editForm.role,
          persona: editForm.persona,
          defaultModel: editForm.defaultModel,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to update agent')
      setEditingAgentId(null)
      await load()
      setMessage(body.data?.message ?? 'Agent updated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update agent')
    } finally {
      setSaving(false)
    }
  }

  async function retryAgent(agentId: string) {
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(endpoint('/api/v1/portal/settings/agents'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to retry agent installation')
      await load()
      setMessage('Agent installation has been queued again.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to retry agent installation')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-module-accent="cyan">
      <PageHeader
        accent="cyan"
        eyebrow="Workspace · Agents"
        title="Organisation agents"
        description="Create and edit agents on computers you own. Organisation owners and admins can also manage shared VPS agents, then grant each member access per computer from Team settings."
        actions={(
          <button
            type="button"
            className="btn-pib-primary btn-pib-sm font-label"
            onClick={() => {
              setEditingAgentId(null)
              setShowCreate((value) => !value)
            }}
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            New agent
          </button>
        )}
      />

      {showCreate && (
        <form onSubmit={createAgent} className="pib-card space-y-4 p-4">
          <p className="text-sm text-[var(--color-pib-text-muted)]">
            Personal computers create a private agent owned by you. Shared VPS creation is available only to organisation owners and admins.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="pib-label">Agent ID</span>
              <input required maxLength={20} className="pib-input w-full font-mono" placeholder="my-research-agent" value={form.agentId} onChange={(event) => setForm((value) => ({ ...value, agentId: event.target.value.toLowerCase() }))} />
            </label>
            <label className="space-y-1">
              <span className="pib-label">Name</span>
              <input required maxLength={100} className="pib-input w-full" placeholder="Research assistant" value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} />
            </label>
            <label className="space-y-1">
              <span className="pib-label">Role</span>
              <input required maxLength={120} className="pib-input w-full" value={form.role} onChange={(event) => setForm((value) => ({ ...value, role: event.target.value }))} />
            </label>
            <label className="space-y-1">
              <span className="pib-label">Computer or VPS</span>
              <select required className="pib-select w-full" value={form.deviceId} onChange={(event) => setForm((value) => ({ ...value, deviceId: event.target.value }))}>
                <option value="">Choose a computer</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId} disabled={!device.supportsCustomAgents}>
                    {device.label} · {device.ownerType === 'organization' ? 'organisation VPS' : 'owned by you'}
                    {!device.supportsCustomAgents ? ' · update required' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="pib-label">Purpose and behaviour</span>
            <textarea required maxLength={20000} className="pib-input min-h-24 w-full" placeholder="What this agent owns, which work it should handle, and how it should behave." value={form.persona} onChange={(event) => setForm((value) => ({ ...value, persona: event.target.value }))} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-pib-ghost btn-pib-sm" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" disabled={saving || devices.length === 0} className="btn-pib-primary btn-pib-sm disabled:opacity-50">
              {saving ? 'Creating…' : 'Create & sync'}
            </button>
          </div>
        </form>
      )}

      {message && <p role="status" className="pib-card px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">{message}</p>}

      <section className="pib-card divide-y divide-[var(--color-pib-line)]">
        {loading ? (
          <p className="p-4 text-sm text-[var(--color-pib-text-muted)]">Loading agents…</p>
        ) : agents.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-pib-text-muted)]">No personal or shared agents are linked to this organisation yet.</p>
        ) : agents.map((agent) => {
          const device = devices.find((row) => row.deviceId === agent.homeDeviceId)
          const isEditing = editingAgentId === agent.agentId
          return (
            <article key={agent.agentId} className="p-4">
              {isEditing ? (
                <form onSubmit={saveAgent} className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] pib-label">Edit agent</p>
                      <p className="mt-0.5 font-mono text-xs text-[var(--color-pib-text-muted)]">
                        {agent.agentHandle ?? agent.agentId}
                      </p>
                    </div>
                    <span className="rounded-full border border-[var(--color-pib-line)] px-2 py-1 text-xs text-[var(--color-pib-text-muted)]">
                      {agent.accessScope === 'organization' ? 'Organisation' : 'Personal'}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="pib-label">Name</span>
                      <input
                        required
                        maxLength={100}
                        className="pib-input w-full"
                        value={editForm.name}
                        onChange={(event) => setEditForm((value) => ({ ...value, name: event.target.value }))}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="pib-label">Role</span>
                      <input
                        required
                        maxLength={120}
                        className="pib-input w-full"
                        value={editForm.role}
                        onChange={(event) => setEditForm((value) => ({ ...value, role: event.target.value }))}
                      />
                    </label>
                    <label className="space-y-1 sm:col-span-2">
                      <span className="pib-label">Preferred model label</span>
                      <input
                        maxLength={200}
                        className="pib-input w-full font-mono text-sm"
                        placeholder="auto"
                        value={editForm.defaultModel}
                        onChange={(event) => setEditForm((value) => ({ ...value, defaultModel: event.target.value }))}
                      />
                      <span className="text-[10px] text-[var(--color-pib-text-muted)]/70">
                        Stored on the agent profile (SOUL). Live provider credentials still come from LLM settings for that computer.
                      </span>
                    </label>
                  </div>
                  <label className="block space-y-1">
                    <span className="pib-label">Purpose and behaviour</span>
                    <textarea
                      required
                      maxLength={20000}
                      className="pib-input min-h-28 w-full"
                      value={editForm.persona}
                      onChange={(event) => setEditForm((value) => ({ ...value, persona: event.target.value }))}
                    />
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className="btn-pib-ghost btn-pib-sm" onClick={cancelEdit} disabled={saving}>
                      Cancel
                    </button>
                    <button type="submit" disabled={saving} className="btn-pib-primary btn-pib-sm disabled:opacity-50">
                      {saving ? 'Saving…' : 'Save & sync profile'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-medium text-[var(--color-pib-text)]">{agent.name}</h2>
                    <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
                      {agent.agentHandle ?? agent.agentId} · {agent.role}
                      {agent.defaultModel ? ` · ${agent.defaultModel}` : ''}
                    </p>
                    <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{agent.persona}</p>
                  </div>
                  <div className="shrink-0 space-y-2 text-right text-xs text-[var(--color-pib-text-muted)]">
                    <span className="inline-block rounded-full border border-[var(--color-pib-line)] px-2 py-1">
                      {agent.accessScope === 'organization' ? 'Organisation' : 'Personal'}
                    </span>
                    <p>{device?.label ?? 'Linked computer'}</p>
                    <p className="capitalize">{agent.provisioningStatus ?? 'ready'}</p>
                    {agent.provisioningError && (
                      <p className="max-w-48 text-[var(--color-error)]">{agent.provisioningError}</p>
                    )}
                    {agent.canManage && (
                      <div className="flex flex-col items-end gap-2 pt-1">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => startEdit(agent)}
                          className="btn-pib-secondary btn-pib-sm disabled:opacity-50"
                        >
                          Edit
                        </button>
                        {agent.provisioningStatus === 'failed' && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void retryAgent(agent.agentId)}
                            className="btn-pib-ghost btn-pib-sm disabled:opacity-50"
                          >
                            Retry install
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </section>
    </div>
  )
}
