import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { createPairing } from '@/lib/linked-computers/crypto'

export const dynamic = 'force-dynamic'

export const POST = withAuth('client', async (_req: NextRequest, user) => {
  const pairing = await createPairing({ actorUserId: user.uid })
  return NextResponse.json({ success: true, data: pairing }, {
    status: 201,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  })
})
