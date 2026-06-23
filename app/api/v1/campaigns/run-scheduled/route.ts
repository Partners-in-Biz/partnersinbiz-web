/**
 * GET /api/v1/campaigns/run-scheduled — launch every email campaign whose
 * scheduled send time (scheduledAt) is now due.
 *
 * Secured by Authorization: Bearer ${CRON_SECRET}. Intended to run on a cron
 * (e.g. every 5 minutes). For each campaign where status == 'scheduled' AND
 * scheduledAt <= now, it resolves the audience and enrols contacts via the
 * shared launchCampaign helper — the same path "Send now" uses.
 *
 * NOTE: register this in vercel.json to fire automatically (see report).
 */
import { NextRequest, NextResponse } from 'next/server'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { Campaign } from '@/lib/campaigns/types'
import { launchCampaign } from '@/lib/campaigns/launch'
import { logActivity } from '@/lib/activity/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const now = Timestamp.now()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshot = await (adminDb.collection('campaigns') as any)
    .where('status', '==', 'scheduled')
    .where('scheduledAt', '<=', now)
    .get()

  const results: Array<{ id: string; ok: boolean; enrolled?: number; error?: string }> = []

  for (const doc of snapshot.docs) {
    const data = doc.data()
    if (data?.deleted) continue
    const campaign = { id: doc.id, ...data } as Campaign

    try {
      const result = await launchCampaign(campaign, doc.ref)
      if (result.ok) {
        logActivity({
          orgId: campaign.orgId,
          type: 'campaign_launched',
          actorId: 'cron',
          actorName: 'Scheduler',
          actorRole: 'ai',
          description: 'Launched scheduled campaign',
          entityId: campaign.id,
          entityType: 'campaign',
          entityTitle: campaign.name ?? undefined,
        }).catch(() => {})
        results.push({ id: doc.id, ok: true, enrolled: result.enrolled })
      } else {
        results.push({ id: doc.id, ok: false, error: result.error })
      }
    } catch (err) {
      results.push({ id: doc.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      processed: results.length,
      launched: results.filter((r) => r.ok).length,
      results,
    },
  })
}
