import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { uploadDriveFile } from '@/lib/google-workspace/actions'
import { jsonContentBuffer, optionalString, readJsonBody, requiredString, resolveGoogleWorkspaceOrg } from '@/lib/google-workspace/route'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const contentType = req.headers.get('content-type') ?? ''

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const body = Object.fromEntries(form.entries())
    const scoped = resolveGoogleWorkspaceOrg(req, user, body)
    if (scoped.response) return scoped.response
    const folderId = requiredString(body.folderId, 'folderId')
    if (folderId instanceof Response) return folderId
    const file = form.get('file')
    if (!(file instanceof File)) return apiError('file is required', 400)
    const name = optionalString(body.name) ?? file.name
    const mimeType = (optionalString(body.mimeType) ?? file.type) || 'application/octet-stream'
    const uploaded = await uploadDriveFile({
      folderId,
      name,
      mimeType,
      content: Buffer.from(await file.arrayBuffer()),
    })
    return apiSuccess(uploaded, 201)
  }

  const body = await readJsonBody(req)
  if (body instanceof Response) return body
  const scoped = resolveGoogleWorkspaceOrg(req, user, body)
  if (scoped.response) return scoped.response
  const folderId = requiredString(body.folderId, 'folderId')
  if (folderId instanceof Response) return folderId
  const name = requiredString(body.name, 'name')
  if (name instanceof Response) return name
  const content = jsonContentBuffer(body)
  if (content instanceof Response) return content
  const uploaded = await uploadDriveFile({
    folderId,
    name,
    mimeType: optionalString(body.mimeType) ?? 'application/octet-stream',
    content,
  })
  return apiSuccess(uploaded, 201)
})
