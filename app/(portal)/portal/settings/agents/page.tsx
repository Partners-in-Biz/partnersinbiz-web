'use client'

import { Icon } from '@/components/studio'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import { CreateAgentOnMachineForm } from '@/components/agents/CreateAgentOnMachineForm'
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
  agentKind?: 'custom' | 'marketplace'
  marketplaceTemplateId?: string
  marketplaceSkills?: string[]
  isMarketplace?: boolean
  canManage: boolean
  canEdit?: boolean
  canConfigureMarketplace?: boolean
  installedSkills?: string[]
  hasAccess: boolean
  provisioningStatus?: 'installing' | 'ready' | 'failed'
  provisioningError?: string | null
}

type SkillListing = {
  skillId: string
  name: string
  description: string
  tier: 'public'
  packVersion: string
  usedByTemplates: string[]
  available: boolean
}

type DeviceRow = {
  deviceId: string
  label: string
  deviceKind: 'computer' | 'vps'
  ownerType: 'user' | 'organization'
  runtimeVersion?: string
  supportsCustomAgents?: boolean
}

type MarketplaceRow = {
  templateId: string
  name: string
  role: string
  summary: string
  iconKey: string
  colorKey: string
  publicSkillCount: number
  publicSkills: string[]
  editable: false
  pack: 'public'
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
  const [marketplace, setMarketplace] = useState<MarketplaceRow[]>([])
  const [skills, setSkills] = useState<SkillListing[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'machines' | 'marketplace'>('machines')
  const [showCreate, setShowCreate] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [skillsAgentId, setSkillsAgentId] = useState<string | null>(null)
  const [selectedSkills, setSelectedSkills] = useState<string[]>([])
  const [pullTemplateId, setPullTemplateId] = useState<string | null>(null)
  const [pullDeviceId, setPullDeviceId] = useState('')
  const [uninstallAgentId, setUninstallAgentId] = useState<string | null>(null)
  const [uninstallDeviceId, setUninstallDeviceId] = useState('')
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
  const [shareMembers, setShareMembers] = useState<Array<{ uid: string; displayName?: string | null; email?: string | null }>>([])

  const load = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(endpoint('/api/v1/portal/settings/agents'))
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to load agents')
      setAgents(Array.isArray(body.data?.agents) ? body.data.agents : [])
      setDevices(Array.isArray(body.data?.devices) ? body.data.devices : [])
      setMarketplace(Array.isArray(body.data?.marketplace) ? body.data.marketplace : [])
      setSkills(Array.isArray(body.data?.skills) ? body.data.skills : [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const orgId = scope.orgId
    if (!orgId) return
    fetch(`/api/v1/organizations/${encodeURIComponent(orgId)}/members`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const rows = Array.isArray(body?.data) ? body.data : []
        setShareMembers(rows.flatMap((row: { uid?: string; userId?: string; displayName?: string; email?: string }) => {
          const uid = row.uid || row.userId
          if (!uid) return []
          return [{ uid, displayName: row.displayName ?? null, email: row.email ?? null }]
        }))
      })
      .catch(() => {})
  }, [scope.orgId])

  const customAgents = useMemo(
    () => agents.filter((agent) => !agent.isMarketplace && agent.agentKind !== 'marketplace'),
    [agents],
  )
  const marketplaceInstalled = useMemo(
    () => agents.filter((agent) => agent.isMarketplace || agent.agentKind === 'marketplace'),
    [agents],
  )

  const agentsForDevice = useCallback(
    (deviceId: string) => agents.filter((agent) => agent.homeDeviceId === deviceId),
    [agents],
  )

  function revealMachineSection(id: string) {
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function startCreateAgent() {
    setActiveTab('machines')
    setEditingAgentId(null)
    setPullTemplateId(null)
    setShowCreate(true)
    revealMachineSection('new-custom-agent')
  }

  function startEdit(agent: AgentRow) {
    if (!agent.canEdit && !agent.canManage) return
    setActiveTab('machines')
    setShowCreate(false)
    setPullTemplateId(null)
    setEditingAgentId(agent.agentId)
    setEditForm({
      name: agent.name,
      role: agent.role,
      persona: agent.persona,
      defaultModel: agent.defaultModel || 'auto',
    })
    setMessage('')
    revealMachineSection(`custom-agent-${agent.agentId}`)
  }

  function cancelEdit() {
    setEditingAgentId(null)
  }

  async function createAgent(input: {
    name: string
    role: string
    persona: string
    deviceId: string
    agentHandle?: string
    accessMode: 'personal' | 'organization' | 'people'
    sharedWithUserIds: string[]
  }) {
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(endpoint('/api/v1/portal/settings/agents'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: input.agentHandle || form.agentId,
          name: input.name,
          role: input.role,
          persona: input.persona,
          deviceId: input.deviceId,
          accessMode: input.accessMode,
          sharedWithUserIds: input.sharedWithUserIds,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to create agent')
      setShowCreate(false)
      setForm({ agentId: '', name: '', role: 'Specialist', persona: '', deviceId: '' })
      await load()
      setMessage(`${body.data?.agent?.name ?? 'Agent'} is being installed on the selected computer. It will appear there once that machine hosts it.`)
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

  async function pullMarketplace(event: FormEvent) {
    event.preventDefault()
    if (!pullTemplateId || !pullDeviceId) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(endpoint('/api/v1/portal/settings/agents/marketplace/pull'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: pullTemplateId, deviceId: pullDeviceId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to pull marketplace agent')
      setPullTemplateId(null)
      setPullDeviceId('')
      await load()
      setMessage(body.data?.message ?? 'Marketplace agent is installing.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to pull marketplace agent')
    } finally {
      setSaving(false)
    }
  }

  function startSkillsConfig(agent: AgentRow) {
    if (!agent.canConfigureMarketplace) return
    setSkillsAgentId(agent.agentId)
    setSelectedSkills(agent.installedSkills ?? agent.marketplaceSkills ?? [])
    setPullTemplateId(null)
    setEditingAgentId(null)
    setUninstallAgentId(null)
  }

  async function saveMarketplaceSkills(event: FormEvent) {
    event.preventDefault()
    if (!skillsAgentId) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(endpoint('/api/v1/portal/settings/agents/marketplace/skills'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: skillsAgentId, skills: selectedSkills }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to update skills')
      setSkillsAgentId(null)
      await load()
      setMessage(body.data?.message ?? 'Skills updated.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update skills')
    } finally {
      setSaving(false)
    }
  }

  async function uninstallMarketplace(event: FormEvent) {
    event.preventDefault()
    if (!uninstallAgentId || !uninstallDeviceId) return
    setSaving(true)
    setMessage('')
    try {
      const response = await fetch(endpoint('/api/v1/portal/settings/agents/marketplace/uninstall'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: uninstallAgentId, deviceId: uninstallDeviceId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Failed to uninstall agent')
      setUninstallAgentId(null)
      setUninstallDeviceId('')
      await load()
      setMessage(body.data?.message ?? 'Uninstall queued.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to uninstall agent')
    } finally {
      setSaving(false)
    }
  }

  function toggleSkill(skillId: string) {
    setSelectedSkills((current) => (
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId].sort()
    ))
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-module-accent="cyan">
      <PageHeader
        accent="cyan"
        eyebrow="Workspace · Agents"
        title="Agents"
        description="Pull system agent templates onto computers you own (public skills only), or create your own custom agents. System/platform employees are never edited here."
        actions={(
          <button
            type="button"
            className="btn-pib-primary btn-pib-sm font-label"
            onClick={startCreateAgent}
          >
            <Icon name="add" />
            New custom agent
          </button>
        )}
      />

      {message && <p role="status" className="pib-card px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">{message}</p>}

      <div className="border-b border-[var(--color-pib-line)]" role="tablist" aria-label="Agent management views">
        <button
          type="button"
          id="agents-machines-tab"
          role="tab"
          aria-selected={activeTab === 'machines'}
          aria-controls="agents-machines-panel"
          className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'machines' ? 'border-primary text-[var(--color-pib-text)]' : 'border-transparent text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'}`}
          onClick={() => setActiveTab('machines')}
        >
          Machines & agents
        </button>
        <button
          type="button"
          id="agents-marketplace-tab"
          role="tab"
          aria-selected={activeTab === 'marketplace'}
          aria-controls="agents-marketplace-panel"
          className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'marketplace' ? 'border-primary text-[var(--color-pib-text)]' : 'border-transparent text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'}`}
          onClick={() => setActiveTab('marketplace')}
        >
          Marketplace
        </button>
      </div>

      {activeTab === 'machines' && (
        <section id="agents-machines-panel" role="tabpanel" aria-labelledby="agents-machines-tab" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm text-[var(--color-pib-text)]">Machines and their agents</h2>
              <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                See exactly which agents belong to each linked machine. You can change only agents and machines you own or have been granted access to.
              </p>
            </div>
            <Link href="/portal/settings/linked-computers" className="btn-pib-secondary btn-pib-sm">
              Manage machines
            </Link>
          </div>

          {loading ? (
            <p className="pib-card p-4 text-sm text-[var(--color-pib-text-muted)]">Loading machines…</p>
          ) : devices.length === 0 ? (
            <div className="pib-card p-4 text-sm text-[var(--color-pib-text-muted)]">
              No active machines are available to this workspace yet. <Link href="/portal/settings/linked-computers" className="text-primary underline">Link or manage a machine</Link> before adding an agent.
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {devices.map((device) => {
                const machineAgents = agentsForDevice(device.deviceId)
                return (
                  <article key={device.deviceId} className="pib-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-medium text-[var(--color-pib-text)]">{device.label}</h3>
                        <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
                          {device.deviceKind === 'vps' ? 'VPS' : 'Computer'} · {device.ownerType === 'organization' ? 'organisation-managed' : 'owned by you'}
                          {device.runtimeVersion ? ` · runtime ${device.runtimeVersion}` : ''}
                        </p>
                      </div>
                      <span className={`rounded border px-2 py-1 text-[10px] ${device.supportsCustomAgents ? 'border-emerald-500/40 text-emerald-300' : 'border-[var(--sc-line)] text-[var(--st-warning)]'}`}>
                        {device.supportsCustomAgents ? 'Agent-ready' : 'Update required'}
                      </span>
                    </div>
                    <div className="mt-4 space-y-2 border-t border-[var(--color-pib-line)] pt-3">
                      {machineAgents.length === 0 ? (
                        <p className="text-sm text-[var(--color-pib-text-muted)]">No workspace agents installed on this machine.</p>
                      ) : machineAgents.map((agent) => (
                        <div key={agent.agentId} className="flex items-center justify-between gap-3 rounded-md bg-[var(--color-pib-surface-muted)] px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[var(--color-pib-text)]">{agent.name}</p>
                            <p className="truncate text-[11px] text-[var(--color-pib-text-muted)]">
                              {agent.agentKind === 'marketplace' || agent.isMarketplace ? 'Marketplace' : 'Custom'} · {agent.role} · {agent.provisioningStatus ?? 'ready'}
                            </p>
                          </div>
                          {(agent.canEdit || agent.canManage || agent.canConfigureMarketplace) && (
                            <button
                              type="button"
                              className="btn-pib-secondary btn-pib-sm shrink-0"
                              onClick={() => {
                                if (agent.agentKind === 'marketplace' || agent.isMarketplace) {
                                  startSkillsConfig(agent)
                                  revealMachineSection('marketplace-agents')
                                } else {
                                  startEdit(agent)
                                }
                              }}
                            >
                              {agent.agentKind === 'marketplace' || agent.isMarketplace ? 'Manage' : 'Edit'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* Marketplace catalog */}
      {activeTab === 'marketplace' && (
      <section id="agents-marketplace-panel" role="tabpanel" aria-labelledby="agents-marketplace-tab" className="space-y-3">
        <div>
          <h2 className="text-sm text-[var(--color-pib-text)]">Marketplace templates</h2>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Install a published agent onto your computer. You get runtime skills suitable for general work - not Partners in Biz internal ops, client data, or admin powers. Templates cannot be edited.
          </p>
        </div>

        {pullTemplateId && (
          <form onSubmit={pullMarketplace} className="pib-card space-y-3 p-4">
            <p className="text-sm text-[var(--color-pib-text)]">
              Pull <strong>{marketplace.find((row) => row.templateId === pullTemplateId)?.name ?? pullTemplateId}</strong> to a computer
            </p>
            <label className="block space-y-1">
              <span className="pib-label">Computer or VPS</span>
              <select
                required
                className="pib-select w-full"
                value={pullDeviceId}
                onChange={(event) => setPullDeviceId(event.target.value)}
              >
                <option value="">Choose a computer</option>
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId} disabled={!device.supportsCustomAgents}>
                    {device.label} · {device.ownerType === 'organization' ? 'organisation VPS' : 'owned by you'}
                    {!device.supportsCustomAgents ? ' · runtime update required' : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[10px] text-[var(--color-pib-text-muted)]/80">
              Pack: public skills only. Your own LLM credentials on that computer are used - never org secrets from another machine.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-pib-ghost btn-pib-sm" onClick={() => { setPullTemplateId(null); setPullDeviceId('') }}>
                Cancel
              </button>
              <button type="submit" disabled={saving || !pullDeviceId} className="btn-pib-primary btn-pib-sm disabled:opacity-50">
                {saving ? 'Pulling…' : 'Pull to computer'}
              </button>
            </div>
          </form>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {loading ? (
            <p className="pib-card p-4 text-sm text-[var(--color-pib-text-muted)] sm:col-span-2">Loading marketplace…</p>
          ) : marketplace.map((template) => (
            <article key={template.templateId} className="pib-card flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <Icon name={template.iconKey} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-[var(--color-pib-text)]">{template.name}</h3>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">{template.role}</p>
                  <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{template.summary}</p>
                  <p className="mt-2 text-[10px] text-[var(--color-pib-text-muted)]/70">
                    {template.publicSkillCount} public skills · not editable
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={saving || devices.length === 0}
                  className="btn-pib-secondary btn-pib-sm disabled:opacity-50"
                  onClick={() => {
                    setShowCreate(false)
                    setEditingAgentId(null)
                    setPullTemplateId(template.templateId)
                    setPullDeviceId(devices[0]?.deviceId ?? '')
                  }}
                >
                  Pull to computer
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      )}

      {/* Skills marketplace */}
      {activeTab === 'marketplace' && (
      <section className="space-y-3">
        <div>
          <h2 className="text-sm text-[var(--color-pib-text)]">Skills marketplace</h2>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Public skills only. Attach these to marketplace agents you own. PiB ops skills (CRM, client documents, CEO gatherers, etc.) are never listed here.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {loading ? (
            <p className="pib-card p-4 text-sm text-[var(--color-pib-text-muted)] sm:col-span-2">Loading skills…</p>
          ) : skills.length === 0 ? (
            <p className="pib-card p-4 text-sm text-[var(--color-pib-text-muted)] sm:col-span-2">No public skills published yet.</p>
          ) : skills.map((skill) => (
            <article key={skill.skillId} className="pib-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-pib-text)]">{skill.name}</h3>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--color-pib-text-muted)]">{skill.skillId}</p>
                </div>
                <span className="rounded border border-[var(--color-pib-line)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-pib-text-muted)]">
                  {skill.tier}
                </span>
              </div>
              <p className="mt-2 text-xs text-[var(--color-pib-text-muted)] line-clamp-3">{skill.description}</p>
              <p className="mt-2 text-[10px] text-[var(--color-pib-text-muted)]/70">
                {skill.available ? 'Available' : 'Missing pack files'}
                {skill.usedByTemplates.length > 0 ? ` · defaults on ${skill.usedByTemplates.join(', ')}` : ''}
                {' · '}{skill.packVersion}
              </p>
            </article>
          ))}
        </div>
      </section>
      )}

      {/* Installed marketplace instances */}
      {activeTab === 'machines' && marketplaceInstalled.length > 0 && (
        <section id="marketplace-agents" className="space-y-3">
          <h2 className="text-sm text-[var(--color-pib-text)]">Installed from marketplace</h2>

          {skillsAgentId && (
            <form onSubmit={saveMarketplaceSkills} className="pib-card space-y-3 p-4">
              <p className="text-sm text-[var(--color-pib-text)]">
                Public skills for{' '}
                <strong>{marketplaceInstalled.find((row) => row.agentId === skillsAgentId)?.name ?? skillsAgentId}</strong>
              </p>
              <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
                {skills.filter((skill) => skill.available).map((skill) => (
                  <label key={skill.skillId} className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--color-pib-line)] p-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selectedSkills.includes(skill.skillId)}
                      onChange={() => toggleSkill(skill.skillId)}
                    />
                    <span>
                      <span className="font-medium text-[var(--color-pib-text)]">{skill.name}</span>
                      <span className="mt-0.5 block text-[var(--color-pib-text-muted)]">{skill.skillId}</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-pib-ghost btn-pib-sm" onClick={() => setSkillsAgentId(null)}>Cancel</button>
                <button type="submit" disabled={saving || selectedSkills.length === 0} className="btn-pib-primary btn-pib-sm disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save skills & re-sync'}
                </button>
              </div>
            </form>
          )}

          {uninstallAgentId && (
            <form onSubmit={uninstallMarketplace} className="pib-card space-y-3 p-4">
              <p className="text-sm text-[var(--color-pib-text)]">
                Remove{' '}
                <strong>{marketplaceInstalled.find((row) => row.agentId === uninstallAgentId)?.name ?? uninstallAgentId}</strong>
                {' '}from a computer
              </p>
              <label className="block space-y-1">
                <span className="pib-label">Computer</span>
                <select required className="pib-select w-full" value={uninstallDeviceId} onChange={(event) => setUninstallDeviceId(event.target.value)}>
                  <option value="">Choose a computer</option>
                  {devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                  ))}
                </select>
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-pib-ghost btn-pib-sm" onClick={() => { setUninstallAgentId(null); setUninstallDeviceId('') }}>Cancel</button>
                <button type="submit" disabled={saving || !uninstallDeviceId} className="btn-pib-secondary btn-pib-sm disabled:opacity-50">
                  {saving ? 'Removing…' : 'Uninstall from computer'}
                </button>
              </div>
            </form>
          )}

          <div className="pib-card divide-y divide-[var(--color-pib-line)]">
            {marketplaceInstalled.map((agent) => {
              const device = devices.find((row) => row.deviceId === agent.homeDeviceId)
              const skillList = agent.installedSkills ?? []
              return (
                <article key={agent.agentId} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-[var(--color-pib-text)]">{agent.name}</h3>
                    <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
                      Template · {agent.marketplaceTemplateId ?? agent.agentHandle} · public pack
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm text-[var(--color-pib-text-muted)]">{agent.persona}</p>
                    {skillList.length > 0 && (
                      <p className="mt-2 text-[10px] text-[var(--color-pib-text-muted)]/80">
                        Skills: {skillList.join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 space-y-2 text-right text-xs text-[var(--color-pib-text-muted)]">
                    <span className="rounded border border-[var(--color-pib-line)] px-2 py-1">Marketplace</span>
                    <p className="mt-2">{device?.label ?? 'Linked computer'}</p>
                    <p className="mt-1 capitalize">{agent.provisioningStatus ?? 'ready'}</p>
                    {agent.canConfigureMarketplace && (
                      <div className="flex flex-col items-end gap-2 pt-1">
                        <button
                          type="button"
                          disabled={saving}
                          className="btn-pib-secondary btn-pib-sm disabled:opacity-50"
                          onClick={() => startSkillsConfig(agent)}
                        >
                          Skills
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          className="btn-pib-ghost btn-pib-sm disabled:opacity-50"
                          onClick={() => {
                            setUninstallAgentId(agent.agentId)
                            setUninstallDeviceId(agent.homeDeviceId ?? devices[0]?.deviceId ?? '')
                            setSkillsAgentId(null)
                          }}
                        >
                          Uninstall…
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {/* Custom agents */}
      {activeTab === 'machines' && (
      <section id="custom-agents" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm text-[var(--color-pib-text)]">Your custom agents</h2>
            <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
              Agents you create. Owners can edit purpose and re-sync the profile to their computer.
            </p>
          </div>
        </div>

        {showCreate && (
          <div id="new-custom-agent" className="pib-card scroll-mt-6 space-y-4 p-4">
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              The agent is installed on the computer you pick. Choose who can use it on that machine. It will not appear on other machines.
            </p>
            <CreateAgentOnMachineForm
              devices={devices}
              defaultDeviceId={form.deviceId}
              members={shareMembers}
              creating={saving}
              canCreate={devices.length > 0}
              submitLabel="Create & sync"
              onSubmit={createAgent}
            />
            <button type="button" className="btn-pib-ghost btn-pib-sm" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        )}

        <div className="pib-card divide-y divide-[var(--color-pib-line)]">
          {loading ? (
            <p className="p-4 text-sm text-[var(--color-pib-text-muted)]">Loading agents…</p>
          ) : customAgents.length === 0 ? (
            <p className="p-4 text-sm text-[var(--color-pib-text-muted)]">
              No custom agents yet. Pull a marketplace template above, or create your own.
            </p>
          ) : customAgents.map((agent) => {
            const device = devices.find((row) => row.deviceId === agent.homeDeviceId)
            const isEditing = editingAgentId === agent.agentId
            const canEdit = Boolean(agent.canEdit ?? agent.canManage)
            return (
              <article id={`custom-agent-${agent.agentId}`} key={agent.agentId} className="scroll-mt-6 p-4">
                {isEditing ? (
                  <form onSubmit={saveAgent} className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] pib-label">Edit custom agent</p>
                        <p className="mt-0.5 font-mono text-xs text-[var(--color-pib-text-muted)]">
                          {agent.agentHandle ?? agent.agentId}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="pib-label">Name</span>
                        <input required maxLength={100} className="pib-input w-full" value={editForm.name} onChange={(event) => setEditForm((value) => ({ ...value, name: event.target.value }))} />
                      </label>
                      <label className="space-y-1">
                        <span className="pib-label">Role</span>
                        <input required maxLength={120} className="pib-input w-full" value={editForm.role} onChange={(event) => setEditForm((value) => ({ ...value, role: event.target.value }))} />
                      </label>
                      <label className="space-y-1 sm:col-span-2">
                        <span className="pib-label">Preferred model label</span>
                        <input maxLength={200} className="pib-input w-full font-mono text-sm" placeholder="auto" value={editForm.defaultModel} onChange={(event) => setEditForm((value) => ({ ...value, defaultModel: event.target.value }))} />
                      </label>
                    </div>
                    <label className="block space-y-1">
                      <span className="pib-label">Purpose and behaviour</span>
                      <textarea required maxLength={20000} className="pib-input min-h-28 w-full" value={editForm.persona} onChange={(event) => setEditForm((value) => ({ ...value, persona: event.target.value }))} />
                    </label>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" className="btn-pib-ghost btn-pib-sm" onClick={cancelEdit} disabled={saving}>Cancel</button>
                      <button type="submit" disabled={saving} className="btn-pib-primary btn-pib-sm disabled:opacity-50">
                        {saving ? 'Saving…' : 'Save & sync profile'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-[var(--color-pib-text)]">{agent.name}</h3>
                      <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
                        {agent.agentHandle ?? agent.agentId} · {agent.role}
                        {agent.defaultModel ? ` · ${agent.defaultModel}` : ''}
                      </p>
                      <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">{agent.persona}</p>
                    </div>
                    <div className="shrink-0 space-y-2 text-right text-xs text-[var(--color-pib-text-muted)]">
                      <span className="inline-block rounded border border-[var(--color-pib-line)] px-2 py-1">
                        {agent.accessScope === 'organization' ? 'Organisation' : 'Personal'}
                      </span>
                      <p>{device?.label ?? 'Linked computer'}</p>
                      <p className="mt-1 capitalize">{agent.provisioningStatus ?? 'ready'}</p>
                      {agent.provisioningError && (
                        <p className="max-w-48 text-[var(--color-error)]">{agent.provisioningError}</p>
                      )}
                      {canEdit && (
                        <div className="flex flex-col items-end gap-2 pt-1">
                          <button type="button" disabled={saving} onClick={() => startEdit(agent)} className="btn-pib-secondary btn-pib-sm disabled:opacity-50">
                            Edit
                          </button>
                          {agent.provisioningStatus === 'failed' && (
                            <button type="button" disabled={saving} onClick={() => void retryAgent(agent.agentId)} className="btn-pib-ghost btn-pib-sm disabled:opacity-50">
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
        </div>
      </section>
      )}
    </div>
  )
}
