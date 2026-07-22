#!/usr/bin/env tsx
/**
 * Create an organisation VPS pairing challenge that adopts partners-vps.
 *
 * Usage:
 *   npx tsx scripts/create-vps-adoption-pairing.ts
 */
import { resolve } from 'node:path'
import { config } from 'dotenv'

const PEET_OWNER_USER_ID = 'zcpAJ4NXWQfjXWPXkl6nYwt7Gmm1'

async function main(): Promise<void> {
  config({ path: resolve(process.cwd(), '.env.local'), quiet: true })
  const { createPairing } = await import('@/lib/linked-computers/crypto')
  const result = await createPairing({
    actorUserId: PEET_OWNER_USER_ID,
    deviceKind: 'vps',
    ownerType: 'organization',
    ownerOrgId: 'pib-platform-owner',
    adoptLocationId: 'partners-vps',
  })
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Pairing create failed')
  process.exitCode = 1
})
