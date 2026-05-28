/**
 * GET /api/cron/social — Cron endpoint for processing the social post queue.
 *
 * Called every 1 minute by Vercel Cron or external scheduler.
 * Auth: CRON_SECRET or AI_API_KEY bearer tokens.
 *
 * Uses the queue processor from lib/social/queue.ts which handles:
 *  - Optimistic locking for concurrent safety
 *  - Stale lock detection (5min threshold)
 *  - Exponential backoff retry (1m → 5m → 15m → 1hr, max 5 attempts)
 */
import { NextRequest } from 'next/server'
import { apiSuccess, apiError } from '@/lib/api/response'
import { processQueue } from '@/lib/social/queue'
import { runWithFirestoreReadAudit } from '@/lib/firebase/read-audit'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  const validCronAuth = auth === `Bearer ${process.env.CRON_SECRET}`
  const validApiAuth = auth === `Bearer ${process.env.AI_API_KEY}`
  if (!validCronAuth && !validApiAuth) return apiError('Unauthorized', 401)

  const result = await runWithFirestoreReadAudit('api/cron/social', () => processQueue())

  return apiSuccess(result)
}
