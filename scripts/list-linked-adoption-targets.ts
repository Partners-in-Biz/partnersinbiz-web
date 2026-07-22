import { resolve } from 'node:path'
import { config } from 'dotenv'

async function main() {
  config({ path: resolve(process.cwd(), '.env.local'), quiet: true })
  const { adminDb } = await import('@/lib/firebase/admin')
  const devices = await adminDb.collection('linked_devices').limit(20).get()
  console.log('devices', JSON.stringify(devices.docs.map((d) => {
    const x = d.data()
    return {
      id: d.id,
      label: x.label,
      kind: x.deviceKind,
      ownerType: x.ownerType,
      status: x.status,
      platform: x.platform,
      adoptedFrom: x.adoptedFromLocationId || null,
      runtime: x.runtimeVersion,
    }
  }), null, 2))
  const locs = await adminDb.collection('project_execution_locations').limit(40).get()
  console.log('locations', JSON.stringify(locs.docs.map((d) => {
    const x = d.data()
    return {
      id: d.id,
      label: x.label,
      kind: x.kind,
      status: x.status,
      runtimeTargetId: x.runtimeTargetId,
      replacedBy: x.replacedByLocationId || null,
      nativeDeviceId: x.nativeDeviceId || null,
    }
  }), null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
