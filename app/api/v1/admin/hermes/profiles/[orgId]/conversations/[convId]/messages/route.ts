import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { createHermesRun, requireHermesProfileAccess } from '@/lib/hermes/server'
import { appendMessage, getConversation, listMessages, touchConversation, updateMessage } from '@/lib/hermes/conversations'

async function buildOrgContext(orgId: string): Promise<string> {
  try {
    const orgDoc = await adminDb.collection('organizations').doc(orgId).get()
    if (!orgDoc.exists) return ''
    const org = orgDoc.data() as Record<string, unknown> | undefined
    if (!org) return ''
    const brand = (org.brandProfile ?? {}) as Record<string, unknown>
    const doWords = Array.isArray(brand.doWords) ? (brand.doWords as string[]).filter(Boolean).join(', ') : ''
    const dontWords = Array.isArray(brand.dontWords) ? (brand.dontWords as string[]).filter(Boolean).join(', ') : ''
    const lines = [
      '[Client context — you are working on behalf of a Partners-in-Biz client organisation]',
      `orgId: ${orgId}`,
      org.name ? `name: ${org.name}` : '',
      org.slug ? `slug: ${org.slug}` : '',
      org.industry ? `industry: ${org.industry}` : '',
      org.website ? `website: ${org.website}` : '',
      org.description ? `description: ${org.description}` : '',
      brand.tagline ? `tagline: ${brand.tagline}` : '',
      brand.toneOfVoice ? `voice: ${brand.toneOfVoice}` : '',
      brand.targetAudience ? `audience: ${brand.targetAudience}` : '',
      doWords ? `do-words: ${doWords}` : '',
      dontWords ? `dont-words: ${dontWords}` : '',
      'When writing copy, taking actions, or making decisions on this client\'s behalf: stay in their voice, scope every platform API call to this orgId, and never leak data or copy from other clients. If a skill needs an orgId, this is the one to pass.',
      '---',
    ].filter(Boolean)
    return lines.join('\n') + '\n\n'
  } catch {
    return ''
  }
}

async function buildProjectContext(orgId: string, projectId: string): Promise<string> {
  try {
    const projectDoc = await adminDb.collection('projects').doc(projectId).get()
    if (!projectDoc.exists) return ''
    const project = projectDoc.data() as Record<string, unknown> | undefined
    if (!project || project.orgId !== orgId) return ''
    const tasksSnap = await adminDb.collection('projects').doc(projectId).collection('tasks').orderBy('order', 'asc').limit(50).get()
    const tasks = tasksSnap.docs.map((d) => {
      const t = d.data() as Record<string, unknown>
      return `  - [${String(t.columnId ?? '?')}] ${String(t.title ?? '(untitled)')} (id=${d.id}${t.priority ? `, priority=${t.priority}` : ''})`
    })
    const columns = Array.isArray(project.columns) ? (project.columns as Array<Record<string, unknown>>).map((c) => `${c.id}=${c.name}`).join(', ') : ''
    const lines = [
      '[Project context — you are operating on a Partners-in-Biz project]',
      `projectId: ${projectId}`,
      `name: ${project.name ?? '(unnamed)'}`,
      project.description ? `description: ${project.description}` : '',
      project.status ? `status: ${project.status}` : '',
      columns ? `columns: ${columns}` : '',
      tasks.length ? `tasks (${tasks.length}):\n${tasks.join('\n')}` : 'tasks: (none)',
      'Use the project-management skill (calls PiB /api/v1/projects API) to update tasks. Always reference projectId when changing kanban state.',
      '---',
    ].filter(Boolean)
    return lines.join('\n') + '\n\n'
  } catch {
    return ''
  }
}

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ orgId: string; convId: string }> }

export const GET = withAuth('client', async (_req: NextRequest, user, ctx) => {
  const { orgId, convId } = await (ctx as Ctx).params
  const access = await requireHermesProfileAccess(user, orgId, 'runs')
  if (access instanceof Response) return access
  const conv = await getConversation(convId)
  if (!conv || conv.orgId !== orgId || conv.profile !== access.link.profile) {
    return apiError('Conversation not found', 404)
  }
  if (!conv.participantUids.includes(user.uid)) return apiError('Forbidden', 403)
  const messages = await listMessages(convId)
  return apiSuccess({ messages })
})

export const POST = withAuth('client', async (req: NextRequest, user, ctx) => {
  const { orgId, convId } = await (ctx as Ctx).params
  const access = await requireHermesProfileAccess(user, orgId, 'runs')
  if (access instanceof Response) return access
  const conv = await getConversation(convId)
  if (!conv || conv.orgId !== orgId || conv.profile !== access.link.profile) {
    return apiError('Conversation not found', 404)
  }
  if (!conv.participantUids.includes(user.uid)) return apiError('Forbidden', 403)

  const body = await req.json().catch(() => ({}))
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return apiError('content is required', 400)
  if (content.length > 32000) return apiError('content too long (32000 max)', 400)

  const userMessage = await appendMessage(convId, {
    role: 'user',
    content,
    status: 'completed',
    createdBy: user.uid,
  })
  await touchConversation(convId, {
    lastMessagePreview: content,
    lastMessageRole: 'user',
    title: conv.messageCount === 0 ? content.slice(0, 80) : undefined,
  })

  const assistantMessage = await appendMessage(convId, {
    role: 'assistant',
    content: '',
    status: 'pending',
    createdBy: user.uid,
  })

  const isFirstUserMessage = conv.messageCount === 0
  const orgContext = isFirstUserMessage
    ? await buildOrgContext(orgId)
    : ''
  const projectContext = isFirstUserMessage && conv.projectId
    ? await buildProjectContext(orgId, conv.projectId)
    : ''
  const hermesPrompt = orgContext + projectContext + content

  const runResult = await createHermesRun(access.link, user.uid, {
    prompt: hermesPrompt,
    conversation_id: convId,
    metadata: {
      conversationId: convId,
      messageId: assistantMessage.id,
      orgId,
      projectId: conv.projectId,
      source: 'partnersinbiz-web/chat',
    },
  })

  if (!runResult.response.ok) {
    return apiError('Hermes run request failed', runResult.response.status || 502, {
      hermes: runResult.data,
      userMessage,
      assistantMessage,
    })
  }

  const hermesPayload = runResult.data && typeof runResult.data === 'object' ? (runResult.data as Record<string, unknown>) : {}
  const runId = String(hermesPayload.run_id ?? hermesPayload.runId ?? hermesPayload.id ?? '')
  if (!runId) {
    await updateMessage(convId, assistantMessage.id, {
      status: 'failed',
      error: 'Hermes run response did not include a run id',
    })
    return apiError('Hermes run response did not include a run id', 502)
  }
  await updateMessage(convId, assistantMessage.id, { runId })

  return apiSuccess({
    userMessage,
    assistantMessage,
    runId,
    runDocId: runResult.runDocId,
    hermes: runResult.data,
  })
})
