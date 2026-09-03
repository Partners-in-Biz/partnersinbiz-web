'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  authoringSurfaceCopy,
  blankGraphTemplateDraft,
  buildTemplateFromDraft,
  draftFromTemplate,
  exposeNoraControls,
  materializationPreview,
  serializeAuthoringPayload,
  type GraphNodeDraft,
  type GraphTemplateDraft,
} from '@/lib/workflow-graph/authoring'
import type { GraphTemplate, WorkflowNodeKind } from '@/lib/workflow-graph/types'
import { AGENT_MODEL_OPTIONS } from '@/lib/agents/runRouting'

const NODE_KINDS: WorkflowNodeKind[] = [
  'agent',
  'human_gate',
  'code_check',
  'system',
  'wait_event',
  'delay',
]

const AGENT_OPTIONS = ['pip', 'theo', 'maya', 'sage', 'nora', 'docs', 'seo', 'ads', 'qa-release', 'support', 'data', 'sales']

function csv(value: string): string[] {
  return Array.from(new Set(value.split(',').map((part) => part.trim()).filter(Boolean)))
}

function csvJoin(values?: string[]): string {
  return Array.isArray(values) ? values.join(', ') : ''
}

function hoursFromMs(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  return String(Math.round(ms / 3_600_000 * 10) / 10)
}

function msFromHours(value: string): number | undefined {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.round(n * 3_600_000)
}

function emptyNode(kind: WorkflowNodeKind = 'agent'): GraphNodeDraft {
  const id = `node_${Math.random().toString(36).slice(2, 8)}`
  return {
    nodeId: id,
    kind,
    name: kind === 'agent' ? 'Agent step' : kind === 'human_gate' ? 'Human gate' : kind,
    dependsOnNodeIds: [],
    assigneeAgentId: kind === 'agent' ? 'theo' : undefined,
    expectedArtifacts: kind === 'agent' || kind === 'human_gate' ? ['evidence'] : [],
    agentInput: kind === 'agent' ? { spec: '' } : undefined,
    requiredCapability: kind === 'human_gate' ? 'publish' : undefined,
    checkType: kind === 'code_check' ? 'artifact_presence' : undefined,
    systemAction: kind === 'system' ? 'system:noop' : undefined,
    riskLevel: 'medium',
  }
}

export function WorkflowGraphAuthoringPanel({
  projectId,
  orgId,
}: {
  projectId: string
  orgId?: string
}) {
  const copy = authoringSurfaceCopy()
  const [templates, setTemplates] = useState<GraphTemplate[]>([])
  const [draft, setDraft] = useState<GraphTemplateDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRunId, setLastRunId] = useState<string | null>(null)
  const [inspectSummary, setInspectSummary] = useState<string | null>(null)

  const scopedOrgId = orgId || ''

  const loadTemplates = useCallback(async () => {
    if (!scopedOrgId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/graph-templates?orgId=${encodeURIComponent(scopedOrgId)}&limit=100`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to load graph templates')
      const items = Array.isArray(body.data?.items) ? (body.data.items as GraphTemplate[]) : []
      const forProject = items.filter((item) => !item.projectId || item.projectId === projectId || item.pilot === true)
      setTemplates(forProject)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph templates')
    } finally {
      setLoading(false)
    }
  }, [projectId, scopedOrgId])

  useEffect(() => {
    loadTemplates().catch(() => {})
  }, [loadTemplates])

  const preview = useMemo(
    () => materializationPreview(draft?.nodes || []),
    [draft?.nodes],
  )

  const nora = useMemo(
    () => (draft ? exposeNoraControls(draft) : null),
    [draft],
  )

  const validation = useMemo(() => {
    if (!draft || !scopedOrgId) return null
    return buildTemplateFromDraft(draft, scopedOrgId)
  }, [draft, scopedOrgId])

  function startNew() {
    if (!scopedOrgId) {
      setError('Project orgId is required to author graph templates')
      return
    }
    setDraft(blankGraphTemplateDraft({
      orgId: scopedOrgId,
      projectId,
      name: 'New workflow graph',
    }))
    setMessage(null)
    setError(null)
    setLastRunId(null)
    setInspectSummary(null)
  }

  function editTemplate(template: GraphTemplate) {
    setDraft(draftFromTemplate(template))
    setMessage(null)
    setError(null)
    setLastRunId(null)
    setInspectSummary(null)
  }

  function updateNode(index: number, patch: Partial<GraphNodeDraft>) {
    if (!draft) return
    const nodes = draft.nodes.map((node, i) => (i === index ? { ...node, ...patch } : node))
    setDraft({ ...draft, nodes })
  }

  function removeNode(index: number) {
    if (!draft) return
    setDraft({ ...draft, nodes: draft.nodes.filter((_, i) => i !== index) })
  }

  async function saveDraft(nextStatus?: GraphTemplate['status']) {
    if (!draft || !scopedOrgId) return
    const working = nextStatus ? { ...draft, status: nextStatus } : draft
    const built = buildTemplateFromDraft(working, scopedOrgId)
    if (!built.ok) {
      setError(built.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = serializeAuthoringPayload(working, scopedOrgId)
      const hasId = Boolean(working.id)
      const res = await fetch(
        hasId
          ? `/api/v1/graph-templates/${encodeURIComponent(working.id!)}`
          : `/api/v1/graph-templates?orgId=${encodeURIComponent(scopedOrgId)}`,
        {
          method: hasId ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Org-Id': scopedOrgId,
          },
          body: JSON.stringify(payload),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Save failed')
      const saved = (body.data || body) as GraphTemplate
      setDraft(draftFromTemplate(saved))
      setMessage(`Saved ${saved.name} v${saved.version} (${saved.status})`)
      await loadTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function ensurePilot() {
    if (!scopedOrgId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/graph-templates?orgId=${encodeURIComponent(scopedOrgId)}&ensurePilot=true&projectId=${encodeURIComponent(projectId)}`,
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Pilot ensure failed')
      const pilot = (body.data?.pilot || body.data?.items?.[0]) as GraphTemplate | undefined
      if (pilot) {
        setDraft(draftFromTemplate(pilot))
        setMessage(`Pilot ready: ${pilot.name}`)
      }
      await loadTemplates()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pilot ensure failed')
    } finally {
      setSaving(false)
    }
  }

  async function startRun() {
    if (!draft?.id || !scopedOrgId) {
      setError('Save an active template before starting a run')
      return
    }
    if (draft.status !== 'active') {
      setError('Template must be active to start a run')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/workflow-runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Org-Id': scopedOrgId,
          'Idempotency-Key': `suite-start:${draft.id}:${projectId}:${Date.now()}`,
        },
        body: JSON.stringify({
          orgId: scopedOrgId,
          templateId: draft.id,
          projectId,
          triggerType: 'manual',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Start run failed')
      const run = body.data?.run
      const inspect = body.data?.inspect
      setLastRunId(run?.id || null)
      setInspectSummary(
        inspect
          ? `status=${inspect.status}; blocker=${inspect.blocker?.code || inspect.blockedReasonCode || 'none'}; nodes=${inspect.nodes?.length ?? 0}`
          : null,
      )
      setMessage(`Started run ${run?.id || ''}`.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Start run failed')
    } finally {
      setSaving(false)
    }
  }

  if (!scopedOrgId) {
    return (
      <section className="pib-card rounded-[var(--radius-card)] p-5">
        <h3 className="text-sm font-headline font-medium text-[var(--color-pib-text)]">{copy.title}</h3>
        <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">Project org is still loading - graph authoring waits for org scope.</p>
      </section>
    )
  }

  return (
    <section className="pib-card rounded-[var(--radius-card)] p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="pib-label">Suite · Workflow Graph</p>
          <h3 className="mt-1 text-sm font-headline font-medium text-[var(--color-pib-text)]">{copy.title}</h3>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{copy.subtitle}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {copy.bans.map((ban) => (
              <li
                key={ban}
                className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-card)] px-2 py-0.5 text-[11px] text-[var(--color-pib-text-muted)]"
              >
                {ban}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="pib-btn-secondary text-xs" disabled={saving || loading} onClick={() => startNew()}>
            New template
          </button>
          <button type="button" className="pib-btn-secondary text-xs" disabled={saving || loading} onClick={() => ensurePilot()}>
            Ensure pilot
          </button>
          <button type="button" className="pib-btn-secondary text-xs" disabled={saving || loading} onClick={() => loadTemplates()}>
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 rounded-[var(--radius-btn)] border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-[var(--radius-btn)] border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">{message}</p>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(220px,0.35fr)_minmax(0,1fr)]">
        <div className="rounded-[var(--radius-btn)] border border-[var(--color-pib-line)] bg-[var(--color-card)] p-3">
          <h4 className="text-xs font-headline font-medium text-[var(--color-pib-text)]">Templates</h4>
          <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
            {loading ? 'Loading…' : `${templates.length} template(s) · not a second board`}
          </p>
          <ul className="mt-3 space-y-2">
            {templates.map((template) => (
              <li key={template.id}>
                <button
                  type="button"
                  className="w-full rounded-[var(--radius-btn)] border border-[var(--color-pib-line)] px-3 py-2 text-left hover:border-[var(--color-accent-v2)]"
                  onClick={() => editTemplate(template)}
                >
                  <div className="text-xs font-medium text-[var(--color-pib-text)]">{template.name}</div>
                  <div className="mt-0.5 text-[11px] text-[var(--color-pib-text-muted)]">
                    {template.status} · v{template.version} · {template.nodes?.length || 0} nodes
                    {template.pilot ? ' · pilot' : ''}
                  </div>
                </button>
              </li>
            ))}
            {!loading && templates.length === 0 ? (
              <li className="text-[11px] text-[var(--color-pib-text-muted)]">No templates yet. Create one or ensure the internal pilot.</li>
            ) : null}
          </ul>
        </div>

        <div className="space-y-4">
          {!draft ? (
            <div className="rounded-[var(--radius-btn)] border border-dashed border-[var(--color-pib-line)] p-6 text-sm text-[var(--color-pib-text-muted)]">
              Select a template or create a new structured GraphTemplate. Agent and human_gate work still lands on this project&apos;s Kanban only.
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block pib-label">Name</span>
                  <input
                    className="pib-input"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block pib-label">Status</span>
                  <select
                    className="pib-input"
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value as GraphTemplateDraft['status'] })}
                  >
                    <option value="draft">draft</option>
                    <option value="active">active</option>
                    <option value="archived">archived</option>
                  </select>
                </label>
              </div>

              {nora ? (
                <div className="rounded-[var(--radius-btn)] border border-[var(--color-pib-line)] bg-[var(--color-card)] p-3">
                  <h4 className="text-xs font-headline font-medium text-[var(--color-pib-text)]">Nora ops controls</h4>
                  <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">Budgets, concurrency limits, notify policy, and stuck/gate SLAs.</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block pib-label">Max concurrent agents / run (1–8)</span>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        className="pib-input"
                        value={draft.limits.maxConcurrentAgentNodes}
                        onChange={(e) => setDraft({
                          ...draft,
                          limits: {
                            ...draft.limits,
                            maxConcurrentAgentNodes: Number(e.target.value) || 1,
                          },
                        })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block pib-label">Max tokens / run</span>
                      <input
                        type="number"
                        className="pib-input"
                        value={draft.budgets.maxTokensPerRun ?? ''}
                        onChange={(e) => setDraft({
                          ...draft,
                          budgets: {
                            ...draft.budgets,
                            maxTokensPerRun: e.target.value === '' ? undefined : Number(e.target.value),
                          },
                        })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block pib-label">Max cost / run</span>
                      <input
                        type="number"
                        className="pib-input"
                        value={draft.budgets.maxCostPerRun ?? ''}
                        onChange={(e) => setDraft({
                          ...draft,
                          budgets: {
                            ...draft.budgets,
                            maxCostPerRun: e.target.value === '' ? undefined : Number(e.target.value),
                          },
                        })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block pib-label">Warn at ratio</span>
                      <input
                        type="number"
                        step="0.05"
                        min={0.1}
                        max={1}
                        className="pib-input"
                        value={draft.budgets.warnAtRatio ?? 0.8}
                        onChange={(e) => setDraft({
                          ...draft,
                          budgets: {
                            ...draft.budgets,
                            warnAtRatio: Number(e.target.value) || 0.8,
                          },
                        })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block pib-label">On budget exceed</span>
                      <select
                        className="pib-input"
                        value={draft.budgets.onExceed}
                        onChange={(e) => setDraft({
                          ...draft,
                          budgets: {
                            ...draft.budgets,
                            onExceed: e.target.value as GraphTemplateDraft['budgets']['onExceed'],
                          },
                        })}
                      >
                        <option value="pause_run">pause_run</option>
                        <option value="block_new_agent_nodes">block_new_agent_nodes</option>
                        <option value="fail_run">fail_run</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block pib-label">Currency</span>
                      <select
                        className="pib-input"
                        value={draft.budgets.currency}
                        onChange={(e) => setDraft({
                          ...draft,
                          budgets: {
                            ...draft.budgets,
                            currency: e.target.value as 'USD' | 'ZAR',
                          },
                        })}
                      >
                        <option value="USD">USD</option>
                        <option value="ZAR">ZAR</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-2 pt-6 text-xs text-[var(--color-pib-text)]">
                      <input
                        type="checkbox"
                        checked={draft.notify.quietSuccess}
                        onChange={(e) => setDraft({
                          ...draft,
                          notify: { ...draft.notify, quietSuccess: e.target.checked },
                        })}
                      />
                      Quiet success
                    </label>
                    <label className="flex items-center gap-2 pt-6 text-xs text-[var(--color-pib-text)]">
                      <input
                        type="checkbox"
                        checked={draft.notify.alertOnBlock}
                        onChange={(e) => setDraft({
                          ...draft,
                          notify: { ...draft.notify, alertOnBlock: e.target.checked },
                        })}
                      />
                      Alert on block
                    </label>
                    <label className="block">
                      <span className="mb-1 block pib-label">CEO notify on (csv)</span>
                      <input
                        className="pib-input"
                        placeholder="block, budget, human_gate_sla"
                        value={csvJoin(draft.notify.ceoNotifyOn as string[] | undefined)}
                        onChange={(e) => setDraft({
                          ...draft,
                          notify: {
                            ...draft.notify,
                            ceoNotifyOn: csv(e.target.value).filter((v): v is 'block' | 'budget' | 'human_gate_sla' =>
                              v === 'block' || v === 'budget' || v === 'human_gate_sla',
                            ),
                          },
                        })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block pib-label">Agent heartbeat SLA (hours)</span>
                      <input
                        className="pib-input"
                        value={hoursFromMs(draft.sla.agentRunningHeartbeatMs)}
                        onChange={(e) => setDraft({
                          ...draft,
                          sla: {
                            ...draft.sla,
                            agentRunningHeartbeatMs: msFromHours(e.target.value) ?? draft.sla.agentRunningHeartbeatMs,
                          },
                        })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block pib-label">Human gate warn (hours)</span>
                      <input
                        className="pib-input"
                        value={hoursFromMs(draft.sla.humanGateWarnMs)}
                        onChange={(e) => setDraft({
                          ...draft,
                          sla: {
                            ...draft.sla,
                            humanGateWarnMs: msFromHours(e.target.value) ?? draft.sla.humanGateWarnMs,
                          },
                        })}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block pib-label">Run no-transition (hours)</span>
                      <input
                        className="pib-input"
                        value={hoursFromMs(draft.sla.runNoTransitionMs)}
                        onChange={(e) => setDraft({
                          ...draft,
                          sla: {
                            ...draft.sla,
                            runNoTransitionMs: msFromHours(e.target.value) ?? draft.sla.runNoTransitionMs,
                          },
                        })}
                      />
                    </label>
                  </div>
                </div>
              ) : null}

              <div className="rounded-[var(--radius-btn)] border border-[var(--color-pib-line)] bg-[var(--color-card)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-headline font-medium text-[var(--color-pib-text)]">Nodes</h4>
                    <p className="mt-1 text-[11px] text-[var(--color-pib-text-muted)]">
                      Kanban materialize: {preview.kanbanNodeIds.join(', ') || 'none'} · Ledger-only: {preview.ledgerOnlyNodeIds.join(', ') || 'none'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="pib-btn-secondary text-xs"
                    onClick={() => setDraft({ ...draft, nodes: [...draft.nodes, emptyNode('agent')] })}
                  >
                    Add agent node
                  </button>
                </div>

                <div className="mt-3 space-y-3">
                  {draft.nodes.map((node, index) => (
                    <div key={`${node.nodeId}-${index}`} className="rounded-[var(--radius-btn)] border border-[var(--color-pib-line)] p-3">
                      <div className="grid gap-2 md:grid-cols-4">
                        <label className="block">
                          <span className="mb-1 block pib-label">nodeId</span>
                          <input
                            className="pib-input"
                            value={node.nodeId}
                            onChange={(e) => updateNode(index, { nodeId: e.target.value.trim() || node.nodeId })}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block pib-label">kind</span>
                          <select
                            className="pib-input"
                            value={node.kind}
                            onChange={(e) => updateNode(index, { kind: e.target.value as WorkflowNodeKind })}
                          >
                            {NODE_KINDS.map((kind) => (
                              <option key={kind} value={kind}>{kind}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block md:col-span-2">
                          <span className="mb-1 block pib-label">name</span>
                          <input
                            className="pib-input"
                            value={node.name}
                            onChange={(e) => updateNode(index, { name: e.target.value })}
                          />
                        </label>
                        <label className="block md:col-span-2">
                          <span className="mb-1 block pib-label">dependsOnNodeIds (csv)</span>
                          <input
                            className="pib-input"
                            value={csvJoin(node.dependsOnNodeIds)}
                            onChange={(e) => updateNode(index, { dependsOnNodeIds: csv(e.target.value) })}
                          />
                        </label>
                        {node.kind === 'agent' ? (
                          <>
                            <label className="block">
                              <span className="mb-1 block pib-label">assigneeAgentId</span>
                              <select
                                className="pib-input"
                                value={node.assigneeAgentId || 'theo'}
                                onChange={(e) => updateNode(index, { assigneeAgentId: e.target.value })}
                              >
                                {AGENT_OPTIONS.map((agent) => (
                                  <option key={agent} value={agent}>{agent}</option>
                                ))}
                              </select>
                            </label>
                            <label className="block">
                              <span className="mb-1 block pib-label">agentModel</span>
                              <select
                                className="pib-input"
                                value={node.agentModel || ''}
                                onChange={(e) => updateNode(index, { agentModel: (e.target.value || undefined) as GraphNodeDraft['agentModel'] })}
                              >
                                <option value="">Platform default</option>
                                {AGENT_MODEL_OPTIONS.map((model) => (
                                  <option key={model.value} value={model.value}>{model.label}</option>
                                ))}
                              </select>
                            </label>
                            <label className="block md:col-span-3">
                              <span className="mb-1 block pib-label">agentInput.spec</span>
                              <textarea
                                className="pib-input"
                                rows={2}
                                value={node.agentInput?.spec || ''}
                                onChange={(e) => updateNode(index, {
                                  agentInput: { ...(node.agentInput || { spec: '' }), spec: e.target.value },
                                })}
                              />
                            </label>
                          </>
                        ) : null}
                        {node.kind === 'human_gate' || node.kind === 'system' || node.kind === 'agent' ? (
                          <label className="block">
                            <span className="mb-1 block pib-label">requiredCapability</span>
                            <input
                              className="pib-input"
                              value={node.requiredCapability || ''}
                              onChange={(e) => updateNode(index, { requiredCapability: e.target.value || undefined })}
                            />
                          </label>
                        ) : null}
                        {node.kind === 'system' ? (
                          <label className="block md:col-span-2">
                            <span className="mb-1 block pib-label">systemAction</span>
                            <input
                              className="pib-input"
                              value={node.systemAction || ''}
                              onChange={(e) => updateNode(index, { systemAction: e.target.value })}
                            />
                          </label>
                        ) : null}
                        {node.kind === 'code_check' ? (
                          <label className="block md:col-span-2">
                            <span className="mb-1 block pib-label">checkType</span>
                            <input
                              className="pib-input"
                              value={node.checkType || ''}
                              onChange={(e) => updateNode(index, { checkType: e.target.value })}
                            />
                          </label>
                        ) : null}
                        <label className="block md:col-span-2">
                          <span className="mb-1 block pib-label">expectedArtifacts (csv)</span>
                          <input
                            className="pib-input"
                            value={csvJoin(node.expectedArtifacts)}
                            onChange={(e) => updateNode(index, { expectedArtifacts: csv(e.target.value) })}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block pib-label">reviewerAgentId</span>
                          <input
                            className="pib-input"
                            value={node.reviewerAgentId || ''}
                            onChange={(e) => updateNode(index, { reviewerAgentId: e.target.value || undefined })}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block pib-label">riskLevel</span>
                          <select
                            className="pib-input"
                            value={node.riskLevel || 'medium'}
                            onChange={(e) => updateNode(index, { riskLevel: e.target.value as GraphNodeDraft['riskLevel'] })}
                          >
                            <option value="low">low</option>
                            <option value="medium">medium</option>
                            <option value="high">high</option>
                          </select>
                        </label>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-[11px] text-[var(--color-pib-text-muted)]">
                          {node.kind === 'agent' || node.kind === 'human_gate'
                            ? 'Materializes to Kanban on this project'
                            : 'Ledger-only - never a board card'}
                        </p>
                        <button type="button" className="text-xs text-red-300" onClick={() => removeNode(index)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  {draft.nodes.length === 0 ? (
                    <p className="text-[11px] text-[var(--color-pib-text-muted)]">Add at least one node. Agent nodes need assignee + spec + expectedArtifacts.</p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="pib-btn-primary text-xs" disabled={saving} onClick={() => saveDraft()}>
                  {saving ? 'Saving…' : 'Save template'}
                </button>
                <button type="button" className="pib-btn-secondary text-xs" disabled={saving} onClick={() => saveDraft('active')}>
                  Save & activate
                </button>
                <button type="button" className="pib-btn-secondary text-xs" disabled={saving || !draft.id} onClick={() => startRun()}>
                  Start run on Kanban
                </button>
                {validation && !validation.ok ? (
                  <span className="text-xs text-[var(--st-warning)]">Validation: {validation.error}</span>
                ) : (
                  <span className="text-xs text-emerald-200">Validation: ok · materialize {preview.kanbanNodeIds.length} / ledger {preview.ledgerOnlyNodeIds.length}</span>
                )}
              </div>

              {lastRunId ? (
                <p className="text-[11px] text-[var(--color-pib-text-muted)]">
                  Last run: {lastRunId}
                  {inspectSummary ? ` · ${inspectSummary}` : ''}
                  {' '}· inspect via GET /api/v1/workflow-runs?id=
                  {lastRunId}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
