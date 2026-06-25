/**
 * GET /api/v1/admin/hermes/control-plane
 *
 * The operator control-plane snapshot for Hermes agents. For every
 * org→profile routing link in `hermes_profile_links`, returns:
 *   - VPS host + port (parsed from the link baseUrl)
 *   - enabled state
 *   - last heartbeat (latest hermes_runs activity for that profile)
 *   - requests today (hermes_runs created since local midnight UTC)
 *   - capabilities + masked secret presence
 *
 * Also returns the org roster (for the routing-table picker) and a global
 * "all paused" indicator (true when every link is disabled).
 *
 * Auth: admin. Read-only — mutations live in sibling action routes.
 */
import { withAuth } from '@/lib/api/auth'
import { apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { HERMES_PROFILE_LINKS_COLLECTION, HERMES_RUNS_COLLECTION } from '@/lib/hermes/server'
import { normalizeHermesProfileLink } from '@/lib/hermes/access'

export const dynamic = 'force-dynamic'

function parseHostPort(baseUrl: string): { host: string; port: number | null } {
  try {
    const u = new URL(baseUrl)
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : u.protocol === 'http:' ? 80 : null
    return { host: u.hostname, port }
  } catch {
    return { host: baseUrl || 'unknown', port: null }
  }
}

function tsToMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === 'object') {
    const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; _seconds?: number }
    if (typeof v.toMillis === 'function') { try { return v.toMillis() } catch { /* noop */ } }
    if (typeof v.toDate === 'function') { try { return v.toDate().getTime() } catch { /* noop */ } }
    const seconds = v.seconds ?? v._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

export const GET = withAuth('admin', async () => {
  const startOfTodayUtc = new Date()
  startOfTodayUtc.setUTCHours(0, 0, 0, 0)
  const todayMs = startOfTodayUtc.getTime()

  const [linksSnap, orgsSnap, runsSnap] = await Promise.all([
    adminDb.collection(HERMES_PROFILE_LINKS_COLLECTION).get(),
    adminDb.collection('organizations').limit(300).get(),
    // No orderBy → avoids composite index; window-filter in memory.
    adminDb.collection(HERMES_RUNS_COLLECTION).limit(8000).get(),
  ])

  const orgNames = new Map<string, string>()
  const orgs: { id: string; name: string }[] = []
  orgsSnap.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    const name = typeof data.name === 'string' ? data.name : d.id
    orgNames.set(d.id, name)
    orgs.push({ id: d.id, name })
  })
  orgs.sort((a, b) => a.name.localeCompare(b.name))

  // Aggregate hermes_runs per profile: last activity + requests today.
  const lastByProfile = new Map<string, number>()
  const todayByProfile = new Map<string, number>()
  const lastByOrg = new Map<string, number>()
  const todayByOrg = new Map<string, number>()
  runsSnap.forEach((d) => {
    const data = d.data() as Record<string, unknown>
    const profile = typeof data.profile === 'string' ? data.profile : ''
    const orgId = typeof data.orgId === 'string' ? data.orgId : ''
    const createdMs = tsToMillis(data.createdAt)
    const updatedMs = tsToMillis(data.updatedAt) ?? createdMs
    if (updatedMs != null) {
      if (profile) lastByProfile.set(profile, Math.max(lastByProfile.get(profile) ?? 0, updatedMs))
      if (orgId) lastByOrg.set(orgId, Math.max(lastByOrg.get(orgId) ?? 0, updatedMs))
    }
    if (createdMs != null && createdMs >= todayMs) {
      if (profile) todayByProfile.set(profile, (todayByProfile.get(profile) ?? 0) + 1)
      if (orgId) todayByOrg.set(orgId, (todayByOrg.get(orgId) ?? 0) + 1)
    }
  })

  const links = linksSnap.docs.map((doc) => {
    const link = normalizeHermesProfileLink(doc.id, doc.data() ?? {})
    const { host, port } = parseHostPort(link.baseUrl)
    const lastMs = Math.max(lastByProfile.get(link.profile) ?? 0, lastByOrg.get(link.orgId) ?? 0)
    const requestsToday = (todayByProfile.get(link.profile) ?? 0) || (todayByOrg.get(link.orgId) ?? 0)
    return {
      orgId: link.orgId,
      orgName: orgNames.get(link.orgId) ?? link.orgId,
      profile: link.profile,
      baseUrl: link.baseUrl,
      dashboardBaseUrl: link.dashboardBaseUrl ?? null,
      host,
      port,
      enabled: link.enabled,
      capabilities: link.capabilities,
      permissions: link.permissions,
      hasApiKey: Boolean(link.apiKey),
      hasDashboardSessionToken: Boolean(link.dashboardSessionToken),
      lastHeartbeat: lastMs > 0 ? new Date(lastMs).toISOString() : null,
      requestsToday,
      updatedAt: link.updatedAt ?? null,
      updatedBy: link.updatedBy ?? null,
    }
  })
  links.sort((a, b) => a.orgName.localeCompare(b.orgName))

  const enabledCount = links.filter((l) => l.enabled).length
  const pausedAll = links.length > 0 && enabledCount === 0

  return apiSuccess({
    links,
    orgs,
    summary: {
      total: links.length,
      enabled: enabledCount,
      disabled: links.length - enabledCount,
      pausedAll,
      requestsToday: links.reduce((s, l) => s + l.requestsToday, 0),
    },
    generatedAt: new Date().toISOString(),
  })
})
