/**
 * Development/staging verification for finance/payroll security hardening:
 * role matrix, org/entity/book isolation, payslip/statutory/export boundaries,
 * safe errors, approval inventory, HTTP org guards, and service-only posture.
 * No external payments, SARS, egress, production deploy, or client-visible sends.
 */
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import {
  authorizeFinanceAction,
  ACTION_ROLES_FOR_COVERAGE,
  FinanceAuthorizationError,
  type FinanceAction,
} from '../../lib/finance/policy'
import { FinanceNotFoundError, mapFinanceErrorToHttp } from '../../lib/finance/errors'
import {
  authorizeEmployeeRead,
  authorizeExportManifestRead,
  authorizePayslipRead,
  authorizeStatutoryRead,
  redactSensitivePayrollRecord,
} from '../../lib/finance/payroll-access'
import {
  APPROVAL_GATED_ACTIONS,
  AUDITED_MUTATION_ACTIONS,
  assertApprovalActionMapped,
} from '../../lib/finance/security-matrix'
import { matchesExactFinanceScope, normalizeRequiredFinanceScope } from '../../lib/finance/scope'
import { checkFinanceCommandOrgScope } from '../../lib/finance/http-guards'
import {
  FINANCE_HTTP_ENTRYPOINTS,
  FINANCE_UI_BOUNDARY_NOTE,
  FINANCE_UI_SHIPPED,
  SERVICE_ONLY_FINANCE_MODULES,
} from '../../lib/finance/service-boundaries'
import type { FinanceActorContext, FinanceScope } from '../../lib/finance/types'

const orgId = 'org-verify-sec'
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

function main() {
  const viewer = actor('v1', 'finance_viewer')
  const clerk = actor('c1', 'payroll_clerk')
  const approver = actor('p1', 'payroll_approver')
  const accountant = actor('a1', 'accountant')

  assert.strictEqual(matchesExactFinanceScope(scope, scope), true)
  assert.strictEqual(matchesExactFinanceScope(scope, { ...scope, orgId: 'other' }), false)
  assert.deepStrictEqual(normalizeRequiredFinanceScope({
    orgId: ' x ', legalEntityId: ' y ', bookId: ' z ',
  }), { orgId: 'x', legalEntityId: 'y', bookId: 'z' })

  const actions = Object.keys(ACTION_ROLES_FOR_COVERAGE) as FinanceAction[]
  assert.ok(actions.length >= 40, 'role matrix must cover full FinanceAction set')
  for (const action of actions) {
    assert.ok(ACTION_ROLES_FOR_COVERAGE[action].length > 0, `${action} must have roles`)
  }

  authorizeFinanceAction(viewer, scope, 'report.read')
  assert.throws(() => authorizeFinanceAction(viewer, scope, 'journal.post'), FinanceAuthorizationError)
  assert.throws(() => authorizeFinanceAction(viewer, scope, 'payroll.run.approve'), FinanceAuthorizationError)
  assert.throws(() => authorizeFinanceAction(clerk, scope, 'payroll.run.approve'), FinanceAuthorizationError)
  authorizeFinanceAction(approver, scope, 'payroll.run.approve')
  authorizeFinanceAction(clerk, scope, 'payroll.run.create')

  assert.throws(() => authorizePayslipRead(viewer, scope), FinanceNotFoundError)
  assert.throws(() => authorizePayslipRead(accountant, scope), FinanceNotFoundError)
  assert.throws(() => authorizeEmployeeRead(accountant, scope), FinanceNotFoundError)
  authorizePayslipRead(clerk, scope)
  authorizeEmployeeRead(clerk, scope)
  assert.throws(() => authorizeStatutoryRead(viewer, scope), FinanceNotFoundError)
  assert.throws(() => authorizeExportManifestRead(viewer, scope), FinanceNotFoundError)
  authorizeStatutoryRead(clerk, scope)
  authorizeExportManifestRead(clerk, scope)

  const wrongDelegation = actor('d1', 'accountant', {
    delegationId: 'dlg',
    delegationOrgId: 'org-other',
    delegationScopes: ['finance:journal.post'],
  })
  assert.throws(
    () => authorizeFinanceAction(wrongDelegation, scope, 'journal.post'),
    /Delegation organization does not match/,
  )
  const expired = actor('e1', 'accountant', {
    assignments: [{
      id: 'e1-a0',
      orgId,
      userId: 'e1',
      legalEntityId: scope.legalEntityId,
      scopeMode: 'entity',
      role: 'accountant',
      status: 'active',
      effectiveTo: '2020-01-01T00:00:00.000Z',
    }],
  })
  assert.throws(
    () => authorizeFinanceAction(expired, scope, 'journal.post', '2026-07-31T10:00:00.000Z'),
    /No active finance assignment/,
  )

  const redacted = redactSensitivePayrollRecord({
    displayName: 'Ada',
    bankAccountNumber: '123',
    taxNumber: '456',
  })
  assert.strictEqual(redacted.displayName, 'Ada')
  assert.strictEqual(redacted.bankAccountNumber, '[redacted]')
  assert.strictEqual(redacted.taxNumber, '[redacted]')

  const forbidden = mapFinanceErrorToHttp(new FinanceAuthorizationError('nope'))
  assert.strictEqual(forbidden.status, 403)
  const missing = mapFinanceErrorToHttp(new FinanceNotFoundError('Payslip not found'))
  assert.strictEqual(missing.status, 404)
  assert.strictEqual(missing.error, 'Payslip not found')
  const internal = mapFinanceErrorToHttp(new Error('/secret/path'))
  assert.strictEqual(internal.status, 500)
  assert.strictEqual(internal.error, 'Finance request failed')

  for (const action of APPROVAL_GATED_ACTIONS) assertApprovalActionMapped(action)
  assert.ok(AUDITED_MUTATION_ACTIONS.includes('payroll.run.approve'))
  assert.ok(AUDITED_MUTATION_ACTIONS.includes('journal.post'))
  assert.ok(AUDITED_MUTATION_ACTIONS.includes('payroll.statutory.approve'))

  assert.deepStrictEqual(checkFinanceCommandOrgScope(undefined, null), {
    ok: false, status: 422, error: 'command.orgId is required',
  })
  assert.deepStrictEqual(checkFinanceCommandOrgScope('org-a', 'org-b'), {
    ok: false, status: 403, error: 'Organization scope mismatch',
  })
  assert.deepStrictEqual(checkFinanceCommandOrgScope('org-a', 'org-a'), {
    ok: true, orgId: 'org-a',
  })

  const root = path.resolve(__dirname, '../..')
  for (const entry of FINANCE_HTTP_ENTRYPOINTS) {
    const route = fs.readFileSync(path.join(root, entry), 'utf8')
    const usesSharedHelper = route.includes("from '@/lib/finance/http-command'")
    assert.ok(
      usesSharedHelper || route.includes('mapFinanceErrorToHttp'),
      `${entry} safe errors`,
    )
    assert.ok(
      usesSharedHelper || route.includes('checkFinanceCommandOrgScope'),
      `${entry} org guard`,
    )
    assert.ok(route.includes("withAuth('client'"), `${entry} client auth`)
    assert.ok(!route.includes("withAuth('admin'"), `${entry} must not be admin-only`)
  }
  const helper = fs.readFileSync(path.join(root, 'lib/finance/http-command.ts'), 'utf8')
  assert.ok(helper.includes('mapFinanceErrorToHttp'))
  assert.ok(helper.includes('checkFinanceCommandOrgScope'))

  // Discover any extra finance HTTP routes not in inventory.
  const financeApi = path.join(root, 'app/api/v1/finance')
  const discovered: string[] = []
  function walk(dir: string) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'route.ts') {
        discovered.push(path.relative(root, full).split(path.sep).join('/'))
      }
    }
  }
  walk(financeApi)
  assert.deepStrictEqual(discovered.sort(), [...FINANCE_HTTP_ENTRYPOINTS].sort())

  const payslipSource = fs.readFileSync(path.join(root, 'lib/payroll/pay-run-service.ts'), 'utf8')
  assert.ok(payslipSource.includes('authorizePayslipRead'))
  assert.ok(/getPayslip\(\s*actor:/.test(payslipSource) || payslipSource.includes('getPayslip(\n    actor:'))
  const statutorySource = fs.readFileSync(path.join(root, 'lib/payroll/statutory-service.ts'), 'utf8')
  assert.ok(statutorySource.includes('authorizeStatutoryRead'))
  assert.ok(statutorySource.includes('authorizeExportManifestRead'))

  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
  for (const collection of ['payslips', 'payroll_employees', 'finance_audit_events', 'finance_role_assignments']) {
    assert.ok(
      rules.includes(`match /${collection}/{id} { allow read, write: if false; }`),
      `${collection} must remain server-only`,
    )
  }

  assert.strictEqual(FINANCE_UI_SHIPPED, true)
  assert.ok(/foundation workbench shipped/i.test(FINANCE_UI_BOUNDARY_NOTE))
  assert.ok(SERVICE_ONLY_FINANCE_MODULES.includes('lib/payroll/pay-run-service.ts'))
  assert.ok(fs.existsSync(path.join(root, 'app/(portal)/portal/finance/page.tsx')))
  assert.ok(!fs.existsSync(path.join(root, 'app/(portal)/portal/finance/payroll')))

  for (const rel of [
    'lib/finance/errors.ts',
    'lib/finance/payroll-access.ts',
    'lib/finance/security-matrix.ts',
    'lib/finance/scope.ts',
    'lib/finance/http-guards.ts',
    'lib/finance/service-boundaries.ts',
  ]) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8')
    assert.ok(!/externalPaymentInitiated:\s*true/.test(src))
    assert.ok(!/sarsSubmissionInitiated:\s*true/.test(src))
    assert.ok(!/externalEgressAllowed:\s*true/.test(src))
  }

  console.log(JSON.stringify({
    ok: true,
    checks: [
      'exact-scope-isolation',
      'full-role-matrix-coverage',
      'clerk-approver-viewer-denials',
      'payslip-employee-anti-enumeration',
      'statutory-export-read-auth',
      'delegation-org-and-expired-assignment',
      'sensitive-field-redaction',
      'safe-error-mapping',
      'approval-inventory',
      'audit-mutation-inventory',
      'http-org-scope-guard',
      'finance-http-entrypoint-inventory',
      'payslip-statutory-getter-auth',
      'server-only-collections',
      'service-only-ui-boundary',
      'no-egress-flags',
    ],
    approvalGatedActions: APPROVAL_GATED_ACTIONS.length,
    auditedMutationActions: AUDITED_MUTATION_ACTIONS.length,
    financeHttpEntrypoints: FINANCE_HTTP_ENTRYPOINTS.length,
    financeUiShipped: FINANCE_UI_SHIPPED,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
    noEgress: true,
  }, null, 2))
}

main()
