import { getSoftwareBuildEvidenceRows, type SoftwareBuildEvidenceRow, type SoftwareBuildEvidenceSource } from './software-build-evidence'

export type AgentOutputQualityStatus = 'pass' | 'warning' | 'blocked'

export interface AgentOutputReviewArtifact {
  type: string
  label: string
  ref: string
  href?: string
}

export interface AgentOutputQualityCheck {
  label: string
  status: AgentOutputQualityStatus
  detail: string
}

export interface AgentOutputApprovalGate {
  label: string
  status: AgentOutputQualityStatus
  value: string
  href?: string
}

export interface AgentOutputReviewCard {
  summary: string
  evidence: SoftwareBuildEvidenceRow[]
  artifacts: AgentOutputReviewArtifact[]
  qualityChecks: AgentOutputQualityCheck[]
  approvalGates: AgentOutputApprovalGate[]
  nextAction: string
}

type ArtifactInput = {
  type?: unknown
  label?: unknown
  ref?: unknown
  url?: unknown
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function compact(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function firstSentence(value: string, maxLength = 260) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trim()}…`
}

function hrefForArtifact(ref: string) {
  if (/^https?:\/\//i.test(ref)) return ref
  return undefined
}

function documentHref(id: string) {
  return `/admin/documents/${encodeURIComponent(id)}`
}

function buildArtifacts(agentOutput: Record<string, unknown>): AgentOutputReviewArtifact[] {
  const artifacts = Array.isArray(agentOutput.artifacts) ? agentOutput.artifacts as ArtifactInput[] : []
  return artifacts
    .map((artifact): AgentOutputReviewArtifact | null => {
      const ref = compact(artifact.ref) ?? compact(artifact.url)
      if (!ref) return null
      const type = compact(artifact.type) ?? 'artifact'
      return {
        type,
        label: compact(artifact.label) ?? type,
        ref,
        href: hrefForArtifact(ref),
      }
    })
    .filter((artifact): artifact is AgentOutputReviewArtifact => Boolean(artifact))
    .slice(0, 8)
}

function hasKind(evidence: SoftwareBuildEvidenceRow[], kind: SoftwareBuildEvidenceRow['kind']) {
  return evidence.some((row) => row.kind === kind)
}

function buildApprovalGates(source: SoftwareBuildEvidenceSource, context: Record<string, unknown>, evidence: SoftwareBuildEvidenceRow[]): AgentOutputApprovalGate[] {
  const gates: AgentOutputApprovalGate[] = []
  const sourceDocumentId = compact(source.sourceDocumentId) ?? compact(context.sourceDocumentId)
  const sourceSpecVersion = compact(source.sourceSpecVersion) ?? compact(context.sourceSpecVersion)
  const approvalGateTaskId = compact(source.approvalGateTaskId) ?? compact(context.approvalGateTaskId)

  if (sourceDocumentId) {
    gates.push({ label: 'Source document', status: 'pass', value: sourceDocumentId, href: documentHref(sourceDocumentId) })
  }
  if (sourceSpecVersion) {
    gates.push({ label: 'Spec version', status: 'pass', value: sourceSpecVersion })
  }
  if (approvalGateTaskId) {
    gates.push({ label: 'Approval gate', status: 'blocked', value: approvalGateTaskId })
  }
  if (hasKind(evidence, 'blocker')) {
    gates.push({ label: 'Production/external actions', status: 'blocked', value: 'Separate Peet approval still required for production deploys, public publishing, sends, spend, billing, secrets/config, or destructive actions.' })
  }

  return gates
}

function buildQualityChecks(summary: string, evidence: SoftwareBuildEvidenceRow[], artifacts: AgentOutputReviewArtifact[], approvalGates: AgentOutputApprovalGate[]): AgentOutputQualityCheck[] {
  const hasVerification = hasKind(evidence, 'verification')
  const hasBlockingGate = approvalGates.some((gate) => gate.status === 'blocked')
  return [
    {
      label: 'Summary',
      status: summary ? 'pass' : 'warning',
      detail: summary ? 'Agent supplied a readable completion summary.' : 'No readable completion summary was supplied.',
    },
    {
      label: 'Evidence',
      status: evidence.length ? 'pass' : 'warning',
      detail: evidence.length ? `${evidence.length} evidence row${evidence.length === 1 ? '' : 's'} attached.` : 'No structured evidence rows were found.',
    },
    {
      label: 'Artifacts',
      status: artifacts.length ? 'pass' : 'warning',
      detail: artifacts.length ? `${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'} linked.` : 'No artifacts were linked by the agent.',
    },
    {
      label: 'Verification',
      status: hasVerification ? 'pass' : 'warning',
      detail: hasVerification ? 'Verification command or check evidence is present.' : 'No verification command was detected in the output.',
    },
    {
      label: 'Approval gates',
      status: hasBlockingGate ? 'blocked' : 'pass',
      detail: hasBlockingGate ? 'At least one approval or release gate remains closed.' : 'No closed approval gates were detected on the review card.',
    },
  ]
}

function nextActionFor(source: SoftwareBuildEvidenceSource, qualityChecks: AgentOutputQualityCheck[]) {
  const reviewStatus = compact((source as Record<string, unknown>).reviewStatus)
  const hasBlocked = qualityChecks.some((check) => check.status === 'blocked')
  const hasWarnings = qualityChecks.some((check) => check.status === 'warning')

  if (reviewStatus === 'changes-requested') return 'Peet should check the change note and wait for the assigned agent to resubmit.'
  if (hasBlocked) return 'Peet should review the evidence, approve if it is correct, or send it back to the assigned agent with a change note.'
  if (hasWarnings) return 'Peet should review the missing evidence, then request a clearer proof trail or approve if the work is sufficient.'
  return 'Peet should approve the completed work or mark it handled if no further action is needed.'
}

export function buildAgentOutputReviewCard(source: SoftwareBuildEvidenceSource & Record<string, unknown>): AgentOutputReviewCard {
  const agentInput = objectValue(source.agentInput)
  const agentOutput = objectValue(source.agentOutput)
  const context = objectValue(agentInput.context)
  const summary = firstSentence(compact(agentOutput.summary) ?? compact(source.summary) ?? '')
  const evidence = getSoftwareBuildEvidenceRows(source)
  const artifacts = buildArtifacts(agentOutput)
  const approvalGates = buildApprovalGates(source, context, evidence)
  const qualityChecks = buildQualityChecks(summary, evidence, artifacts, approvalGates)

  return {
    summary,
    evidence,
    artifacts,
    qualityChecks,
    approvalGates,
    nextAction: nextActionFor(source, qualityChecks),
  }
}
