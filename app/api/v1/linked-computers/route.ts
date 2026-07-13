import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { listOwnedDevices } from '@/lib/linked-computers/store'
import { lifecycleError, noStoreHeaders } from '@/lib/linked-computers/http'

export const dynamic = 'force-dynamic'
export async function handleLinkedComputerList(user: { uid: string }, list = listOwnedDevices): Promise<Response> {
  try { return NextResponse.json({ success: true, data: await list(user.uid) }, { headers: noStoreHeaders }) }
  catch (error) { return lifecycleError(error) }
}
export const GET = withAuth('client', async (_req: NextRequest, user) => handleLinkedComputerList(user))
