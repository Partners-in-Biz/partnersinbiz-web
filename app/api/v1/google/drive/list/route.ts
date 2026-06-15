import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { listDriveFiles } from '@/lib/google-workspace/actions'
import { optionalString, parseBoolean, parsePageSize, requiredString, resolveGoogleWorkspaceOrg } from '@/lib/google-workspace/route'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const scoped = resolveGoogleWorkspaceOrg(req, user)
  if (scoped.response) return scoped.response
  const folderId = requiredString(searchParams.get('folderId'), 'folderId')
  if (folderId instanceof Response) return folderId
  const result = await listDriveFiles({
    folderId,
    pageSize: parsePageSize(searchParams.get('pageSize')),
    pageToken: optionalString(searchParams.get('pageToken')),
    includeFolders: parseBoolean(searchParams.get('includeFolders')),
  })
  return apiSuccess(result)
})
