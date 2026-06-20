import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { drainHiggsfieldCreativeCanvasRuns } from '@/lib/creative-canvas/provider-runtime'
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`) || Boolean(vercelCron)
}

async function runProviderDrain(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)
  const url = new URL(req.url)
  const submitLimit = Number.parseInt(url.searchParams.get('submitLimit') ?? '', 10)
  const pollLimit = Number.parseInt(url.searchParams.get('pollLimit') ?? '', 10)
  const result = await runWithFirestoreReadAudit('api/cron/creative-canvas-provider-runs', () =>
    drainHiggsfieldCreativeCanvasRuns({
      submitLimit: Number.isFinite(submitLimit) ? submitLimit : undefined,
      pollLimit: Number.isFinite(pollLimit) ? pollLimit : undefined,
    }),
  )
  return apiSuccess(result)
}

export async function GET(req: NextRequest) {
  return runProviderDrain(req)
}

export async function POST(req: NextRequest) {
  return runProviderDrain(req)
}
