import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { ensureOrgAccess, loadScopedRecord, updateActorFields } from '@/lib/youtube-studio/api'
import { refundCanvasCreditUsage } from '@/lib/creative-canvas/credits'
import { VIDEO_EDITOR_COLLECTIONS } from '@/lib/video-editor/api'
import { registerVideoEditorRenderOutputs } from '@/lib/video-editor/register-outputs'
import {
  sanitizeVideoEditorRenderJobStatusInput,
  sanitizeVideoEditorSettingsInput,
  serializeVideoEditorRecord,
} from '@/lib/video-editor/sanitize'
import type { VideoEditorProject, VideoEditorRenderJob } from '@/lib/video-editor/types'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const TERMINAL_STATUSES = new Set(['rendered', 'failed', 'cancelled'])

export const GET = withAuth('client', async (_req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.renderJobs, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Render job not found', 404)
  const denied = await ensureOrgAccess(user, String(loaded.data.orgId ?? ''))
  if (denied) return denied
  return apiSuccess({ job: serializeVideoEditorRecord<VideoEditorRenderJob>(loaded.id, loaded.data) })
})

export const PUT = withAuth('client', async (req: NextRequest, user, context) => {
  const { id } = await (context as RouteContext).params
  const loaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.renderJobs, id)
  if (!loaded || loaded.data.deleted === true) return apiError('Render job not found', 404)
  const orgId = String(loaded.data.orgId ?? '')
  const denied = await ensureOrgAccess(user, orgId)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const patch = sanitizeVideoEditorRenderJobStatusInput(body)
  if (!patch.status) return apiError('A valid status (rendering | rendered | failed | cancelled) is required', 400)

  const currentStatus = String(loaded.data.status ?? '')
  if (TERMINAL_STATUSES.has(currentStatus)) {
    return apiSuccess({ id, status: currentStatus, alreadyTerminal: true })
  }

  if (patch.status === 'rendering') {
    await loaded.ref.set({ status: 'rendering', ...updateActorFields(user) }, { merge: true })
    return apiSuccess({ id, status: 'rendering' })
  }

  const projectId = String(loaded.data.projectId ?? '')
  const projectLoaded = await loadScopedRecord(VIDEO_EDITOR_COLLECTIONS.projects, projectId)
  const projectValid = Boolean(projectLoaded && projectLoaded.data.deleted !== true && String(projectLoaded.data.orgId ?? '') === orgId)

  if (patch.status === 'rendered') {
    if (!patch.output) return apiError('output.url and output.storagePath are required to complete a render', 400)
    await loaded.ref.set({ status: 'rendered', output: patch.output, ...updateActorFields(user) }, { merge: true })

    let registration: Record<string, string> = {}
    if (projectValid && projectLoaded) {
      await projectLoaded.ref.set({
        status: 'rendered',
        lastRender: {
          jobId: id,
          url: patch.output.url,
          renderedAt: FieldValue.serverTimestamp(),
          ...(patch.output.durationSeconds !== undefined ? { durationSeconds: patch.output.durationSeconds } : {}),
        },
        ...updateActorFields(user),
      }, { merge: true })
      const project = serializeVideoEditorRecord<VideoEditorProject>(projectLoaded.id, projectLoaded.data)
      const settings = sanitizeVideoEditorSettingsInput(loaded.data.settingsSnapshot)
      try {
        registration = { ...(await registerVideoEditorRenderOutputs(id, project, patch.output, settings)) }
      } catch (error) {
        console.error('[video-editor] output registration failed:', error)
        registration = { registrationError: error instanceof Error ? error.message : 'registration failed' }
      }
    }
    return apiSuccess({ id, status: 'rendered', ...registration })
  }

  const refund = await refundCanvasCreditUsage(orgId, id)
  const existingCredits = (loaded.data.credits as Record<string, unknown> | undefined) ?? {}
  await loaded.ref.set({
    status: patch.status,
    ...(patch.error ? { error: patch.error } : {}),
    credits: { ...existingCredits, refunded: refund.amount },
    ...updateActorFields(user),
  }, { merge: true })

  if (projectValid && projectLoaded && String(projectLoaded.data.status ?? '') === 'rendering') {
    await projectLoaded.ref.set({ status: 'draft', ...updateActorFields(user) }, { merge: true })
  }
  return apiSuccess({ id, status: patch.status, refunded: refund.amount })
})
