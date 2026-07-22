import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { putWorkspaceMapping } from '@/lib/linked-computers/store'
import { lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { randomUUID } from 'node:crypto'

type Context = { params: Promise<{ deviceId: string }> }
export async function handleDeviceMapping(req: NextRequest, user: { uid: string }, deviceId: string, put = putWorkspaceMapping): Promise<Response> {
  try {
    const body = await req.json()
    if (![body.orgId, body.workspaceId, body.label].every((v) => typeof v === 'string')) throw new Error('linked computers: invalid mapping')
    const label = String(body.label).trim()
    if (!label) throw new Error('linked computers: invalid mapping')
    const existingMappingId = typeof body.mappingId === 'string' ? body.mappingId.trim() : ''
    if (existingMappingId) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(existingMappingId)) throw new Error('linked computers: invalid mapping')
      const status = body.status === 'pending' || body.status === 'active' ? body.status : 'active'
      await put({
        mappingId: existingMappingId,
        deviceId,
        orgId: body.orgId,
        workspaceId: body.workspaceId,
        actorUserId: user.uid,
        label,
        status,
      })
      return NextResponse.json({ success: true, data: { mappingId: existingMappingId, status } }, { headers: noStoreHeaders })
    }
    const mappingId = randomUUID()
    await put({ mappingId, deviceId, orgId: body.orgId, workspaceId: body.workspaceId, actorUserId: user.uid, label, status: 'pending' })
    return NextResponse.json({ success: true, data: { mappingId, status: 'pending' } }, { headers: noStoreHeaders })
  } catch (error) { return lifecycleError(error) }
}
export const PUT = withAuth('client', async (req: NextRequest, user, context: Context) => handleDeviceMapping(req, user, (await context.params).deviceId))
