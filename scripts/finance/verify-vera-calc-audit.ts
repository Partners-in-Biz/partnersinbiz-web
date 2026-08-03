/**
 * Vera independent calc audit pack runner.
 * EXIT 0 only when all golden fixtures pass. No SARS submit / payment.
 */
import { runAllVeraPhase45Goldens } from '../../lib/finance/audit/vera-phase45-golden-fixtures'

function main() {
  const summary = runAllVeraPhase45Goldens()
  const payload = {
    ok: summary.failCount === 0,
    auditId: summary.meta.auditId,
    packageId: summary.meta.packageId,
    packageTaxYearLabel: summary.meta.packageTaxYearLabel,
    packageMatches2025_26Tables: summary.packageMatches2025_26Tables,
    packageMatches2026_27Tables: summary.packageMatches2026_27Tables,
    passCount: summary.passCount,
    failCount: summary.failCount,
    failures: summary.results.filter((r) => !r.pass),
    materialFindings: summary.materialFindings,
    hardGates: summary.meta.hardGates,
    externalPaymentInitiated: false,
    sarsSubmissionInitiated: false,
    noEgress: true,
  }
  console.log(JSON.stringify(payload, null, 2))
  if (!payload.ok) {
    process.exitCode = 1
  }
}

main()
