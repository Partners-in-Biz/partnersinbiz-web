/**
 * Vera Phase 6 independent calc + recon audit pack runner.
 * Re-runs Phase 4+5 goldens + expense GL + rev-rec multi-period + bank materialization.
 * EXIT 0 only when all fixtures pass. No SARS submit / payment / auto-post / prod.
 */
import { runAllVeraPhase6Goldens } from '../../lib/finance/audit/vera-phase6-golden-fixtures'

async function main() {
  const summary = await runAllVeraPhase6Goldens()
  const payload = {
    ok: summary.failCount === 0,
    auditId: summary.meta.auditId,
    packageId: summary.meta.packageId,
    taskId: summary.meta.taskId,
    projectId: summary.meta.projectId,
    phase: summary.meta.phase,
    phase45: summary.phase45,
    passCount: summary.passCount,
    failCount: summary.failCount,
    failures: summary.results.filter((r) => !r.pass).map((r) => ({
      domain: r.domain,
      fixtureId: r.fixtureId,
      expected: r.expected,
      actual: r.actual,
      variance: r.variance,
    })),
    fixtureIds: summary.results.map((r) => r.fixtureId),
    materialFindings: summary.materialFindings,
    hardGates: summary.hardGates,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
    autoPosted: false,
    noEgress: true,
  }
  console.log(JSON.stringify(payload, null, 2))
  if (!payload.ok) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
