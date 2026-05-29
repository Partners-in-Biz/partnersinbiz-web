import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { apiError, apiSuccess } from '@/lib/api/response'
import {
  nextPlaybookRunAt,
  playbookIsDue,
  runProjectPlaybookTemplate,
  type ProjectPlaybookRecord,
} from '@/lib/projects/playbooks'

export const dynamic = 'force-dynamic'

type PlaybookDoc = {
  id: string
  data: () => Record<string, unknown>
  ref?: { parent?: { parent?: { id?: string } | null } | null }
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function authorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  const vercelCron = req.headers.get('x-vercel-cron')
  return Boolean(vercelCron) || (Boolean(process.env.CRON_SECRET) && auth === `Bearer ${process.env.CRON_SECRET}`)
}

function queryLimit(req: NextRequest): number {
  const requested = Number(req.nextUrl.searchParams.get('limit') || 50)
  if (!Number.isFinite(requested)) return 50
  return Math.max(1, Math.min(100, Math.floor(requested)))
}

function projectIdForPlaybook(doc: PlaybookDoc, playbook: Record<string, unknown>): string {
  return cleanString(playbook.projectId) || cleanString(doc.ref?.parent?.parent?.id)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return apiError('Unauthorized', 401)

  const now = new Date()
  const snap = await (adminDb as unknown as {
    collectionGroup: (collectionId: string) => {
      where: (field: string, operator: string, value: unknown) => {
        limit: (limit: number) => { get: () => Promise<{ docs: PlaybookDoc[] }> }
      }
    }
  }).collectionGroup('playbooks')
    .where('autoCreateTasks', '==', true)
    .limit(queryLimit(req))
    .get()

  const results: Array<Record<string, unknown>> = []
  let createdTasks = 0

  for (const doc of snap.docs) {
    const playbook = { id: doc.id, ...doc.data() } as ProjectPlaybookRecord
    if (!playbookIsDue(playbook, now)) continue

    const projectId = projectIdForPlaybook(doc, playbook)
    if (!projectId) {
      results.push({ playbookId: doc.id, ok: false, error: 'Missing parent project id' })
      continue
    }

    try {
      const projectRef = adminDb.collection('projects').doc(projectId)
      const projectDoc = await projectRef.get()
      if (!projectDoc.exists) {
        results.push({ projectId, playbookId: doc.id, ok: false, error: 'Project not found' })
        continue
      }

      const nextRunAt = nextPlaybookRunAt(playbook, now)
      const run = await runProjectPlaybookTemplate({
        projectId,
        playbookId: doc.id,
        playbook,
        project: (projectDoc.data() ?? {}) as Record<string, unknown>,
        actorUid: 'cron',
        nextRunAt,
        disableAutoCreateTasks: nextRunAt === null,
      })
      if (!run.ok) {
        results.push({ projectId, playbookId: doc.id, ok: false, error: run.error })
        continue
      }

      createdTasks += run.data.taskCount
      results.push({
        projectId,
        playbookId: doc.id,
        ok: true,
        taskCount: run.data.taskCount,
        createdTaskIds: run.data.createdTaskIds,
        nextRunAt,
      })
    } catch (err) {
      results.push({
        projectId,
        playbookId: doc.id,
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown project playbook cron error',
      })
    }
  }

  return apiSuccess({
    scanned: snap.docs.length,
    processed: results.filter((result) => result.ok === true).length,
    failed: results.filter((result) => result.ok === false).length,
    createdTasks,
    results,
  })
}
