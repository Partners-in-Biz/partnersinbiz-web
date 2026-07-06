import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { drainDueYouTubeReleasePlans } from '@/lib/youtube-studio/publish-executor'
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`) || Boolean(vercelCron)
}

async function runPublishDrain(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)
  const url = new URL(req.url)
  const limit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const result = await runWithFirestoreReadAudit('api/cron/youtube-studio-publish', async () =>
    drainDueYouTubeReleasePlans({
      now: new Date(),
      limit: Number.isFinite(limit) ? limit : undefined,
    })
  )
  return apiSuccess(result)
}

export async function GET(req: NextRequest) {
  return runPublishDrain(req)
}

export async function POST(req: NextRequest) {
  return runPublishDrain(req)
}
