import { NextRequest } from 'next/server'
import type { ApiUser } from '@/lib/api/types'
import { apiError, apiSuccess } from '@/lib/api/response'
import { loadFinanceActorContext } from '@/lib/finance/firestore-context'
import { mapFinanceErrorToHttp } from '@/lib/finance/errors'
import { checkFinanceCommandOrgScope } from '@/lib/finance/http-guards'

export async function runFinanceCommandHandler(
  req: NextRequest,
  user: ApiUser,
  options: {
    operations: readonly string[]
    execute: (
      operation: string,
      actor: Awaited<ReturnType<typeof loadFinanceActorContext>>,
      command: Record<string, unknown>,
    ) => Promise<unknown>
    logLabel: string
  },
) {
  try {
    const body = await req.json() as { operation?: unknown; command?: unknown }
    if (typeof body.operation !== 'string' || !options.operations.includes(body.operation)) {
      return apiError('Unsupported finance operation', 422)
    }
    const command = body.command && typeof body.command === 'object'
      ? body.command as Record<string, unknown>
      : {}
    const orgCheck = checkFinanceCommandOrgScope(command.orgId, req.headers.get('x-org-id'))
    if (!orgCheck.ok) return apiError(orgCheck.error, orgCheck.status)
    const actor = await loadFinanceActorContext(user, orgCheck.orgId, {
      correlationId: req.headers.get('x-correlation-id') ?? undefined,
    })
    const result = await options.execute(body.operation, actor, command)
    return apiSuccess({ operation: body.operation, result })
  } catch (error) {
    if (error instanceof SyntaxError) return apiError('Invalid JSON body', 400)
    const mapped = mapFinanceErrorToHttp(error)
    if (mapped.code === 'finance_internal') {
      console.error(`[${options.logLabel}] failed`, error)
    }
    return apiError(mapped.error, mapped.status, { code: mapped.code })
  }
}

export async function runFinanceQueryHandler(
  req: NextRequest,
  user: ApiUser,
  options: {
    resources: readonly string[]
    execute: (
      resource: string,
      actor: Awaited<ReturnType<typeof loadFinanceActorContext>>,
      params: URLSearchParams,
      orgId: string,
    ) => Promise<unknown>
    logLabel: string
  },
) {
  try {
    const params = req.nextUrl.searchParams
    const resource = params.get('resource') ?? ''
    if (!options.resources.includes(resource)) {
      return apiError('Unsupported finance query resource', 422)
    }
    const orgCheck = checkFinanceCommandOrgScope(params.get('orgId'), req.headers.get('x-org-id'))
    if (!orgCheck.ok) return apiError(orgCheck.error, orgCheck.status)
    const actor = await loadFinanceActorContext(user, orgCheck.orgId, {
      correlationId: req.headers.get('x-correlation-id') ?? undefined,
    })
    const result = await options.execute(resource, actor, params, orgCheck.orgId)
    return apiSuccess({ resource, result })
  } catch (error) {
    const mapped = mapFinanceErrorToHttp(error)
    if (mapped.code === 'finance_internal') {
      console.error(`[${options.logLabel}] failed`, error)
    }
    return apiError(mapped.error, mapped.status, { code: mapped.code })
  }
}
