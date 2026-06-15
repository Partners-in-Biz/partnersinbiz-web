import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { shareDriveFile } from '@/lib/google-workspace/actions'
import { optionalString, parseBoolean, readJsonBody, requiredString, resolveGoogleWorkspaceOrg } from '@/lib/google-workspace/route'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await readJsonBody(req)
  if (body instanceof Response) return body
  const scoped = resolveGoogleWorkspaceOrg(req, user, body)
  if (scoped.response) return scoped.response
  const fileId = requiredString(body.fileId, 'fileId')
  if (fileId instanceof Response) return fileId
  const type = optionalString(body.type) ?? 'user'
  if (type !== 'user' && type !== 'group') return apiError('Only user and group Drive shares are allowed through this endpoint', 400)
  const permission = await shareDriveFile({
    fileId,
    type,
    emailAddress: optionalString(body.emailAddress) ?? optionalString(body.email),
    role: optionalString(body.role),
    sendNotificationEmail: parseBoolean(body.sendNotificationEmail) ?? parseBoolean(body.sendNotification) ?? false,
  })
  return apiSuccess(permission)
})
