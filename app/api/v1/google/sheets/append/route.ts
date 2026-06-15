import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { appendSheetValues } from '@/lib/google-workspace/actions'
import { optionalString, readJsonBody, requiredString, resolveGoogleWorkspaceOrg } from '@/lib/google-workspace/route'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await readJsonBody(req)
  if (body instanceof Response) return body
  const scoped = resolveGoogleWorkspaceOrg(req, user, body)
  if (scoped.response) return scoped.response
  const spreadsheetId = requiredString(body.spreadsheetId, 'spreadsheetId')
  if (spreadsheetId instanceof Response) return spreadsheetId
  const range = requiredString(body.range, 'range')
  if (range instanceof Response) return range
  if (!Array.isArray(body.values)) return apiError('values must be a two-dimensional array', 400)
  const result = await appendSheetValues({
    spreadsheetId,
    range,
    values: body.values as unknown[][],
    valueInputOption: optionalString(body.valueInputOption),
    insertDataOption: optionalString(body.insertDataOption),
  })
  return apiSuccess(result)
})
