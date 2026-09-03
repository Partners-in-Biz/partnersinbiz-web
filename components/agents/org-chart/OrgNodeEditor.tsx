'use client'

/**
 * Org-chart side drawer.
 *
 * Role tab → Firestore org-node defaults (Kanban fill-ins)
 * Runtime tab → full live Hermes AgentDetailPanel (same as /admin/agents)
 *   when the node is bound to a real agentId.
 */

import { useCallback, useEffect, useState } from 'react'
import type { AgentOrgNode } from '@/lib/agent-org/types'
import type { AgentTeamDoc } from '@/components/agents/AgentCard'
import type { RuntimeModelSummary } from '@/lib/agents/runtime-config'
import { PageTabs } from '@/components/ui/AppFoundation'
import { AgentDetailPanel } from '@/components/agents/AgentDetailPanel'
import OrgRoleForm from './OrgRoleForm'

import { Icon } from '@/components/studio'

type DrawerTab = 'role' | 'runtime'

export interface OrgNodeEditorProps {
  open: boolean
  orgId: string
  /** null = create mode. */
  node: AgentOrgNode | null
  /** All nodes of the org  -  used for the reportsTo select. */
  nodes: AgentOrgNode[]
  canEdit?: boolean
  /** Live team docs keyed by agentId (from /admin/agents or portal agents). */
  agentsById?: Record<string, AgentTeamDoc & { runtimeModel?: RuntimeModelSummary }>
  /**
   * Chart CRUD base path.
   * Admin: `/api/v1/admin/agent-org`
   * Portal: `/api/v1/portal/settings/agents/org-chart`
   */
  apiBase?: string
  /** Show Runtime tab + AgentDetailPanel (admin only  -  needs superadmin agent APIs). */
  allowRuntimeTab?: boolean
  /** Allow push to live Hermes from the Role tab. */
  allowLiveRuntimeSync?: boolean
  readOnlyMessage?: string
  onClose: () => void
  onSaved: (node: AgentOrgNode | null) => void
  onDeleted: () => void
  /** Called when live agent runtime is saved so parent can refresh live chips. */
  onRuntimeSaved?: (agent: AgentTeamDoc) => void
}

export default function OrgNodeEditor({
  open,
  orgId,
  node,
  nodes,
  canEdit = true,
  agentsById = {},
  apiBase = '/api/v1/admin/agent-org',
  allowRuntimeTab = true,
  allowLiveRuntimeSync = true,
  readOnlyMessage,
  onClose,
  onSaved,
  onDeleted,
  onRuntimeSaved,
}: OrgNodeEditorProps) {
  const [tab, setTab] = useState<DrawerTab>('role')
  const [boundAgent, setBoundAgent] = useState<(AgentTeamDoc & { runtimeModel?: RuntimeModelSummary }) | null>(null)
  const [agentLoadError, setAgentLoadError] = useState<string | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)

  const agentId = node?.agentId?.trim() || ''

  const loadBoundAgent = useCallback(async (id: string) => {
    if (!id) {
      setBoundAgent(null)
      setAgentLoadError(null)
      return
    }
    const cached = agentsById[id]
    if (cached) {
      setBoundAgent(cached)
      setAgentLoadError(null)
    }
    // Portal mode: no admin agent config API  -  rely on agentsById cache only.
    if (!allowRuntimeTab) {
      if (!cached) {
        setBoundAgent(null)
        setAgentLoadError(null)
      }
      setAgentLoading(false)
      return
    }
    setAgentLoading(true)
    setAgentLoadError(null)
    try {
      // Prefer the team list cache; config is used only to confirm the agent exists.
      const res = await fetch(`/api/v1/admin/agents/${encodeURIComponent(id)}/config`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (cached) {
          setBoundAgent(cached)
          setAgentLoadError(null)
          return
        }
        throw new Error(body?.error ?? `Agent ${id} not found (${res.status})`)
      }
      const data = (body.data ?? {}) as Record<string, unknown>
      const fromConfig: AgentTeamDoc = {
        agentId: id,
        name: String(data.name ?? cached?.name ?? id),
        role: String(data.role ?? cached?.role ?? 'Specialist'),
        persona: String(data.persona ?? cached?.persona ?? ''),
        enabled: data.enabled !== false,
        baseUrl: String(data.baseUrl ?? cached?.baseUrl ?? ''),
        apiKey: String(data.apiKey ?? cached?.apiKey ?? '••••••'),
        defaultModel: typeof data.defaultModel === 'string'
          ? data.defaultModel
          : (cached?.defaultModel ?? ''),
        iconKey: String(data.iconKey ?? cached?.iconKey ?? node?.iconKey ?? 'smart_toy'),
        colorKey: String(data.colorKey ?? cached?.colorKey ?? node?.colorKey ?? 'violet'),
        responsibilities: cached?.responsibilities ?? [],
        skills: cached?.skills ?? [],
        cronWatchLoops: cached?.cronWatchLoops ?? [],
        allowedScopes: cached?.allowedScopes ?? [],
        exampleTaskTypes: cached?.exampleTaskTypes ?? [],
        skillPolicy: cached?.skillPolicy,
        runtimeModel: cached?.runtimeModel,
        lastHealthCheck: cached?.lastHealthCheck,
        lastHealthStatus: cached?.lastHealthStatus,
      }
      setBoundAgent(fromConfig)
    } catch (e) {
      if (!cached) {
        setBoundAgent(null)
        setAgentLoadError(e instanceof Error ? e.message : 'Failed to load agent')
      }
    } finally {
      setAgentLoading(false)
    }
  }, [agentsById, allowRuntimeTab, node?.colorKey, node?.iconKey])

  useEffect(() => {
    if (!open) return
    setTab('role')
    void loadBoundAgent(agentId)
  }, [open, agentId, node?.id, loadBoundAgent])

  useEffect(() => {
    if (tab === 'runtime' && !agentId) setTab('role')
  }, [tab, agentId])

  if (!open) return null

  const title = node ? node.name : 'New role'
  const subtitle = node
    ? (node.agentId ? `${node.title} · ${node.agentId}` : node.title)
    : 'Create a node on the org chart'

  const tabs: Array<{ label: string; value: DrawerTab }> = [
    { label: 'Org role', value: 'role' },
    ...(allowRuntimeTab && agentId ? [{ label: 'Live runtime', value: 'runtime' as const }] : []),
  ]

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-[var(--color-pib-line)] bg-[var(--color-pib-bg)]"
        data-module-accent="cyan"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ animation: 'slideIn 0.2s ease-out' }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-pib-line)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-medium text-[var(--color-pib-text)]">
              {title}
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--color-pib-text-muted)]">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-pib-text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--color-pib-text)]"
            aria-label="Close editor"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>

        {tabs.length > 1 && (
          <PageTabs
            className="shrink-0 border-x-0 border-t-0 px-4 py-2"
            ariaLabel="Org node editor tabs"
            value={tab}
            onValueChange={(value) => setTab(value as DrawerTab)}
            tabs={tabs}
          />
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === 'role' && (
            <div className="h-full overflow-y-auto px-5 py-4">
              <OrgRoleForm
                orgId={orgId}
                node={node}
                nodes={nodes}
                canEdit={canEdit}
                apiBase={apiBase}
                allowLiveRuntimeSync={allowLiveRuntimeSync}
                readOnlyMessage={readOnlyMessage}
                defaultSyncLiveRuntime={allowLiveRuntimeSync}
                showCancel
                onCancel={onClose}
                onSaved={(saved) => {
                  onSaved(saved)
                  const nextId = saved?.agentId?.trim()
                  if (nextId) void loadBoundAgent(nextId)
                }}
                onDeleted={onDeleted}
              />
            </div>
          )}

          {allowRuntimeTab && tab === 'runtime' && (
            <div className="flex h-full min-h-0 flex-col">
              {agentLoading && !boundAgent ? (
                <div className="p-5 text-sm text-[var(--color-pib-text-muted)]">Loading live agent…</div>
              ) : agentLoadError && !boundAgent ? (
                <div className="space-y-3 p-5">
                  <div role="alert" className="rounded-md border border-amber-500/30 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] px-3 py-2 text-xs text-[var(--st-warning)]">
                    {agentLoadError}
                  </div>
                  <p className="text-xs text-[var(--color-pib-text-muted)]">
                    Bind a seeded runtime agent id (pip, theo, maya, …) on the Org role tab to unlock
                    live model, skills, cron, env, and profile files  -  same panel as /admin/agents.
                  </p>
                </div>
              ) : boundAgent ? (
                <AgentDetailPanel
                  agent={boundAgent}
                  onClose={onClose}
                  onSaved={(agent) => {
                    setBoundAgent((prev) => (prev ? { ...prev, ...agent } : agent))
                    onRuntimeSaved?.(agent)
                  }}
                  canEdit={canEdit}
                  hideChrome
                />
              ) : (
                <div className="p-5 text-sm text-[var(--color-pib-text-muted)]">
                  No live agent bound.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
