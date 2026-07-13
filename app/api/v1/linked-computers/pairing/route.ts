import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { createPairing } from '@/lib/linked-computers/crypto'

export const dynamic = 'force-dynamic'

type CreatePairingFn = typeof createPairing

export async function handlePairingCreate(user: { uid: string }, create: CreatePairingFn = createPairing): Promise<Response> {
  try {
    const pairing = await create({ actorUserId: user.uid })
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

export const POST = withAuth('client', async (_req: NextRequest, user) => handlePairingCreate(user))
