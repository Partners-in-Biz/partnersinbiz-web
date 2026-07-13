import { NextRequest, NextResponse } from 'next/server'
import { runDeviceCleanupWorker } from '@/lib/linked-computers/store'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest): Promise<Response> {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  if (!((Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`) || Boolean(vercelCron))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runDeviceCleanupWorker()
  return NextResponse.json({ success: true, data: result }, { headers: { 'Cache-Control': 'no-store' } })
}
