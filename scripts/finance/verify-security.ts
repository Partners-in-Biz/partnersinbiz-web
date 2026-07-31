/**
 * Development/staging verification for finance/payroll security hardening:
 * role matrix, org/entity/book isolation, payslip boundaries, safe errors,
 * approval inventory, and server-only collection posture.
 * No external payments, SARS, egress, production deploy, or client-visible sends.
 */
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { authorizeFinanceAction, FinanceAuthorizationError } from '../../lib/finance/policy'
import { FinanceNotFoundError, mapFinanceErrorToHttp } from '../../lib/finance/errors'
import { authorizePayslipRead, redactSensitivePayrollRecord } from '../../lib/finance/payroll-access'
import {
  APPROVAL_GATED_ACTIONS,
  AUDITED_MUTATION_ACTIONS,
  assertApprovalActionMapped,
} from '../../lib/finance/security-matrix'
import { matchesExactFinanceScope, normalizeRequiredFinanceScope } from '../../lib/finance/scope'
import type { FinanceActorContext, FinanceScope } from '../../lib/finance/types'

const orgId = 'org-verify-sec'
const scope: Required<FinanceScope> = { orgId, legalEntityId: 'entity-a', bookId: 'book-a' }

function actor(
  uid: string,
  role: FinanceActorContext['assignments'][number]['role'],
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
  }
}

function main() {
  const viewer = actor('v1', 'finance_viewer')
  const clerk = actor('c1', 'payroll_clerk')
  const accountant = actor('a1', 'accountant')

  assert.strictEqual(matchesExactFinanceScope(scope, scope), true)
  assert.strictEqual(matchesExactFinanceScope(scope, { ...scope, orgId: 'other' }), false)
  assert.deepStrictEqual(normalizeRequiredFinanceScope({
    orgId: ' x ', legalEntityId: ' y ', bookId: ' z ',
  }), { orgId: 'x', legalEntityId: 'y', bookId: 'z' })

  authorizeFinanceAction(viewer, scope, 'report.read')
  assert.throws(() => authorizeFinanceAction(viewer, scope, 'journal.post'), FinanceAuthorizationError)
  assert.throws(() => authorizePayslipRead(viewer, scope), FinanceNotFoundError)
  assert.throws(() => authorizePayslipRead(accountant, scope), FinanceNotFoundError)
  authorizePayslipRead(clerk, scope)

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

  const root = path.resolve(__dirname, '../..')
  const route = fs.readFileSync(path.join(root, 'app/api/v1/finance/foundation/commands/route.ts'), 'utf8')
  assert.ok(route.includes('mapFinanceErrorToHttp'))
  assert.ok(route.includes("withAuth('client'"))
  assert.ok(!route.includes("withAuth('admin'"))

  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8')
  for (const collection of ['payslips', 'payroll_employees', 'finance_audit_events', 'finance_role_assignments']) {
    assert.ok(
      rules.includes(`match /${collection}/{id} { allow read, write: if false; }`),
      `${collection} must remain server-only`,
    )
  }

  // Ensure no accidental egress flags in security modules.
  for (const rel of [
    'lib/finance/errors.ts',
    'lib/finance/payroll-access.ts',
    'lib/finance/security-matrix.ts',
    'lib/finance/scope.ts',
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
      'role-matrix-denials',
      'payslip-anti-enumeration',
      'sensitive-field-redaction',
      'safe-error-mapping',
      'approval-inventory',
      'audit-mutation-inventory',
      'foundation-route-safe-errors',
      'server-only-collections',
      'no-egress-flags',
    ],
    approvalGatedActions: APPROVAL_GATED_ACTIONS.length,
    auditedMutationActions: AUDITED_MUTATION_ACTIONS.length,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
    noEgress: true,
  }, null, 2))
}

main()
