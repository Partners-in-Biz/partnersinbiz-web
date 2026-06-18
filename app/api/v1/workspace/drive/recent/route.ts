import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { resolveWorkspaceUser } from '@/lib/workspace/currentUser'
import { getFreshGoogleAccessToken, googleAccountHasScopes } from '@/lib/google/userToken'

export const dynamic = 'force-dynamic'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly'

type DriveFile = { id?: string; name?: string; mimeType?: string; modifiedTime?: string; webViewLink?: string; iconLink?: string; owners?: Array<{ displayName?: string }>; shared?: boolean }

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const orgIdParam = url.searchParams.get('orgId')
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 10), 1), 25)
    const user = await resolveWorkspaceUser(orgIdParam)
    if (!user) return apiError('Not authenticated', 401)

    const token = await getFreshGoogleAccessToken({ orgId: user.orgId, uid: user.uid })
    if (!token.ok) {
      return apiSuccess({ status: token.notConnected ? 'not_connected' : 'needs_reconnect', files: [] })
    }
    if (!googleAccountHasScopes(token.scopes, [DRIVE_SCOPE])) {
      return apiSuccess({ status: 'needs_reconnect', files: [] })
    }
    const params = new URLSearchParams({
      orderBy: 'modifiedTime desc',
      pageSize: String(limit),
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink,iconLink,owners(displayName),shared)',
      q: 'trashed = false',
    })
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { authorization: `Bearer ${token.accessToken}` },
    })
    if (!res.ok) return apiError('Google Drive request failed', 502)
    const json = (await res.json()) as { files?: DriveFile[] }
    const files = (json.files ?? []).map((f) => ({
      id: f.id ?? '',
      name: f.name ?? '(untitled)',
      mimeType: f.mimeType ?? '',
      modifiedTime: f.modifiedTime ?? '',
      webViewLink: f.webViewLink ?? null,
      iconLink: f.iconLink ?? null,
      owner: f.owners?.[0]?.displayName ?? null,
      shared: Boolean(f.shared),
    }))
    return apiSuccess({ status: 'connected', files, accountEmail: token.emailAddress })
  } catch (err) {
    return apiErrorFromException(err)
  }
}
