import type { FinanceActorContext, FinanceRole, FinanceScope } from './types'

export type FinanceAction =
  | 'foundation.configure'
  | 'foundation.read'
  | 'journal.create'
  | 'journal.post'
  | 'journal.reverse'
  | 'period.adjust'
  | 'period.close'

const ACTION_ROLES: Record<FinanceAction, readonly FinanceRole[]> = {
  'foundation.configure': ['finance_admin'],
  'foundation.read': ['finance_viewer', 'bookkeeper', 'accountant', 'finance_approver', 'finance_admin'],
  'journal.create': ['bookkeeper', 'accountant', 'finance_admin'],
  'journal.post': ['accountant', 'finance_approver', 'finance_admin'],
  'journal.reverse': ['accountant', 'finance_approver', 'finance_admin'],
  'period.adjust': ['accountant', 'finance_approver', 'finance_admin'],
  'period.close': ['finance_approver', 'finance_admin'],
}

export class FinanceAuthorizationError extends Error {
  readonly statusCode = 403

  constructor(message: string) {
    super(message)
    this.name = 'FinanceAuthorizationError'
  }
}

function isAssignmentEffective(assignment: FinanceActorContext['assignments'][number], at: string): boolean {
  if (assignment.status !== 'active') return false
  if (assignment.effectiveFrom && assignment.effectiveFrom > at) return false
  if (assignment.effectiveTo && assignment.effectiveTo < at) return false
  return true
}

export function authorizeFinanceAction(
  actor: FinanceActorContext,
  scope: FinanceScope,
  action: FinanceAction,
  at = new Date().toISOString(),
): void {
  if (!actor.membershipActive) throw new FinanceAuthorizationError('Active organization membership is required')
  if (actor.orgId !== scope.orgId) throw new FinanceAuthorizationError('Actor organization does not match finance scope')

  const coveringAssignments = actor.assignments.filter((assignment) => {
    if (!isAssignmentEffective(assignment, at)) return false
    if (assignment.orgId !== scope.orgId || assignment.userId !== actor.uid) return false
    if (assignment.legalEntityId !== scope.legalEntityId) return false
    if (assignment.scopeMode === 'entity') return true
    return Boolean(scope.bookId) && assignment.bookId === scope.bookId
  })

  if (coveringAssignments.length === 0) {
    throw new FinanceAuthorizationError('No active finance assignment covers this scope')
  }
  if (!coveringAssignments.some((assignment) => ACTION_ROLES[action].includes(assignment.role))) {
    throw new FinanceAuthorizationError(`Finance role cannot perform ${action}`)
  }
}
