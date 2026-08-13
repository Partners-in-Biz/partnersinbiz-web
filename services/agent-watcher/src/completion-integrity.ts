import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

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

export type CompletionIntegrityAssessment = {
  outcome: 'pass' | 'changes-requested' | 'blocked'
  reasons: string[]
  evidence: CompletionEvidence | null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isValidDevelopmentCommitSha(value: string): boolean {
  return /^[0-9a-f]{7,64}$/i.test(value)
}

function normalizedChangedFiles(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((file): file is string => typeof file === 'string')) return null
  const files = value as string[]
  if (files.some((file) => file !== file.trim() || !file || file.startsWith('/') || file.includes('..'))) return null
  if (new Set(files).size !== files.length) return null
  return files
}

export function validateCompletionEvidence(value: unknown): { ok: true; evidence: CompletionEvidence } | { ok: false; reasons: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reasons: ['completion_evidence_missing'] }
  const raw = value as Record<string, unknown>
  const workKind = raw.workKind
  const changedFiles = normalizedChangedFiles(raw.changedFiles)
  const testCommand = stringValue(raw.testCommand)
  const reasons: string[] = []
  if (raw.schemaVersion !== 1) reasons.push('completion_evidence_schema_invalid')
  if (workKind !== 'code' && workKind !== 'no-code') reasons.push('completion_work_kind_invalid')
  if (!changedFiles) reasons.push('changed_file_list_invalid')
  if (!testCommand) reasons.push('scoped_test_command_missing')
  if (raw.testResult !== 'passed') reasons.push('scoped_test_result_not_passing')
  if (workKind === 'code') {
    if (!isValidDevelopmentCommitSha(stringValue(raw.commitSha))) reasons.push('development_commit_missing_or_invalid')
    if (!changedFiles?.length) reasons.push('changed_file_list_missing_for_code')
    if (raw.worktreeState !== 'clean') reasons.push('worktree_state_conflicts_with_done')
  }
  if (workKind === 'no-code') {
    if (changedFiles?.length) reasons.push('no_code_task_lists_changed_files')
    if (!stringValue(raw.noCodeReason)) reasons.push('no_code_exception_reason_missing')
    if (raw.worktreeState !== 'not-applicable' && raw.worktreeState !== 'clean') reasons.push('worktree_state_conflicts_with_done')
  }
  if (reasons.length || (workKind !== 'code' && workKind !== 'no-code') || !changedFiles) return { ok: false, reasons }
  return {
    ok: true,
    evidence: {
      schemaVersion: 1,
      workKind,
      ...(workKind === 'code' ? { commitSha: stringValue(raw.commitSha) } : {}),
      changedFiles,
      testCommand,
      testResult: 'passed',
      worktreeState: raw.worktreeState as 'clean' | 'not-applicable',
      ...(workKind === 'no-code' ? { noCodeReason: stringValue(raw.noCodeReason) } : {}),
    },
  }
}

function reportsUnresolvedWork(summary: string): boolean {
  return /\b(?:unresolved|remaining work|not (?:yet )?(?:committed|pushed|complete|finished)|nothing is committed|cannot complete|still (?:needs|requires)|incomplete)\b/i.test(summary)
}

export function assessCompletionIntegrity(input: { summary: unknown; evidence: unknown; commitReachable: boolean | null; changedFilesMatch?: boolean | null; worktreeClean?: boolean | null; verifyAgainstPlatformRepo?: boolean; currentAgentStatus: unknown }): CompletionIntegrityAssessment {
  const summary = stringValue(input.summary)
  const validation = validateCompletionEvidence(input.evidence)
  if ('reasons' in validation) return { outcome: 'changes-requested', reasons: validation.reasons, evidence: null }
  const reasons: string[] = []
  if (reportsUnresolvedWork(summary)) reasons.push('agent_output_reports_unresolved_work')
  const currentAgentStatus = stringValue(input.currentAgentStatus)
  // Producer closeout may briefly land in done/blocked before this watcher pass runs:
  // the Projects API rewrites agentStatus=done to blocked when verification is still
  // missing (completion_integrity_verification_required). Treat those as producer-
  // finished, not as a competing owner, so the watcher can still pass real CE.
  const apiIntegrityRewrite = /completion_integrity_verification_required/i.test(summary)
  const producerFinishedStatuses = new Set(['in-progress', 'picked-up', 'done'])
  if (currentAgentStatus === 'blocked' && apiIntegrityRewrite) {
    // allowed
  } else if (currentAgentStatus && !producerFinishedStatuses.has(currentAgentStatus)) {
    reasons.push(`agent_state_conflicts_with_completion:${currentAgentStatus}`)
  }
  // Client product boards (SAG, Loyalty Plus, …) do not share PIB_REPO_ROOT.
  // Their commits live in their own GitHub trees; a dirty PiB monorepo or a
  // SHA that is not an ancestor of origin/development must not bounce them.
  const verifyAgainstPlatformRepo = input.verifyAgainstPlatformRepo !== false
  if (verifyAgainstPlatformRepo && validation.evidence.workKind === 'code' && input.commitReachable !== true) reasons.push('commit_not_reachable_on_origin_development')
  if (verifyAgainstPlatformRepo && validation.evidence.workKind === 'code' && input.changedFilesMatch !== true) reasons.push('changed_file_list_mismatch_with_commit')
  if (verifyAgainstPlatformRepo && validation.evidence.workKind === 'code' && input.worktreeClean === false) reasons.push('watcher_worktree_state_conflicts_with_done')
  if (!reasons.length) return { outcome: 'pass', reasons, evidence: validation.evidence }
  return {
    outcome: reasons.some(reason => reason === 'agent_output_reports_unresolved_work' || reason.startsWith('agent_state_conflicts_with_completion:')) ? 'blocked' : 'changes-requested',
    reasons,
    evidence: validation.evidence,
  }
}

export async function verifyCleanWatcherWorktree(
  repoRoot = process.env.PIB_REPO_ROOT || process.cwd(),
): Promise<boolean> {
  try {
    const { stdout } = await execFile('git', ['-C', repoRoot, 'status', '--porcelain'], { timeout: 10_000 })
    return !stdout.trim()
  } catch {
    return false
  }
}

/**
 * Verify a submitted source commit against the current remote development tip.
 * The watcher deliberately performs this instead of trusting a task narrative or
 * a caller-supplied reachability flag. Failure is fail-closed.
 */
export async function verifyReachableDevelopmentCommit(
  commitSha: string,
  repoRoot = process.env.PIB_REPO_ROOT || process.cwd(),
): Promise<boolean> {
  if (!isValidDevelopmentCommitSha(commitSha)) return false
  try {
    await execFile('git', ['-C', repoRoot, 'fetch', '--quiet', 'origin', 'development'], { timeout: 30_000 })
    await execFile('git', ['-C', repoRoot, 'merge-base', '--is-ancestor', commitSha, 'origin/development'], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/**
 * Verify that the producer's claimed changed-file list exactly matches the
 * submitted commit. This binds completion evidence to the source revision,
 * rather than accepting a narrative or arbitrary artifact list.
 */
export async function verifyChangedFilesMatchCommit(
  commitSha: string,
  changedFiles: string[],
  repoRoot = process.env.PIB_REPO_ROOT || process.cwd(),
): Promise<boolean> {
  if (!isValidDevelopmentCommitSha(commitSha) || !normalizedChangedFiles(changedFiles)) return false
  try {
    const { stdout } = await execFile(
      'git',
      ['-C', repoRoot, 'diff-tree', '--no-commit-id', '--name-only', '-z', '-r', '--root', commitSha],
      { timeout: 10_000 },
    )
    const actual = stdout.split('\0').filter((file) => file.length > 0).sort()
    const expected = [...changedFiles].sort()
    return actual.length === expected.length && actual.every((file, index) => file === expected[index])
  } catch {
    return false
  }
}
