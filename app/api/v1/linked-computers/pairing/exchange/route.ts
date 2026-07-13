import { NextRequest, NextResponse } from 'next/server'
import { apiError } from '@/lib/api/response'
import { exchangePairing } from '@/lib/linked-computers/crypto'

export const dynamic = 'force-dynamic'

type ExchangePairingFn = typeof exchangePairing

export async function handlePairingExchange(req: NextRequest, exchange: ExchangePairingFn = exchangePairing): Promise<Response> {
  try {
    const body = await req.json()
    const result = await exchange(body)
    return NextResponse.json({ success: true, data: result }, {
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    })
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : ''
    const status = /not found/.test(internalMessage) ? 404 : /expired|consumed|attempts exhausted/.test(internalMessage) ? 410 : 401
    const response = apiError(status === 404 ? 'Pairing challenge not found' : status === 410 ? 'Pairing challenge unavailable' : 'Pairing exchange denied', status)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Pragma', 'no-cache')
    return response
  }
}

export const POST = (req: NextRequest) => handlePairingExchange(req)
