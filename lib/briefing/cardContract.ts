import type { BriefingSourceItem, BriefingV2CardContract } from './types'
import { extractSafeExcerpt } from './utils'

const GATED_EXTERNAL_ACTIONS = 'Production deploys, main merges, public publishing, client/prospect sends, paid spend, finance, secret/config changes, and destructive actions remain separately approval-gated.'

function clean(value: unknown, maxLength = 240): string | null {
  return extractSafeExcerpt(value, { maxLength })
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = clean(value)
    if (text) return text
  }
  return null
}

function sourceLabel(item: BriefingSourceItem): string {
  return item.source.type.replace(/-/g, ' ')
}

function sourceHref(item: BriefingSourceItem): string | null {
  return clean(item.source.url, 500)
}

function sourceEvidence(item: BriefingSourceItem): BriefingV2CardContract['evidenceLinks'] {
  const links: BriefingV2CardContract['evidenceLinks'] = []
  const href = sourceHref(item)
  if (href) {
    links.push({ id: 'source', label: `Open source ${sourceLabel(item)}`, href, kind: 'source' })
  }

  const evidenceRows = item.metadata?.softwareBuildEvidence
  if (Array.isArray(evidenceRows)) {
    for (const row of evidenceRows.slice(0, 6)) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue
      const candidate = row as Record<string, unknown>
      const label = firstText(candidate.label, candidate.kind, candidate.value)
      const href = clean(candidate.href, 500)
      const value = firstText(candidate.value)
      if (!label && !href && !value) continue
      links.push({
        id: `evidence-${links.length}`,
        label: label ?? 'Evidence',
        href: href ?? undefined,
        description: value ?? undefined,
        kind: 'evidence',
      })
    }
  }

  const sourceEvidenceId = firstText(item.context.sourceEvidenceId)
  if (sourceEvidenceId) {
    links.push({ id: 'source-evidence-id', label: 'Source evidence id', description: sourceEvidenceId, kind: 'evidence' })
  }

  return links
}

function defaultSafetyGate(item: BriefingSourceItem): BriefingV2CardContract['safetyGate'] {
  const requiresApproval = ['needs-peet', 'critical', 'client-risk', 'review'].includes(item.priority)
  return {
    level: requiresApproval ? 'approval-required' : 'internal-only',
    summary: GATED_EXTERNAL_ACTIONS,
    sideEffectAllowed: false,
    requiresApproval,
    gatedActions: ['production-deploy', 'main-merge', 'public-publish', 'external-send', 'paid-spend', 'finance-change', 'secret-config-change', 'destructive-delete'],
  }
}

function defaultNearestValidActions(item: BriefingSourceItem): BriefingV2CardContract['nearestValidActions'] {
  const actions: BriefingV2CardContract['nearestValidActions'] = [
    { action: 'open-evidence', label: 'Open evidence/source', reason: 'Read-only, source-linked review is safe before any gated action.' },
    { action: 'create-task', label: 'Create internal follow-up task', reason: 'Internal Projects/Kanban routing preserves tenant scope and evidence.' },
  ]
  if (item.source.type === 'agent-output') {
    actions.unshift({ action: 'pending-review', label: 'Mark pending review', reason: 'Internal review state only; no external side effect.' })
  }
  if (item.source.type === 'seo-task') {
    actions.unshift({ action: 'complete', label: 'Complete internal SEO task', reason: 'Only valid after Peet confirms the decision or the evidence is sufficient.' })
  }
  return actions
}

function seoTaskContract(item: BriefingSourceItem): Partial<BriefingV2CardContract> {
  const status = clean(item.metadata?.seoTaskStatus) ?? null
  const taskTitle = firstText(item.context.seoTaskTitle, item.title) ?? item.source.id
  const blocked = status === 'blocked'
  return {
    decisionRequest: {
      prompt: blocked ? `Unblock SEO task: ${taskTitle}` : `Decide SEO task: ${taskTitle}`,
      scope: 'internal',
      source: item.source.type,
      reason: firstText(item.metadata?.blockerReason, item.summary) ?? 'SEO needs an internal decision before the next step can continue.',
    },
    options: [
      { id: 'complete', label: 'Complete / continue', description: 'Confirm the SEO task can proceed or be marked complete.', recommended: !blocked },
      { id: 'skip', label: 'Skip / hold', description: 'Hold this SEO task and keep the reason auditable.', recommended: false },
      { id: 'create-follow-up', label: 'Create follow-up task', description: 'Route the unresolved SEO decision to Projects/Kanban.', recommended: blocked },
    ],
    recommendedOption: blocked
      ? { id: 'create-follow-up', label: 'Create follow-up task' }
      : { id: 'complete', label: 'Complete / continue' },
    inputTarget: { action: blocked ? 'create-task' : 'complete', resourceType: item.source.type, resourceId: item.source.id, orgId: item.orgId },
    afterSubmit: { consequence: 'SEO work can continue only through internal task state/evidence updates; public publishing remains separately approval-gated.', releasesAgentId: 'seo', createsAuditTrail: true },
    agentHandoff: { targetAgentId: 'seo', sourceTaskId: item.context.seoTaskId ?? item.source.id, sourceProjectId: item.context.projectId ?? null, summary: item.summary, context: { sprintId: item.context.seoSprintId ?? null } },
    disabledReason: `External SEO publishing is disabled here: ${GATED_EXTERNAL_ACTIONS}`,
  }
}

function agentOutputContract(item: BriefingSourceItem): Partial<BriefingV2CardContract> {
  const agentId = firstText(item.metadata?.assigneeAgentId, item.actor.id.replace(/^agent:/, '')) ?? 'agent'
  const taskId = item.context.taskId ?? item.source.id.replace(/:agent-output$/, '')
  return {
    decisionRequest: {
      prompt: `Review ${agentId} output for internal review`,
      scope: 'internal',
      source: item.source.type,
      reason: firstText(item.summary, item.excerpt) ?? 'Agent work is ready for internal review.',
    },
    options: [
      { id: 'approve-review', label: 'Approve internal review', description: 'Mark this output approved for internal continuation only.', recommended: true },
      { id: 'request-changes', label: 'Request changes', description: 'Send the task back with review notes.', recommended: false },
      { id: 'open-evidence', label: 'Open evidence', description: 'Inspect commit, test, document, and source links first.', recommended: false },
    ],
    recommendedOption: { id: 'approve-review', label: 'Approve internal review' },
    inputTarget: { action: 'pending-review', resourceType: 'task', resourceId: taskId, orgId: item.orgId },
    afterSubmit: { consequence: 'Only the internal review state changes; production release, publishing, sends, spend, and destructive actions stay separately gated.', releasesAgentId: item.context.reviewerAgentId ?? null, createsAuditTrail: true },
    agentHandoff: { targetAgentId: agentId, sourceTaskId: taskId, sourceProjectId: item.context.projectId ?? null, summary: item.summary },
    safetyGate: { level: 'internal-only', summary: GATED_EXTERNAL_ACTIONS, sideEffectAllowed: false, requiresApproval: false, gatedActions: ['production-deploy', 'main-merge', 'public-publish', 'external-send', 'paid-spend', 'finance-change', 'secret-config-change', 'destructive-delete'] },
    disabledReason: `External release actions are disabled from review cards: ${GATED_EXTERNAL_ACTIONS}`,
  }
}

function defaultContract(item: BriefingSourceItem): BriefingV2CardContract {
  const source = item.source.type
  const base: BriefingV2CardContract = {
    decisionRequest: {
      prompt: item.title,
      scope: 'internal',
      source,
      reason: firstText(item.summary, item.excerpt) ?? `Review this ${sourceLabel(item)} item.`,
    },
    options: [
      { id: 'review', label: 'Review internally', description: 'Inspect the source and decide the next internal step.', recommended: true },
      { id: 'create-follow-up', label: 'Create follow-up', description: 'Route work to Projects/Kanban with source evidence.', recommended: false },
    ],
    recommendedOption: { id: 'review', label: 'Review internally' },
    inputTarget: { action: 'read', resourceType: source, resourceId: item.source.id, orgId: item.orgId },
    afterSubmit: { consequence: 'Records an internal briefing state only; no external side effect is performed.', createsAuditTrail: true },
    agentHandoff: { targetAgentId: item.context.reviewerAgentId ?? null, sourceTaskId: item.context.taskId ?? null, sourceProjectId: item.context.projectId ?? null, summary: item.summary },
    evidenceLinks: sourceEvidence(item),
    safetyGate: defaultSafetyGate(item),
    disabledReason: `Unsafe external actions are unavailable from this card: ${GATED_EXTERNAL_ACTIONS}`,
    nearestValidActions: defaultNearestValidActions(item),
  }

  const sourceSpecific = source === 'seo-task'
    ? seoTaskContract(item)
    : source === 'agent-output'
      ? agentOutputContract(item)
      : {}

  return {
    ...base,
    ...sourceSpecific,
    evidenceLinks: sourceEvidence(item),
    safetyGate: { ...base.safetyGate, ...(sourceSpecific.safetyGate ?? {}) },
    nearestValidActions: sourceSpecific.nearestValidActions ?? base.nearestValidActions,
  }
}

function safeOption(option: BriefingV2CardContract['options'][number]): BriefingV2CardContract['options'][number] | null {
  const id = clean(option.id, 80)
  const label = clean(option.label, 120)
  if (!id || !label) return null
  return {
    id,
    label,
    description: clean(option.description) ?? undefined,
    recommended: option.recommended === true,
    disabled: option.disabled === true,
    disabledReason: clean(option.disabledReason) ?? undefined,
  }
}

function safeEvidenceLink(link: BriefingV2CardContract['evidenceLinks'][number], index: number): BriefingV2CardContract['evidenceLinks'][number] | null {
  const label = clean(link.label, 160)
  const href = clean(link.href, 500)
  const description = clean(link.description)
  if (!label && !href && !description) return null
  return {
    id: clean(link.id, 80) ?? `evidence-${index}`,
    label: label ?? 'Evidence',
    href: href ?? undefined,
    description: description ?? undefined,
    kind: clean(link.kind, 80) ?? 'evidence',
  }
}

function safeNearestValidAction(action: BriefingV2CardContract['nearestValidActions'][number]): BriefingV2CardContract['nearestValidActions'][number] | null {
  const actionId = clean(action.action, 80)
  const label = clean(action.label, 120)
  if (!actionId || !label) return null
  return {
    action: actionId,
    label,
    reason: clean(action.reason) ?? undefined,
    href: clean(action.href, 500) ?? undefined,
  }
}

function mergeContract(item: BriefingSourceItem, generated: BriefingV2CardContract): BriefingV2CardContract {
  const options = (item.options ?? generated.options).map(safeOption).filter((option): option is BriefingV2CardContract['options'][number] => Boolean(option))
  const generatedActionGate = generated.safetyGate
  const requestedSafetyGate = item.safetyGate
  const evidenceLinks = (item.evidenceLinks ?? generated.evidenceLinks).map(safeEvidenceLink).filter((link): link is BriefingV2CardContract['evidenceLinks'][number] => Boolean(link))
  const nearestValidActions = (item.nearestValidActions ?? generated.nearestValidActions).map(safeNearestValidAction).filter((action): action is BriefingV2CardContract['nearestValidActions'][number] => Boolean(action))
  const recommendedOption = item.recommendedOption ? safeOption(item.recommendedOption) : generated.recommendedOption

  return {
    decisionRequest: {
      prompt: clean(item.decisionRequest?.prompt) ?? generated.decisionRequest.prompt,
      scope: item.decisionRequest?.scope ?? generated.decisionRequest.scope,
      source: clean(item.decisionRequest?.source, 120) ?? generated.decisionRequest.source,
      reason: clean(item.decisionRequest?.reason) ?? generated.decisionRequest.reason,
    },
    options: options.length > 0 ? options : generated.options,
    recommendedOption: recommendedOption && options.some((option) => option.id === recommendedOption.id) ? recommendedOption : generated.recommendedOption,
    inputTarget: {
      action: clean(item.inputTarget?.action, 80) ?? generated.inputTarget.action,
      resourceType: clean(item.inputTarget?.resourceType, 120) ?? generated.inputTarget.resourceType,
      resourceId: clean(item.inputTarget?.resourceId, 160) ?? generated.inputTarget.resourceId,
      orgId: item.orgId,
      method: item.inputTarget?.method ?? generated.inputTarget.method,
    },
    afterSubmit: {
      consequence: clean(item.afterSubmit?.consequence) ?? generated.afterSubmit.consequence,
      releasesAgentId: clean(item.afterSubmit?.releasesAgentId, 80) ?? generated.afterSubmit.releasesAgentId,
      createsAuditTrail: item.afterSubmit?.createsAuditTrail ?? generated.afterSubmit.createsAuditTrail,
      nextStatus: clean(item.afterSubmit?.nextStatus, 80) ?? generated.afterSubmit.nextStatus,
    },
    agentHandoff: {
      targetAgentId: clean(item.agentHandoff?.targetAgentId, 80) ?? generated.agentHandoff.targetAgentId,
      sourceTaskId: clean(item.agentHandoff?.sourceTaskId, 160) ?? generated.agentHandoff.sourceTaskId,
      sourceProjectId: clean(item.agentHandoff?.sourceProjectId, 160) ?? generated.agentHandoff.sourceProjectId,
      summary: clean(item.agentHandoff?.summary) ?? generated.agentHandoff.summary,
      context: item.agentHandoff?.context ?? generated.agentHandoff.context,
    },
    evidenceLinks: evidenceLinks.length > 0 ? evidenceLinks : generated.evidenceLinks,
    safetyGate: {
      level: clean(requestedSafetyGate?.level, 80) ?? generatedActionGate.level,
      summary: clean(requestedSafetyGate?.summary) ?? generatedActionGate.summary,
      sideEffectAllowed: false,
      requiresApproval: generatedActionGate.requiresApproval || requestedSafetyGate?.requiresApproval === true,
      gatedActions: Array.from(new Set([...(generatedActionGate.gatedActions ?? []), ...(requestedSafetyGate?.gatedActions ?? [])].map((action) => clean(action, 80)).filter((action): action is string => Boolean(action)))),
    },
    disabledReason: clean(item.disabledReason) ?? generated.disabledReason,
    nearestValidActions: nearestValidActions.length > 0 ? nearestValidActions : generated.nearestValidActions,
  }
}

export function buildBriefingCardContract(item: BriefingSourceItem): BriefingV2CardContract {
  return mergeContract(item, defaultContract(item))
}

export function withBriefingCardContract<T extends BriefingSourceItem>(item: T): T & BriefingV2CardContract {
  return { ...item, ...buildBriefingCardContract(item) }
}
