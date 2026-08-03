import { isValidApprovalGate } from '@/lib/projects/task-allowlists'
import { mapCapabilityToHumanGateApprovalGate } from './engine'
import type { MaterializeIntent } from './types'

/**
 * Defense-in-depth: never pass raw capability aliases ("publish"/"approval") into
 * Kanban taskPayload.approvalGate. Engine should already map; store re-sanitizes
 * so a stale deploy / intent bug cannot hard-fail materialize with invalid_spec.
 *
 * Pure module — safe for unit tests (no firebase-admin).
 */
export function sanitizeMaterializeApprovalGate(intent: MaterializeIntent): string | undefined {
  if (intent.kind !== 'human_gate') {
    const raw = typeof intent.approvalGate === 'string' ? intent.approvalGate.trim() : ''
    return raw && isValidApprovalGate(raw) ? raw : undefined
  }
  const candidate = typeof intent.approvalGate === 'string' ? intent.approvalGate.trim() : ''
  if (candidate && isValidApprovalGate(candidate) && candidate !== 'none') {
    return candidate
  }
  // Invalid candidate (publish/approval) or empty → map capability/alias.
  return mapCapabilityToHumanGateApprovalGate(candidate || intent.requiredCapability)
}
