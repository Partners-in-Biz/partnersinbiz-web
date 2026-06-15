import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { readSheetValues } from '@/lib/google-workspace/actions'
import { optionalString, readJsonBody, requiredString, resolveGoogleWorkspaceOrg } from '@/lib/google-workspace/route'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const { searchParams } = new URL(req.url)
  const scoped = resolveGoogleWorkspaceOrg(req, user)
  if (scoped.response) return scoped.response
  const spreadsheetId = requiredString(searchParams.get('spreadsheetId'), 'spreadsheetId')
  if (spreadsheetId instanceof Response) return spreadsheetId
  const range = requiredString(searchParams.get('range'), 'range')
  if (range instanceof Response) return range
  const result = await readSheetValues({
    spreadsheetId,
    range,
    majorDimension: optionalString(searchParams.get('majorDimension')),
  })
  return apiSuccess(result)
})

export const POST = withAuth('admin', async (req: NextRequest, user) => {
  const body = await readJsonBody(req)
  if (body instanceof Response) return body
  const scoped = resolveGoogleWorkspaceOrg(req, user, body)
  if (scoped.response) return scoped.response
  const spreadsheetId = requiredString(body.spreadsheetId, 'spreadsheetId')
  if (spreadsheetId instanceof Response) return spreadsheetId
  const range = requiredString(body.range, 'range')
  if (range instanceof Response) return range
  const result = await readSheetValues({
    spreadsheetId,
    range,
    majorDimension: optionalString(body.majorDimension),
  })
  return apiSuccess(result)
})
