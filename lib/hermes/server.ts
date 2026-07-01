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

/**
 * Validate an admin-supplied Hermes base URL to prevent stored SSRF. The base
 * URL is later used as a `fetch` target with the platform API key attached, so
 * a malicious value could be pointed at a cloud-metadata endpoint to exfiltrate
 * the bearer token.
 *
 * IMPORTANT — production reality: the control plane talks to the Hermes sidecar
 * SAME-HOST over a local port (e.g. http://127.0.0.1:8643). So we must NOT block
 * loopback/private ranges or require https — doing so breaks live agent
 * connectivity. We block only what is NEVER a legitimate Hermes target: the
 * link-local / cloud-metadata range (169.254.0.0/16, which includes the AWS/GCP
 * 169.254.169.254 metadata IP and the ECS 169.254.170.2 endpoint), 0.0.0.0, and
 * the well-known metadata hostnames. We also restrict the scheme to http/https.
 *
 * Returns an error string when the URL is unsafe, or null when it is allowed.
 */
export function validateHermesBaseUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'baseUrl must be a valid absolute URL'
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'baseUrl must use http or https'
  }

  // Strip IPv6 brackets and any zone id for inspection.
  const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/%.*$/, '')

  // Cloud-metadata hostnames are never a valid Hermes target.
  if (host === 'metadata.google.internal' || host === 'metadata') {
    return 'baseUrl host is not allowed'
  }

  // Block the link-local / metadata range (169.254.0.0/16) and 0.0.0.0 only.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if ((a === 169 && b === 254) || a === 0) {
      return 'baseUrl host is not allowed'
    }
  }

  // IPv6: block link-local (fe80::/10) and the unspecified address; metadata
  // over IPv6 is also link-local. Loopback/unique-local are allowed (same-host).
  if (host.includes(':')) {
    if (host === '::') return 'baseUrl host is not allowed'
    if (/^fe[89ab][0-9a-f]:/.test(host)) return 'baseUrl host is not allowed'
    // IPv4-mapped link-local metadata (e.g. ::ffff:169.254.169.254).
    if (/(^|:)169\.254\./.test(host)) return 'baseUrl host is not allowed'
  }

  return null
}

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

  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : ''

  // Reject SSRF-prone base URLs at write time so a bad value is never stored.
  if (baseUrl) {
    const baseUrlError = validateHermesBaseUrl(baseUrl)
    if (baseUrlError) throw new Error(baseUrlError)
  }
  if (dashboardBaseUrl) {
    const dashboardError = validateHermesBaseUrl(dashboardBaseUrl)
    if (dashboardError) throw new Error(`dashboard ${dashboardError}`)
  }

  return {
    orgId,
    profile: typeof body.profile === 'string' ? body.profile.trim() : '',
    baseUrl,
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
  // Guard against a stored SSRF-prone base URL even if it bypassed write-time validation.
  const baseUrlError = validateHermesBaseUrl(link.baseUrl)
  if (baseUrlError) throw new Error(`Refusing Hermes request: ${baseUrlError}`)
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
  const metadata = request.metadata && typeof request.metadata === 'object' ? request.metadata : undefined
  const conversationId = typeof request.conversation_id === 'string'
    ? request.conversation_id
    : typeof metadata?.conversationId === 'string'
      ? metadata.conversationId
      : typeof metadata?.conversation_id === 'string'
        ? metadata.conversation_id
        : undefined
  const messageId = typeof metadata?.messageId === 'string'
    ? metadata.messageId
    : typeof metadata?.message_id === 'string'
      ? metadata.message_id
      : undefined
  const dispatchAgentId = typeof metadata?.dispatchAgentId === 'string'
    ? metadata.dispatchAgentId
    : typeof metadata?.agentId === 'string'
      ? metadata.agentId
      : undefined
  const docRef = await adminDb.collection(HERMES_RUNS_COLLECTION).add({
    orgId: link.orgId,
    profile: link.profile,
    hermesRunId,
    requestedBy,
    prompt: request.prompt,
    ...(conversationId ? { conversationId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(dispatchAgentId ? { dispatchAgentId } : {}),
    ...(metadata ? { metadata } : {}),
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
  const baseUrlError = validateHermesBaseUrl(link.baseUrl)
  if (baseUrlError) throw new Error(`Refusing Hermes request: ${baseUrlError}`)
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
