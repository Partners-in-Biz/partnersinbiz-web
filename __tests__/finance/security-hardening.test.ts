import { FinanceValidationError } from '@/lib/accounting/foundation'
import {
  FinanceAuthorizationError,
  ACTION_ROLES_FOR_COVERAGE,
  authorizeFinanceAction,
  effectiveFinanceAssignments,
  type FinanceAction,
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
  authorizeEmployeeRead,
  authorizeExportManifestRead,
  authorizePayslipRead,
  authorizeStatutoryRead,
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
import { checkFinanceCommandOrgScope } from '@/lib/finance/http-guards'
import {
  FINANCE_HTTP_ENTRYPOINTS,
  FINANCE_UI_BOUNDARY_NOTE,
  FINANCE_UI_SHIPPED,
  SERVICE_ONLY_FINANCE_MODULES,
} from '@/lib/finance/service-boundaries'
import type { FinanceActorContext, FinanceRole, FinanceScope } from '@/lib/finance/types'
import fs from 'fs'
import path from 'path'

const orgId = 'org-sec'
const scope: Required<FinanceScope> = { orgId, legalEntityId: 'entity-a', bookId: 'book-a' }
const ROOT = path.join(__dirname, '../..')

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
  test('full ACTION_ROLES coverage is non-empty for every FinanceAction', () => {
    const actions = Object.keys(ACTION_ROLES_FOR_COVERAGE) as FinanceAction[]
    expect(actions.length).toBeGreaterThan(40)
    for (const action of actions) {
      expect(ACTION_ROLES_FOR_COVERAGE[action].length).toBeGreaterThan(0)
    }
  })

  test('payroll_clerk vs payroll_approver vs finance_viewer matrix samples', () => {
    const viewer = actor('viewer-1', 'finance_viewer')
    const clerk = actor('clerk-1', 'payroll_clerk')
    const approver = actor('pap-1', 'payroll_approver')

    expect(() => authorizeFinanceAction(viewer, scope, 'report.read')).not.toThrow()
    expect(() => authorizeFinanceAction(viewer, scope, 'journal.post')).toThrow(FinanceAuthorizationError)
    expect(() => authorizeFinanceAction(viewer, scope, 'payroll.run.approve')).toThrow(FinanceAuthorizationError)
    expect(() => authorizeFinanceAction(viewer, scope, 'payroll.run.create')).toThrow(FinanceAuthorizationError)
    expect(() => authorizePayslipRead(viewer, scope)).toThrow(FinanceNotFoundError)

    expect(() => authorizeFinanceAction(clerk, scope, 'payroll.run.create')).not.toThrow()
    expect(() => authorizeFinanceAction(clerk, scope, 'payroll.run.submit')).not.toThrow()
    expect(() => authorizeFinanceAction(clerk, scope, 'payroll.run.approve')).toThrow(FinanceAuthorizationError)
    expect(() => authorizeFinanceAction(clerk, scope, 'payroll.run.reverse')).toThrow(FinanceAuthorizationError)
    expect(() => authorizePayslipRead(clerk, scope)).not.toThrow()
    expect(() => authorizeEmployeeRead(clerk, scope)).not.toThrow()

    expect(() => authorizeFinanceAction(approver, scope, 'payroll.run.approve')).not.toThrow()
    expect(() => authorizeFinanceAction(approver, scope, 'payroll.run.reverse')).not.toThrow()
    expect(() => authorizeFinanceAction(approver, scope, 'payroll.statutory.approve')).not.toThrow()
    expect(() => authorizePayslipRead(approver, scope)).not.toThrow()
  })

  test('accountant cannot read payslips or employees; payroll roles can', () => {
    const accountant = actor('acct-1', 'accountant')
    const clerk = actor('clerk-1', 'payroll_clerk')
    const payrollApprover = actor('pap-1', 'payroll_approver')
    expect(() => authorizeFinanceAction(accountant, scope, 'invoice.read')).not.toThrow()
    expect(() => authorizePayslipRead(accountant, scope)).toThrow(FinanceNotFoundError)
    expect(() => authorizeEmployeeRead(accountant, scope)).toThrow(FinanceNotFoundError)
    expect(() => authorizePayslipRead(clerk, scope)).not.toThrow()
    expect(() => authorizePayslipRead(payrollApprover, scope)).not.toThrow()
    expect(listPayslipReadableRoles()).toEqual(
      expect.arrayContaining(['finance_admin', 'payroll_clerk', 'payroll_approver']),
    )
    expect(listPayslipReadableRoles()).not.toEqual(expect.arrayContaining(['finance_viewer', 'accountant', 'bookkeeper']))
  })

  test('statutory and export reads deny finance_viewer with non-enumerating 404', () => {
    const viewer = actor('viewer-stat', 'finance_viewer')
    const clerk = actor('clerk-stat', 'payroll_clerk')
    expect(() => authorizeStatutoryRead(viewer, scope)).toThrow(FinanceNotFoundError)
    expect(() => authorizeExportManifestRead(viewer, scope)).toThrow(FinanceNotFoundError)
    try {
      authorizeStatutoryRead(viewer, scope)
    } catch (error) {
      expect((error as Error).message).toBe('Statutory record not found')
      expect((error as Error).message).not.toMatch(/permission|role|forbidden/i)
    }
    try {
      authorizeExportManifestRead(viewer, scope)
    } catch (error) {
      expect((error as Error).message).toBe('Export manifest not found')
    }
    expect(() => authorizeStatutoryRead(clerk, scope)).not.toThrow()
    expect(() => authorizeExportManifestRead(clerk, scope)).not.toThrow()
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

  test('revoked and expired assignments fail closed', () => {
    const revoked = actor('rev-1', 'accountant', {
      assignments: [{
        id: 'rev-1-a0',
        orgId,
        userId: 'rev-1',
        legalEntityId: scope.legalEntityId,
        scopeMode: 'entity',
        role: 'accountant',
        status: 'revoked',
      }],
    })
    const expired = actor('exp-1', 'accountant', {
      assignments: [{
        id: 'exp-1-a0',
        orgId,
        userId: 'exp-1',
        legalEntityId: scope.legalEntityId,
        scopeMode: 'entity',
        role: 'accountant',
        status: 'active',
        effectiveFrom: '2020-01-01T00:00:00.000Z',
        effectiveTo: '2020-12-31T23:59:59.000Z',
      }],
    })
    expect(() => authorizeFinanceAction(revoked, scope, 'journal.post', '2026-07-31T10:00:00.000Z'))
      .toThrow(/No active finance assignment/)
    expect(() => authorizeFinanceAction(expired, scope, 'journal.post', '2026-07-31T10:00:00.000Z'))
      .toThrow(/No active finance assignment/)
  })

  test('delegation must grant exact finance action or finance:* and match org', () => {
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
    const wrongOrg = { ...delegated, delegationOrgId: 'org-other' }
    expect(() => authorizeFinanceAction(wrongOrg, scope, 'journal.post'))
      .toThrow(/Delegation organization does not match/)
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
      path.join(ROOT, 'app/api/v1/finance/foundation/commands/route.ts'),
      'utf8',
    )
    const helper = fs.readFileSync(path.join(ROOT, 'lib/finance/http-command.ts'), 'utf8')
    expect(source).toContain("from '@/lib/finance/http-command'")
    expect(source).toContain("withAuth('client'")
    expect(source).not.toMatch(/withAuth\('admin'/)
    expect(helper).toContain('mapFinanceErrorToHttp')
    expect(helper).toContain('checkFinanceCommandOrgScope')
  })

  test('HTTP org scope guard rejects missing org and header mismatch', () => {
    expect(checkFinanceCommandOrgScope(undefined, null)).toEqual({
      ok: false, status: 422, error: 'command.orgId is required',
    })
    expect(checkFinanceCommandOrgScope('org-a', 'org-b')).toEqual({
      ok: false, status: 403, error: 'Organization scope mismatch',
    })
    expect(checkFinanceCommandOrgScope(' org-a ', 'org-a')).toEqual({ ok: true, orgId: 'org-a' })
    expect(checkFinanceCommandOrgScope('org-a', null)).toEqual({ ok: true, orgId: 'org-a' })
  })

  test('server-only finance/payroll collections remain deny-all in firestore.rules', () => {
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8')
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

describe('HTTP / service / UI boundaries', () => {
  test('only allowlisted finance HTTP entrypoints exist under app/api', () => {
    const financeApiRoot = path.join(ROOT, 'app/api/v1/finance')
    const found: string[] = []
    function walk(dir: string) {
      if (!fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name === 'route.ts' || entry.name === 'route.js') {
          found.push(path.relative(ROOT, full).split(path.sep).join('/'))
        }
      }
    }
    walk(financeApiRoot)
    expect(found.sort()).toEqual([...FINANCE_HTTP_ENTRYPOINTS].sort())
    for (const entry of FINANCE_HTTP_ENTRYPOINTS) {
      const source = fs.readFileSync(path.join(ROOT, entry), 'utf8')
      const usesSharedHelper = source.includes("from '@/lib/finance/http-command'")
      expect(
        usesSharedHelper || source.includes('checkFinanceCommandOrgScope'),
      ).toBe(true)
      expect(
        usesSharedHelper || source.includes('mapFinanceErrorToHttp'),
      ).toBe(true)
      expect(source).toContain("withAuth('client'")
    }
    // Shared finance HTTP helper must enforce org scope + safe error mapping.
    const helper = fs.readFileSync(path.join(ROOT, 'lib/finance/http-command.ts'), 'utf8')
    expect(helper).toContain('checkFinanceCommandOrgScope')
    expect(helper).toContain('mapFinanceErrorToHttp')
  })

  test('service-only finance modules are not imported from app routes outside allowlist', () => {
    const appRoot = path.join(ROOT, 'app')
    const offenders: string[] = []
    const importPattern = new RegExp(
      SERVICE_ONLY_FINANCE_MODULES.map((m) => m
        .replace(/^lib\//, '')
        .replace(/\.ts$/, '')
        .replace(/\//g, '[/\\\\]')).join('|'),
    )
    function walk(dir: string) {
      if (!fs.existsSync(dir)) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          const rel = path.relative(ROOT, full).split(path.sep).join('/')
          if (FINANCE_HTTP_ENTRYPOINTS.includes(rel as typeof FINANCE_HTTP_ENTRYPOINTS[number])) continue
          const source = fs.readFileSync(full, 'utf8')
          // foundation route may import foundation repository/service types — only flag payroll/docs/IC/tax/reporting service paths
          if (/lib\/payroll\/|payroll\/pay-run-service|payroll\/statutory-service|documents-service|intercompany-service|tax-service|reporting-service/.test(source)
            && /from ['"]@\/lib\/(payroll|accounting)\//.test(source)) {
            // foundation repository is allowed on foundation route only — already skipped allowlist
            if (/foundation-service|firestore-foundation-repository/.test(source)
              && !/pay-run-service|statutory-service|documents-service|intercompany-service|tax-service|reporting-service/.test(source)) {
              continue
            }
            if (/pay-run-service|statutory-service|documents-service|intercompany-service|tax-service|reporting-service|calculation-service/.test(source)) {
              offenders.push(rel)
            }
          }
          void importPattern
        }
      }
    }
    walk(appRoot)
    expect(offenders).toEqual([])
  })

  test('finance foundation UI is shipped; payroll UI remains staged', () => {
    expect(FINANCE_UI_SHIPPED).toBe(true)
    expect(FINANCE_UI_BOUNDARY_NOTE).toMatch(/foundation workbench shipped/i)
    expect(fs.existsSync(path.join(ROOT, 'app/(portal)/portal/finance/page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'app/(portal)/portal/finance/setup/page.tsx'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'app/(portal)/portal/finance/ledger/page.tsx'))).toBe(true)
    // Full payroll/tax/intercompany portal modules remain unshipped as dedicated screens.
    expect(fs.existsSync(path.join(ROOT, 'app/(portal)/portal/finance/payroll'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'app/(portal)/portal/payroll'))).toBe(false)
  })
})

// Keep type import used for coverage compilation.
void (null as unknown as FinanceRole)
