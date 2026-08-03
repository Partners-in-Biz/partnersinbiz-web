import { execFileSync } from 'child_process'
import path from 'path'

/**
 * Runs hermetic domain golden paths before Playwright UI assertions.
 * Writes artifacts/finance-e2e-last-run.json for the browser specs to read.
 */
export default async function globalSetup() {
  const root = process.cwd()
  execFileSync('npx', ['tsx', 'scripts/finance/e2e-golden-paths.ts'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    timeout: 180_000,
  })
  const reportPath = path.join(root, 'artifacts', 'finance-e2e-last-run.json')
  process.env.FINANCE_E2E_REPORT_PATH = reportPath
}
