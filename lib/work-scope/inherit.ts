import { companyFieldsForWrite } from './index'

/**
 * Child records (tasks, milestones, messages…) inherit the parent's company
 * work scope but never its `clientVisibility`.
 */
export function inheritedWorkScopeFields(
  parent: { companyId?: unknown; workOwner?: unknown; marketingOwner?: unknown } | null | undefined,
): Record<string, unknown> {
  const companyId = typeof parent?.companyId === 'string' ? parent.companyId.trim() : ''
  if (companyId) return companyFieldsForWrite(companyId)
  const out: Record<string, unknown> = {}
  if (typeof parent?.workOwner === 'string' && parent.workOwner) out.workOwner = parent.workOwner
  if (typeof parent?.marketingOwner === 'string' && parent.marketingOwner) out.marketingOwner = parent.marketingOwner
  return out
}
