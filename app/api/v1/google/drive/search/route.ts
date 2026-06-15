import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { searchDriveFiles } from '@/lib/google-workspace/actions'
import { optionalString, parsePageSize, requiredString, resolveGoogleWorkspaceOrg } from '@/lib/google-workspace/route'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const scoped = resolveGoogleWorkspaceOrg(req, user)
  if (scoped.response) return scoped.response
  const query = requiredString(searchParams.get('q') ?? searchParams.get('query'), 'q')
  if (query instanceof Response) return query
  const result = await searchDriveFiles({
    query,
    folderId: optionalString(searchParams.get('folderId')),
    pageSize: parsePageSize(searchParams.get('pageSize')),
    pageToken: optionalString(searchParams.get('pageToken')),
  })
  return apiSuccess(result)
})
