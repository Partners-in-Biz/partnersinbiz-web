import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { createPairing } from '@/lib/linked-computers/crypto'

export const dynamic = 'force-dynamic'

type CreatePairingFn = typeof createPairing
type PairingCreateInput = {
  deviceKind?: 'computer' | 'vps'
  ownerType?: 'user' | 'organization'
  ownerOrgId?: string
  orgId?: string
  agentIds?: string[]
  adoptLocationId?: string
}

export async function handlePairingCreate(
  user: { uid: string },
  inputOrCreate: PairingCreateInput | CreatePairingFn = {},
  create: CreatePairingFn = createPairing,
): Promise<Response> {
  try {
    const input = typeof inputOrCreate === 'function' ? {} : inputOrCreate
    const createFn = typeof inputOrCreate === 'function' ? inputOrCreate : create
    const deviceKind = input.deviceKind ?? 'computer'
    const ownerType = input.ownerType ?? 'user'
    if (!['computer', 'vps'].includes(deviceKind) || !['user', 'organization'].includes(ownerType)) {
      return NextResponse.json({ success: false, error: 'Invalid pairing options' }, { status: 400 })
    }
    const ownerOrgId = ownerType === 'organization' && typeof input.ownerOrgId === 'string'
      ? input.ownerOrgId.trim()
      : undefined
    if (ownerType === 'organization' && !ownerOrgId) {
      return NextResponse.json({ success: false, error: 'Organisation is required' }, { status: 400 })
    }
    const adoptLocationId = typeof input.adoptLocationId === 'string' ? input.adoptLocationId.trim() : undefined
    if (adoptLocationId && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(adoptLocationId)) {
      return NextResponse.json({ success: false, error: 'Invalid project location' }, { status: 400 })
    }
    const orgId = typeof input.orgId === 'string' ? input.orgId.trim() : ''
    const agentIds = Array.isArray(input.agentIds)
      ? input.agentIds.filter((item): item is string => typeof item === 'string')
      : undefined
    const pairing = await createFn({
      actorUserId: user.uid,
      deviceKind,
      ownerType,
      ...(ownerOrgId ? { ownerOrgId } : {}),
      ...(orgId ? { orgId } : {}),
      ...(agentIds ? { agentIds } : {}),
      ...(adoptLocationId ? { adoptLocationId } : {}),
    })
    return NextResponse.json({ success: true, data: pairing }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    })
  } catch {
    return NextResponse.json({ success: false, error: 'Pairing challenge could not be created' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    })
  }
}

export const POST = withAuth('client', async (req: NextRequest, user) => {
  const body = await req.json().catch(() => ({})) as PairingCreateInput
  return handlePairingCreate(user, body)
})
