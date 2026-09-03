'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useToast } from '@/components/ui/Toast'
import { PageTabs } from '@/components/ui/AppFoundation'
import { HudChip } from '@/components/ui/HudChip'
import type { AgentTeamDoc } from './AgentCard'
import type { HealthStatus } from './AgentCard'
import { AgentRuntimeModelForm } from './AgentRuntimeModelForm'
import type { AgentRuntimeModelSettings } from '@/lib/agents/runtime-config'
import type { AgentOrgNode } from '@/lib/agent-org/types'
import { buildOrgDefaultsFromRuntime } from '@/lib/agent-org/syncRuntime'
import OrgRoleForm from '@/components/agents/org-chart/OrgRoleForm'

import { Icon } from '@/components/studio'

const COLOR_ACCENT: Record<string, string> = {
  violet: 'text-[var(--sc-ink-soft)]',
  sky: 'text-sky-400',
  amber: 'text-[var(--sc-ink-soft)]',
  emerald: 'text-emerald-400',
  rose: 'text-rose-400',
}

const COLOR_ICON_BG: Record<string, string> = {
  violet: 'bg-[var(--sc-surface)]/15 text-[var(--sc-ink-soft)]',
  sky: 'bg-sky-500/15 text-sky-400',
  amber: 'bg-[var(--sc-surface)]/15 text-[var(--sc-ink-soft)]',
  emerald: 'bg-emerald-500/15 text-emerald-400',
  rose: 'bg-rose-500/15 text-rose-400',
}

const HEALTH_PILL: Record<HealthStatus, { label: string; className: string }> = {
  ok: { label: 'Online', className: 'bg-emerald-500/15 text-emerald-400' },
  degraded: { label: 'Degraded', className: 'bg-[var(--sc-surface)]/15 text-[var(--sc-ink-soft)]' },
  unreachable: { label: 'Unreachable', className: 'bg-red-500/15 text-[var(--st-danger)]' },
  loading: { label: 'Checking…', className: 'bg-white/10 text-[var(--color-pib-text-muted)]' },
}

const BASE_TABS = ['overview', 'skills', 'cron', 'env', 'config', 'soul', 'files', 'logs', 'edit'] as const
type BaseTab = typeof BASE_TABS[number]
type Tab = BaseTab | 'org'
const TAB_LABELS: Record<Tab, string> = {
  org: 'Org role',
  overview: 'Overview',
  skills: 'Skills',
  cron: 'Cron',
  env: 'Env',
  config: 'Config',
  soul: 'Soul',
  files: 'Files',
  logs: 'Logs',
  edit: 'Edit',
}

export type AgentDetailOrgRoleContext = {
  orgId: string
  /** Matching org-chart node for this agent (null = unbound seat / create from agent). */
  node: AgentOrgNode | null
  nodes: AgentOrgNode[]
  onNodeSaved?: (node: AgentOrgNode | null) => void
  onNodeDeleted?: () => void
}

interface AgentDetailPanelProps {
  agent: AgentTeamDoc | null
  onClose: () => void
  onSaved: (updated: AgentTeamDoc) => void
  canEdit?: boolean
  /** Hide outer header/close when embedded inside OrgNodeEditor. */
  hideChrome?: boolean
  /** When set, expose the Org role tab (parity with org-chart drawer). */
  orgRole?: AgentDetailOrgRoleContext | null
}

interface HealthResult {
  status: HealthStatus
  latencyMs?: number
}

type Skill = {
  name: string
  description?: string | null
  fileCount: number
  sizeBytes: number
}

type SkillPolicyView = {
  policyVersion: string
  mode: 'hard_allowlist'
  policy: {
    vpsExternalDir: string
    pibSkills: string[]
    runtimeSkills?: string[]
    globalSkills: string[]
    deniedSkills: string[]
    capabilities?: string[]
    approvalGates?: string[]
    primaryOwnerOf?: string[]
    mayRequestFrom?: string[]
    reviewerAgentId?: string | null
  }
  drift?: {
    status: 'in_sync' | 'drifted' | 'not_applied'
    missingPibSkills: string[]
    unexpectedPibSkills: string[]
    missingGlobalSkills: string[]
    unexpectedGlobalSkills: string[]
    configExternalDirs: string[]
    expectedExternalDirs: string[]
  } | null
}

type LogRun = {
  id: string
  orgId: string | null
  profile: string | null
  hermesRunId: string | null
  requestedBy: string | null
  prompt: string | null
  status: string | null
  createdAt: string | null
}

type CronJob = {
  id: string
  name?: string | null
  prompt: string
  schedule: string
  status?: string | null
  last_run?: string | null
  next_run?: string | null
}

type EnvEntry = {
  key: string
  is_set: boolean
  redacted_value?: string | null
  description?: string | null
  url?: string | null
  category?: string | null
  is_password?: boolean
  tools?: string[]
  advanced?: boolean
}

type ProfileFile = {
  path: string
  absolutePath?: string
  exists: boolean
  editable: boolean
  kind?: string
  sizeBytes?: number | null
  updatedAt?: string | null
  content?: string
}

function formatBytes(n: number): string {
  if (n < 1024) return n + ' B'
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1048576).toFixed(1) + ' MB'
}

function FieldRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-[10px] pib-label">
          {label}
        </label>
      ) : (
        <span className="text-[10px] pib-label">
          {label}
        </span>
      )}
      {children}
    </div>
  )
}

function RegistryList({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null
  return (
    <div className="pib-card p-3">
      <p className="text-[10px] pib-label mb-2">{title}</p>
      <ul className="space-y-1.5 text-xs text-[var(--color-pib-text-muted)] leading-relaxed">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-1 h-1 w-1 shrink-0 rounded bg-primary/70" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AgentDetailPanel({
  agent,
  onClose,
  onSaved,
  canEdit = false,
  hideChrome = false,
  orgRole = null,
}: AgentDetailPanelProps) {
  const { success: toastSuccess, error: toastError } = useToast()

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>(orgRole ? 'org' : 'overview')
  const [orgNodeLocal, setOrgNodeLocal] = useState<AgentOrgNode | null>(orgRole?.node ?? null)

  useEffect(() => {
    setOrgNodeLocal(orgRole?.node ?? null)
  }, [orgRole?.node, agent?.agentId])

  useEffect(() => {
    // Prefer org tab when context appears; otherwise stay unless previous tab vanished.
    if (orgRole && activeTab !== 'org' && !BASE_TABS.includes(activeTab as BaseTab)) {
      setActiveTab('org')
    }
    if (!orgRole && activeTab === 'org') setActiveTab('overview')
  }, [orgRole, activeTab])

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editPersona, setEditPersona] = useState('')
  const [editEnabled, setEditEnabled] = useState(true)
  const [editBaseUrl, setEditBaseUrl] = useState('')
  const [editApiKey, setEditApiKey] = useState('')
  const [editModel, setEditModel] = useState('')

  // Health check state
  const [healthResult, setHealthResult] = useState<HealthResult | null>(null)
  const [pinging, setPinging] = useState(false)

  // Save state
  const [saving, setSaving] = useState(false)

  // Skills tab state
  const [skills, setSkills] = useState<Skill[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillsError, setSkillsError] = useState<string | null>(null)
  const [skillsMessage, setSkillsMessage] = useState<string | null>(null)
  const [skillPolicy, setSkillPolicy] = useState<SkillPolicyView | null>(null)
  const [skillPolicyLoading, setSkillPolicyLoading] = useState(false)
  const [skillPolicyApplying, setSkillPolicyApplying] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const skillInputRef = useRef<HTMLInputElement | null>(null)

  // Config tab state
  const [configData, setConfigData] = useState<unknown>(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configText, setConfigText] = useState('')
  const [configSaving, setConfigSaving] = useState(false)
  const [configMessage, setConfigMessage] = useState<string | null>(null)

  // Profile files / soul state
  const [profileFiles, setProfileFiles] = useState<ProfileFile[] | null>(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [selectedFilePath, setSelectedFilePath] = useState('SOUL.md')
  const [fileContent, setFileContent] = useState('')
  const [fileMeta, setFileMeta] = useState<ProfileFile | null>(null)
  const [fileSaving, setFileSaving] = useState(false)
  const [fileMessage, setFileMessage] = useState<string | null>(null)

  // Logs tab state
  const [logsData, setLogsData] = useState<LogRun[] | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<string | null>(null)

  // Cron tab state
  const [cronJobs, setCronJobs] = useState<CronJob[]>([])
  const [cronSupported, setCronSupported] = useState<boolean | null>(null)
  const [cronLoading, setCronLoading] = useState(false)
  const [cronError, setCronError] = useState<string | null>(null)
  const [cronMessage, setCronMessage] = useState<string | null>(null)
  const [cronName, setCronName] = useState('')
  const [cronPrompt, setCronPrompt] = useState('')
  const [cronSchedule, setCronSchedule] = useState('0 9 * * *')
  const [cronProvider, setCronProvider] = useState('')
  const [cronModel, setCronModel] = useState('')
  const [cronCreating, setCronCreating] = useState(false)
  const [showCronForm, setShowCronForm] = useState(false)

  // Env tab state
  const [envData, setEnvData] = useState<EnvEntry[] | null>(null)
  const [envSupported, setEnvSupported] = useState<boolean | null>(null)
  const [envLoading, setEnvLoading] = useState(false)
  const [envError, setEnvError] = useState<string | null>(null)
  const [envKey, setEnvKey] = useState('')
  const [envValue, setEnvValue] = useState('')
  const [envSaving, setEnvSaving] = useState(false)
  const [envMessage, setEnvMessage] = useState<string | null>(null)

  // Lazy-load tracking: which tabs have been loaded for the current agent
  const loadedTabs = useRef<Set<Tab>>(new Set())

  // Reset everything when agent changes
  useEffect(() => {
    if (!agent) return
    setActiveTab(orgRole ? 'org' : 'overview')
    setEditName(agent.name)
    setEditPersona(agent.persona)
    setEditEnabled(agent.enabled)
    setEditBaseUrl(agent.baseUrl)
    setEditApiKey('')
    setEditModel(agent.defaultModel)
    setHealthResult(null)
    setSkills([])
    setSkillsError(null)
    setSkillsMessage(null)
    setSkillPolicy(null)
    setSkillPolicyLoading(false)
    setSkillPolicyApplying(false)
    setConfigData(null)
    setConfigError(null)
    setConfigText('')
    setConfigMessage(null)
    setProfileFiles(null)
    setFilesError(null)
    setSelectedFilePath('SOUL.md')
    setFileContent('')
    setFileMeta(null)
    setFileMessage(null)
    setLogsData(null)
    setLogsError(null)
    setCronJobs([])
    setCronSupported(null)
    setCronError(null)
    setCronMessage(null)
    setShowCronForm(false)
    setCronName('')
    setCronPrompt('')
    setCronSchedule('0 9 * * *')
    setCronProvider('')
    setCronModel('')
    setEnvData(null)
    setEnvSupported(null)
    setEnvError(null)
    setEnvKey('')
    setEnvValue('')
    setEnvMessage(null)
    loadedTabs.current = new Set()
  }, [agent])

  useEffect(() => {
    if (!canEdit && activeTab === 'edit') setActiveTab('overview')
  }, [activeTab, canEdit])

  const loadSkills = useCallback(async (agentId: string) => {
    setSkillsLoading(true)
    setSkillsError(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/skills`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to load skills (${res.status})`)
      setSkills(body.data?.skills ?? [])
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : 'Failed to load skills')
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  const loadSkillPolicy = useCallback(async (agentId: string) => {
    setSkillPolicyLoading(true)
    setSkillsError(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/skill-policy`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to load skill policy (${res.status})`)
      setSkillPolicy(body.data ?? null)
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : 'Failed to load skill policy')
    } finally {
      setSkillPolicyLoading(false)
    }
  }, [])

  const loadConfig = useCallback(async (agentId: string) => {
    setConfigLoading(true)
    setConfigError(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/config`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to load config (${res.status})`)
      const nextData = body.data ?? body
      setConfigData(nextData)
      const dataObj = nextData && typeof nextData === 'object' ? nextData as Record<string, unknown> : {}
      const liveConfig = dataObj.liveConfig
      const liveObj = liveConfig && typeof liveConfig === 'object' ? liveConfig as Record<string, unknown> : null
      const editableConfig = liveObj && 'config' in liveObj ? liveObj.config : liveConfig
      setConfigText(JSON.stringify(editableConfig ?? {}, null, 2))
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : 'Failed to load config')
    } finally {
      setConfigLoading(false)
    }
  }, [])

  const loadLogs = useCallback(async (agentId: string) => {
    setLogsLoading(true)
    setLogsError(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/logs`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to load logs (${res.status})`)
      setLogsData(body.data?.runs ?? [])
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : 'Failed to load logs')
    } finally {
      setLogsLoading(false)
    }
  }, [])

  const loadCron = useCallback(async (agentId: string) => {
    setCronLoading(true)
    setCronError(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/cron`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to load cron jobs (${res.status})`)
      const jobs = body.data?.jobs ?? body.data ?? []
      setCronJobs(Array.isArray(jobs) ? jobs : [])
      setCronSupported(body.data?.supported !== false)
    } catch (e) {
      setCronError(e instanceof Error ? e.message : 'Failed to load cron jobs')
    } finally {
      setCronLoading(false)
    }
  }, [])

  const loadEnv = useCallback(async (agentId: string) => {
    setEnvLoading(true)
    setEnvError(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/env`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to load env (${res.status})`)
      const raw = body.data?.env ?? {}
      // Convert object map to sorted array
      const entries: EnvEntry[] = Object.entries(raw).map(([key, val]) => ({
        key,
        ...(val as Omit<EnvEntry, 'key'>),
      }))
      entries.sort((a, b) => {
        if (a.is_set !== b.is_set) return a.is_set ? -1 : 1
        return a.key.localeCompare(b.key)
      })
      setEnvData(entries)
      setEnvSupported(body.data?.supported !== false)
    } catch (e) {
      setEnvError(e instanceof Error ? e.message : 'Failed to load env')
    } finally {
      setEnvLoading(false)
    }
  }, [])

  const loadProfileFiles = useCallback(async (agentId: string, path = selectedFilePath) => {
    setFilesLoading(true)
    setFilesError(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/files`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to load profile files (${res.status})`)
      const files = body.data?.files ?? body.data ?? []
      setProfileFiles(Array.isArray(files) ? files : [])
      const targetPath = path || 'SOUL.md'
      const fileRes = await fetch(`/api/v1/admin/agents/${agentId}/files/${targetPath.split('/').map(encodeURIComponent).join('/')}`)
      const fileBody = await fileRes.json().catch(() => ({}))
      if (!fileRes.ok) throw new Error(fileBody.error || `Failed to read ${targetPath} (${fileRes.status})`)
      const nextFile = fileBody.data ?? fileBody
      setSelectedFilePath(targetPath)
      setFileMeta(nextFile)
      setFileContent(typeof nextFile.content === 'string' ? nextFile.content : '')
    } catch (e) {
      setFilesError(e instanceof Error ? e.message : 'Failed to load profile files')
    } finally {
      setFilesLoading(false)
    }
  }, [selectedFilePath])

  // Activate tab and lazy-load its data
  function activateTab(tab: Tab) {
    if (!canEdit && tab === 'edit') return
    setActiveTab(tab)
    if (!agent) return
    const { agentId } = agent
    if (tab === 'skills' && !loadedTabs.current.has('skills')) {
      loadedTabs.current.add('skills')
      loadSkills(agentId)
      loadSkillPolicy(agentId)
    }
    if (tab === 'config' && !loadedTabs.current.has('config')) {
      loadedTabs.current.add('config')
      loadConfig(agentId)
    }
    if ((tab === 'soul' || tab === 'files') && !loadedTabs.current.has(tab)) {
      loadedTabs.current.add(tab)
      loadProfileFiles(agentId, tab === 'soul' ? 'SOUL.md' : selectedFilePath)
    }
    if (tab === 'logs' && !loadedTabs.current.has('logs')) {
      loadedTabs.current.add('logs')
      loadLogs(agentId)
    }
    if (tab === 'cron' && !loadedTabs.current.has('cron')) {
      loadedTabs.current.add('cron')
      loadCron(agentId)
    }
    if (tab === 'env' && !loadedTabs.current.has('env')) {
      loadedTabs.current.add('env')
      loadEnv(agentId)
    }
  }

  if (!agent) return null

  const { agentId } = agent
  const iconClass = COLOR_ICON_BG[agent.colorKey] ?? 'bg-white/10 text-[var(--color-pib-text-muted)]'
  const accentClass = COLOR_ACCENT[agent.colorKey] ?? 'text-[var(--color-pib-text-muted)]'

  async function pingHealth() {
    setPinging(true)
    setHealthResult(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/health`)
      const body = await res.json()
      if (!res.ok) {
        setHealthResult({ status: 'unreachable' })
      } else {
        setHealthResult({
          status: body.data?.status ?? 'unreachable',
          latencyMs: body.data?.latencyMs,
        })
      }
    } catch {
      setHealthResult({ status: 'unreachable' })
    } finally {
      setPinging(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) {
      toastError('Only super admins can edit agents.')
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: editName.trim(),
        persona: editPersona.trim(),
        enabled: editEnabled,
        baseUrl: editBaseUrl.trim(),
        defaultModel: editModel.trim(),
      }
      if (editApiKey.trim()) {
        payload.apiKey = editApiKey.trim()
      }
      const res = await fetch(`/api/v1/admin/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) {
        toastError(body?.error ?? 'Failed to save agent')
      } else {
        toastSuccess(`${editName} saved.`)
        // API returns { agent } or the doc depending on version  -  accept either.
        const updated = (body.data?.agent ?? body.data) as AgentTeamDoc
        onSaved(updated)
        setEditApiKey('')
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function handleRuntimeModelSaved(result: {
    settings: AgentRuntimeModelSettings
    registryDefaultModel?: string | null
    agent?: unknown
  }) {
    const registryLabel = result.registryDefaultModel
      ?? [result.settings.primaryProvider, result.settings.primaryModel].filter(Boolean).join(' / ')
    if (registryLabel) setEditModel(registryLabel)

    if (result.agent && typeof result.agent === 'object') {
      onSaved(result.agent as AgentTeamDoc)
    } else if (agent) {
      onSaved({ ...agent, defaultModel: registryLabel || agent.defaultModel })
    }

    toastSuccess('Auto model settings saved.')
    loadedTabs.current.delete('config')
    void loadConfig(agentId)

    // Mirror primary model/effort into the linked org-chart node when present.
    if (orgRole?.node?.id && canEdit) {
      const defaults = buildOrgDefaultsFromRuntime(result.settings)
      void fetch(`/api/v1/admin/agent-org/${encodeURIComponent(orgRole.node.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: orgRole.orgId,
          defaultModel: defaults.defaultModel,
          defaultEffort: defaults.defaultEffort,
        }),
      })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}))
          if (!res.ok) {
            toastError(body?.error ?? 'Live runtime saved, but org-chart defaults did not sync')
            return
          }
          const saved = (body.data?.node ?? body.data ?? null) as AgentOrgNode | null
          if (saved) {
            setOrgNodeLocal(saved)
            orgRole.onNodeSaved?.(saved)
          }
        })
        .catch((err) => {
          toastError(err instanceof Error ? err.message : 'Org-chart default sync failed')
        })
    }
  }

  async function uploadSkill(file: File) {
    if (!canEdit) {
      setSkillsError('Only super admins can install skills.')
      return
    }
    if (!file.name.endsWith('.zip')) {
      setSkillsError('File must be a .zip')
      return
    }
    setSkillsError(null)
    setSkillsMessage(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/v1/admin/agents/${agentId}/skills`, { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`)
      setSkillsMessage(`Installed: ${body.data?.installed || 'skill'} (${body.data?.fileCount ?? '?'} files). Gateway restarting…`)
      setTimeout(() => loadSkills(agentId), 4000)
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function removeSkill(name: string) {
    if (!canEdit) {
      setSkillsError('Only super admins can remove skills.')
      return
    }
    if (!confirm(`Delete skill "${name}"? This will remove it from the VPS and restart the gateway.`)) return
    setSkillsError(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Delete failed (${res.status})`)
      setSkillsMessage(`Deleted ${name}. Gateway restarting…`)
      setTimeout(() => loadSkills(agentId), 4000)
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function applySkillPolicy() {
    if (!agent) return
    setSkillPolicyApplying(true)
    setSkillsError(null)
    setSkillsMessage(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agent.agentId}/skill-policy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applyConfig: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to apply policy (${res.status})`)
      setSkillPolicy(body.data ?? null)
      setSkillsMessage('Skill policy applied to the live profile config. Restart may take a few seconds.')
      setTimeout(() => {
        loadSkillPolicy(agent.agentId)
        loadSkills(agent.agentId)
      }, 3000)
    } catch (e) {
      setSkillsError(e instanceof Error ? e.message : 'Failed to apply skill policy')
    } finally {
      setSkillPolicyApplying(false)
    }
  }

  async function saveLiveConfig() {
    if (!canEdit) {
      setConfigError('Only super admins can edit agent config.')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(configText)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Config must be valid JSON')
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setConfigError('Config must be a JSON object.')
      return
    }
    setConfigSaving(true)
    setConfigError(null)
    setConfigMessage(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: parsed }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to save config (${res.status})`)
      setConfigMessage('Config saved. Gateway restarting...')
      setTimeout(() => loadConfig(agentId), 3000)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Failed to save config')
    } finally {
      setConfigSaving(false)
    }
  }

  async function saveEnvKey(e: React.FormEvent) {
    e.preventDefault()
    if (!canEdit) {
      setEnvError('Only super admins can edit agent environment keys.')
      return
    }
    const key = envKey.trim().toUpperCase()
    if (!key || !envValue) return
    setEnvSaving(true)
    setEnvError(null)
    setEnvMessage(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/env`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ set: { [key]: envValue } }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to update env (${res.status})`)
      setEnvMessage(`${key} saved. Gateway restarting...`)
      setEnvKey('')
      setEnvValue('')
      setTimeout(() => loadEnv(agentId), 3000)
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : 'Failed to update env')
    } finally {
      setEnvSaving(false)
    }
  }

  async function unsetEnvKey(key: string) {
    if (!canEdit) {
      setEnvError('Only super admins can edit agent environment keys.')
      return
    }
    if (!confirm(`Unset ${key} for ${agent?.name ?? 'this agent'}?`)) return
    setEnvSaving(true)
    setEnvError(null)
    setEnvMessage(null)
    try {
      const res = await fetch(`/api/v1/admin/agents/${agentId}/env`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unset: [key] }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to unset env (${res.status})`)
      setEnvMessage(`${key} unset. Gateway restarting...`)
      setTimeout(() => loadEnv(agentId), 3000)
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : 'Failed to unset env')
    } finally {
      setEnvSaving(false)
    }
  }

  async function selectProfileFile(path: string) {
    if (!agent) return
    setSelectedFilePath(path)
    setFileMessage(null)
    await loadProfileFiles(agent.agentId, path)
  }

  async function saveProfileFile() {
    if (!canEdit) {
      setFilesError('Only super admins can edit agent profile files.')
      return
    }
    if (!agent || !fileMeta?.editable) return
    setFileSaving(true)
    setFilesError(null)
    setFileMessage(null)
    try {
      const encoded = selectedFilePath.split('/').map(encodeURIComponent).join('/')
      const res = await fetch(`/api/v1/admin/agents/${agent.agentId}/files/${encoded}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed to save ${selectedFilePath} (${res.status})`)
      setFileMessage(`${selectedFilePath} saved. Gateway restarting...`)
      setTimeout(() => loadProfileFiles(agent.agentId, selectedFilePath), 3000)
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : 'Failed to save profile file')
    } finally {
      setFileSaving(false)
    }
  }

  const healthPill = healthResult ? HEALTH_PILL[healthResult.status] : null

  // Config summary extraction  -  API returns flat Firestore fields
  const configObj = configData && typeof configData === 'object' ? configData as Record<string, unknown> : null
  const configModelDefault = configObj?.defaultModel as string | undefined
  const configRole = configObj?.role as string | undefined
  const configPersona = configObj?.persona as string | undefined
  const configEnabled = configObj?.enabled as boolean | undefined
  const configModels = configObj?.models // optional /v1/models probe result
  const liveConfigObj = configObj?.liveConfig && typeof configObj.liveConfig === 'object'
    ? configObj.liveConfig as Record<string, unknown>
    : null
  const liveConfigPath = liveConfigObj?.path as string | undefined
  const tabsForPanel: Tab[] = orgRole
    ? (['org', ...BASE_TABS] as Tab[])
    : ([...BASE_TABS] as Tab[])
  const visibleTabs = canEdit ? tabsForPanel : tabsForPanel.filter((tab) => tab !== 'edit')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Panel header */}
      {!hideChrome && (
        <>
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconClass}`}>
            <Icon name={agent.iconKey} className="text-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className={`text-sm ${accentClass}`}>{agent.name}</h2>
            <p className="text-xs leading-snug text-[var(--color-pib-text-muted)]">{agent.role}</p>
          </div>
          {healthPill ? (
            <HudChip live={healthResult?.status === 'ok'} className={healthPill.className}>
              {healthPill.label}
            </HudChip>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/10 hover:text-[var(--color-pib-text)]"
            aria-label="Close panel"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        </>
      )}

      <div className="shrink-0 border-b border-white/10 px-4 py-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">
        Only super admins can edit live agent configuration. Secrets remain redacted; config, env, file, cron, and runtime operations stay behind admin approval gates.
        {orgRole ? ' Org role tab edits Firestore task defaults; Config tab edits the live Hermes machine profile.' : ''}
      </div>

      <PageTabs
        className="shrink-0 border-x-0 border-t-0 px-4 py-2"
        ariaLabel="Agent detail tabs"
        value={activeTab}
        onValueChange={(value) => activateTab(value as Tab)}
        tabs={visibleTabs.map((tab) => ({ label: TAB_LABELS[tab], value: tab }))}
      />

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">

        {/* ORG ROLE TAB */}
        {activeTab === 'org' && orgRole && (
          <OrgRoleForm
            orgId={orgRole.orgId}
            node={orgNodeLocal ?? (agent.agentId ? {
              id: '',
              orgId: orgRole.orgId,
              name: agent.name,
              title: agent.role || 'Specialist',
              agentId: agent.agentId,
              reportsTo: null,
              chainOfCommand: [],
              capabilities: [],
              defaultModel: null,
              defaultEffort: null,
              delegation: { assignableFrom: 'manager_only', escalateToManager: true, allowLateral: false },
              status: 'active',
              iconKey: agent.iconKey || 'smart_toy',
              colorKey: agent.colorKey || 'violet',
              createdAt: '',
              updatedAt: '',
            } : null)}
            nodes={orgRole.nodes}
            canEdit={canEdit}
            defaultSyncLiveRuntime={Boolean(agent.agentId)}
            showCancel={false}
            onSaved={(saved) => {
              setOrgNodeLocal(saved)
              orgRole.onNodeSaved?.(saved)
            }}
            onDeleted={() => {
              setOrgNodeLocal(null)
              orgRole.onNodeDeleted?.()
            }}
          />
        )}

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <section className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="pib-card p-3 space-y-0.5">
                  <p className="text-[10px] pib-label">Status</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`w-1.5 h-1.5 rounded ${agent.enabled ? 'bg-emerald-400' : 'bg-white/20'}`} />
                    <span className="text-sm text-[var(--color-pib-text)]">{agent.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                </div>
                <div className="pib-card p-3 space-y-0.5">
                  <p className="text-[10px] pib-label">Last health</p>
                  {agent.lastHealthStatus ? (
                    <span className={`inline-block mt-1 text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded ${HEALTH_PILL[agent.lastHealthStatus].className}`}>
                      {HEALTH_PILL[agent.lastHealthStatus].label}
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--color-pib-text-muted)]/50 mt-1 block">No data</span>
                  )}
                </div>
              </div>

              <div className="pib-card p-3">
                <p className="text-[10px] pib-label mb-1">API Key (masked)</p>
                <code className="text-xs font-mono text-[var(--color-pib-text-muted)]/70 break-all">{agent.apiKey}</code>
              </div>

              <div className="pib-card p-3">
                <p className="text-[10px] pib-label mb-1">Base URL</p>
                <code className="text-xs font-mono text-[var(--color-pib-text)] break-all">{agent.baseUrl}</code>
              </div>

              <div className="space-y-3">
                <p className="text-[10px] pib-label">
                  Registry
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <RegistryList title="Responsibilities" items={agent.responsibilities} />
                  <RegistryList title="Advertised skills" items={agent.skills} />
                  <RegistryList title="Cron / watch loops" items={agent.cronWatchLoops} />
                  <RegistryList title="Allowed scopes" items={agent.allowedScopes} />
                  <div className="sm:col-span-2">
                    <RegistryList title="Example task types" items={agent.exampleTaskTypes} />
                  </div>
                </div>
              </div>
            </section>

            {/* Health ping */}
            <section className="space-y-3">
              <p className="text-[10px] pib-label">
                Health Check
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={pingHealth}
                  disabled={pinging}
                  className="pib-btn-ghost text-sm font-label flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Icon name="wifi_tethering" className="text-[16px]" />
                  {pinging ? 'Pinging…' : 'Ping now'}
                </button>
                {healthPill && !pinging && (
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded ${healthPill.className}`}>
                      {healthPill.label}
                    </span>
                    {healthResult?.latencyMs !== undefined && (
                      <span className="text-xs text-[var(--color-pib-text-muted)]">{healthResult.latencyMs}ms</span>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* SKILLS TAB */}
        {activeTab === 'skills' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] pib-label">
                {skills.length} installed
              </p>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={applySkillPolicy}
                    disabled={skillPolicyApplying}
                    className="btn-pib-primary btn-pib-sm text-xs font-label flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Icon name="rule_settings" className="text-[14px]" />
                    {skillPolicyApplying ? 'Applying…' : 'Apply policy'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { loadSkills(agentId); loadSkillPolicy(agentId) }}
                  disabled={skillsLoading || skillPolicyLoading}
                  className="pib-btn-ghost text-xs font-label flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Icon name="refresh" className="text-[14px]" />
                  {skillsLoading || skillPolicyLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
            </div>

            {skillPolicy && (
              <div className="pib-card p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] pib-label">Runtime skill policy</p>
                    <code className="mt-1 block text-xs text-[var(--color-pib-text-muted)] break-all">{skillPolicy.policy.vpsExternalDir}</code>
                  </div>
                  <span className={`text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded ${
                    skillPolicy.drift?.status === 'in_sync'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-[var(--sc-surface)]/15 text-[var(--sc-ink-soft)]'
                  }`}>
                    {skillPolicy.drift?.status?.replace('_', ' ') ?? 'unknown'}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <RegistryList title="Runtime repo skills" items={skillPolicy.policy.runtimeSkills ?? skillPolicy.policy.pibSkills} />
                  <RegistryList title="Allowed global skills" items={skillPolicy.policy.globalSkills} />
                  <RegistryList title="Action capabilities" items={skillPolicy.policy.capabilities ?? []} />
                  <RegistryList title="Hard approval gates" items={skillPolicy.policy.approvalGates ?? []} />
                </div>
                {skillPolicy.policy.reviewerAgentId && (
                  <p className="text-xs text-[var(--color-pib-text-muted)]">
                    Reviewer: <span className="font-mono text-[var(--color-pib-text)]">{skillPolicy.policy.reviewerAgentId}</span>
                  </p>
                )}
                {skillPolicy.drift && skillPolicy.drift.status !== 'in_sync' && (
                  <div className="rounded-md border border-amber-500/20 bg-[var(--sc-surface)]/10 p-2 text-xs text-[var(--sc-ink-soft)]">
                    Drift detected: {[
                      skillPolicy.drift.missingPibSkills.length ? `${skillPolicy.drift.missingPibSkills.length} missing PiB` : '',
                      skillPolicy.drift.unexpectedPibSkills.length ? `${skillPolicy.drift.unexpectedPibSkills.length} unexpected PiB` : '',
                      skillPolicy.drift.missingGlobalSkills.length ? `${skillPolicy.drift.missingGlobalSkills.length} missing global` : '',
                      skillPolicy.drift.unexpectedGlobalSkills.length ? `${skillPolicy.drift.unexpectedGlobalSkills.length} unexpected global` : '',
                    ].filter(Boolean).join(', ') || 'config external directory mismatch'}
                  </div>
                )}
              </div>
            )}

            {canEdit && (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) uploadSkill(f)
                }}
                onClick={() => skillInputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors ${
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-[var(--color-pib-line)] hover:border-primary/50'
                }`}
              >
                <Icon name="cloud_upload" className="text-3xl text-[var(--color-pib-text-muted)]" />
                <div className="text-sm text-[var(--color-pib-text)] text-center">
                  {uploading ? 'Uploading…' : 'Drop a skill .zip here, or click to choose'}
                </div>
                <div className="text-xs text-[var(--color-pib-text-muted)]">Max 50 MB. Gateway auto-restarts after install.</div>
                <input
                  ref={skillInputRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  aria-label="Upload skill zip"
                  data-impeccable-disable="content-invisible-at-rest"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadSkill(f)
                    e.target.value = ''
                  }}
                />
              </div>
            )}

            {skillsError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{skillsError}</div>}
            {skillsMessage && <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">{skillsMessage}</div>}

            <div className="grid gap-2 sm:grid-cols-2">
              {skills.length === 0 && !skillsLoading && (
                <div className="sm:col-span-2 text-sm text-[var(--color-pib-text-muted)] py-4 text-center">No skills installed.</div>
              )}
              {skills.map((s) => (
                <div key={s.name} className="pib-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[var(--color-pib-text)] truncate">{s.name}</div>
                      {s.description && <div className="text-xs text-[var(--color-pib-text-muted)] mt-0.5 line-clamp-2">{s.description}</div>}
                      <div className="text-xs text-[var(--color-pib-text-muted)] mt-1">{s.fileCount} files · {formatBytes(s.sizeBytes)}</div>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeSkill(s.name)}
                        className="text-xs text-[var(--st-danger)] hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10"
                        title="Delete skill"
                      >
                        <Icon name="delete" className="text-[16px]" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONFIG TAB */}
        {activeTab === 'config' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] pib-label">
                Agent Config
              </p>
              <button
                type="button"
                onClick={() => { loadedTabs.current.delete('config'); loadConfig(agentId) }}
                disabled={configLoading}
                className="pib-btn-ghost text-xs font-label flex items-center gap-1.5 disabled:opacity-50"
              >
                <Icon name="refresh" className="text-[14px]" />
                {configLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            {configLoading && (
              <div className="space-y-2">
                <div className="pib-skeleton h-6 rounded" />
                <div className="pib-skeleton h-6 rounded w-3/4" />
                <div className="pib-skeleton h-32 rounded" />
              </div>
            )}

            {configError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{configError}</div>
            )}
            {configMessage && (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">{configMessage}</div>
            )}

            {!configLoading && configData !== null && (
              <div className="space-y-3">
                <AgentRuntimeModelForm
                  agentId={agentId}
                  canEdit={canEdit}
                  liveConfigSource={configData}
                  onSaved={(result) => {
                    handleRuntimeModelSaved(result)
                  }}
                />

                <div className="grid grid-cols-2 gap-2">
                  {configModelDefault && (
                    <div className="pib-card p-3">
                      <p className="text-[10px] pib-label mb-1">Registry default model</p>
                      <code className="text-xs font-mono text-[var(--color-pib-text)]">{configModelDefault}</code>
                    </div>
                  )}
                  {configRole && (
                    <div className="pib-card p-3">
                      <p className="text-[10px] pib-label mb-1">Role</p>
                      <span className="text-xs text-[var(--color-pib-text)]">{configRole}</span>
                    </div>
                  )}
                  {configEnabled !== undefined && (
                    <div className="pib-card p-3">
                      <p className="text-[10px] pib-label mb-1">Status</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-1.5 h-1.5 rounded ${configEnabled ? 'bg-emerald-400' : 'bg-white/20'}`} />
                        <span className="text-xs text-[var(--color-pib-text)]">{configEnabled ? 'Enabled' : 'Disabled'}</span>
                      </div>
                    </div>
                  )}
                  {configModels !== undefined && configModels !== null && (
                    <div className="pib-card p-3 col-span-2">
                      <p className="text-[10px] pib-label mb-1">Live models probe</p>
                      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs font-mono text-[var(--color-pib-text-muted)]/80">
                        {JSON.stringify(configModels, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
                <div className="pib-card p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] pib-label">Live config JSON (advanced)</p>
                      {liveConfigPath && <p className="mt-1 text-[10px] font-mono text-[var(--color-pib-text-muted)]/50 break-all">{liveConfigPath}</p>}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={saveLiveConfig}
                        disabled={configSaving || !configText.trim()}
                        className="btn-pib-primary btn-pib-sm text-xs font-label disabled:opacity-50"
                      >
                        {configSaving ? 'Saving...' : 'Save config'}
                      </button>
                    )}
                  </div>
                  <textarea
                    value={configText}
                    onChange={(e) => setConfigText(e.target.value)}
                    readOnly={!canEdit}
                    spellCheck={false}
                    rows={18}
                    aria-label="Agent config JSON"
                    className="pib-input w-full resize-y font-mono text-xs leading-relaxed"
                    placeholder='{ "model": { "provider": "openai-codex", "default": "gpt-5.5" } }'
                  />
                  <p className="text-[10px] text-[var(--color-pib-text-muted)]/60">
                    Prefer the form above for Auto model, effort, and fallbacks. Advanced JSON still writes the full Hermes config and restarts this agent.
                  </p>
                </div>
                {configPersona && (
                  <div className="pib-card p-3">
                    <p className="text-[10px] pib-label mb-1">Persona</p>
                    <p className="text-xs text-[var(--color-pib-text-muted)] leading-relaxed whitespace-pre-wrap">{configPersona}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* SOUL TAB */}
        {activeTab === 'soul' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] pib-label">
                SOUL.md
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadProfileFiles(agentId, 'SOUL.md')}
                  disabled={filesLoading}
                  className="pib-btn-ghost text-xs font-label flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Icon name="refresh" className="text-[14px]" />
                  {filesLoading ? 'Loading...' : 'Refresh'}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={saveProfileFile}
                    disabled={fileSaving || filesLoading || !fileMeta?.editable}
                    className="btn-pib-primary btn-pib-sm text-xs font-label disabled:opacity-50"
                  >
                    {fileSaving ? 'Saving...' : 'Save Soul'}
                  </button>
                )}
              </div>
            </div>
            {filesError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{filesError}</div>}
            {fileMessage && <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">{fileMessage}</div>}
            {fileMeta?.absolutePath && <p className="text-[10px] font-mono text-[var(--color-pib-text-muted)]/50 break-all">{fileMeta.absolutePath}</p>}
            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              readOnly={!canEdit}
              spellCheck={false}
              rows={28}
              aria-label="SOUL.md content"
              className="pib-input w-full resize-y font-mono text-xs leading-relaxed"
              placeholder="This profile does not have a SOUL.md yet."
            />
          </div>
        )}

        {/* FILES TAB */}
        {activeTab === 'files' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] pib-label">
                Profile Files
              </p>
              <button
                type="button"
                onClick={() => loadProfileFiles(agentId, selectedFilePath)}
                disabled={filesLoading}
                className="pib-btn-ghost text-xs font-label flex items-center gap-1.5 disabled:opacity-50"
              >
                <Icon name="refresh" className="text-[14px]" />
                {filesLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            {filesError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{filesError}</div>}
            {fileMessage && <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">{fileMessage}</div>}
            <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-1">
                {(profileFiles ?? []).map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => selectProfileFile(file.path)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      selectedFilePath === file.path
                        ? 'border-primary/60 bg-primary/10 text-[var(--color-pib-text)]'
                        : 'border-white/10 bg-white/5 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-[11px] font-mono truncate">{file.path}</code>
                      <span className={`text-[9px] font-label uppercase ${file.editable ? 'text-emerald-400' : 'text-[var(--color-pib-text-muted)]/50'}`}>
                        {file.editable ? 'edit' : 'read'}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-[var(--color-pib-text-muted)]/50">
                      {file.exists ? `${formatBytes(file.sizeBytes ?? 0)} · ${file.kind ?? 'file'}` : 'missing'}
                    </div>
                  </button>
                ))}
              </div>
              <div className="pib-card p-3 space-y-3 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] pib-label">{selectedFilePath}</p>
                    {fileMeta?.absolutePath && <p className="mt-1 text-[10px] font-mono text-[var(--color-pib-text-muted)]/50 break-all">{fileMeta.absolutePath}</p>}
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={saveProfileFile}
                      disabled={fileSaving || !fileMeta?.editable}
                      className="btn-pib-primary btn-pib-sm text-xs font-label disabled:opacity-50"
                    >
                      {fileSaving ? 'Saving...' : 'Save'}
                    </button>
                  )}
                </div>
                <textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  readOnly={!canEdit || !fileMeta?.editable}
                  spellCheck={false}
                  rows={24}
                  aria-label="Profile file content"
                  className="pib-input w-full resize-y font-mono text-xs leading-relaxed disabled:opacity-70"
                />
              </div>
            </div>
          </div>
        )}

        {/* LOGS TAB */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] pib-label">
                Agent Logs
              </p>
              <button
                type="button"
                onClick={() => { loadedTabs.current.delete('logs'); loadLogs(agentId) }}
                disabled={logsLoading}
                className="pib-btn-ghost text-xs font-label flex items-center gap-1.5 disabled:opacity-50"
              >
                <Icon name="refresh" className="text-[14px]" />
                {logsLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            {logsLoading && (
              <div className="space-y-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="pib-skeleton h-4 rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
                ))}
              </div>
            )}

            {logsError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{logsError}</div>
            )}

            {!logsLoading && !logsError && logsData !== null && logsData.length === 0 && (
              <div className="text-sm text-[var(--color-pib-text-muted)] text-center py-8">No runs recorded for this agent yet.</div>
            )}

            {!logsLoading && !logsError && logsData !== null && logsData.length > 0 && (
              <div className="space-y-2">
                {logsData.map((run) => (
                  <div key={run.id} className="pib-card p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-label uppercase tracking-wide px-1.5 py-0.5 rounded ${
                          run.status === 'done' || run.status === 'completed'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : run.status === 'error' || run.status === 'failed'
                            ? 'bg-red-500/15 text-[var(--st-danger)]'
                            : run.status === 'in-progress'
                            ? 'bg-[var(--sc-surface)]/15 text-[var(--sc-ink-soft)]'
                            : 'bg-white/10 text-[var(--color-pib-text-muted)]'
                        }`}>{run.status ?? 'unknown'}</span>
                        {run.orgId && (
                          <span className="text-[10px] font-mono text-[var(--color-pib-text-muted)]/60 truncate max-w-[120px]">{run.orgId}</span>
                        )}
                      </div>
                      {run.createdAt && (
                        <span className="text-[10px] text-[var(--color-pib-text-muted)]/50 shrink-0">
                          {new Date(run.createdAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {run.prompt && (
                      <p className="text-xs text-[var(--color-pib-text-muted)] line-clamp-2">{run.prompt}</p>
                    )}
                    {run.hermesRunId && (
                      <code className="text-[10px] font-mono text-[var(--color-pib-text-muted)]/40">{run.hermesRunId}</code>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CRON TAB */}
        {activeTab === 'cron' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] pib-label">
                Scheduled Jobs ({cronJobs.length})
              </p>
              <div className="flex items-center gap-2">
                {canEdit && cronSupported !== false && (
                  <button
                    type="button"
                    onClick={() => setShowCronForm((v) => !v)}
                    className="pib-btn-ghost text-xs font-label flex items-center gap-1.5"
                  >
                    <Icon name={showCronForm ? 'remove' : 'add'} className="text-[14px]" />
                    New Job
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { loadedTabs.current.delete('cron'); loadCron(agentId) }}
                  disabled={cronLoading}
                  className="pib-btn-ghost text-xs font-label flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Icon name="refresh" className="text-[14px]" />
                  {cronLoading ? 'Loading…' : 'Refresh'}
                </button>
              </div>
            </div>

            {/* New job form */}
            {canEdit && showCronForm && (
              <form
                className="pib-card p-4 space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault()
                  if (!cronPrompt.trim() || !cronSchedule.trim()) return
                  setCronCreating(true)
                  setCronError(null)
                  setCronMessage(null)
                  try {
                    const res = await fetch(`/api/v1/admin/agents/${agentId}/cron`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        name: cronName.trim() || undefined,
                        prompt: cronPrompt.trim(),
                        schedule: cronSchedule.trim(),
                        provider: cronProvider.trim() || undefined,
                        model: cronModel.trim() || undefined,
                      }),
                    })
                    const body = await res.json().catch(() => ({}))
                    if (!res.ok) throw new Error(body.error || `Failed to create job (${res.status})`)
                    setCronMessage('Job created.')
                    setCronName('')
                    setCronPrompt('')
                    setCronSchedule('0 9 * * *')
                    setCronProvider('')
                    setCronModel('')
                    setShowCronForm(false)
                    loadedTabs.current.delete('cron')
                    loadCron(agentId)
                  } catch (err) {
                    setCronError(err instanceof Error ? err.message : 'Failed to create job')
                  } finally {
                    setCronCreating(false)
                  }
                }}
              >
                <p className="text-[10px] pib-label mb-2">New Cron Job</p>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Name (optional)"
                    value={cronName}
                    onChange={(e) => setCronName(e.target.value)}
                    aria-label="Cron job name (optional)"
                    className="pib-input w-full text-sm"
                  />
                  <textarea
                    placeholder="What should the agent do on each run?"
                    value={cronPrompt}
                    onChange={(e) => setCronPrompt(e.target.value)}
                    required
                    rows={3}
                    aria-label="What should the agent do on each run?"
                    className="pib-input w-full text-sm resize-none"
                  />
                  <input
                    type="text"
                    placeholder="Cron expression, e.g. 0 9 * * *"
                    value={cronSchedule}
                    onChange={(e) => setCronSchedule(e.target.value)}
                    required
                    aria-label="Cron expression, e.g. 0 9 * * *"
                    className="pib-input w-full text-sm font-mono"
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      placeholder="Provider override (optional)"
                      value={cronProvider}
                      onChange={(e) => setCronProvider(e.target.value)}
                      aria-label="Provider override (optional)"
                      className="pib-input w-full text-sm font-mono"
                    />
                    <input
                      type="text"
                      placeholder="Model override (optional)"
                      value={cronModel}
                      onChange={(e) => setCronModel(e.target.value)}
                      aria-label="Model override (optional)"
                      className="pib-input w-full text-sm font-mono"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setShowCronForm(false)} className="pib-btn-ghost text-xs font-label">Cancel</button>
                  <button type="submit" disabled={cronCreating} className="btn-pib-primary btn-pib-sm text-xs font-label disabled:opacity-50">
                    {cronCreating ? 'Creating…' : 'Create Job'}
                  </button>
                </div>
              </form>
            )}

            {cronError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{cronError}</div>}
            {cronMessage && <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">{cronMessage}</div>}

            {cronLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="pib-skeleton h-16 rounded-lg" />)}
              </div>
            )}

            {!cronLoading && cronSupported === false && (
              <div className="text-sm text-[var(--color-pib-text-muted)] text-center py-8 space-y-1">
                <p>This agent&apos;s gateway doesn&apos;t expose the cron API.</p>
                <p className="text-[11px] text-[var(--color-pib-text-muted)]/50">Cron support requires Hermes with the full dashboard enabled.</p>
              </div>
            )}

            {!cronLoading && cronSupported !== false && cronJobs.length === 0 && !cronError && (
              <div className="text-sm text-[var(--color-pib-text-muted)] text-center py-8">
                No cron jobs scheduled. Click &ldquo;New Job&rdquo; to create one.
              </div>
            )}

            {cronJobs.map((job) => (
              <div key={job.id} className="pib-card p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {job.name && <span className="text-sm font-medium text-[var(--color-pib-text)]">{job.name}</span>}
                      <code className="text-[10px] font-mono text-[var(--color-pib-text-muted)]/60 bg-white/5 px-1.5 py-0.5 rounded">{job.schedule}</code>
                      {job.status && (
                        <span className={`text-[10px] font-label uppercase px-1.5 py-0.5 rounded ${
                          job.status === 'running' ? 'bg-emerald-500/15 text-emerald-400'
                          : job.status === 'paused' ? 'bg-[var(--sc-surface)]/15 text-[var(--sc-ink-soft)]'
                          : 'bg-white/10 text-[var(--color-pib-text-muted)]'
                        }`}>{job.status}</span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--color-pib-text-muted)] mt-1 line-clamp-2">{job.prompt}</p>
                    <div className="flex gap-3 mt-1 text-[10px] text-[var(--color-pib-text-muted)]/50">
                      {job.last_run && <span>Last: {new Date(job.last_run).toLocaleString()}</span>}
                      {job.next_run && <span>Next: {new Date(job.next_run).toLocaleString()}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="Trigger now"
                        onClick={async () => {
                          setCronMessage(null); setCronError(null)
                          const res = await fetch(`/api/v1/admin/agents/${agentId}/cron/${job.id}?action=trigger`, { method: 'POST' })
                          const b = await res.json().catch(() => ({}))
                          if (res.ok) { setCronMessage('Job triggered.') } else { setCronError(b.error || 'Failed to trigger') }
                        }}
                        className="p-1.5 rounded hover:bg-white/10 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
                      >
                        <Icon name="play_arrow" className="text-[16px]" />
                      </button>
                      <button
                        type="button"
                        title={job.status === 'paused' ? 'Resume' : 'Pause'}
                        onClick={async () => {
                          const action = job.status === 'paused' ? 'resume' : 'pause'
                          setCronMessage(null); setCronError(null)
                          const res = await fetch(`/api/v1/admin/agents/${agentId}/cron/${job.id}?action=${action}`, { method: 'POST' })
                          const b = await res.json().catch(() => ({}))
                          if (res.ok) { setCronMessage(`Job ${action}d.`); loadedTabs.current.delete('cron'); loadCron(agentId) }
                          else { setCronError(b.error || `Failed to ${action}`) }
                        }}
                        className="p-1.5 rounded hover:bg-white/10 text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
                      >
                        <Icon name={job.status === 'paused' ? 'play_circle' : 'pause'} className="text-[16px]" />
                      </button>
                      <button
                        type="button"
                        title="Delete job"
                        onClick={async () => {
                          if (!confirm(`Delete cron job "${job.name || job.id}"?`)) return
                          setCronMessage(null); setCronError(null)
                          const res = await fetch(`/api/v1/admin/agents/${agentId}/cron/${job.id}`, { method: 'DELETE' })
                          const b = await res.json().catch(() => ({}))
                          if (res.ok) { setCronMessage('Job deleted.'); loadedTabs.current.delete('cron'); loadCron(agentId) }
                          else { setCronError(b.error || 'Failed to delete') }
                        }}
                        className="p-1.5 rounded hover:bg-red-500/10 text-[var(--color-pib-text-muted)] hover:text-[var(--st-danger)] transition-colors"
                      >
                        <Icon name="delete" className="text-[16px]" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ENV TAB */}
        {activeTab === 'env' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[10px] pib-label">
                Environment Keys
              </p>
              <button
                type="button"
                onClick={() => { loadedTabs.current.delete('env'); loadEnv(agentId) }}
                disabled={envLoading}
                className="pib-btn-ghost text-xs font-label flex items-center gap-1.5 disabled:opacity-50"
              >
                <Icon name="refresh" className="text-[14px]" />
                {envLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            {envLoading && (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="pib-skeleton h-12 rounded-lg" />)}
              </div>
            )}

            {envError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{envError}</div>
            )}
            {envMessage && (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">{envMessage}</div>
            )}

            {!envLoading && envSupported === false && (
              <div className="text-sm text-[var(--color-pib-text-muted)] text-center py-8 space-y-1">
                <p>This agent&apos;s gateway doesn&apos;t expose the env API.</p>
                <p className="text-[11px] text-[var(--color-pib-text-muted)]/50">Env inspection requires Hermes with the full dashboard enabled.</p>
              </div>
            )}

            {!envLoading && envData !== null && envSupported !== false && (
              <div className="space-y-3">
                {canEdit && (
                  <form onSubmit={saveEnvKey} className="pib-card p-3 space-y-3">
                    <p className="text-[10px] pib-label">Add or update key</p>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                      <input
                        type="text"
                        value={envKey}
                        onChange={(e) => setEnvKey(e.target.value)}
                        placeholder="OPENAI_API_KEY"
                        aria-label="Environment variable key"
                        className="pib-input w-full text-sm font-mono uppercase"
                        pattern="[A-Za-z0-9_]+"
                        required
                      />
                      <input
                        type="password"
                        value={envValue}
                        onChange={(e) => setEnvValue(e.target.value)}
                        placeholder="New value"
                        aria-label="New value for environment variable"
                        className="pib-input w-full text-sm font-mono"
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="submit"
                        disabled={envSaving}
                        className="btn-pib-primary btn-pib-sm text-xs font-label disabled:opacity-50"
                      >
                        {envSaving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                    <p className="text-[10px] text-[var(--color-pib-text-muted)]/60">Secrets remain redacted after saving. Saving restarts this agent on the VPS and must stay inside the approved runtime/config gate.</p>
                  </form>
                )}

                {envData.filter((e) => !e.advanced).length > 0 && (
                  <p className="text-[10px] pib-label mt-2 mb-1">Providers</p>
                )}
                {envData.map((entry) => (
                  <div
                    key={entry.key}
                    className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${
                      entry.is_set ? 'bg-white/5' : 'bg-transparent border border-white/5'
                    }`}
                  >
                    <span className={`mt-0.5 w-2 h-2 rounded shrink-0 ${entry.is_set ? 'bg-emerald-400' : 'bg-white/20'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs font-mono text-[var(--color-pib-text)]">{entry.key}</code>
                        {entry.is_set && entry.redacted_value && (
                          <code className="text-[10px] font-mono text-[var(--color-pib-text-muted)]/60">{entry.redacted_value}</code>
                        )}
                      </div>
                      {entry.description && (
                        <p className="text-[10px] text-[var(--color-pib-text-muted)]/70 mt-0.5">{entry.description}</p>
                      )}
                      {entry.tools && entry.tools.length > 0 && (
                        <div className="flex gap-1 flex-wrap mt-1">
                          {entry.tools.map((t) => (
                            <span key={t} className="text-[9px] font-label bg-primary/10 text-primary/80 px-1.5 py-0.5 rounded">{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => unsetEnvKey(entry.key)}
                        disabled={envSaving}
                        title={`Unset ${entry.key}`}
                        className="p-1.5 rounded hover:bg-red-500/10 text-[var(--color-pib-text-muted)] hover:text-[var(--st-danger)] transition-colors disabled:opacity-50"
                      >
                        <Icon name="delete" className="text-[16px]" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* EDIT TAB */}
        {activeTab === 'edit' && (
          <form id="agent-edit-form" onSubmit={handleSave} className="space-y-4">
            <FieldRow label="Name" htmlFor="agent-edit-name">
              <input
                id="agent-edit-name"
                aria-label="Agent name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="pib-input w-full"
                required
              />
            </FieldRow>

            <FieldRow label="Persona" htmlFor="agent-edit-persona">
              <textarea
                id="agent-edit-persona"
                aria-label="Agent persona"
                value={editPersona}
                onChange={(e) => setEditPersona(e.target.value)}
                className="pib-input w-full resize-none"
                rows={4}
              />
            </FieldRow>

            <FieldRow label="Registry default model label" htmlFor="agent-edit-model">
              <input
                id="agent-edit-model"
                aria-label="Registry default model label"
                type="text"
                value={editModel}
                onChange={(e) => setEditModel(e.target.value)}
                className="pib-input w-full font-mono text-sm"
                placeholder="e.g. xai-oauth / grok-4.6"
              />
              <p className="mt-1 text-[10px] text-[var(--color-pib-text-muted)]/70">
                Display/registry only. To change what Messages <strong className="text-[var(--color-pib-text)]">Auto</strong> uses
                (live provider, model, effort, fallbacks), open the <button type="button" className="underline text-primary" onClick={() => activateTab('config')}>Config</button> tab.
              </p>
            </FieldRow>

            <FieldRow label="Base URL" htmlFor="agent-edit-base-url">
              <input
                id="agent-edit-base-url"
                aria-label="Base URL"
                type="url"
                value={editBaseUrl}
                onChange={(e) => setEditBaseUrl(e.target.value)}
                className="pib-input w-full font-mono text-sm"
                placeholder="https://…"
              />
            </FieldRow>

            <FieldRow label="API Key (leave blank to keep current)" htmlFor="agent-edit-api-key">
              <input
                id="agent-edit-api-key"
                aria-label="API key"
                type="password"
                value={editApiKey}
                onChange={(e) => setEditApiKey(e.target.value)}
                className="pib-input w-full font-mono text-sm"
                placeholder={agent.apiKey}
                autoComplete="new-password"
              />
            </FieldRow>

            <label className="flex items-center gap-3 cursor-pointer group select-none">
              <div
                onClick={() => setEditEnabled((v) => !v)}
                className={`relative w-10 h-6 rounded transition-colors duration-150 ${editEnabled ? 'bg-emerald-500' : 'bg-white/20'}`}
              >
                <span
                  className={`absolute top-1 left-1 w-4 h-4 rounded bg-white shadow transition-transform duration-150 ${editEnabled ? 'translate-x-4' : 'translate-x-0'}`}
                />
              </div>
              <span className="text-sm text-[var(--color-pib-text)] group-hover:text-[var(--color-pib-text)]">
                Agent enabled
              </span>
            </label>
          </form>
        )}

      </div>

      {/* Sticky footer  -  only visible on Edit tab */}
      {activeTab === 'edit' && (
        <div className="shrink-0 flex justify-end gap-1.5 border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="pib-btn-ghost text-sm font-label"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="agent-edit-form"
            className="btn-pib-primary btn-pib-sm text-sm font-label"
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}
