import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { downloadDriveFile } from '@/lib/google-workspace/actions'
import { contentDispositionAttachment, optionalString, requiredString, resolveGoogleWorkspaceOrg } from '@/lib/google-workspace/route'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const scoped = resolveGoogleWorkspaceOrg(req, user)
  if (scoped.response) return scoped.response
  const fileId = requiredString(searchParams.get('fileId'), 'fileId')
  if (fileId instanceof Response) return fileId
  const downloaded = await downloadDriveFile({
    fileId,
    exportMimeType: optionalString(searchParams.get('exportMimeType')),
  })
  const content = Uint8Array.from(downloaded.content)
  return new Response(content, {
    status: 200,
    headers: {
      'content-type': downloaded.mimeType,
      'content-disposition': contentDispositionAttachment(downloaded.name),
      'x-google-drive-file-id': downloaded.fileId,
    },
  })
})
