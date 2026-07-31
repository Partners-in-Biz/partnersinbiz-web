import { FinanceValidationError } from '@/lib/accounting/foundation'
import {
  FinanceAuthorizationError,
  authorizeFinanceAction,
  effectiveFinanceAssignments,
} from '@/lib/finance/policy'
import {
  FinanceNotFoundError,
  isFinanceHttpError,
  mapFinanceErrorToHttp,
  safeFinanceErrorMessage,
} from '@/lib/finance/errors'
import {
  assertExactFinanceScope,
  matchesExactFinanceScope,
  normalizeRequiredFinanceScope,
  scopesEqual,
} from '@/lib/finance/scope'
import {
  authorizePayslipRead,
  listPayslipReadableRoles,
  redactSensitivePayrollRecord,
  sensitivePayrollFieldKeys,
} from '@/lib/finance/payroll-access'
import {
  AUDITED_MUTATION_ACTIONS,
  APPROVAL_GATED_ACTIONS,
  assertApprovalActionMapped,
  financeActionCoverage,
} from '@/lib/finance/security-matrix'
import type { FinanceActorContext, FinanceScope } from '@/lib/finance/types'
import fs from 'fs'
import path from 'path'

const orgId = 'org-sec'
const scope: Required<FinanceScope> = { orgId, legalEntityId: 'entity-a', bookId: 'book-a' }

function actor(
  uid: string,
  role: FinanceActorContext['assignments'][number]['role'],
  overrides: Partial<FinanceActorContext> = {},
): FinanceActorContext {
  return {
    uid,
    orgId,
    membershipRole: 'member',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [{
      id: `${uid}-a0`,
      orgId,
      userId: uid,
      legalEntityId: scope.legalEntityId,
      scopeMode: 'entity',
      role,
      status: 'active',
    }],
    ...overrides,
  }
}

describe('finance scope helpers', () => {
  test('matches only exact org/entity/book tuples', () => {
    expect(matchesExactFinanceScope(scope, { ...scope })).toBe(true)
    expect(matchesExactFinanceScope(scope, { ...scope, bookId: 'book-b' })).toBe(false)
    expect(matchesExactFinanceScope(scope, { ...scope, legalEntityId: 'entity-b' })).toBe(false)
    expect(matchesExactFinanceScope(scope, { ...scope, orgId: 'org-other' })).toBe(false)
    expect(() => assertExactFinanceScope(scope, { ...scope, bookId: 'book-b' }, 'Journal'))
      .toThrow(FinanceNotFoundError)
    expect(() => assertExactFinanceScope(scope, { ...scope, bookId: 'book-b' }, 'Journal'))
      .toThrow(/not found/)
  })

  test('normalizes and compares required scopes without accepting blanks', () => {
    expect(normalizeRequiredFinanceScope({
      orgId: ' org-a ',
      legalEntityId: ' entity-a ',
      bookId: ' book-a ',
    })).toEqual({ orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' })
    expect(() => normalizeRequiredFinanceScope({ orgId: '', legalEntityId: 'e', bookId: 'b' }))
      .toThrow(FinanceValidationError)
    expect(scopesEqual(scope, { ...scope })).toBe(true)
    expect(scopesEqual(scope, { ...scope, bookId: 'x' })).toBe(false)
  })
})

describe('role/permission matrix and payroll boundaries', () => {
  test('finance_viewer cannot mutate, approve payroll, or read payslips', () => {
    const viewer = actor('viewer-1', 'finance_viewer')
    expect(() => authorizeFinanceAction(viewer, scope, 'report.read')).not.toThrow()
    expect(() => authorizeFinanceAction(viewer, scope, 'journal.post')).toThrow(FinanceAuthorizationError)
    expect(() => authorizeFinanceAction(viewer, scope, 'payroll.run.approve')).toThrow(FinanceAuthorizationError)
    expect(() => authorizePayslipRead(viewer, scope)).toThrow(FinanceNotFoundError)
  })

  test('accountant cannot read payslips; payroll roles can', () => {
    const accountant = actor('acct-1', 'accountant')
    const clerk = actor('clerk-1', 'payroll_clerk')
    const payrollApprover = actor('pap-1', 'payroll_approver')
    expect(() => authorizeFinanceAction(accountant, scope, 'invoice.read')).not.toThrow()
    expect(() => authorizePayslipRead(accountant, scope)).toThrow(FinanceNotFoundError)
    expect(() => authorizePayslipRead(clerk, scope)).not.toThrow()
    expect(() => authorizePayslipRead(payrollApprover, scope)).not.toThrow()
    expect(listPayslipReadableRoles()).toEqual(
      expect.arrayContaining(['finance_admin', 'payroll_clerk', 'payroll_approver']),
    )
    expect(listPayslipReadableRoles()).not.toEqual(expect.arrayContaining(['finance_viewer', 'accountant', 'bookkeeper']))
  })

  test('book-scoped assignment cannot cover a sibling book; entity-scoped can', () => {
    const bookActor = actor('book-1', 'accountant', {
      assignments: [{
        id: 'book-1-a0',
        orgId,
        userId: 'book-1',
        legalEntityId: scope.legalEntityId,
        bookId: 'book-a',
        scopeMode: 'book',
        role: 'accountant',
        status: 'active',
      }],
    })
    expect(effectiveFinanceAssignments(bookActor, scope, '2026-07-31T10:00:00.000Z')).toHaveLength(1)
    expect(effectiveFinanceAssignments(bookActor, { ...scope, bookId: 'book-b' }, '2026-07-31T10:00:00.000Z')).toHaveLength(0)
    expect(() => authorizeFinanceAction(bookActor, { ...scope, bookId: 'book-b' }, 'journal.post'))
      .toThrow('No active finance assignment covers this scope')
  })

  test('cross-tenant actor and inactive membership are denied without mutation side effects', () => {
    const foreign = actor('foreign-1', 'finance_admin', { orgId: 'org-other' })
    const inactive = actor('inactive-1', 'finance_admin', { membershipActive: false })
    expect(() => authorizeFinanceAction(foreign, scope, 'foundation.configure')).toThrow(/organization/)
    expect(() => authorizeFinanceAction(inactive, scope, 'foundation.configure')).toThrow(/membership/)
  })

  test('delegation must grant exact finance action or finance:*', () => {
    const delegated = actor('dlg-1', 'accountant', {
      delegationId: 'dlg-1',
      delegationOrgId: orgId,
      delegationScopes: ['finance:journal.post'],
    })
    expect(() => authorizeFinanceAction(delegated, scope, 'journal.post')).not.toThrow()
    expect(() => authorizeFinanceAction(delegated, scope, 'journal.reverse'))
      .toThrow(/Delegation does not grant finance:journal.reverse/)
    const star = { ...delegated, delegationScopes: ['finance:*'] }
    expect(() => authorizeFinanceAction(star, scope, 'journal.reverse')).not.toThrow()
  })
})

describe('sensitive payroll redaction and anti-enumeration', () => {
  test('redacts bank, tax identity and national id fields by default', () => {
    const raw = {
      id: 'emp-1',
      orgId,
      displayName: 'Ada',
      bankAccountNumber: '1234567890',
      bankBranchCode: '250655',
      taxNumber: '1234567890',
      nationalIdNumber: '9001010001088',
      idNumber: '9001010001088',
      salaryBankAccount: { number: '99', holder: 'Ada' },
      note: 'ok',
    }
    const redacted = redactSensitivePayrollRecord(raw)
    expect(redacted.displayName).toBe('Ada')
    expect(redacted.note).toBe('ok')
    expect(redacted.bankAccountNumber).toBe('[redacted]')
    expect(redacted.taxNumber).toBe('[redacted]')
    expect(redacted.nationalIdNumber).toBe('[redacted]')
    expect(redacted.idNumber).toBe('[redacted]')
    expect(redacted.salaryBankAccount).toBe('[redacted]')
    expect(sensitivePayrollFieldKeys()).toEqual(expect.arrayContaining([
      'bankAccountNumber', 'taxNumber', 'nationalIdNumber', 'idNumber', 'salaryBankAccount',
    ]))
  })

  test('unauthorised payslip read uses non-enumerating not-found error', () => {
    const viewer = actor('viewer-2', 'finance_viewer')
    try {
      authorizePayslipRead(viewer, scope, { payslipId: 'ps_secret' })
      throw new Error('expected denial')
    } catch (error) {
      expect(error).toBeInstanceOf(FinanceNotFoundError)
      expect((error as FinanceNotFoundError).statusCode).toBe(404)
      expect((error as Error).message).toBe('Payslip not found')
      expect((error as Error).message).not.toMatch(/permission|role|forbidden|ps_secret/i)
    }
  })
})

describe('safe finance error mapping', () => {
  test('maps auth, not-found and validation without leaking stacks or internal codes', () => {
    expect(mapFinanceErrorToHttp(new FinanceAuthorizationError('Finance role cannot perform journal.post')))
      .toEqual({ status: 403, error: 'Finance role cannot perform journal.post', code: 'finance_forbidden' })
    expect(mapFinanceErrorToHttp(new FinanceNotFoundError('Payslip not found')))
      .toEqual({ status: 404, error: 'Payslip not found', code: 'finance_not_found' })
    expect(mapFinanceErrorToHttp(new FinanceValidationError('period is hard closed')))
      .toEqual({ status: 422, error: 'period is hard closed', code: 'finance_validation' })
    expect(mapFinanceErrorToHttp(new Error('secret db path /var/lib/xyz'))).toEqual({
      status: 500,
      error: 'Finance request failed',
      code: 'finance_internal',
    })
    expect(safeFinanceErrorMessage(new Error('boom'))).toBe('Finance request failed')
    expect(isFinanceHttpError(new FinanceAuthorizationError('x'))).toBe(true)
    expect(isFinanceHttpError(new Error('x'))).toBe(false)
  })
})

describe('approval enforcement and audit coverage inventory', () => {
  test('approval-gated actions are declared and mapped to policy roles', () => {
    for (const action of APPROVAL_GATED_ACTIONS) {
      expect(() => assertApprovalActionMapped(action)).not.toThrow()
    }
    const coverage = financeActionCoverage()
    expect(coverage['payroll.run.approve']).toEqual(expect.arrayContaining(['payroll_approver', 'finance_admin']))
    expect(coverage['journal.post']).toEqual(expect.arrayContaining(['accountant', 'finance_approver', 'finance_admin']))
    expect(coverage['reconciliation.approve']).toEqual(expect.arrayContaining(['finance_approver', 'finance_admin']))
  })

  test('high-risk mutations are listed for audit event coverage', () => {
    expect(AUDITED_MUTATION_ACTIONS).toEqual(expect.arrayContaining([
      'journal.post',
      'journal.reverse',
      'period.close',
      'reconciliation.approve',
      'payroll.run.approve',
      'payroll.run.reverse',
      'payroll.statutory.approve',
    ]))
    expect(new Set(AUDITED_MUTATION_ACTIONS).size).toBe(AUDITED_MUTATION_ACTIONS.length)
  })

  test('foundation HTTP route uses safe finance error mapping and org header equality', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../app/api/v1/finance/foundation/commands/route.ts'),
      'utf8',
    )
    expect(source).toContain('mapFinanceErrorToHttp')
    expect(source).toContain('Organization scope mismatch')
    expect(source).toContain("withAuth('client'")
    expect(source).not.toMatch(/withAuth\('admin'/)
  })

  test('server-only finance/payroll collections remain deny-all in firestore.rules', () => {
    const rules = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8')
    for (const collection of [
      'finance_role_assignments',
      'finance_audit_events',
      'payslips',
      'payroll_employees',
      'pay_runs',
      'finance_payments',
    ]) {
      expect(rules).toContain(`match /${collection}/{id} { allow read, write: if false; }`)
    }
  })
})
