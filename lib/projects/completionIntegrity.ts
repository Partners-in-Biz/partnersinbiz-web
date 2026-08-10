export type CompletionEvidence = {
  schemaVersion: 1
  workKind: 'code' | 'no-code'
  commitSha?: string
  changedFiles: string[]
  testCommand: string
  testResult: 'passed'
  worktreeState: 'clean' | 'not-applicable'
  noCodeReason?: string
}

type EvidenceValidation =
  | { ok: true; evidence: CompletionEvidence }
  | { ok: false; reasons: string[] }

export type CompletionIntegrityAssessment = {
  outcome: 'pass' | 'changes-requested' | 'blocked'
  reasons: string[]
  evidence: CompletionEvidence | null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isValidDevelopmentCommitSha(value: string): boolean {
  return /^[0-9a-f]{7,64}$/i.test(value)
}

function normalizedChangedFiles(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const files = value.map(stringValue)
  if (files.some(file => !file || file.startsWith('/') || file.includes('..'))) return null
  return [...new Set(files)]
}

export function validateCompletionEvidence(value: unknown): EvidenceValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reasons: ['completion_evidence_missing'] }
  }

  const raw = value as Record<string, unknown>
  const schemaVersion = raw.schemaVersion
  const workKind = raw.workKind
  const changedFiles = normalizedChangedFiles(raw.changedFiles)
  const testCommand = stringValue(raw.testCommand)
  const testResult = raw.testResult
  const worktreeState = raw.worktreeState
  const reasons: string[] = []

  if (schemaVersion !== 1) reasons.push('completion_evidence_schema_invalid')
  if (workKind !== 'code' && workKind !== 'no-code') reasons.push('completion_work_kind_invalid')
  if (!changedFiles) reasons.push('changed_file_list_invalid')
  if (!testCommand) reasons.push('scoped_test_command_missing')
  if (testResult !== 'passed') reasons.push('scoped_test_result_not_passing')

  if (workKind === 'code') {
    const commitSha = stringValue(raw.commitSha)
    if (!isValidDevelopmentCommitSha(commitSha)) reasons.push('development_commit_missing_or_invalid')
    if (!changedFiles?.length) reasons.push('changed_file_list_missing_for_code')
    if (worktreeState !== 'clean') reasons.push('worktree_state_conflicts_with_done')
  }

  if (workKind === 'no-code') {
    if (changedFiles?.length) reasons.push('no_code_task_lists_changed_files')
    if (!stringValue(raw.noCodeReason)) reasons.push('no_code_exception_reason_missing')
    if (worktreeState !== 'not-applicable' && worktreeState !== 'clean') reasons.push('worktree_state_conflicts_with_done')
  }

  if (reasons.length || (workKind !== 'code' && workKind !== 'no-code') || !changedFiles) {
    return { ok: false, reasons }
  }
  return {
    ok: true,
    evidence: {
      schemaVersion: 1,
      workKind,
      ...(workKind === 'code' ? { commitSha: stringValue(raw.commitSha) } : {}),
      changedFiles,
      testCommand,
      testResult: 'passed',
      worktreeState: worktreeState as 'clean' | 'not-applicable',
      ...(workKind === 'no-code' ? { noCodeReason: stringValue(raw.noCodeReason) } : {}),
    },
  }
}

function reportsUnresolvedWork(summary: string): boolean {
  return /\b(?:unresolved|remaining work|not (?:yet )?(?:committed|pushed|complete|finished)|nothing is committed|cannot complete|still (?:needs|requires)|incomplete)\b/i.test(summary)
}

export function assessCompletionIntegrity(input: {
  summary: unknown
  evidence: unknown
  commitReachable: boolean | null
  worktreeClean?: boolean | null
  currentAgentStatus: unknown
}): CompletionIntegrityAssessment {
  const summary = stringValue(input.summary)
  const validation = validateCompletionEvidence(input.evidence)
  if ('reasons' in validation) {
    return { outcome: 'changes-requested', reasons: validation.reasons, evidence: null }
  }

  const reasons: string[] = []
  if (reportsUnresolvedWork(summary)) reasons.push('agent_output_reports_unresolved_work')
  const currentAgentStatus = stringValue(input.currentAgentStatus)
  if (currentAgentStatus && currentAgentStatus !== 'in-progress' && currentAgentStatus !== 'picked-up') {
    reasons.push(`agent_state_conflicts_with_completion:${currentAgentStatus}`)
  }
  if (validation.evidence.workKind === 'code' && input.commitReachable !== true) {
    reasons.push('commit_not_reachable_on_origin_development')
  }
  if (validation.evidence.workKind === 'code' && input.worktreeClean === false) {
    reasons.push('watcher_worktree_state_conflicts_with_done')
  }

  if (!reasons.length) return { outcome: 'pass', reasons, evidence: validation.evidence }
  const outcome = reasons.some(reason => reason === 'agent_output_reports_unresolved_work' || reason.startsWith('agent_state_conflicts_with_completion:'))
    ? 'blocked'
    : 'changes-requested'
  return { outcome, reasons, evidence: validation.evidence }
}
