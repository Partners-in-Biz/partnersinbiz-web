import { adminDb } from '@/lib/firebase/admin'
import { collectAdsBusinessInsightSignals } from './ads-business-signals'
import { collectCrmBusinessInsightSignals } from './crm-business-signals'
import { collectDocumentBusinessInsightSignals } from './document-business-signals'
import { collectInvoiceBusinessInsightSignals } from './invoice-business-signals'
import { collectSeoBusinessInsightSignals } from './seo-business-signals'
import { collectSocialBusinessInsightSignals } from './social-business-signals'
import { collectSupportBusinessInsightSignals } from './support-business-signals'
import type { AgentEvolutionSignal, BusinessInsightSignal } from './review-evaluator'

type TaskDoc = {
  id: string
  data: () => Record<string, unknown>
  ref?: { path?: string }
}

type LoopRunDoc = {
  id: string
  data: () => Record<string, unknown>
}

export type LoopReviewSignalCollectionInput = {
  orgId: string
  projectId?: string | null
  limit?: number
  now?: Date
}

export type LoopReviewSignalCollection = {
  scanned: number
  sourceWindow: { from: string; to: string }
  agentSignals: AgentEvolutionSignal[]
  businessSignals: BusinessInsightSignal[]
  existingSuppressionKeys: string[]
}

const AGENT_STATUSES = new Set(['blocked', 'awaiting-input'])

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(cleanString).filter((item): item is string => Boolean(item))
}

function cleanNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function boundedLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100
  return Math.max(1, Math.min(250, Math.floor(value)))
}

function sourceWindow(now: Date): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)).toISOString(),
    to: now.toISOString(),
  }
}

function projectIdFromPath(path: string | undefined): string | null {
  if (!path) return null
  const match = path.match(/^projects\/([^/]+)\/tasks\/[^/]+/)
  return match?.[1] ?? null
}

function taskProjectId(doc: TaskDoc, data: Record<string, unknown>): string | null {
  return cleanString(data.projectId) ?? projectIdFromPath(doc.ref?.path)
}

function taskTitle(data: Record<string, unknown>, fallback: string): string {
  return cleanString(data.title) ?? fallback
}

function taskText(data: Record<string, unknown>): string {
  return [
    cleanString(data.title),
    cleanString(data.description),
    cleanString(data.agentOutput && typeof data.agentOutput === 'object' && !Array.isArray(data.agentOutput)
      ? (data.agentOutput as Record<string, unknown>).summary
      : null),
  ].filter(Boolean).join(' ').toLowerCase()
}

function taskHref(projectId: string | null, taskId: string): string {
  return projectId ? `/admin/projects/${projectId}?task=${taskId}` : `/admin/agent/board?task=${taskId}`
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'signal'
}

function riskScore(data: Record<string, unknown>): number {
  const riskLevel = cleanString(data.riskLevel)
  const priority = cleanString(data.priority)
  if (riskLevel === 'critical') return 90
  if (riskLevel === 'high') return 78
  if (priority === 'urgent') return 82
  if (priority === 'high') return 68
  return 45
}

function isHighRiskTask(data: Record<string, unknown>): boolean {
  const riskLevel = cleanString(data.riskLevel)
  const priority = cleanString(data.priority)
  return riskLevel === 'critical' || riskLevel === 'high' || priority === 'urgent'
}

function agentSignalForTask(doc: TaskDoc, data: Record<string, unknown>, projectId: string | null): AgentEvolutionSignal | null {
  const assigneeAgentId = cleanString(data.assigneeAgentId)
  const status = cleanString(data.agentStatus)
  const reviewStatus = cleanString(data.reviewStatus)
  if (!assigneeAgentId) return null
  if (!AGENT_STATUSES.has(status ?? '') && reviewStatus !== 'changes-requested') return null

  const text = taskText(data)
  const category: AgentEvolutionSignal['category'] = reviewStatus === 'changes-requested'
    ? 'review-rework'
    : /missing|source|context|spec|brief|requirement/.test(text)
      ? 'missing-context'
      : 'repeat-blocker'
  const title = taskTitle(data, doc.id)
  const updatedAt = cleanString(data.updatedAt)

  return {
    id: `task-${doc.id}`,
    category,
    targetSurface: `agent:${assigneeAgentId}`,
    title,
    summary: `Task ${doc.id} is ${reviewStatus === 'changes-requested' ? 'back from review' : status}.`,
    severity: Math.max(70, riskScore(data)),
    confidence: category === 'missing-context' ? 82 : 72,
    easeOfFix: category === 'missing-context' ? 74 : 62,
    risk: category === 'review-rework' ? 35 : 25,
    source: {
      type: 'task',
      id: doc.id,
      href: taskHref(projectId, doc.id),
      label: title,
    },
    occurredAt: updatedAt ?? undefined,
  }
}

function agentSignalForLoopBudgetRun(doc: LoopRunDoc, data: Record<string, unknown>): AgentEvolutionSignal | null {
  const observability = data.observability
  if (!observability || typeof observability !== 'object' || Array.isArray(observability)) return null

  const budgetStatus = cleanString((observability as Record<string, unknown>).budgetStatus)
  if (budgetStatus !== 'near-limit' && budgetStatus !== 'exceeded') return null

  const loopId = cleanString(data.loopId) ?? doc.id.split(':')[0] ?? 'unknown-loop'
  const loopName = cleanString(data.loopName) ?? loopId
  const lastMeaningfulAction = cleanString((observability as Record<string, unknown>).lastMeaningfulAction)
  const verificationFailures = cleanStringArray((observability as Record<string, unknown>).verificationFailures)
  const noOpStreak = typeof (observability as Record<string, unknown>).noOpStreak === 'number'
    ? (observability as Record<string, unknown>).noOpStreak as number
    : 0
  const occurredAt = cleanString(data.updatedAt) ?? cleanString(data.createdAt)

  return {
    id: `loop-budget-${slug(doc.id)}`,
    category: 'tooling-gap',
    targetSurface: `loop:${loopId}`,
    title: `${loopName} is ${budgetStatus}`,
    summary: [
      `Loop run ${doc.id} reported budgetStatus=${budgetStatus}.`,
      lastMeaningfulAction ? `Last action: ${lastMeaningfulAction}.` : null,
      verificationFailures.length ? `${verificationFailures.length} verification failure${verificationFailures.length === 1 ? '' : 's'} recorded.` : null,
      noOpStreak > 0 ? `No-op streak: ${noOpStreak}.` : null,
    ].filter(Boolean).join(' '),
    severity: budgetStatus === 'exceeded' ? 90 : 76,
    confidence: budgetStatus === 'exceeded' ? 86 : 78,
    easeOfFix: 72,
    risk: budgetStatus === 'exceeded' ? 42 : 30,
    source: {
      type: 'loop-run',
      id: doc.id,
      href: `/admin/loop-engine/runs?run=${encodeURIComponent(doc.id)}`,
      label: loopName,
    },
    occurredAt: occurredAt ?? undefined,
  }
}

function recordAt(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key]
  return isRecord(value) ? value : null
}

function firstString(sources: Array<Record<string, unknown> | null>, keys: string[]): string | null {
  for (const source of sources) {
    if (!source) continue
    for (const key of keys) {
      const value = cleanString(source[key])
      if (value) return value
    }
  }
  return null
}

function firstNumber(sources: Array<Record<string, unknown> | null>, keys: string[]): number | null {
  for (const source of sources) {
    if (!source) continue
    for (const key of keys) {
      const value = cleanNumber(source[key])
      if (value !== null) return value
    }
  }
  return null
}

function firstBool(sources: Array<Record<string, unknown> | null>, keys: string[]): boolean | null {
  for (const source of sources) {
    if (!source) continue
    for (const key of keys) {
      const value = source[key]
      if (typeof value === 'boolean') return value
    }
  }
  return null
}

function firstStringArray(sources: Array<Record<string, unknown> | null>, keys: string[]): string[] {
  for (const source of sources) {
    if (!source) continue
    for (const key of keys) {
      const value = cleanStringArray(source[key])
      if (value.length > 0) return value
    }
  }
  return []
}

function loopRunTelemetrySources(data: Record<string, unknown>): Array<Record<string, unknown> | null> {
  const observability = recordAt(data, 'observability')
  const result = recordAt(data, 'result')
  return [
    recordAt(data, 'usage'),
    recordAt(data, 'telemetry'),
    recordAt(data, 'metrics'),
    recordAt(data, 'runtime'),
    observability ? recordAt(observability, 'usage') : null,
    observability ? recordAt(observability, 'telemetry') : null,
    observability ? recordAt(observability, 'runtime') : null,
    result ? recordAt(result, 'usage') : null,
    result ? recordAt(result, 'telemetry') : null,
    data,
  ]
}

function loopRunTelemetry(data: Record<string, unknown>): {
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
  costUsd: number | null
  durationMs: number | null
  retryCount: number | null
  toolCallCount: number | null
  model: string | null
  reasoningEffort: string | null
  tokenSource: string | null
  costSource: string | null
  exactTokenUsageAvailable: boolean | null
  exactCostAvailable: boolean | null
  exactUsageAvailable: boolean | null
  requiresExactModelTelemetry: boolean
  missing: string[]
  hasAny: boolean
} {
  const sources = loopRunTelemetrySources(data)
  const inputTokens = firstNumber(sources, ['inputTokens', 'promptTokens', 'input_tokens', 'prompt_tokens'])
  const outputTokens = firstNumber(sources, ['outputTokens', 'completionTokens', 'output_tokens', 'completion_tokens'])
  const reasoningTokens = firstNumber(sources, ['reasoningTokens', 'reasoning_tokens'])
  const directTotal = firstNumber(sources, ['totalTokens', 'total_tokens', 'tokensTotal', 'tokenCount', 'tokens'])
  const summedTotal = [inputTokens, outputTokens, reasoningTokens]
    .filter((value): value is number => value !== null)
    .reduce((sum, value) => sum + value, 0)
  const costUsd = firstNumber(sources, ['costUsd', 'totalCostUsd', 'estimatedCostUsd', 'usdCost', 'cost'])
    ?? (firstNumber(sources, ['costCents', 'totalCostCents']) !== null
      ? (firstNumber(sources, ['costCents', 'totalCostCents']) as number) / 100
      : null)
  const durationMs = firstNumber(sources, ['durationMs', 'totalDurationMs', 'elapsedMs', 'latencyMs'])
    ?? (firstNumber(sources, ['durationSeconds', 'elapsedSeconds']) !== null
      ? (firstNumber(sources, ['durationSeconds', 'elapsedSeconds']) as number) * 1000
      : null)
  const retryCount = firstNumber(sources, ['retryCount', 'retries', 'attempts'])
  const toolCallCount = firstNumber(sources, ['toolCallCount', 'toolCalls'])
  const model = firstString(sources, ['model', 'agentModel'])
  const reasoningEffort = firstString(sources, ['reasoningEffort', 'reasoning_effort', 'agentEffort'])
  const tokenSource = firstString(sources, ['tokenSource', 'token_source'])
  const costSource = firstString(sources, ['costSource', 'cost_source'])
  const exactTokenUsageAvailable = firstBool(sources, ['exactTokenUsageAvailable', 'exact_token_usage_available'])
  const exactCostAvailable = firstBool(sources, ['exactCostAvailable', 'exact_cost_available'])
  const exactUsageAvailable = firstBool(sources, ['exactUsageAvailable', 'exact_usage_available'])
  const requiresExactModelTelemetry = firstBool(sources, ['requiresExactModelTelemetry', 'requires_exact_model_telemetry']) === true
  const missing = firstStringArray(sources, ['missing', 'missingTelemetry', 'missing_telemetry'])
  const totalTokens = directTotal ?? (summedTotal > 0 ? summedTotal : null)
  const hasAny = totalTokens !== null || costUsd !== null || durationMs !== null

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    costUsd,
    durationMs,
    retryCount,
    toolCallCount,
    model,
    reasoningEffort,
    tokenSource,
    costSource,
    exactTokenUsageAvailable,
    exactCostAvailable,
    exactUsageAvailable,
    requiresExactModelTelemetry,
    missing,
    hasAny,
  }
}

function minutesLabel(durationMs: number): string {
  const minutes = Math.round(durationMs / 60_000)
  return `${minutes}m`
}

function agentSignalForLoopTelemetryRun(doc: LoopRunDoc, data: Record<string, unknown>): AgentEvolutionSignal | null {
  const loopId = cleanString(data.loopId) ?? doc.id.split(':')[0] ?? 'unknown-loop'
  const loopName = cleanString(data.loopName) ?? loopId
  const status = cleanString(data.status)
  const occurredAt = cleanString(data.updatedAt) ?? cleanString(data.createdAt)
  const telemetry = loopRunTelemetry(data)
  const isTrackedReviewLoop = loopId === 'agent-evolution-review' || loopId === 'business-insight-review'
  const isTerminalRun = status === 'executed' || status === 'failed' || status === 'awaiting_approval' || status === 'proposed' || status === 'evaluated'

  if (!telemetry.hasAny && (!isTrackedReviewLoop || !isTerminalRun)) return null

  const highTokens = (telemetry.totalTokens ?? 0) >= 100_000
  const highCost = (telemetry.costUsd ?? 0) >= 10
  const longDuration = (telemetry.durationMs ?? 0) >= 30 * 60_000
  const repeatedRetries = (telemetry.retryCount ?? 0) >= 3
  const missingExactModelUsage = telemetry.requiresExactModelTelemetry && (
    telemetry.exactTokenUsageAvailable === false ||
    telemetry.exactCostAvailable === false ||
    telemetry.tokenSource === 'unavailable' ||
    telemetry.costSource === 'unavailable'
  )
  if (telemetry.hasAny && !missingExactModelUsage && !highTokens && !highCost && !longDuration && !repeatedRetries) return null

  const missing = !telemetry.hasAny
  const summaryParts = missing
    ? [`Loop run ${doc.id} did not persist token, cost, or duration telemetry.`]
    : missingExactModelUsage
      ? [
        `Loop run ${doc.id} persisted duration telemetry, but exact token/cost telemetry was unavailable from the upstream runtime.`,
        telemetry.model ? `Model: ${telemetry.model}.` : null,
        telemetry.reasoningEffort ? `Reasoning effort: ${telemetry.reasoningEffort}.` : null,
        telemetry.tokenSource ? `Token source: ${telemetry.tokenSource}.` : null,
        telemetry.costSource ? `Cost source: ${telemetry.costSource}.` : null,
        telemetry.missing.length ? `Missing: ${telemetry.missing.join(', ')}.` : null,
        telemetry.durationMs !== null ? `${minutesLabel(telemetry.durationMs)} duration.` : null,
      ]
    : [
      `Loop run ${doc.id} persisted usage telemetry.`,
      telemetry.totalTokens !== null ? `${telemetry.totalTokens} tokens.` : null,
      telemetry.costUsd !== null ? `$${telemetry.costUsd.toFixed(2)} cost.` : null,
      telemetry.durationMs !== null ? `${minutesLabel(telemetry.durationMs)} duration.` : null,
      telemetry.model ? `Model: ${telemetry.model}.` : null,
      telemetry.reasoningEffort ? `Reasoning effort: ${telemetry.reasoningEffort}.` : null,
      telemetry.retryCount !== null ? `${telemetry.retryCount} retries.` : null,
      telemetry.toolCallCount !== null ? `${telemetry.toolCallCount} tool calls.` : null,
    ]

  const severity = missing
    ? 74
    : missingExactModelUsage
      ? 76
    : Math.max(
      highCost ? 88 : 0,
      highTokens ? 84 : 0,
      longDuration ? 80 : 0,
      repeatedRetries ? 78 : 0,
      72,
    )

  return {
    id: `loop-telemetry-${slug(doc.id)}`,
    category: 'tooling-gap',
    targetSurface: `loop:${loopId}`,
    title: missing
      ? `${loopName} is missing usage telemetry`
      : missingExactModelUsage
        ? `${loopName} is missing exact model usage telemetry`
        : `${loopName} needs usage telemetry review`,
    summary: summaryParts.filter(Boolean).join(' '),
    severity,
    confidence: missing ? 72 : missingExactModelUsage ? 82 : 84,
    easeOfFix: missing || missingExactModelUsage ? 78 : 70,
    risk: missing ? 26 : missingExactModelUsage ? 32 : highCost ? 42 : 34,
    source: {
      type: 'loop-run',
      id: doc.id,
      href: `/admin/loop-engine/runs?run=${encodeURIComponent(doc.id)}`,
      label: loopName,
    },
    occurredAt: occurredAt ?? undefined,
  }
}

function businessSignalForTask(
  doc: TaskDoc,
  data: Record<string, unknown>,
  projectId: string | null,
  existingSuppressionKeys: Set<string>,
): BusinessInsightSignal | null {
  const orgId = cleanString(data.orgId)
  const status = cleanString(data.agentStatus)
  if (!orgId || !AGENT_STATUSES.has(status ?? '') || !isHighRiskTask(data)) return null

  const title = taskTitle(data, doc.id)
  const suppressionKey = `project-risk:${orgId}:${doc.id}`
  const labels = cleanStringArray(data.labels)
  const stateLabel = status === 'awaiting-input' ? 'awaiting input' : 'blocked'

  return {
    id: `task-risk-${doc.id}`,
    lane: 'project',
    insightKind: 'risk',
    summary: `High-risk work is ${stateLabel}: ${title}`,
    impactEstimate: 'Potential client delivery or revenue risk',
    metric: 'high_risk_blocked_task',
    value: 1,
    impact: Math.max(80, riskScore(data)),
    urgency: cleanString(data.priority) === 'urgent' ? 88 : 76,
    confidence: labels.includes('client-risk') || labels.includes('revenue') ? 76 : 68,
    actionability: 76,
    risk: 30,
    ownerAgentId: cleanString(data.assigneeAgentId) ?? 'pip',
    ownerRole: 'project-owner',
    nextAction: 'Review the blocked work, assign a clear owner, and create the smallest approved unblock action.',
    suppressionKey,
    sourceLinks: [{
      type: 'task',
      id: doc.id,
      href: taskHref(projectId, doc.id),
      label: title,
    }],
    evidence: [
      { label: 'Task state', value: stateLabel },
      { label: 'Risk level', value: cleanString(data.riskLevel) ?? cleanString(data.priority) ?? 'high' },
    ],
    blocksActiveCommercialLoop: true,
    hasNewSourceItem: !existingSuppressionKeys.has(suppressionKey),
  }
}

function suppressionKeyFromTask(data: Record<string, unknown>): string | null {
  const metadata = data.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const insight = (metadata as Record<string, unknown>).businessInsightReview
  if (!insight || typeof insight !== 'object' || Array.isArray(insight)) return null
  return cleanString((insight as Record<string, unknown>).suppressionKey)
}

export async function collectLoopReviewSignals(input: LoopReviewSignalCollectionInput): Promise<LoopReviewSignalCollection> {
  const limit = boundedLimit(input.limit)
  const now = input.now ?? new Date()
  const window = sourceWindow(now)
  const snap = await adminDb.collectionGroup('tasks')
    .where('orgId', '==', input.orgId)
    .limit(limit)
    .get() as { docs: TaskDoc[] }
  const loopRunSnap = await adminDb.collection('loop_engine_runs')
    .where('orgId', '==', input.orgId)
    .limit(limit)
    .get() as { docs: LoopRunDoc[] }

  const docs = snap.docs.filter((doc) => {
    const data = doc.data()
    const projectId = taskProjectId(doc, data)
    return !input.projectId || projectId === input.projectId
  })
  const existingSuppressionKeys = new Set<string>()
  for (const doc of docs) {
    const key = suppressionKeyFromTask(doc.data())
    if (key) existingSuppressionKeys.add(key)
  }

  const agentSignals: AgentEvolutionSignal[] = []
  const businessSignals: BusinessInsightSignal[] = []
  for (const doc of loopRunSnap.docs) {
    const data = doc.data()
    if (data.deleted === true) continue
    const signal = agentSignalForLoopBudgetRun(doc, data)
    if (signal) agentSignals.push(signal)
    const telemetrySignal = agentSignalForLoopTelemetryRun(doc, data)
    if (telemetrySignal) agentSignals.push(telemetrySignal)
  }
  for (const doc of docs) {
    const data = doc.data()
    if (data.deleted === true) continue
    const projectId = taskProjectId(doc, data)
    const agentSignal = agentSignalForTask(doc, data, projectId)
    if (agentSignal) agentSignals.push(agentSignal)
    const businessSignal = businessSignalForTask(doc, data, projectId, existingSuppressionKeys)
    if (businessSignal) businessSignals.push(businessSignal)
  }
  const crmCollection = await collectCrmBusinessInsightSignals({
    orgId: input.orgId,
    existingSuppressionKeys: [...existingSuppressionKeys],
    limit,
    now,
  })
  const supportCollection = await collectSupportBusinessInsightSignals({
    orgId: input.orgId,
    existingSuppressionKeys: [...existingSuppressionKeys],
    limit,
    now,
  })
  const socialCollection = await collectSocialBusinessInsightSignals({
    orgId: input.orgId,
    existingSuppressionKeys: [...existingSuppressionKeys],
    limit,
    now,
  })
  const adsCollection = await collectAdsBusinessInsightSignals({
    orgId: input.orgId,
    existingSuppressionKeys: [...existingSuppressionKeys],
    limit,
    now,
  })
  const seoCollection = await collectSeoBusinessInsightSignals({
    orgId: input.orgId,
    existingSuppressionKeys: [...existingSuppressionKeys],
    limit,
    now,
  })
  const invoiceCollection = await collectInvoiceBusinessInsightSignals({
    orgId: input.orgId,
    existingSuppressionKeys: [...existingSuppressionKeys],
    limit,
    now,
  })
  const documentCollection = await collectDocumentBusinessInsightSignals({
    orgId: input.orgId,
    existingSuppressionKeys: [...existingSuppressionKeys],
    limit,
    now,
  })
  businessSignals.push(...crmCollection.signals)
  businessSignals.push(...supportCollection.signals)
  businessSignals.push(...socialCollection.signals)
  businessSignals.push(...adsCollection.signals)
  businessSignals.push(...seoCollection.signals)
  businessSignals.push(...invoiceCollection.signals)
  businessSignals.push(...documentCollection.signals)

  return {
    scanned: snap.docs.length +
      loopRunSnap.docs.length +
      crmCollection.contactsScanned +
      crmCollection.dealsScanned +
      supportCollection.ticketsScanned +
      socialCollection.postsScanned +
      adsCollection.connectionsScanned +
      adsCollection.campaignsScanned +
      seoCollection.tasksScanned +
      seoCollection.sprintsScanned +
      invoiceCollection.invoicesScanned +
      documentCollection.documentsScanned,
    sourceWindow: window,
    agentSignals,
    businessSignals,
    existingSuppressionKeys: [...existingSuppressionKeys].sort(),
  }
}
