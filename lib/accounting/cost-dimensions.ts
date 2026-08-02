import { FinanceValidationError, requiredText } from './foundation'

/** Optional analytical dimensions shared by journals, AR/AP lines, payroll items, and time costing. */
export interface CostDimensions {
  projectId?: string
  taskId?: string
  costCentreCode?: string
  branchId?: string
  companyId?: string
  contactId?: string
  employeeId?: string
}

export const COST_DIMENSION_KEYS = [
  'projectId',
  'taskId',
  'costCentreCode',
  'branchId',
  'companyId',
  'contactId',
  'employeeId',
] as const

function optionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requiredText(value, field)
}

export function normalizeCostDimensions(input: CostDimensions | undefined | null): CostDimensions {
  if (!input) return {}
  const out: CostDimensions = {}
  const projectId = optionalId(input.projectId, 'projectId')
  const taskId = optionalId(input.taskId, 'taskId')
  const costCentreCode = optionalId(input.costCentreCode, 'costCentreCode')
  const branchId = optionalId(input.branchId, 'branchId')
  const companyId = optionalId(input.companyId, 'companyId')
  const contactId = optionalId(input.contactId, 'contactId')
  const employeeId = optionalId(input.employeeId, 'employeeId')
  if (taskId && !projectId) throw new FinanceValidationError('taskId requires projectId')
  if (projectId) out.projectId = projectId
  if (taskId) out.taskId = taskId
  if (costCentreCode) out.costCentreCode = costCentreCode
  if (branchId) out.branchId = branchId
  if (companyId) out.companyId = companyId
  if (contactId) out.contactId = contactId
  if (employeeId) out.employeeId = employeeId
  return out
}

export function pickCostDimensions<T extends CostDimensions>(source: T): CostDimensions {
  return normalizeCostDimensions({
    projectId: source.projectId,
    taskId: source.taskId,
    costCentreCode: source.costCentreCode,
    branchId: source.branchId,
    companyId: source.companyId,
    contactId: source.contactId,
    employeeId: source.employeeId,
  })
}

export function hasProjectDimension(dims: CostDimensions | undefined, projectId: string): boolean {
  return Boolean(dims?.projectId && dims.projectId === projectId)
}
