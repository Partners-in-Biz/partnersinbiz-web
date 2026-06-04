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

function hasApprovalReference(source: SoftwareBuildEvidenceSource, context: Record<string, unknown>, evidence: SoftwareBuildEvidenceRow[]) {
  return Boolean(
    compact(source.approvalGateTaskId) ||
    compact(context.approvalGateTaskId) ||
    compact(source.sourceDocumentId) ||
    compact(context.sourceDocumentId) ||
    compact(source.sourceSpecVersion) ||
    compact(context.sourceSpecVersion) ||
    evidence.some((row) => /approval|source document|spec version|related doc/i.test(`${row.label} ${row.value}`)),
  )
}

function falseSuccessStatus(summary: string, evidence: SoftwareBuildEvidenceRow[], approvalGates: AgentOutputApprovalGate[]): AgentOutputQualityCheck {
  if (!summary) {
    return {
      label: 'False success guard',
      status: 'warning',
      detail: 'No summary is available to compare completion claims against blockers and approvals.',
    }
  }

  const hasBlocker = hasKind(evidence, 'blocker') || approvalGates.some((gate) => gate.status === 'blocked')
  const claimsSuccess = /\b(completed|complete|done|ready to ship|shipped|passed|success|successful|approved|deployed|published|sent|launched)\b/i.test(summary)
  const separatesCaveat = /\b(no production|production[^.]*gated|separately gated|approval required|approval remains|blocked|blocker|internal[-\s]only|no [^.]*occurred|not (?:deployed|published|sent|launched)|without external)\b/i.test(summary)

  if (hasBlocker && claimsSuccess && !separatesCaveat) {
    return {
      label: 'False success guard',
      status: 'blocked',
      detail: 'The output claims success while approval/blocker evidence is still open, without a clear caveat.',
    }
  }

  return {
    label: 'False success guard',
    status: 'pass',
    detail: hasBlocker
      ? 'Success language is caveated by the blocker or approval-gate status.'
      : 'No contradictory success claim was detected.',
  }
}

function buildQualityChecks(source: SoftwareBuildEvidenceSource, context: Record<string, unknown>, summary: string, evidence: SoftwareBuildEvidenceRow[], artifacts: AgentOutputReviewArtifact[], approvalGates: AgentOutputApprovalGate[]): AgentOutputQualityCheck[] {
  const hasVerification = hasKind(evidence, 'verification')
  const hasBlocker = hasKind(evidence, 'blocker')
  const hasBlockingGate = approvalGates.some((gate) => gate.status === 'blocked')
  const hasBuildArtifact = artifacts.some((artifact) => /commit|sha|test|verification|check|build|preview|url|link/i.test(`${artifact.type} ${artifact.label}`)) || evidence.some((row) => row.kind === 'commit' || row.kind === 'link')
  const approvalReferencePresent = hasApprovalReference(source, context, evidence)
  const approvalSeparated = !approvalReferencePresent || approvalGates.length > 0

  return [
    {
      label: 'Summary',
      status: summary ? 'pass' : 'warning',
      detail: summary ? 'Agent supplied a readable completion summary.' : 'No readable completion summary was supplied.',
    },
    {
      label: 'Evidence present',
      status: evidence.length ? 'pass' : 'warning',
      detail: evidence.length ? `${evidence.length} evidence row${evidence.length === 1 ? '' : 's'} attached.` : 'No structured evidence rows were found.',
    },
    {
      label: 'Approvals separated',
      status: approvalSeparated ? (hasBlockingGate ? 'blocked' : 'pass') : 'warning',
      detail: approvalSeparated
        ? (hasBlockingGate ? 'Approval/release gates are called out separately from completion evidence.' : 'Approval references are separated from the completion summary.')
        : 'Approval references were detected but no separate approval gate row was built.',
    },
    {
      label: 'Blocked work clear',
      status: hasBlocker || hasBlockingGate ? 'blocked' : 'pass',
      detail: hasBlocker || hasBlockingGate
        ? 'Blocked or approval-gated work is visible on the review card.'
        : 'No blocked work was detected in the evidence rows.',
    },
    {
      label: 'Test/build artifacts linked',
      status: hasVerification && hasBuildArtifact ? 'pass' : 'warning',
      detail: hasVerification && hasBuildArtifact
        ? 'Verification evidence and build/test artifacts are linked.'
        : hasVerification
          ? 'Verification evidence exists, but no commit, preview, build, or test artifact was linked.'
          : 'No verification command or test/build artifact was detected in the output.',
    },
    falseSuccessStatus(summary, evidence, approvalGates),
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
  const qualityChecks = buildQualityChecks(source, context, summary, evidence, artifacts, approvalGates)

  return {
    summary,
    evidence,
    artifacts,
    qualityChecks,
    approvalGates,
    nextAction: nextActionFor(source, qualityChecks),
  }
}
