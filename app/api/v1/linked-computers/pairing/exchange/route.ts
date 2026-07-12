import { NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { exchangePairing } from '@/lib/linked-computers/crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json()
    const result = await exchangePairing(body)
    return NextResponse.json({ success: true, data: result }, {
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pairing exchange failed'
    const status = /not found/.test(message) ? 404 : /expired|consumed|attempts exhausted/.test(message) ? 410 : 401
    return apiError(message, status)
  }
}
