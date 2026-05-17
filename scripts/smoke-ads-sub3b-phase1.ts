/**
 * Sub-3b Phase 1 acceptance — list accessible LinkedIn ad accounts.
 *
 * Requires:
 *   SMOKE_LINKEDIN_ACCESS_TOKEN — valid OAuth access token with r_ads scope
 *
 * Run: SMOKE_LINKEDIN_ACCESS_TOKEN=AQX... npx tsx scripts/smoke-ads-sub3b-phase1.ts
 */
import { listAdAccounts } from '@/lib/ads/providers/linkedin/accounts'

async function main() {
  const accessToken = process.env.SMOKE_LINKEDIN_ACCESS_TOKEN
  if (!accessToken) {
    console.log('Set SMOKE_LINKEDIN_ACCESS_TOKEN to run')
    process.exit(0)
  }
  console.log('Listing LinkedIn ad accounts (ACTIVE + DRAFT)…')
  const accounts = await listAdAccounts({ accessToken })
  console.log(`✓ ${accounts.length} ad account(s) accessible:`)
  accounts.forEach((a) => console.log(`  - ${a.id} (${a.name ?? '<unnamed>'}, ${a.currency ?? '?'}, ${a.status ?? '?'})`))
  if (accounts.length === 0) {
    throw new Error('No accessible ad accounts — verify the OAuth grant includes a Marketing Developer Platform-approved account')
  }
  console.log('\nSub-3b Phase 1 acceptance: PASSED')
}

main().catch((err) => {
  console.error('FAILED', err)
  process.exit(1)
})
