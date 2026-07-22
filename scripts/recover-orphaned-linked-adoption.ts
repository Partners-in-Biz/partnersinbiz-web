#!/usr/bin/env tsx
/**
 * Reverse an orphaned pairing+adoption where the server created the device
 * and retired the legacy location, but the runtime never persisted identity
 * (e.g. Linux credential helper failed). Safe only when lastSeenAt is null.
 *
 * Usage:
 *   npx tsx scripts/recover-orphaned-linked-adoption.ts --dry-run \
 *     --device-id 14c59da2-b6e7-44d0-95da-df03dae10525
 *   npx tsx scripts/recover-orphaned-linked-adoption.ts --apply \
 *     --device-id 14c59da2-b6e7-44d0-95da-df03dae10525
 */
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'

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
  const actorUserId = argValue(argv, '--actor-user-id') || PEET_OWNER_USER_ID
  if (!deviceId) throw new Error('Required: --device-id <orphaned-linked-device-id>')

  const { adminDb } = await import('@/lib/firebase/admin')
  const nativeLocationId = `linked-device:${deviceId}`
  const deviceRef = adminDb.collection('linked_devices').doc(deviceId)
  const credentialRef = adminDb.collection('linked_device_credentials').doc(deviceId)
  const nativeLocationRef = adminDb.collection('project_execution_locations').doc(nativeLocationId)

  const [deviceSnap, credentialSnap, nativeLocationSnap, nativeReplicaSnap, grantSnap, mappingSnap] = await Promise.all([
    deviceRef.get(),
    credentialRef.get(),
    nativeLocationRef.get(),
    adminDb.collection('project_location_replicas').where('locationId', '==', nativeLocationId).get(),
    adminDb.collection('linked_device_grants').where('deviceId', '==', deviceId).get(),
    adminDb.collection('linked_device_workspace_mappings').where('deviceId', '==', deviceId).get(),
  ])

  if (!deviceSnap.exists) throw new Error(`device not found: ${deviceId}`)
  const device = deviceSnap.data() ?? {}
  const adoptLocationId = typeof device.adoptedFromLocationId === 'string' ? device.adoptedFromLocationId : null
  if (!adoptLocationId) throw new Error('device has no adoptedFromLocationId; refuse to recover')
  if (device.lastSeenAt != null) {
    throw new Error('device has lastSeenAt set; refuse to recover a device that may have heartbeated')
  }

  const legacyLocationRef = adminDb.collection('project_execution_locations').doc(adoptLocationId)
  const legacyLocationSnap = await legacyLocationRef.get()
  if (!legacyLocationSnap.exists) throw new Error(`legacy location missing: ${adoptLocationId}`)
  const legacy = legacyLocationSnap.data() ?? {}
  if (legacy.replacedByLocationId !== nativeLocationId || legacy.adoptedDeviceId !== deviceId) {
    throw new Error('legacy location is not bound to this orphaned native adoption')
  }

  const legacyReplicaSnap = await adminDb
    .collection('project_location_replicas')
    .where('locationId', '==', adoptLocationId)
    .get()

  const nativeReplicas = nativeReplicaSnap.docs
  const legacyReplicas = legacyReplicaSnap.docs.filter((doc) => {
    const row = doc.data() ?? {}
    return typeof row.replacedByReplicaId === 'string' && row.replacedByReplicaId.length > 0
  })

  const projectIds = Array.from(new Set([
    ...nativeReplicas.map((doc) => String(doc.data()?.projectId || '')),
    ...legacyReplicas.map((doc) => String(doc.data()?.projectId || '')),
  ].filter(Boolean))).sort()

  const projectSnaps = await Promise.all(
    projectIds.map((projectId) => adminDb.collection('projects').doc(projectId).get()),
  )

  const preflight = {
    deviceId,
    adoptLocationId,
    nativeLocationId,
    actorUserId,
    mode: dryRun ? 'dry-run' : 'apply',
    deviceStatus: device.status ?? null,
    deviceLabel: device.label ?? null,
    lastSeenAt: device.lastSeenAt ?? null,
    nativeReplicaCount: nativeReplicas.length,
    legacyReplacedReplicaCount: legacyReplicas.length,
    grantIds: grantSnap.docs.map((doc) => doc.id),
    mappingIds: mappingSnap.docs.map((doc) => doc.id),
    projectCount: projectIds.length,
    credentialExists: credentialSnap.exists,
    nativeLocationExists: nativeLocationSnap.exists,
  }
  console.log(JSON.stringify({ preflight }, null, 2))

  if (dryRun) {
    console.log('\nNo writes performed. Re-run with --apply to reverse the orphaned adoption.')
    return
  }

  const at = Timestamp.now()
  const batch = adminDb.batch()

  for (const doc of nativeReplicas) {
    batch.delete(doc.ref)
  }

  for (const doc of legacyReplicas) {
    const row = doc.data() ?? {}
    batch.update(doc.ref, {
      active: true,
      availability: typeof row.availability === 'string' ? row.availability : 'offline',
      syncStatus: typeof row.syncStatus === 'string' ? row.syncStatus : 'offline',
      replacedByReplicaId: FieldValue.delete(),
      unlinkedAt: FieldValue.delete(),
      unlinkedByUserId: FieldValue.delete(),
      updatedAt: at,
    })
  }

  for (const snap of projectSnaps) {
    if (!snap.exists) continue
    const project = snap.data() ?? {}
    const existing = Array.isArray(project.executionLocationIds)
      ? project.executionLocationIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : []
    const executionLocationIds = Array.from(new Set([
      ...existing.filter((locationId) => locationId !== nativeLocationId),
      adoptLocationId,
    ]))
    const canonicalLocationId = project.canonicalLocationId === nativeLocationId
      ? adoptLocationId
      : project.canonicalLocationId ?? null
    batch.update(snap.ref, {
      executionLocationIds,
      canonicalLocationId,
      updatedAt: at,
    })
  }

  for (const doc of grantSnap.docs) batch.delete(doc.ref)
  for (const doc of mappingSnap.docs) batch.delete(doc.ref)
  if (credentialSnap.exists) batch.delete(credentialRef)
  if (nativeLocationSnap.exists) batch.delete(nativeLocationRef)
  batch.delete(deviceRef)

  batch.update(legacyLocationRef, {
    status: 'active',
    availability: legacy.availability === 'online' ? 'online' : 'offline',
    replacedByLocationId: FieldValue.delete(),
    adoptedDeviceId: FieldValue.delete(),
    retiredAt: FieldValue.delete(),
    retiredByUserId: FieldValue.delete(),
    updatedAt: at,
  })

  batch.create(adminDb.collection('linked_computer_audit_events').doc(randomUUID()), {
    eventId: randomUUID(),
    action: 'adoption.orphaned_recovered',
    actorUserId,
    deviceId,
    adoptedFromLocationId: adoptLocationId,
    nativeLocationId,
    createdAt: at,
  })

  await batch.commit()
  console.log(JSON.stringify({
    result: {
      ok: true,
      recoveredLocationId: adoptLocationId,
      deletedDeviceId: deviceId,
      deletedNativeLocationId: nativeLocationId,
      restoredLegacyReplicas: legacyReplicas.length,
      deletedNativeReplicas: nativeReplicas.length,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Recovery failed')
  process.exitCode = 1
})
