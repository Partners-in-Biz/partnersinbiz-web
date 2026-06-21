import type {
  CreativeCanvasCategoryEvidence,
  CreativeCanvasCollaborationProofEvidence,
  CreativeCanvasMobileViewportEvidence,
  CreativeCanvasProofCategoryKey,
  CreativeCanvasProofBinding,
  CreativeCanvasProofStatus,
  CreativeCanvasWorldClassCertification,
} from './types'

export const requiredCreativeCanvasProofCategories: Array<{ key: CreativeCanvasProofCategoryKey; label: string; requiresProviderJobId: boolean }> = [
  { key: 'image', label: 'Image', requiresProviderJobId: true },
  { key: 'video_social', label: 'Video/social', requiresProviderJobId: true },
  { key: 'audio', label: 'Audio', requiresProviderJobId: true },
  { key: 'blog_document', label: 'Blog/document', requiresProviderJobId: false },
  { key: 'book', label: 'Book', requiresProviderJobId: true },
]

const requiredViewportKeys: CreativeCanvasMobileViewportEvidence['key'][] = ['desktop', 'tablet', 'mobile', 'mobile_panels']
const certifiedCollaborationOutcomes = new Set<string>([
  'remote_changes_adopted',
  'conflict_detected',
  'version_forked',
])

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function uniqueCount(values: string[]): number {
  return new Set(values.filter(hasText)).size
}

function hasCurrentCanvasBinding(
  proof: CreativeCanvasProofBinding | undefined,
  current?: CreativeCanvasProofBinding,
): boolean {
  if (!proof) return false

  const hasRequiredBinding = hasText(proof.orgId)
    && Number.isInteger(proof.canvasVersion)
    && proof.canvasVersion > 0
    && hasText(proof.graphSignature)
    && Number.isInteger(proof.nodeCount)
    && proof.nodeCount >= 0
    && Number.isInteger(proof.edgeCount)
    && proof.edgeCount >= 0

  if (!hasRequiredBinding) {
    return false
  }

  if (!current) {
    return true
  }

  return proof.orgId === current.orgId
    && proof.canvasVersion === current.canvasVersion
    && proof.graphSignature === current.graphSignature
    && proof.nodeCount === current.nodeCount
    && proof.edgeCount === current.edgeCount
}

export function hasStructuredCollaborationProof(
  proof: CreativeCanvasCollaborationProofEvidence | undefined,
  current?: CreativeCanvasProofBinding,
): boolean {
  if (!proof) return false
  const mutations = Array.isArray(proof.collaborationRemoteMutations) ? proof.collaborationRemoteMutations : []
  const touchedNodeCount = uniqueCount(mutations.flatMap((item) => item.touchedNodeIds))
  const mutationKindCount = uniqueCount(mutations.map((item) => item.operation))

  return Boolean(
    hasCurrentCanvasBinding(proof, current)
      && hasText(proof.collaborationRemoteGraphSignature)
      && proof.collaborationRemoteGraphSignature === proof.graphSignature
      && typeof proof.collaborationRemoteTouchedNodeCount === 'number'
      && proof.collaborationRemoteTouchedNodeCount > 0
      && proof.collaborationRemoteTouchedNodeCount <= proof.nodeCount
      && typeof proof.collaborationRemoteActorCount === 'number'
      && proof.collaborationRemoteActorCount > 0
      && typeof proof.collaborationRemoteEventCount === 'number'
      && proof.collaborationRemoteEventCount > 0
      && typeof proof.collaborationRemoteMutationCount === 'number'
      && proof.collaborationRemoteMutationCount > 0
      && typeof proof.collaborationRemoteMutationKindCount === 'number'
      && proof.collaborationRemoteMutationKindCount > 0
      && proof.collaborationRemoteMutationCount <= mutations.length
      && proof.collaborationRemoteMutationKindCount <= mutationKindCount
      && proof.collaborationRemoteTouchedNodeCount <= touchedNodeCount
      && hasText(proof.collaborationRemoteSource)
      && hasText(proof.collaborationRemoteOutcome)
      && certifiedCollaborationOutcomes.has(proof.collaborationRemoteOutcome)
      && hasText(proof.collaborationCapturedAt)
      && hasText(proof.collaborationEvidence),
  )
}

export function hasStructuredMobileProof(proof: {
  mobileViewportProofCount?: number
  mobileViewportRequiredCount?: number
  mobileViewportProofCapturedAt?: string
  mobileViewportEvidence?: string
  mobileViewportBehaviorEvidence?: CreativeCanvasMobileViewportEvidence[]
} | undefined): boolean {
  if (!proof) return false
  const evidence = Array.isArray(proof.mobileViewportBehaviorEvidence) ? proof.mobileViewportBehaviorEvidence : []
  const covered = new Set(evidence.map((item) => item.key))

  return Boolean(
    typeof proof.mobileViewportProofCount === 'number'
      && typeof proof.mobileViewportRequiredCount === 'number'
      && proof.mobileViewportRequiredCount >= requiredViewportKeys.length
      && proof.mobileViewportProofCount >= proof.mobileViewportRequiredCount
      && hasText(proof.mobileViewportProofCapturedAt)
      && hasText(proof.mobileViewportEvidence)
      && requiredViewportKeys.every((key) => covered.has(key))
      && evidence.every((item) => (
        item.status >= 200
        && item.status < 400
        && item.contentType.startsWith('image/')
        && item.criticalControlsVisible
        && item.criticalControlsEnabled
        && item.horizontalOverflow === false
        && item.touchSmokePassed
        && item.pointerSmokePassed
        && item.panelKeys.length > 0
        && hasText(item.screenshotUrl)
        && hasText(item.capturedAt)
      )),
  )
}

export function hasDurableCategoryEvidence(proof: {
  runtimeCategoryEvidence?: CreativeCanvasCategoryEvidence[]
  exportCategoryEvidence?: CreativeCanvasCategoryEvidence[]
}, current?: CreativeCanvasProofBinding): boolean {
  if (!proof) return false
  const runtime = Array.isArray(proof.runtimeCategoryEvidence) ? proof.runtimeCategoryEvidence : []
  const exportEvidence = Array.isArray(proof.exportCategoryEvidence) ? proof.exportCategoryEvidence : []

  return requiredCreativeCanvasProofCategories.every((category) => {
    const runtimeItem = runtime.find((item) => item.categoryKey === category.key)
    const exportItem = exportEvidence.find((item) => item.categoryKey === category.key)
    const runtimeProviderOk = !category.requiresProviderJobId || Boolean(runtimeItem?.providerJobIds.length)

    return Boolean(
      runtimeItem
        && exportItem
        && hasCurrentCanvasBinding(runtimeItem, current)
        && hasCurrentCanvasBinding(exportItem, current)
        && runtimeItem.runIds.length >= 2
        && runtimeItem.outputNodeIds.length > 0
        && runtimeItem.outputKinds.length > 0
        && runtimeProviderOk
        && exportItem.exportIds.length > 0
        && exportItem.downstreamDraftIds.length > 0
        && exportItem.lineageSourceNodeIds.length > 0
        && hasText(runtimeItem.completedAt)
        && hasText(exportItem.completedAt),
    )
  })
}

export function buildWorldClassCertification(input: {
  benchmarkProofs: Array<{ key: string; passed: boolean; evidence?: string }>
  runtimeProof?: { status: CreativeCanvasProofStatus; readyForLiveProof?: boolean }
  liveProofArtifacts: string[]
  requiredBenchmarkCount: number
  capturedAt: string
  currentBinding?: CreativeCanvasProofBinding
  signedInPreviewProofPassed?: boolean
  signedInPreviewProofEvidence?: string
  kbCertificationRecorded?: boolean
  kbCertificationEvidence?: string
}): CreativeCanvasWorldClassCertification {
  const blockers: string[] = []
  const warnings: string[] = []
  const passedBenchmarks = input.benchmarkProofs.filter((item) => item.passed)

  if (passedBenchmarks.length < input.requiredBenchmarkCount) {
    blockers.push(`Missing ${input.requiredBenchmarkCount - passedBenchmarks.length} source-backed benchmark proofs.`)
  }

  if (input.runtimeProof?.status !== 'passed' || input.runtimeProof.readyForLiveProof !== true) {
    blockers.push('Runtime proof is not passed and ready for live proof.')
  }

  if (input.liveProofArtifacts.length < 4) {
    blockers.push('Signed-in live proof artifacts are incomplete.')
  }

  if (input.signedInPreviewProofPassed !== true) {
    blockers.push('Signed-in Vercel Preview proof is missing or failed.')
  }

  if (input.kbCertificationRecorded !== true) {
    blockers.push('KB-recorded certification artifact is missing.')
  }

  const passedGateCount = input.requiredBenchmarkCount - Math.max(0, input.requiredBenchmarkCount - passedBenchmarks.length)
    + (input.runtimeProof?.status === 'passed' && input.runtimeProof.readyForLiveProof ? 1 : 0)
    + Math.min(input.liveProofArtifacts.length, 4)
    + (input.signedInPreviewProofPassed === true ? 1 : 0)
    + (input.kbCertificationRecorded === true ? 1 : 0)
  const requiredGateCount = input.requiredBenchmarkCount + 7

  return {
    status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'passed',
    capturedAt: input.capturedAt,
    orgId: input.currentBinding?.orgId,
    canvasVersion: input.currentBinding?.canvasVersion,
    graphSignature: input.currentBinding?.graphSignature,
    nodeCount: input.currentBinding?.nodeCount,
    edgeCount: input.currentBinding?.edgeCount,
    passedGateCount,
    requiredGateCount,
    blockers,
    warnings,
    evidence: [
      `${passedBenchmarks.length}/${input.requiredBenchmarkCount} benchmark proofs passed.`,
      `${input.liveProofArtifacts.length}/4 live proof artifacts captured.`,
      ...(input.signedInPreviewProofEvidence && input.signedInPreviewProofPassed ? [input.signedInPreviewProofEvidence] : []),
      ...(input.kbCertificationEvidence && input.kbCertificationRecorded ? [input.kbCertificationEvidence] : []),
      ...passedBenchmarks.map((item) => item.evidence).filter(hasText),
    ],
  }
}
