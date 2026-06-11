import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { apiError } from '@/lib/api/response'
import type { HermesCapability, HermesProfileLink, HermesRunRequest } from './types'
import {
  canAccessHermesProfile,
  normalizeHermesProfileLink,
  sanitizeHermesCapabilities,
  sanitizeHermesPermissions,
} from './access'

export const HERMES_PROFILE_LINKS_COLLECTION = 'hermes_profile_links'
export const HERMES_RUNS_COLLECTION = 'hermes_runs'

export type HermesAdminControl =
  | 'models'
  | 'model'
  | 'config'
  | 'tools'
  | 'skills'
  | 'sessions'
  | 'logs'
  | 'env'
  | 'profile'
  | 'profiles'
  | 'cron'

type HermesAdminMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

type HermesAdminControlDefinition = {
  capability: HermesCapability
  basePath: string
  methods: readonly HermesAdminMethod[]
  allowSubpaths?: boolean
}

export const HERMES_ADMIN_CONTROLS: Record<HermesAdminControl, HermesAdminControlDefinition> = {
  models: { capability: 'models', basePath: '/v1/models', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowSubpaths: true },
  model: { capability: 'models', basePath: '/api/model', methods: ['GET', 'POST'], allowSubpaths: true },
  config: { capability: 'dashboard', basePath: '/api/config', methods: ['GET', 'POST', 'PUT', 'PATCH'], allowSubpaths: true },
  tools: { capability: 'tools', basePath: '/api/tools', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowSubpaths: true },
  skills: { capability: 'tools', basePath: '/api/skills', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowSubpaths: true },
  sessions: { capability: 'dashboard', basePath: '/api/sessions', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowSubpaths: true },
  logs: { capability: 'dashboard', basePath: '/api/logs', methods: ['GET', 'DELETE'], allowSubpaths: true },
  env: { capability: 'dashboard', basePath: '/api/env', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowSubpaths: true },
  profile: { capability: 'dashboard', basePath: '/api/profile', methods: ['GET', 'PUT', 'PATCH'] },
  profiles: { capability: 'dashboard', basePath: '/api/profiles', methods: ['GET'], allowSubpaths: true },
  cron: { capability: 'cron', basePath: '/api/cron/jobs', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowSubpaths: true },
}

const SAFE_HERMES_PATH_PART = /^[A-Za-z0-9._:-]+$/

export function publicHermesProfileLink(link: HermesProfileLink) {
  return {
    orgId: link.orgId,
    profile: link.profile,
    baseUrl: link.baseUrl,
    dashboardBaseUrl: link.dashboardBaseUrl,
    enabled: link.enabled,
    capabilities: link.capabilities,
    permissions: link.permissions,
    hasApiKey: Boolean(link.apiKey),
    hasDashboardSessionToken: Boolean(link.dashboardSessionToken),
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    createdBy: link.createdBy,
    updatedBy: link.updatedBy,
  }
}

export async function getHermesProfileLink(orgId: string): Promise<HermesProfileLink | null> {
  const doc = await adminDb.collection(HERMES_PROFILE_LINKS_COLLECTION).doc(orgId).get()
  if (!doc.exists) return null
  return normalizeHermesProfileLink(orgId, doc.data() ?? {})
}

export async function requireHermesProfileAccess(
  user: ApiUser,
  orgId: string,
  capability: HermesCapability,
): Promise<{ link: HermesProfileLink } | NextResponse> {
  const link = await getHermesProfileLink(orgId)
  const access = canAccessHermesProfile(user, link, capability)
  if (!access.allowed) return apiError(access.error ?? 'Forbidden', access.status ?? 403)
  return { link: link! }
}

export function sanitizeHermesProfileWrite(orgId: string, user: ApiUser, body: Record<string, unknown>) {
  const existingApiKey = typeof body.existingApiKey === 'string' ? body.existingApiKey : undefined
  const incomingApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined
  const apiKey = incomingApiKey || existingApiKey || undefined
  const existingDashboardSessionToken = typeof body.existingDashboardSessionToken === 'string' ? body.existingDashboardSessionToken : undefined
  const incomingDashboardSessionToken = typeof body.dashboardSessionToken === 'string' ? body.dashboardSessionToken.trim() : undefined
  const dashboardSessionToken = incomingDashboardSessionToken || existingDashboardSessionToken || undefined
  const dashboardBaseUrl = typeof body.dashboardBaseUrl === 'string' && body.dashboardBaseUrl.trim()
    ? body.dashboardBaseUrl.trim().replace(/\/+$/, '')
    : undefined

  return {
    orgId,
    profile: typeof body.profile === 'string' ? body.profile.trim() : '',
    baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : '',
    ...(dashboardBaseUrl ? { dashboardBaseUrl } : { dashboardBaseUrl: FieldValue.delete() }),
    ...(apiKey ? { apiKey } : {}),
    ...(dashboardSessionToken ? { dashboardSessionToken } : { dashboardSessionToken: FieldValue.delete() }),
    enabled: body.enabled === false ? false : true,
    capabilities: sanitizeHermesCapabilities(body.capabilities),
    permissions: sanitizeHermesPermissions(body.permissions),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: user.uid,
  }
}

export async function saveHermesProfileLink(orgId: string, user: ApiUser, body: Record<string, unknown>) {
  const data = sanitizeHermesProfileWrite(orgId, user, body)
  if (!data.profile) throw new Error('profile is required')
  if (!data.baseUrl) throw new Error('baseUrl is required')
  await adminDb.collection(HERMES_PROFILE_LINKS_COLLECTION).doc(orgId).set(
    {
      ...data,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: user.uid,
    },
    { merge: true },
  )
  return normalizeHermesProfileLink(orgId, data)
}

export async function callHermesJson(link: HermesProfileLink, path: string, init: RequestInit = {}) {
  const url = `${link.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...headersToObject(init.headers),
  }
  if (link.apiKey) headers['Authorization'] = `Bearer ${link.apiKey}`

  const response = await fetch(url, { ...init, headers })
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }
  return { response, data }
}

export function resolveHermesAdminControl(
  control: string,
  pathParts: string[] = [],
  method: HermesAdminMethod,
  search = '',
): { capability: HermesCapability; path: string } | { error: string; status: number } {
  const definition = HERMES_ADMIN_CONTROLS[control as HermesAdminControl]
  if (!definition) return { error: 'Hermes admin control is not allowlisted', status: 404 }
  if (!definition.methods.includes(method)) return { error: 'Method not allowed for Hermes admin control', status: 405 }
  if (pathParts.length > 0 && !definition.allowSubpaths) return { error: 'Subpath not allowed for Hermes admin control', status: 404 }
  if (pathParts.some((part) => !part || part === '.' || part === '..' || !SAFE_HERMES_PATH_PART.test(part))) {
    return { error: 'Invalid Hermes admin control path', status: 400 }
  }

  const subpath = pathParts.map((part) => encodeURIComponent(part)).join('/')
  return {
    capability: definition.capability,
    path: `${definition.basePath}${subpath ? `/${subpath}` : ''}${search}`,
  }
}

export async function callHermesAdminControl(
  link: HermesProfileLink,
  controlPath: string,
  method: HermesAdminMethod,
  body?: string,
) {
  const dashboardPath = controlPath.startsWith('/api/')
  const targetLink = dashboardPath && link.dashboardBaseUrl
    ? { ...link, baseUrl: link.dashboardBaseUrl, apiKey: undefined }
    : link
  const headers = dashboardPath && link.dashboardSessionToken
    ? { 'X-Hermes-Session-Token': link.dashboardSessionToken }
    : undefined
  return callHermesJson(targetLink, controlPath, {
    method,
    ...(headers ? { headers } : {}),
    ...(body ? { body } : {}),
  })
}

export async function createHermesRun(link: HermesProfileLink, requestedBy: string, request: HermesRunRequest) {
  const { prompt, ...rest } = request
  const hermesPayload = { input: prompt, ...rest }
  const { response, data } = await callHermesJson(link, '/v1/runs', {
    method: 'POST',
    body: JSON.stringify(hermesPayload),
  })
  if (!response.ok) {
    return { response, data, runDocId: null }
  }

  const payload = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const hermesRunId = String(payload.run_id ?? payload.runId ?? payload.id ?? '')
  const docRef = await adminDb.collection(HERMES_RUNS_COLLECTION).add({
    orgId: link.orgId,
    profile: link.profile,
    hermesRunId,
    requestedBy,
    prompt: request.prompt,
    ...(request.model ? { model: request.model } : {}),
    ...(request.reasoning_effort ? { reasoningEffort: request.reasoning_effort } : {}),
    status: payload.status ?? 'submitted',
    response: data,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  return { response, data, runDocId: docRef.id }
}

export async function callHermesStream(link: HermesProfileLink, path: string) {
  const url = `${link.baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  const headers: Record<string, string> = {}
  if (link.apiKey) headers['Authorization'] = `Bearer ${link.apiKey}`
  const res = await fetch(url, { headers })
  if (!res.ok || !res.body) {
    throw new Error(`Hermes stream ${path} failed: ${res.status}`)
  }
  return res
}

export async function stopHermesRun(link: HermesProfileLink, runId: string) {
  const { response, data } = await callHermesJson(link, `/v1/runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
  })
  return { response, data }
}

export async function resolveHermesApproval(
  link: HermesProfileLink,
  runId: string,
  choice: 'once' | 'session' | 'always' | 'deny',
  resolveAll?: boolean,
) {
  const { response, data } = await callHermesJson(link, `/v1/runs/${encodeURIComponent(runId)}/approval`, {
    method: 'POST',
    body: JSON.stringify({ choice, ...(resolveAll ? { resolve_all: true } : {}) }),
  })
  return { response, data }
}

function headersToObject(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries((headers as unknown as { entries(): Iterable<[string, string]> }).entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers as Record<string, string>
}
