import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { getRuntimeChannelConfig } from '@/lib/linked-computers/runtime-config'
import { deviceReleaseChannel } from '@/lib/linked-computers/runtime-targets'
import type { LinkedDevice } from '@/lib/linked-computers/types'

type Context = { params: Promise<{ deviceId: string }> }

async function defaultLoadDevice(deviceId: string): Promise<LinkedDevice> {
  const snap = await adminDb.collection('linked_devices').doc(deviceId).get()
  if (!snap.exists) throw new Error('linked computers: device not found')
  const row = snap.data() ?? {}
  return { ...row, deviceId } as LinkedDevice
}

export async function handleDeviceRuntimeConfig(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
  loadDevice: (id: string) => Promise<LinkedDevice> = defaultLoadDevice,
  getConfig = getRuntimeChannelConfig,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')
    const device = await loadDevice(deviceId)
    const channel = deviceReleaseChannel(device)
    const config = await getConfig(channel)
    return NextResponse.json({
      success: true,
      data: {
        channel,
        hermes: config.hermes,
        runtimeMinVersion: config.runtimeMinVersion,
        serverTime: new Date().toISOString(),
      },
    }, { headers: noStoreHeaders })
  } catch (error) {
    return lifecycleError(error)
  }
}

export const GET = async (req: NextRequest, context: Context) => (
  handleDeviceRuntimeConfig(req, (await context.params).deviceId)
)
