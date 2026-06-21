import type {
  CreativeCanvasBenchmarkProof,
  CreativeCanvasCategoryEvidence,
  CreativeCanvasCertificationArtifactEvidence,
  CreativeCanvasCollaborationProofEvidence,
  CreativeCanvasKnowledgeBaseCertificationEvidence,
  CreativeCanvasLiveProofArtifact,
  CreativeCanvasMobileProof,
  CreativeCanvasMobileViewportEvidence,
  CreativeCanvasProofCategoryKey,
  CreativeCanvasProofBinding,
  CreativeCanvasWorldClassCertificationInput,
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
const requiredLiveProofArtifactKeys = ['desktop', 'tablet', 'mobile', 'mobile_panels'] as const
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

function hasSafeHttpUrl(value: unknown): value is string {
  if (!hasText(value)) {
    return false
  }

  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function hasSuccessfulStatus(value: unknown): value is number {
  return typeof value === 'number' && value >= 200 && value < 300
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
  const actorCount = uniqueCount(mutations.map((item) => item.actorUid))
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
      && proof.collaborationRemoteActorCount === actorCount
      && proof.collaborationRemoteEventCount === mutations.length
      && proof.collaborationRemoteMutationCount === mutations.length
      && proof.collaborationRemoteMutationKindCount === mutationKindCount
      && proof.collaborationRemoteTouchedNodeCount === touchedNodeCount
      && hasText(proof.collaborationRemoteSource)
      && hasText(proof.collaborationRemoteOutcome)
      && certifiedCollaborationOutcomes.has(proof.collaborationRemoteOutcome)
      && hasText(proof.collaborationCapturedAt)
      && hasText(proof.collaborationEvidence),
  )
}

export function hasStructuredMobileProof(
  proof: CreativeCanvasMobileProof | undefined,
  current: CreativeCanvasProofBinding,
): boolean {
  if (!proof) return false
  const evidence = Array.isArray(proof.mobileViewportBehaviorEvidence) ? proof.mobileViewportBehaviorEvidence : []
  const covered = new Set(evidence.map((item) => item.key))

  return Boolean(
    hasCurrentCanvasBinding(current)
      && hasCurrentCanvasBinding(proof, current)
      && typeof proof.mobileViewportProofCount === 'number'
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

function hasBenchmarkProofRequirements(
  proof: CreativeCanvasBenchmarkProof,
  current: CreativeCanvasProofBinding,
): boolean {
  return Boolean(
    proof.passed
      && hasCurrentCanvasBinding(proof, current)
      && hasText(proof.key)
      && hasText(proof.evidence)
      && hasSafeHttpUrl(proof.proofUrl)
      && hasText(proof.notes)
      && hasSafeHttpUrl(proof.sourceUrl)
      && proof.sourceEvidenceReachable === true
      && hasSuccessfulStatus(proof.sourceEvidenceStatus)
      && proof.sourceSignalsMatched === true
      && Array.isArray(proof.sourceSignals)
      && proof.sourceSignals.some(hasText)
      && hasText(proof.sourceSignalsVerifiedAt)
      && proof.directComparisonVerdict === 'pass'
      && hasText(proof.directComparisonAt)
      && hasText(proof.directComparisonNotes),
  )
}

function hasLiveProofArtifactRequirements(proof: CreativeCanvasLiveProofArtifact): boolean {
  return Boolean(
    hasCurrentCanvasBinding(proof)
      && hasText(proof.key)
      && hasSafeHttpUrl(proof.url)
      && hasSuccessfulStatus(proof.status)
      && hasText(proof.contentType)
      && proof.contentType.startsWith('image/')
      && hasText(proof.capturedAt)
      && hasText(proof.evidence),
  )
}

function hasCertificationArtifactEvidence(
  proof: CreativeCanvasCertificationArtifactEvidence | undefined,
  current?: CreativeCanvasProofBinding,
): boolean {
  return Boolean(
    proof
      && hasCurrentCanvasBinding(proof, current)
      && proof.passed === true
      && hasText(proof.evidence)
      && hasText(proof.artifactRef)
      && hasText(proof.capturedAt),
  )
}

function hasKbCertificationEvidence(
  proof: CreativeCanvasKnowledgeBaseCertificationEvidence | undefined,
  current?: CreativeCanvasProofBinding,
): boolean {
  return Boolean(
    proof
      && hasCurrentCanvasBinding(proof, current)
      && proof.recorded === true
      && hasText(proof.evidence)
      && hasText(proof.artifactRef)
      && hasText(proof.capturedAt),
  )
}

function isCurrentBenchmarkProof(
  proof: CreativeCanvasBenchmarkProof,
  current: CreativeCanvasProofBinding,
): boolean {
  return hasBenchmarkProofRequirements(proof, current)
}

export function buildWorldClassCertification(input: CreativeCanvasWorldClassCertificationInput): CreativeCanvasWorldClassCertification {
  const blockers: string[] = []
  const warnings: string[] = []
  const passedBenchmarks = input.benchmarkProofs.filter((item) => isCurrentBenchmarkProof(item, input.currentBinding))
  const currentBindingValid = hasCurrentCanvasBinding(input.currentBinding)
  const validLiveProofArtifacts = input.liveProofArtifacts.filter((item) => (
    hasLiveProofArtifactRequirements(item) && hasCurrentCanvasBinding(item, input.currentBinding)
  ))
  const validLiveProofArtifactKeys = new Set(validLiveProofArtifacts.map((item) => item.key))
  const validRequiredLiveProofArtifactCount = requiredLiveProofArtifactKeys.filter((key) => (
    validLiveProofArtifactKeys.has(key)
  )).length
  const runtimeProofValid = Boolean(
    input.runtimeProof
      && hasCurrentCanvasBinding(input.runtimeProof, input.currentBinding)
      && input.runtimeProof.status === 'passed'
      && input.runtimeProof.readyForLiveProof === true,
  )
  const signedInPreviewProofValid = hasCertificationArtifactEvidence(input.signedInPreviewProof, input.currentBinding)
  const kbCertificationValid = hasKbCertificationEvidence(input.kbCertification, input.currentBinding)

  if (passedBenchmarks.length < input.requiredBenchmarkCount) {
    blockers.push(`Missing ${input.requiredBenchmarkCount - passedBenchmarks.length} source-backed benchmark proofs.`)
  }

  if (!currentBindingValid) {
    blockers.push('Current canvas binding is missing or invalid.')
  }

  if (!runtimeProofValid) {
    blockers.push('Runtime proof is not passed and ready for live proof.')
  }

  if (validRequiredLiveProofArtifactCount < requiredLiveProofArtifactKeys.length) {
    blockers.push('Signed-in live proof artifacts are incomplete.')
  }

  if (input.signedInPreviewProof?.passed !== true) {
    blockers.push('Signed-in Vercel Preview proof is missing or failed.')
  } else if (!signedInPreviewProofValid) {
    blockers.push('Signed-in Vercel Preview proof evidence is incomplete.')
  }

  if (input.kbCertification?.recorded !== true) {
    blockers.push('KB-recorded certification artifact is missing.')
  } else if (!kbCertificationValid) {
    blockers.push('KB-recorded certification evidence is incomplete.')
  }

  const passedGateCount = input.requiredBenchmarkCount - Math.max(0, input.requiredBenchmarkCount - passedBenchmarks.length)
    + (runtimeProofValid ? 1 : 0)
    + validRequiredLiveProofArtifactCount
    + (signedInPreviewProofValid ? 1 : 0)
    + (kbCertificationValid ? 1 : 0)
  const requiredGateCount = input.requiredBenchmarkCount + 7

  return {
    status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'passed',
    capturedAt: input.capturedAt,
    orgId: input.currentBinding.orgId,
    canvasVersion: input.currentBinding.canvasVersion,
    graphSignature: input.currentBinding.graphSignature,
    nodeCount: input.currentBinding.nodeCount,
    edgeCount: input.currentBinding.edgeCount,
    passedGateCount,
    requiredGateCount,
    blockers,
    warnings,
    signedInPreviewProofPassed: signedInPreviewProofValid,
    signedInPreviewProofEvidence: input.signedInPreviewProof?.evidence,
    signedInPreviewProofArtifactRef: input.signedInPreviewProof?.artifactRef,
    kbCertificationRecorded: kbCertificationValid,
    kbCertificationEvidence: input.kbCertification?.evidence,
    kbCertificationArtifactRef: input.kbCertification?.artifactRef,
    evidence: [
      `${passedBenchmarks.length}/${input.requiredBenchmarkCount} benchmark proofs passed.`,
      `${validRequiredLiveProofArtifactCount}/${requiredLiveProofArtifactKeys.length} required live proof artifacts captured.`,
      ...(signedInPreviewProofValid && input.signedInPreviewProof?.evidence ? [input.signedInPreviewProof.evidence] : []),
      ...(kbCertificationValid && input.kbCertification?.evidence ? [input.kbCertification.evidence] : []),
      ...passedBenchmarks.map((item) => item.evidence).filter(hasText),
    ],
  }
}
