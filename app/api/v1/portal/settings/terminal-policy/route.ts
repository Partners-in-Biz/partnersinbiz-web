import { NextRequest } from 'next/server'
import { apiError, apiErrorFromException, apiSuccess } from '@/lib/api/response'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { getTerminalPolicy, saveTerminalPolicy, validateTerminalPolicy } from '@/lib/messages/workbench/terminal-policy'

export const dynamic = 'force-dynamic'
export const GET = withPortalAuthAndRole('owner', async (_request: NextRequest, _uid: string, orgId: string) => {
  try { return apiSuccess(await getTerminalPolicy(orgId)) } catch (error) { return apiErrorFromException(error) }
})
export const PUT = withPortalAuthAndRole('owner', async (request: NextRequest, uid: string, orgId: string) => {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const validation = validateTerminalPolicy(body?.allowedShellArgv)
  if (!validation.ok) return apiError(validation.error, 400)
  try { return apiSuccess(await saveTerminalPolicy(orgId, uid, validation.value)) } catch (error) { return apiErrorFromException(error) }
})
