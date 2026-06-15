import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { createGoogleDoc } from '@/lib/google-workspace/actions'
import { optionalString, readJsonBody, requiredString, resolveGoogleWorkspaceOrg } from '@/lib/google-workspace/route'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await readJsonBody(req)
  if (body instanceof Response) return body
  const scoped = resolveGoogleWorkspaceOrg(req, user, body)
  if (scoped.response) return scoped.response
  const title = requiredString(body.title, 'title')
  if (title instanceof Response) return title
  const doc = await createGoogleDoc({
    title,
    folderId: optionalString(body.folderId),
    content: optionalString(body.markdown) ?? optionalString(body.content),
  })
  return apiSuccess(doc, 201)
})
