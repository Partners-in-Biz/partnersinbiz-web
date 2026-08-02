import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api/response'
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'
import { refreshDueXaiLlmConnections } from '@/lib/llm-providers/refresh-worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest): Promise<Response> {
  const authorized = (Boolean(process.env.CRON_SECRET)
    && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`)
    || Boolean(req.headers.get('x-vercel-cron'))
  if (!authorized) return apiError('Unauthorized', 401)

  try {
    const summary = await runWithFirestoreReadAudit(
      'api/cron/llm-credential-refresh',
      () => refreshDueXaiLlmConnections(),
    )
    return apiSuccess(summary)
  } catch (error) {
    console.error('[llm-credential-refresh-cron-error]', error)
    return apiError('LLM credential refresh worker failed', 500)
  }
}
