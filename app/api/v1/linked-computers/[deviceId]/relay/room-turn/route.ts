import { NextRequest, NextResponse } from 'next/server'
import { appendAgentMessage, AppendAgentMessageError } from '@/lib/conversations/append-agent-message'
import { getConversation } from '@/lib/conversations/conversations'
import { agentIdFromProfile } from '@/lib/agent-rooms/projection'
import { getAgentRoomById } from '@/lib/agent-rooms/store'
import { adminDb } from '@/lib/firebase/admin'
import { authenticateSignedDeviceRequest, lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'
import { isRoomMember } from '@/lib/linked-computers/relay-queue'
import { orgFeatureFlagEnabled } from '@/lib/organizations/feature-flags'

type Context = { params: Promise<{ deviceId: string }> }

export async function handleRelayRoomTurn(
  req: NextRequest,
  deviceId: string,
  auth = authenticateSignedDeviceRequest,
): Promise<Response> {
  try {
    const rawBody = await req.text()
    const identity = await auth(req, deviceId, rawBody)
    if (identity.deviceId !== deviceId) throw new Error('linked computers: tenant scope mismatch')

    const body = JSON.parse(rawBody) as Record<string, unknown>
    const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : ''
    const profile = typeof body.profile === 'string' ? body.profile.trim() : ''
    const text = typeof body.text === 'string' ? body.text : ''
    if (!roomId || !profile) {
      return NextResponse.json(
        { success: false, error: 'roomId and profile are required' },
        { status: 400, headers: noStoreHeaders },
      )
    }

    const agentId = agentIdFromProfile(profile)
    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'profile does not name a known agent' },
        { status: 400, headers: noStoreHeaders },
      )
    }

    const room = await getAgentRoomById(roomId)
    if (!room || room.status !== 'active') {
      return NextResponse.json(
        { success: false, error: 'Agent room not found' },
        { status: 404, headers: noStoreHeaders },
      )
    }
    if (!(await orgFeatureFlagEnabled(room.orgId, 'agentRoomsEnabled'))) {
      return NextResponse.json(
        { success: false, error: 'feature_disabled' },
        { status: 404, headers: noStoreHeaders },
      )
    }
    if (!isRoomMember(room, { agentId, deviceId })) {
      return NextResponse.json(
        { success: false, error: 'These agents are not in a shared room.', reason: 'not_teammates' },
        { status: 403, headers: noStoreHeaders },
      )
    }
    if (!room.conversationId) {
      return NextResponse.json(
        { success: false, error: 'Agent room has no mirror conversation' },
        { status: 404, headers: noStoreHeaders },
      )
    }

    const conversation = await getConversation(room.conversationId)
    if (!conversation || conversation.orgId !== room.orgId) {
      return NextResponse.json(
        { success: false, error: 'Conversation not found' },
        { status: 404, headers: noStoreHeaders },
      )
    }

    const deviceSnap = await adminDb.collection('linked_devices').doc(deviceId).get()
    const label = typeof deviceSnap.data()?.label === 'string' && deviceSnap.data()!.label.trim()
      ? String(deviceSnap.data()!.label).trim()
      : deviceId

    const message = await appendAgentMessage({
      convId: room.conversationId,
      agentId,
      content: text,
      richParts: body.richParts ?? body.rich_parts ?? body.parts,
      deviceBadge: { deviceId, label },
    })

    return NextResponse.json({
      success: true,
      data: { message },
    }, { status: 201, headers: noStoreHeaders })
  } catch (error) {
    if (error instanceof AppendAgentMessageError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.status, headers: noStoreHeaders },
      )
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: 'Linked computer request invalid' },
        { status: 400, headers: noStoreHeaders },
      )
    }
    return lifecycleError(error)
  }
}

export const POST = async (req: NextRequest, context: Context) => (
  handleRelayRoomTurn(req, (await context.params).deviceId)
)
