#!/usr/bin/env tsx
/**
 * Adopt a legacy project execution location onto an already-paired linked device.
 *
 * Use this when Messages shows "Legacy · pairing required" but the Mac/VPS is
 * already authenticated in Linked Computers. Sync is a separate gate.
 *
 * Usage:
 *   npx tsx scripts/adopt-project-location-onto-device.ts --dry-run \
 *     --device-id <linked-device-id> --location-id peets-mac-mini
 *   npx tsx scripts/adopt-project-location-onto-device.ts --apply \
 *     --device-id <linked-device-id> --location-id peets-mac-mini
 *   npx tsx scripts/adopt-project-location-onto-device.ts --apply \
 *     --device-id <linked-device-id> --location-id partners-vps \
 *     --actor-user-id zcpAJ4NXWQfjXWPXkl6nYwt7Gmm1
 */
import { resolve } from 'node:path'
import { config } from 'dotenv'

const PEET_OWNER_USER_ID = 'zcpAJ4NXWQfjXWPXkl6nYwt7Gmm1'

function argValue(argv: string[], name: string): string | null {
  const index = argv.indexOf(name)
  if (index < 0) return null
  const value = argv[index + 1]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function main(): Promise<void> {
  config({ path: resolve(process.cwd(), '.env.local'), quiet: true })
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const dryRun = !apply || argv.includes('--dry-run')
  const deviceId = argValue(argv, '--device-id')
  const locationId = argValue(argv, '--location-id')
  const actorUserId = argValue(argv, '--actor-user-id') || PEET_OWNER_USER_ID
  if (!deviceId || !locationId) {
    throw new Error('Required: --device-id <id> --location-id <legacy-location-id>')
  }

  const { adminDb } = await import('@/lib/firebase/admin')
  const deviceSnap = await adminDb.collection('linked_devices').doc(deviceId).get()
  const locationSnap = await adminDb.collection('project_execution_locations').doc(locationId).get()
  const nativeLocationId = `linked-device:${deviceId}`
  const nativeSnap = await adminDb.collection('project_execution_locations').doc(nativeLocationId).get()
  const replicaSnap = await adminDb.collection('project_location_replicas')
    .where('locationId', '==', locationId)
    .get()
  const activeReplicas = replicaSnap.docs.filter((doc) => doc.data()?.active === true)

  const preflight = {
    deviceId,
    locationId,
    actorUserId,
    deviceExists: deviceSnap.exists,
    deviceStatus: deviceSnap.data()?.status ?? null,
    deviceKind: deviceSnap.data()?.deviceKind ?? null,
    deviceLabel: deviceSnap.data()?.label ?? null,
    locationExists: locationSnap.exists,
    locationStatus: locationSnap.data()?.status ?? null,
    locationLabel: locationSnap.data()?.label ?? null,
    nativeLocationExists: nativeSnap.exists,
    activeReplicaCount: activeReplicas.length,
    mode: dryRun ? 'dry-run' : 'apply',
  }
  console.log(JSON.stringify({ preflight }, null, 2))

  if (dryRun) {
    console.log('\nNo writes performed. Re-run with --apply to adopt.')
    return
  }

  const { adoptLegacyLocationOntoLinkedDevice } = await import('@/lib/linked-computers/crypto')
  const result = await adoptLegacyLocationOntoLinkedDevice({
    actorUserId,
    deviceId,
    adoptLocationId: locationId,
  })
  console.log(JSON.stringify({ result }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Adoption failed')
  process.exitCode = 1
})
