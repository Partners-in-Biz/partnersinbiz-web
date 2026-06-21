import { buildCreativeCanvasAssetGallery } from './assets'
import { buildCreativeCanvasOrchestrationPlan } from './orchestration'
import { getHiggsfieldRuntimeReadiness } from './provider-runtime'
import { summarizeCreativeCanvasRuns } from './runs'
import type {
  CreativeCanvas,
  CreativeCanvasRuntimeProof,
  CreativeCanvasRuntimeProofCheck,
  CreativeCanvasRun,
  CreativeCanvasProofStatus,
  CreativeCanvasReliabilityCoverageCategory,
} from './types'

type CanvasWithId = CreativeCanvas & { id: string }
type RunWithId = CreativeCanvasRun & { id: string }
type ReliabilityCategory = 'image' | 'video_social' | 'audio' | 'blog_document' | 'book'
const REQUIRED_COMPLETED_RUNS_PER_CATEGORY = 2

const RELIABILITY_CATEGORIES: Array<{
  key: ReliabilityCategory
  label: string
  kinds: Array<NonNullable<CreativeCanvasRun['input']['outputKind']>>
}> = [
  { key: 'image', label: 'Image', kinds: ['image', 'campaign_asset'] },
  { key: 'video_social', label: 'Video/social', kinds: ['video', 'social_post_draft', 'youtube_render'] },
  { key: 'audio', label: 'Audio', kinds: ['audio'] },
  { key: 'blog_document', label: 'Blog/document', kinds: ['blog_draft', 'document_block', 'copy', 'caption'] },
  { key: 'book', label: 'Book', kinds: ['book_artifact'] },
]

function proofStatus(checks: CreativeCanvasRuntimeProofCheck[]): CreativeCanvasProofStatus {
  if (checks.some((check) => check.status === 'blocked')) return 'blocked'
  if (checks.some((check) => check.status === 'warning')) return 'warning'
  return 'passed'
}

function check(input: CreativeCanvasRuntimeProofCheck): CreativeCanvasRuntimeProofCheck {
  return input
}

function isActiveStatus(status: CreativeCanvasRun['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'waiting_for_review'
}

function hasCompletedRunArtifact(run: RunWithId): boolean {
  return Boolean(run.output?.url || run.output?.artifactId || run.output?.textPreview)
}

function categoryCoverage(runs: RunWithId[]): CreativeCanvasReliabilityCoverageCategory[] {
  return RELIABILITY_CATEGORIES.map((category) => {
    const matchingRuns = runs.filter((run) => {
      const outputKind = run.input.outputKind
      return outputKind ? category.kinds.includes(outputKind) : false
    })
    const statusCompleted = matchingRuns.filter((run) => run.status === 'completed')
    const completed = statusCompleted.filter(hasCompletedRunArtifact).length
    const active = matchingRuns.filter((run) => isActiveStatus(run.status)).length
    const failed = matchingRuns.filter((run) => run.status === 'failed').length
    const cancelled = matchingRuns.filter((run) => run.status === 'cancelled').length
    const latestCompletedRun = statusCompleted.find(hasCompletedRunArtifact)
    const latestRun = matchingRuns[0]
    const status: CreativeCanvasProofStatus = completed >= REQUIRED_COMPLETED_RUNS_PER_CATEGORY
      ? 'passed'
      : completed || active || statusCompleted.length
        ? 'warning'
        : 'blocked'
    return {
      key: category.key,
      label: category.label,
      requiredOutputKinds: category.kinds,
      requiredCompleted: REQUIRED_COMPLETED_RUNS_PER_CATEGORY,
      status,
      total: matchingRuns.length,
      completed,
      active,
      failed,
      cancelled,
      latestRunId: latestRun?.id,
      latestCompletedRunId: latestCompletedRun?.id,
      nextAction: completed >= REQUIRED_COMPLETED_RUNS_PER_CATEGORY
        ? undefined
        : statusCompleted.length > completed
          ? 'Ingest provider output artifacts for completed proof runs.'
        : active
          ? 'Wait for this proof run to complete or ingest the provider output.'
          : failed
            ? 'Retry failed proof run or queue a new proof batch.'
            : 'Queue proof batch to create this required creative job.',
    }
  })
}

export function buildCreativeCanvasRuntimeProof(input: {
  canvas: CanvasWithId
  runs: RunWithId[]
  env?: NodeJS.ProcessEnv
}): CreativeCanvasRuntimeProof {
  const { canvas, runs } = input
  const orchestration = buildCreativeCanvasOrchestrationPlan(canvas)
  const operations = summarizeCreativeCanvasRuns(runs)
  const readiness = getHiggsfieldRuntimeReadiness({ canvas, env: input.env })
  const assets = buildCreativeCanvasAssetGallery({ nodes: canvas.nodes, runs })
  const exportableAssets = assets.filter((asset) => asset.canDraftExport)
  const completedRuns = runs.filter((run) => run.status === 'completed')
  const completedRunsWithArtifacts = completedRuns.filter(hasCompletedRunArtifact)
  const completedRunsMissingArtifacts = completedRuns.length - completedRunsWithArtifacts.length
  const activeRuns = runs.filter((run) => run.status === 'queued' || run.status === 'running' || run.status === 'waiting_for_review')
  const reliabilityCoverage = categoryCoverage(runs)
  const coveredCategories = reliabilityCoverage.filter((category) => category.completed >= category.requiredCompleted)
  const totalFailures = runs.filter((run) => run.status === 'failed').length
  const completedOrFailedRuns = completedRunsWithArtifacts.length + totalFailures
  const failureRate = completedOrFailedRuns ? totalFailures / completedOrFailedRuns : 0
  const allReliabilityCategoriesCovered = coveredCategories.length >= RELIABILITY_CATEGORIES.length
  const repeatedJobsCompleted = completedRunsWithArtifacts.length >= RELIABILITY_CATEGORIES.length * REQUIRED_COMPLETED_RUNS_PER_CATEGORY
  const repeatedJobQueueDrained = activeRuns.length === 0 && operations.staleActiveRuns === 0
  const repeatedJobReliabilityPassed = repeatedJobsCompleted
    && allReliabilityCategoriesCovered
    && repeatedJobQueueDrained
    && failureRate <= 0.1
    && completedRunsMissingArtifacts === 0
  const repeatedJobReliabilityObserved = completedRunsWithArtifacts.length >= 4
    || activeRuns.length > 0
    || coveredCategories.length >= 2
    || completedRunsMissingArtifacts > 0

  const checks: CreativeCanvasRuntimeProofCheck[] = [
    check({
      id: 'project_link',
      label: 'Linked project',
      status: canvas.linked?.projectId ? 'passed' : 'blocked',
      evidence: canvas.linked?.projectId ? `Project ${canvas.linked.projectId}` : 'No project linked to this canvas.',
      nextAction: canvas.linked?.projectId ? undefined : 'Link the canvas to a project before creating agent tasks.',
    }),
    check({
      id: 'graph_orchestration',
      label: 'Agent orchestration graph',
      status: orchestration.steps.length && !orchestration.blockers.length ? 'passed' : 'blocked',
      evidence: `${orchestration.steps.length} steps, ${orchestration.agents.length} agents, ${orchestration.blockers.length} blockers.`,
      nextAction: orchestration.blockers[0] ?? (!orchestration.steps.length ? 'Add or apply a workflow preset.' : undefined),
    }),
    check({
      id: 'runtime_readiness',
      label: 'Higgsfield runtime readiness',
      status: readiness.blockers.length ? 'blocked' : readiness.warnings.length ? 'warning' : 'passed',
      evidence: `Submit ${readiness.submitConfigured ? 'configured' : 'missing'}, status ${readiness.statusPollingConfigured ? 'configured' : 'missing'}, internal bridge ${readiness.internalBridgeConfigured ? 'yes' : 'no'}.`,
      nextAction: readiness.blockers[0] ?? readiness.warnings[0],
    }),
    check({
      id: 'provider_runs',
      label: 'Provider run evidence',
      status: completedRuns.length ? 'passed' : activeRuns.length ? 'warning' : 'blocked',
      evidence: `${operations.total} runs, ${operations.completed} completed, ${operations.active} active, ${operations.failed} failed.`,
      nextAction: completedRuns.length ? undefined : activeRuns.length ? 'Wait for runtime drain/callback completion.' : 'Queue a Higgsfield/provider run from the canvas.',
    }),
    check({
      id: 'completed_run_artifacts',
      label: 'Completed run artifacts',
      status: completedRuns.length && !completedRunsWithArtifacts.length
        ? 'blocked'
        : completedRunsMissingArtifacts
          ? 'warning'
          : completedRunsWithArtifacts.length
            ? 'passed'
            : 'blocked',
      evidence: `${completedRunsWithArtifacts.length}/${completedRuns.length} completed runs have output URL, artifact ID, or text preview evidence.`,
      nextAction: completedRunsMissingArtifacts
        ? 'Ingest provider output artifacts for every completed proof run before claiming repeated-job reliability.'
        : completedRunsWithArtifacts.length
          ? undefined
          : 'Complete a provider run with output artifact evidence.',
    }),
    check({
      id: 'queue_health',
      label: 'Provider queue health',
      status: operations.staleActiveRuns || operations.retryableFailures ? 'warning' : 'passed',
      evidence: `${operations.staleActiveRuns} stale active, ${operations.retryableFailures} retryable failures.`,
      nextAction: operations.retryableFailures ? 'Use Retry all retryable.' : operations.staleActiveRuns ? 'Run the provider drain or inspect stuck jobs.' : undefined,
    }),
    check({
      id: 'output_assets',
      label: 'Output asset evidence',
      status: exportableAssets.length ? 'passed' : assets.some((asset) => asset.origin === 'run_output') ? 'warning' : 'blocked',
      evidence: `${assets.length} assets, ${exportableAssets.length} draft-exportable output assets.`,
      nextAction: exportableAssets.length ? undefined : 'Ingest completed provider output into an output node and pass review gates.',
    }),
    check({
      id: 'repeated_job_coverage',
      label: 'Repeated creative job coverage',
      status: coveredCategories.length >= RELIABILITY_CATEGORIES.length
        ? 'passed'
        : coveredCategories.length >= 2
          ? 'warning'
          : 'blocked',
      evidence: reliabilityCoverage
        .map((category) => `${category.label}: ${category.completed}/${category.requiredCompleted} required completed (${category.total} total)`)
        .join('; '),
      nextAction: coveredCategories.length >= RELIABILITY_CATEGORIES.length
        ? undefined
        : `Run and complete ${REQUIRED_COMPLETED_RUNS_PER_CATEGORY} image, video/social, audio, blog/document, and book creative jobs through the canvas.`,
    }),
    check({
      id: 'repeated_job_reliability',
      label: 'Repeated creative job reliability',
      status: repeatedJobReliabilityPassed ? 'passed' : repeatedJobReliabilityObserved ? 'warning' : 'blocked',
      evidence: `${runs.length} total runs, ${completedRunsWithArtifacts.length} artifact-backed completed, ${completedRunsMissingArtifacts} completed missing artifacts, ${activeRuns.length} active, ${totalFailures} failed, ${Math.round(failureRate * 100)}% artifact-backed failure rate, ${operations.staleActiveRuns} stale active.`,
      nextAction: repeatedJobReliabilityPassed
        ? undefined
        : `Complete at least ${REQUIRED_COMPLETED_RUNS_PER_CATEGORY} artifact-backed creative jobs in each category, ${RELIABILITY_CATEGORIES.length * REQUIRED_COMPLETED_RUNS_PER_CATEGORY} total, with <=10% failures and no active or stale runs.`,
    }),
  ]

  const status = proofStatus(checks)
  const readyForLiveProof = status === 'passed'
  return {
    canvasId: canvas.id,
    orgId: canvas.orgId,
    status,
    checks,
    reliabilityCoverage,
    readyForLiveProof,
    summary: readyForLiveProof
      ? 'Canvas has linked project, agent orchestration, runtime readiness, artifact-backed repeated provider jobs, healthy drained queue, and exportable output assets.'
      : `${checks.filter((item) => item.status === 'blocked').length} blockers and ${checks.filter((item) => item.status === 'warning').length} warnings remain before live proof.`,
  }
}
