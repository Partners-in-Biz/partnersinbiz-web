/**
 * CLI entry for finance golden paths (hermetic).
 * Usage: npx tsx scripts/finance/e2e-golden-paths.ts
 *        npm run test:finance:e2e:domain
 */
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { runFinanceGoldenPaths } from '../../lib/finance/e2e/golden-paths'

async function main() {
  const report = await runFinanceGoldenPaths()
  const outDir = path.join(process.cwd(), 'artifacts')
  mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'finance-e2e-last-run.json')
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
  console.error(`wrote ${outFile}`)
  if (!report.ok) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
