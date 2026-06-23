import type { ApiUser } from '@/lib/api/types'
import { restrictedAdminOrgIds } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'
import { HERMES_PROFILE_LINKS_COLLECTION, HERMES_RUNS_COLLECTION } from '@/lib/hermes/server'
import { PRODUCTS as ONBOARDING_PRODUCTS } from '@/lib/onboarding/products'
import { REPORT_EMAIL_TEMPLATES } from '@/lib/reports/templates'
import { getCallbackUrl, getClientCredentials, getOAuthConfig } from '@/lib/social/oauth-config'

type SurfaceMetric = {
  label: string
  value: string
  helper?: string
}

type SurfaceAction = {
  label: string
  href: string
}

type SurfaceRow = {
  id: string
  cells: string[]
  href?: string
  actions?: SurfaceAction[]
}

type SurfaceSection = {
  title: string
  description?: string
  columns: string[]
  rows: SurfaceRow[]
  emptyMessage?: string
}

type SurfaceCallout = {
  title: string
  body: string
  tone?: 'default' | 'warn'
  href?: string
  hrefLabel?: string
}

export type AdminBacklogSurfacePayload = {
  metrics: SurfaceMetric[]
  sections: SurfaceSection[]
  actions?: SurfaceAction[]
  callouts?: SurfaceCallout[]
}

type OrgRecord = {
  id: string
  name: string
  slug: string
  status: string
}

type BasicDoc = Record<string, unknown> & { id: string }

const SOCIAL_REVIEW_STATUSES = new Set(['pending_approval', 'client_review', 'qa_review'])
const SENSITIVE_ACTION_RE = /(delete|suspend|impersonat|billing|domain|key|credential|backup|restore|admin)/i
const SOCIAL_PLATFORMS = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'linkedin', label: 'LinkedIn (personal)' },
  { key: 'linkedin_org', label: 'LinkedIn (organization)' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'twitter', label: 'X / Twitter' },
  { key: 'threads', label: 'Threads' },
]

function asDocs(snapshot: FirebaseFirestore.QuerySnapshot | FirebaseFirestore.DocumentSnapshot): BasicDoc[] {
  if ('docs' in snapshot) return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  return snapshot.exists ? [{ id: snapshot.id, ...snapshot.data() }] : []
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function timestampMs(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'object') {
    const source = value as { toMillis?: () => number; seconds?: number; _seconds?: number; toDate?: () => Date }
    try {
      if (typeof source.toMillis === 'function') return source.toMillis()
      if (typeof source.toDate === 'function') return source.toDate().getTime()
    } catch {
      return null
    }
    const seconds = source.seconds ?? source._seconds
    if (typeof seconds === 'number') return seconds * 1000
  }
  return null
}

function formatDateTime(value: unknown): string {
  const ms = timestampMs(value)
  if (!ms) return 'Unknown'
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

function formatDate(value: unknown): string {
  const ms = timestampMs(value)
  if (!ms) return 'Unknown'
  return new Date(ms).toISOString().slice(0, 10)
}

function maskValue(value: string): string {
  if (!value) return 'Not configured'
  if (value.length <= 8) return `${value.slice(0, 2)}...`
  return `${value.slice(0, 4)}...${value.slice(-2)}`
}

function slugPath(org: OrgRecord | undefined, suffix: string): string | undefined {
  if (!org?.slug) return undefined
  return `/admin/org/${org.slug}${suffix}`
}

async function readOrganizations(user: ApiUser): Promise<Map<string, OrgRecord>> {
  const restricted = restrictedAdminOrgIds(user)
  const map = new Map<string, OrgRecord>()

  if (restricted.length > 0) {
    const docs = await Promise.all(restricted.map((id) => adminDb.collection('organizations').doc(id).get().catch(() => null)))
    for (const doc of docs) {
      if (!doc?.exists) continue
      map.set(doc.id, {
        id: doc.id,
        name: stringValue(doc.data()?.name, doc.id),
        slug: stringValue(doc.data()?.slug, doc.id),
        status: stringValue(doc.data()?.status, 'active'),
      })
    }
    return map
  }

  const snapshot = await adminDb.collection('organizations').limit(200).get().catch(() => null)
  for (const doc of snapshot?.docs ?? []) {
    map.set(doc.id, {
      id: doc.id,
      name: stringValue(doc.data()?.name, doc.id),
      slug: stringValue(doc.data()?.slug, doc.id),
      status: stringValue(doc.data()?.status, 'active'),
    })
  }
  return map
}

async function readOrgScopedCollection(user: ApiUser, collectionName: string, limit = 120): Promise<BasicDoc[]> {
  const restricted = restrictedAdminOrgIds(user)

  if (restricted.length === 0) {
    const snapshot = await adminDb.collection(collectionName).limit(limit).get().catch(() => null)
    return snapshot ? asDocs(snapshot) : []
  }

  const perOrg = Math.max(10, Math.ceil(limit / Math.max(restricted.length, 1)))
  const results = await Promise.all(
    restricted.map((orgId) =>
      adminDb.collection(collectionName).where('orgId', '==', orgId).limit(perOrg).get().catch(() => null),
    ),
  )
  return results.flatMap((snapshot) => (snapshot ? asDocs(snapshot) : []))
}

async function readGlobalCollection(collectionName: string, limit = 120, orderField?: string): Promise<BasicDoc[]> {
  const query = orderField
    ? adminDb.collection(collectionName).orderBy(orderField, 'desc').limit(limit)
    : adminDb.collection(collectionName).limit(limit)
  const snapshot = await query.get().catch(() => null)
  return snapshot ? asDocs(snapshot) : []
}

function contentPreview(doc: BasicDoc): string {
  return stringValue(doc.caption)
    || stringValue(doc.text)
    || stringValue(doc.body)
    || stringValue(doc.subject)
    || stringValue(doc.title)
    || 'No preview'
}

function buildMetrics(rows: Array<{ label: string; value: string; helper?: string }>): SurfaceMetric[] {
  return rows
}

function buildActions(...actions: SurfaceAction[]): SurfaceAction[] {
  return actions.filter((action) => Boolean(action.href))
}

export async function buildPropertiesSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const [orgs, properties] = await Promise.all([
    readOrganizations(user),
    readOrgScopedCollection(user, 'properties', 160),
  ])

  const active = properties.filter((property) => property.deleted !== true)
  const inventory = active
    .sort((a, b) => (timestampMs(b.updatedAt) ?? 0) - (timestampMs(a.updatedAt) ?? 0))
    .slice(0, 80)

  return {
    actions: buildActions({ label: 'Open organizations', href: '/admin/organizations' }),
    metrics: buildMetrics([
      { label: 'Tracked properties', value: String(active.length), helper: 'Live property docs across accessible orgs.' },
      { label: 'Active', value: String(active.filter((property) => stringValue(property.status) === 'active').length) },
      { label: 'Draft', value: String(active.filter((property) => stringValue(property.status) === 'draft').length) },
      { label: 'Org coverage', value: String(new Set(active.map((property) => stringValue(property.orgId))).size) },
    ]),
    callouts: [
      {
        title: 'Bounded control plane',
        body: 'This route surfaces the real property inventory, ingest key state, and org handoff links. Redirect cleanup can happen after the route contract is in place.',
      },
    ],
    sections: [
      {
        title: 'Property inventory',
        description: 'Current property documents with org ownership, type, status, and recent change signal.',
        columns: ['Property', 'Organization', 'Type', 'Status', 'Updated'],
        rows: inventory.map((property) => {
          const org = orgs.get(stringValue(property.orgId))
          return {
            id: property.id,
            cells: [
              `${stringValue(property.name, property.id)} (${stringValue(property.domain, 'no-domain')})`,
              org?.name ?? stringValue(property.orgId, 'Unknown org'),
              stringValue(property.type, 'unknown'),
              stringValue(property.status, 'draft'),
              formatDateTime(property.updatedAt ?? property.createdAt),
            ],
            href: slugPath(org, '/intelligence'),
            actions: buildActions(
              { label: 'Org intelligence', href: slugPath(org, '/intelligence') ?? '/admin/organizations' },
              { label: 'Analytics settings', href: slugPath(org, '/settings') ?? '/admin/organizations' },
            ),
          }
        }),
        emptyMessage: 'No properties found for the accessible org scope.',
      },
    ],
  }
}

export async function buildProductsSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const [orgs, products] = await Promise.all([
    readOrganizations(user),
    readOrgScopedCollection(user, 'products', 180),
  ])

  const activeProducts = products.filter((product) => product.deleted !== true && product.active !== false)
  const onboardingProducts = Object.values(ONBOARDING_PRODUCTS)

  return {
    actions: buildActions(
      { label: 'Open services', href: '/services' },
      { label: 'Open onboarding starts', href: '/start/athleet-management' },
    ),
    metrics: buildMetrics([
      { label: 'Client products', value: String(activeProducts.length), helper: 'Billable product records across accessible orgs.' },
      { label: 'Onboarding offers', value: String(onboardingProducts.length), helper: 'Public /start product registry entries.' },
      { label: 'Org coverage', value: String(new Set(activeProducts.map((product) => stringValue(product.orgId))).size) },
      { label: 'Route status', value: 'Live', helper: '/admin/products no longer redirects to settings.' },
    ]),
    callouts: [
      {
        title: 'Admin product control plane',
        body: 'This surface combines platform onboarding products with client product records so operators can audit product catalog readiness without leaving admin.',
      },
    ],
    sections: [
      {
        title: 'Client product catalog',
        description: 'Products stored in the shared products collection, grouped by owning organization and current catalog state.',
        columns: ['Product', 'Organization', 'Price', 'Unit', 'Updated'],
        rows: activeProducts
          .sort((a, b) => (timestampMs(b.updatedAt) ?? 0) - (timestampMs(a.updatedAt) ?? 0))
          .slice(0, 80)
          .map((product) => {
            const org = orgs.get(stringValue(product.orgId))
            const price = numberValue(product.unitPrice)
            const currency = stringValue(product.currency, 'ZAR')
            return {
              id: product.id,
              cells: [
                `${stringValue(product.name, product.id)} (${stringValue(product.sku, 'no-sku')})`,
                org?.name ?? stringValue(product.orgId, 'Unknown org'),
                `${currency} ${price.toFixed(2)}`,
                stringValue(product.unit, 'item'),
                formatDateTime(product.updatedAt ?? product.createdAt),
              ],
              href: slugPath(org, '/settings/products'),
              actions: buildActions({ label: 'Open org products', href: slugPath(org, '/settings/products') ?? '/admin/organizations' }),
            }
          }),
        emptyMessage: 'No active product records were found for the accessible org scope.',
      },
      {
        title: 'Public onboarding products',
        description: 'Current product registry entries exposed through /start/[product].',
        columns: ['Product', 'Slug', 'Price label', 'Features', 'Start route'],
        rows: onboardingProducts.map((product) => ({
          id: product.slug,
          cells: [
            product.name,
            product.slug,
            product.priceLabel,
            String(product.features.length),
            `/start/${product.slug}`,
          ],
          href: `/start/${product.slug}`,
          actions: buildActions({ label: 'Open start page', href: `/start/${product.slug}` }),
        })),
      },
    ],
  }
}

export async function buildHermesSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const [orgs, profileLinks, runs] = await Promise.all([
    readOrganizations(user),
    readGlobalCollection(HERMES_PROFILE_LINKS_COLLECTION, 120),
    readGlobalCollection(HERMES_RUNS_COLLECTION, 120, 'createdAt'),
  ])

  const restricted = restrictedAdminOrgIds(user)
  const visibleLinks = restricted.length > 0
    ? profileLinks.filter((link) => restricted.includes(stringValue(link.orgId, link.id)))
    : profileLinks
  const visibleRuns = restricted.length > 0
    ? runs.filter((run) => restricted.includes(stringValue(run.orgId)))
    : runs
  const enabledLinks = visibleLinks.filter((link) => link.enabled !== false)
  const recentFailures = visibleRuns.filter((run) => ['failed', 'error', 'cancelled'].includes(stringValue(run.status).toLowerCase()))

  return {
    actions: buildActions(
      { label: 'Open agents board', href: '/admin/agents' },
      { label: 'Open infrastructure metrics', href: '/admin/system/infrastructure' },
    ),
    metrics: buildMetrics([
      { label: 'Profile links', value: String(visibleLinks.length), helper: 'Hermes profiles configured for accessible orgs.' },
      { label: 'Enabled', value: String(enabledLinks.length) },
      { label: 'Recent runs', value: String(visibleRuns.length) },
      { label: 'Failures', value: String(recentFailures.length), helper: 'Recent runs with failed/error/cancelled status.' },
    ]),
    callouts: [
      {
        title: 'Hermes operations hub',
        body: 'Use this top-level route to audit profile links, recent run status, and safe handoffs into agents, profile tools, skills, jobs, and infrastructure metrics.',
      },
    ],
    sections: [
      {
        title: 'Profile links',
        description: 'Configured Hermes profile links and capability readiness by organization.',
        columns: ['Organization', 'Profile', 'Base URL', 'Capabilities', 'Status'],
        rows: visibleLinks.map((link) => {
          const orgId = stringValue(link.orgId, link.id)
          const org = orgs.get(orgId)
          const capabilities = link.capabilities && typeof link.capabilities === 'object'
            ? Object.entries(link.capabilities as Record<string, unknown>)
                .filter(([, enabled]) => enabled === true)
                .map(([capability]) => capability)
                .join(', ')
            : 'none'
          return {
            id: link.id,
            cells: [
              org?.name ?? orgId,
              stringValue(link.profile, 'unlinked'),
              stringValue(link.baseUrl, 'missing'),
              capabilities || 'none',
              link.enabled === false ? 'disabled' : 'enabled',
            ],
            href: `/admin/hermes/profiles/${orgId}`,
            actions: buildActions(
              { label: 'Open profile API', href: `/api/v1/admin/hermes/profiles/${orgId}` },
              { label: 'Open agents', href: '/admin/agents' },
            ),
          }
        }),
        emptyMessage: 'No Hermes profile links are configured for the accessible org scope.',
      },
      {
        title: 'Recent Hermes runs',
        description: 'Recent run records submitted through the Partners in Biz Hermes bridge.',
        columns: ['Run', 'Organization', 'Profile', 'Status', 'Created'],
        rows: visibleRuns.slice(0, 50).map((run) => {
          const orgId = stringValue(run.orgId)
          return {
            id: run.id,
            cells: [
              stringValue(run.hermesRunId, run.id),
              orgs.get(orgId)?.name ?? orgId,
              stringValue(run.profile, 'unknown'),
              stringValue(run.status, 'submitted'),
              formatDateTime(run.createdAt),
            ],
            actions: buildActions({ label: 'Open agents logs', href: '/admin/agents' }),
          }
        }),
        emptyMessage: 'No recent Hermes runs were found.',
      },
    ],
  }
}

export async function buildWikiSyncSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const [orgs, memoryItems, tasks, runs] = await Promise.all([
    readOrganizations(user),
    readOrgScopedCollection(user, 'agent_memory_items', 160),
    readGlobalCollection('agent_tasks', 80, 'createdAt'),
    readGlobalCollection(HERMES_RUNS_COLLECTION, 80, 'createdAt'),
  ])

  const knowledgeItems = memoryItems.filter((item) => stringValue(item.sourceType).includes('knowledge') || stringValue(item.type).includes('knowledge'))
  const wikiTasks = tasks.filter((task) => {
    const haystack = [
      stringValue(task.title),
      stringValue(task.description),
      stringValue(task.type),
      stringValue(task.sourceType),
    ].join(' ').toLowerCase()
    return haystack.includes('wiki') || haystack.includes('knowledge') || haystack.includes('obsidian')
  })
  const knowledgeRuns = runs.filter((run) => {
    const prompt = stringValue(run.prompt).toLowerCase()
    return prompt.includes('wiki') || prompt.includes('knowledge') || prompt.includes('obsidian')
  })

  return {
    actions: buildActions(
      { label: 'Open shared knowledge', href: '/admin/knowledge' },
      { label: 'Open mission control', href: '/admin/mission-control' },
    ),
    metrics: buildMetrics([
      { label: 'Knowledge memory', value: String(knowledgeItems.length), helper: 'Indexed knowledge items in accessible org scopes.' },
      { label: 'Wiki tasks', value: String(wikiTasks.length) },
      { label: 'Knowledge runs', value: String(knowledgeRuns.length) },
      { label: 'Reindex API', value: 'Ready', helper: '/api/v1/admin/agent-memory/reindex' },
    ]),
    callouts: [
      {
        title: 'Manual sync guardrail',
        body: 'Knowledge and wiki updates stay reviewable. This surface exposes sync evidence and reindex handoffs without creating automatic wiki rewrites.',
        href: '/admin/knowledge',
        hrefLabel: 'Review knowledge base',
      },
    ],
    sections: [
      {
        title: 'Indexed knowledge memory',
        description: 'Recent knowledge-backed memory rows available to the admin sync/reindex flow.',
        columns: ['Item', 'Organization', 'Source', 'Updated', 'Status'],
        rows: knowledgeItems.slice(0, 50).map((item) => {
          const orgId = stringValue(item.orgId)
          return {
            id: item.id,
            cells: [
              stringValue(item.title, item.id),
              orgs.get(orgId)?.name ?? orgId,
              stringValue(item.sourceType, stringValue(item.type, 'knowledge')),
              formatDateTime(item.updatedAt ?? item.createdAt),
              stringValue(item.status, 'indexed'),
            ],
            actions: buildActions({ label: 'Open knowledge', href: '/admin/knowledge' }),
          }
        }),
        emptyMessage: 'No indexed knowledge memory rows were found for the accessible org scope.',
      },
      {
        title: 'Wiki and knowledge jobs',
        description: 'Recent tasks/runs that mention wiki, Obsidian, or knowledge sync.',
        columns: ['Record', 'Source', 'Status', 'Created', 'Route'],
        rows: [
          ...wikiTasks.slice(0, 25).map((task) => ({
            id: `task-${task.id}`,
            cells: [
              stringValue(task.title, task.id),
              'agent task',
              stringValue(task.status, 'open'),
              formatDateTime(task.createdAt),
              '/admin/mission-control',
            ],
            actions: buildActions({ label: 'Mission control', href: '/admin/mission-control' }),
          })),
          ...knowledgeRuns.slice(0, 25).map((run) => ({
            id: `run-${run.id}`,
            cells: [
              stringValue(run.hermesRunId, run.id),
              'Hermes run',
              stringValue(run.status, 'submitted'),
              formatDateTime(run.createdAt),
              '/admin/agents',
            ],
            actions: buildActions({ label: 'Agents', href: '/admin/agents' }),
          })),
        ],
        emptyMessage: 'No wiki or knowledge sync jobs were found.',
      },
    ],
  }
}

export async function buildModerationSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const [orgs, posts, campaigns] = await Promise.all([
    readOrganizations(user),
    readOrgScopedCollection(user, 'social_posts', 200),
    readOrgScopedCollection(user, 'campaigns', 160),
  ])

  const pendingPosts = posts.filter((post) => SOCIAL_REVIEW_STATUSES.has(stringValue(post.status)))
  const reviewCampaigns = campaigns.filter((campaign) => ['pending_approval', 'in_review', 'review'].includes(stringValue(campaign.status)))

  return {
    metrics: buildMetrics([
      { label: 'Social approvals', value: String(pendingPosts.length), helper: 'Posts currently waiting on admin/client review.' },
      { label: 'Campaign reviews', value: String(reviewCampaigns.length) },
      { label: 'Flagged alerts', value: String(pendingPosts.filter((post) => stringValue(post.status) === 'qa_review').length) },
      { label: 'Strike candidates', value: String(new Set(pendingPosts.map((post) => stringValue(post.orgId))).size) },
    ]),
    callouts: [
      {
        title: 'Current moderation signal',
        body: 'The live moderation pressure in PiB is the approval queue. This page keeps that queue visible without falling back to a broad dashboard redirect.',
        tone: 'warn',
      },
    ],
    sections: [
      {
        title: 'Social content queue',
        description: 'Awaiting-review social posts across accessible orgs.',
        columns: ['Post', 'Organization', 'Status', 'Platform', 'Updated'],
        rows: pendingPosts.slice(0, 80).map((post) => {
          const org = orgs.get(stringValue(post.orgId))
          return {
            id: post.id,
            cells: [
              contentPreview(post).slice(0, 80),
              org?.name ?? stringValue(post.orgId, 'Unknown org'),
              stringValue(post.status, 'pending_approval'),
              Array.isArray(post.platforms) ? post.platforms.join(', ') : stringValue(post.platform, 'mixed'),
              formatDateTime(post.updatedAt ?? post.createdAt),
            ],
            href: slugPath(org, `/social?status=${encodeURIComponent(stringValue(post.status, 'pending_approval'))}`),
            actions: buildActions(
              { label: 'Open org queue', href: slugPath(org, `/social?status=${encodeURIComponent(stringValue(post.status, 'pending_approval'))}`) ?? '/admin/organizations' },
            ),
          }
        }),
        emptyMessage: 'No social posts are waiting on moderation right now.',
      },
      {
        title: 'Campaign review pressure',
        description: 'Campaigns still sitting in a review state.',
        columns: ['Campaign', 'Organization', 'Status', 'Type', 'Updated'],
        rows: reviewCampaigns.slice(0, 40).map((campaign) => {
          const org = orgs.get(stringValue(campaign.orgId))
          return {
            id: campaign.id,
            cells: [
              stringValue(campaign.name, campaign.id),
              org?.name ?? stringValue(campaign.orgId, 'Unknown org'),
              stringValue(campaign.status, 'review'),
              stringValue(campaign.clientType, 'campaign'),
              formatDateTime(campaign.updatedAt ?? campaign.createdAt),
            ],
            href: slugPath(org, '/campaigns'),
            actions: buildActions({ label: 'Open campaigns', href: slugPath(org, '/campaigns') ?? '/admin/organizations' }),
          }
        }),
        emptyMessage: 'No campaigns are waiting on moderation-related review.',
      },
    ],
  }
}

export async function buildAuditLogSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const [orgs, activity] = await Promise.all([
    readOrganizations(user),
    readGlobalCollection('activity', 150, 'createdAt'),
  ])

  const restricted = restrictedAdminOrgIds(user)
  const scoped = restricted.length > 0
    ? activity.filter((entry) => restricted.includes(stringValue(entry.orgId)))
    : activity
  const entries = scoped.slice(0, 100)

  return {
    actions: buildActions({ label: 'Open platform users', href: '/admin/platform-users' }),
    metrics: buildMetrics([
      { label: 'Recent audit rows', value: String(entries.length), helper: 'Most recent platform activity entries.' },
      { label: 'Sensitive actions', value: String(entries.filter((entry) => SENSITIVE_ACTION_RE.test(stringValue(entry.type))).length) },
      { label: 'Admins seen', value: String(new Set(entries.map((entry) => stringValue(entry.actorId) || stringValue(entry.actorName))).size) },
      { label: 'CSV export path', value: '/api/v1/org/audit-log', helper: 'Per-org CSV export remains available from the org audit route.' },
    ]),
    sections: [
      {
        title: 'Recent admin activity',
        description: 'Immutable recent activity rows across accessible orgs.',
        columns: ['When', 'Actor', 'Action', 'Organization', 'Summary'],
        rows: entries.map((entry) => {
          const org = orgs.get(stringValue(entry.orgId))
          return {
            id: entry.id,
            cells: [
              formatDateTime(entry.createdAt),
              stringValue(entry.actorName, stringValue(entry.actorId, 'Unknown actor')),
              stringValue(entry.type, 'activity'),
              org?.name ?? stringValue(entry.orgId, 'Platform'),
              stringValue(entry.description, 'No summary'),
            ],
            href: org ? `/admin/org/${org.slug}/activity` : '/admin/dashboard',
            actions: buildActions(
              { label: 'Open org activity', href: org ? `/admin/org/${org.slug}/activity` : '/admin/dashboard' },
            ),
          }
        }),
        emptyMessage: 'No audit activity is available for this admin scope.',
      },
    ],
  }
}

function domainConfigFromOrg(doc: BasicDoc) {
  const settings = (doc.settings ?? {}) as Record<string, unknown>
  const customDomain = (settings.customDomain ?? {}) as Record<string, unknown>
  return {
    orgId: doc.id,
    orgName: stringValue(doc.name, doc.id),
    slug: stringValue(doc.slug, doc.id),
    domain: stringValue(customDomain.customDomain),
    subdomain: stringValue(customDomain.subdomain),
    verified: customDomain.verified === true,
    sslStatus: stringValue(customDomain.sslStatus, 'pending'),
    verifiedAt: customDomain.verifiedAt,
    lastCheckedAt: customDomain.lastCheckedAt,
  }
}

export async function buildDomainsSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const restricted = restrictedAdminOrgIds(user)
  const orgSnapshots = restricted.length > 0
    ? await Promise.all(restricted.map((id) => adminDb.collection('organizations').doc(id).get().catch(() => null)))
    : (await adminDb.collection('organizations').limit(200).get().catch(() => null))?.docs ?? []

  const domainRows = (Array.isArray(orgSnapshots) ? orgSnapshots : []).flatMap((doc) => {
    if (!doc?.exists) return []
    const row = domainConfigFromOrg({ id: doc.id, ...doc.data() })
    return row.domain || row.subdomain ? [row] : []
  })

  return {
    actions: buildActions({ label: 'Open SSL board', href: '/admin/domains/ssl' }),
    metrics: buildMetrics([
      { label: 'Custom domains', value: String(domainRows.length) },
      { label: 'Verified', value: String(domainRows.filter((row) => row.verified).length) },
      { label: 'Pending DNS/SSL', value: String(domainRows.filter((row) => row.sslStatus !== 'active').length) },
      { label: 'Active SSL', value: String(domainRows.filter((row) => row.sslStatus === 'active').length) },
    ]),
    sections: [
      {
        title: 'Domain inventory',
        description: 'Current white-label domains and their verification state.',
        columns: ['Domain', 'Organization', 'Portal alias', 'Verified', 'SSL'],
        rows: domainRows.map((row) => ({
          id: row.orgId,
          cells: [
            row.domain || 'No custom domain',
            row.orgName,
            row.subdomain ? `${row.subdomain}.partnersinbiz.online` : 'Not assigned',
            row.verified ? `Yes (${formatDate(row.verifiedAt)})` : 'No',
            row.sslStatus,
          ],
          href: `/admin/org/${row.slug}/settings`,
          actions: buildActions({ label: 'Org settings', href: `/admin/org/${row.slug}/settings` }),
        })),
        emptyMessage: 'No custom domains are configured in the accessible org scope.',
      },
    ],
  }
}

export async function buildSslSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const base = await buildDomainsSurface(user)
  return {
    ...base,
    metrics: buildMetrics([
      { label: 'SSL active', value: base.metrics.find((metric) => metric.label === 'Active SSL')?.value ?? '0' },
      { label: 'Pending', value: base.metrics.find((metric) => metric.label === 'Pending DNS/SSL')?.value ?? '0' },
      { label: 'Renewal model', value: 'Auto', helper: 'SSL state is currently platform-managed per org custom-domain settings.' },
      { label: 'Manual review', value: 'Operator', helper: 'Use the per-org settings route to investigate failed provisioning.' },
    ]),
    actions: buildActions({ label: 'Open domains board', href: '/admin/domains' }),
  }
}

function extractAb(doc: BasicDoc) {
  const ab = (doc.ab ?? {}) as Record<string, unknown>
  const variants = Array.isArray(ab.variants) ? ab.variants as Array<Record<string, unknown>> : []
  if (ab.enabled !== true && variants.length === 0) return null
  return {
    enabled: ab.enabled === true,
    status: stringValue(ab.status, 'inactive'),
    metric: stringValue(ab.winnerMetric, 'opens'),
    variants,
    winnerVariantId: stringValue(ab.winnerVariantId),
    updatedAt: doc.updatedAt ?? doc.createdAt,
  }
}

async function loadAbTests(user: ApiUser) {
  const [orgs, campaigns, broadcasts] = await Promise.all([
    readOrganizations(user),
    readOrgScopedCollection(user, 'campaigns', 150),
    readOrgScopedCollection(user, 'broadcasts', 100),
  ])

  const rows = [
    ...campaigns.flatMap((campaign) => {
      const ab = extractAb(campaign)
      if (!ab) return []
      return [{
        id: `campaign_${campaign.id}`,
        name: stringValue(campaign.name, campaign.id),
        orgId: stringValue(campaign.orgId),
        org: orgs.get(stringValue(campaign.orgId)),
        kind: 'Campaign',
        ab,
      }]
    }),
    ...broadcasts.flatMap((broadcast) => {
      const ab = extractAb(broadcast)
      if (!ab) return []
      return [{
        id: `broadcast_${broadcast.id}`,
        name: stringValue(broadcast.name, broadcast.id),
        orgId: stringValue(broadcast.orgId),
        org: orgs.get(stringValue(broadcast.orgId)),
        kind: 'Broadcast',
        ab,
      }]
    }),
  ]

  return rows.sort((a, b) => (timestampMs(b.ab.updatedAt) ?? 0) - (timestampMs(a.ab.updatedAt) ?? 0))
}

export async function buildAbTestsSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const tests = await loadAbTests(user)

  return {
    metrics: buildMetrics([
      { label: 'Experiment docs', value: String(tests.length), helper: 'Campaign and broadcast docs with native A/B config.' },
      { label: 'Running', value: String(tests.filter((test) => ['testing', 'winner-pending'].includes(test.ab.status)).length) },
      { label: 'Winner declared', value: String(tests.filter((test) => Boolean(test.ab.winnerVariantId)).length) },
      { label: 'Variant count', value: String(tests.reduce((sum, test) => sum + test.ab.variants.length, 0)) },
    ]),
    sections: [
      {
        title: 'Experiment inventory',
        description: 'Current A/B-capable docs with status, metric, and quick navigation to results.',
        columns: ['Experiment', 'Organization', 'Surface', 'Status', 'Winner metric'],
        rows: tests.map((test) => ({
          id: test.id,
          cells: [
            test.name,
            test.org?.name ?? test.orgId,
            test.kind,
            test.ab.status,
            `${test.ab.metric} (${test.ab.variants.length} variants)`,
          ],
          href: `/admin/ab-tests/${test.id}`,
          actions: buildActions({ label: 'Results', href: `/admin/ab-tests/${test.id}` }),
        })),
        emptyMessage: 'No campaign or broadcast A/B configs are stored yet.',
      },
    ],
  }
}

export async function buildAbTestDetailSurface(user: ApiUser, testId: string): Promise<AdminBacklogSurfacePayload> {
  const tests = await loadAbTests(user)
  const match = tests.find((test) => test.id === testId)
  if (!match) {
    return {
      metrics: [],
      sections: [
        {
          title: 'Experiment not found',
          columns: ['Status'],
          rows: [],
          emptyMessage: 'No stored A/B configuration matches this test id.',
        },
      ],
      callouts: [
        {
          title: 'No redirect fallback',
          body: 'This detail route exists even when the experiment id is unknown, which keeps the controller free to remove the old broad redirect later.',
          tone: 'warn',
        },
      ],
    }
  }

  const variants = match.ab.variants.map((variant) => ({
    id: stringValue(variant.id, 'variant'),
    label: stringValue(variant.label, stringValue(variant.id, 'Variant')),
    sent: numberValue(variant.sent),
    delivered: numberValue(variant.delivered),
    opened: numberValue(variant.opened),
    clicked: numberValue(variant.clicked),
  }))

  return {
    actions: buildActions(
      { label: 'Back to experiments', href: '/admin/ab-tests' },
      { label: 'Open org campaigns', href: match.org ? `/admin/org/${match.org.slug}/campaigns` : '/admin/organizations' },
    ),
    metrics: buildMetrics([
      { label: 'Surface', value: match.kind },
      { label: 'Status', value: match.ab.status },
      { label: 'Winner', value: match.ab.winnerVariantId || 'Pending' },
      { label: 'Metric', value: match.ab.metric },
    ]),
    sections: [
      {
        title: 'Variant results',
        description: 'Stored variant counters on the live campaign or broadcast document.',
        columns: ['Variant', 'Sent', 'Delivered', 'Opened', 'Clicked'],
        rows: variants.map((variant) => ({
          id: variant.id,
          cells: [
            variant.label,
            String(variant.sent),
            String(variant.delivered),
            String(variant.opened),
            String(variant.clicked),
          ],
        })),
        emptyMessage: 'This experiment does not yet have stored variant counters.',
      },
    ],
  }
}

export async function buildAnalyticsIngestionSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const [properties, events] = await Promise.all([
    readOrgScopedCollection(user, 'properties', 160),
    readOrgScopedCollection(user, 'product_events', 300),
  ])

  const propertyMap = new Map(properties.map((property) => [property.id, property]))
  const now = Date.now()
  const lastHour = events.filter((event) => (timestampMs(event.timestamp) ?? 0) >= now - 3600000)
  const lastDay = events.filter((event) => (timestampMs(event.timestamp) ?? 0) >= now - 86400000)
  const lastWeek = events.filter((event) => (timestampMs(event.timestamp) ?? 0) >= now - 604800000)
  const counts = new Map<string, number>()
  for (const event of lastWeek) {
    const propertyId = stringValue(event.propertyId, 'unknown')
    counts.set(propertyId, (counts.get(propertyId) ?? 0) + 1)
  }

  const topProperties = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)

  return {
    metrics: buildMetrics([
      { label: 'Events (1h)', value: String(lastHour.length) },
      { label: 'Events (24h)', value: String(lastDay.length) },
      { label: 'Events (7d)', value: String(lastWeek.length) },
      { label: 'Properties seen', value: String(new Set(lastWeek.map((event) => stringValue(event.propertyId))).size) },
    ]),
    callouts: [
      {
        title: 'Failure visibility',
        body: 'The current ingest path rejects bad batches before storage and does not keep a dead-letter collection. This page shows the live accepted-event stream and top properties instead of redirecting to a generic dashboard.',
      },
    ],
    sections: [
      {
        title: 'Top properties by 7-day event volume',
        columns: ['Property', 'Domain', 'Organization', 'Events', 'Last seen'],
        rows: topProperties.map(([propertyId, volume]) => {
          const property = propertyMap.get(propertyId)
          return {
            id: propertyId,
            cells: [
              stringValue(property?.name, propertyId),
              stringValue(property?.domain, 'unknown'),
              stringValue(property?.orgId, 'unknown'),
              String(volume),
              formatDateTime(
                lastWeek.find((event) => stringValue(event.propertyId) === propertyId)?.timestamp,
              ),
            ],
          }
        }),
        emptyMessage: 'No analytics events are stored for the accessible admin scope.',
      },
      {
        title: 'Recent sample events',
        columns: ['Event', 'Property', 'Session', 'Path', 'Timestamp'],
        rows: events.slice(0, 30).map((event) => ({
          id: event.id,
          cells: [
            stringValue(event.event, 'event'),
            stringValue(event.propertyId, 'unknown'),
            stringValue(event.sessionId, 'unknown'),
            stringValue(event.pageUrl, stringValue((event.properties as Record<string, unknown> | undefined)?.path, 'n/a')),
            formatDateTime(event.timestamp),
          ],
        })),
        emptyMessage: 'No sample events are available.',
      },
    ],
  }
}

export async function buildScrolledbrainSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const properties = await readOrgScopedCollection(user, 'properties', 160)
  const property = properties.find((entry) => stringValue(entry.domain).includes('scrolledbrain'))

  if (!property) {
    return {
      metrics: [],
      sections: [
        {
          title: 'Scrolledbrain property',
          columns: ['Status'],
          rows: [],
          emptyMessage: 'No property with a scrolledbrain domain is available in this admin scope.',
        },
      ],
    }
  }

  const eventsSnapshot = await adminDb
    .collection('product_events')
    .where('propertyId', '==', property.id)
    .limit(200)
    .get()
    .catch(() => null)
  const events = eventsSnapshot ? asDocs(eventsSnapshot) : []
  const pageCounts = new Map<string, number>()
  for (const event of events) {
    const page = stringValue(event.pageUrl, stringValue((event.properties as Record<string, unknown> | undefined)?.path, '/'))
    pageCounts.set(page, (pageCounts.get(page) ?? 0) + 1)
  }

  return {
    actions: buildActions({ label: 'Ingestion monitor', href: '/admin/analytics/ingestion' }),
    metrics: buildMetrics([
      { label: 'Property id', value: property.id },
      { label: 'Status', value: stringValue(property.status, 'draft') },
      { label: 'Events stored', value: String(events.length) },
      { label: 'Ingest key rotated', value: formatDateTime(property.ingestKeyRotatedAt) },
    ]),
    sections: [
      {
        title: 'Top pages',
        columns: ['Page', 'Views', 'Last seen', 'Property', 'Type'],
        rows: Array.from(pageCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 25)
          .map(([page, views]) => ({
            id: page,
            cells: [
              page,
              String(views),
              formatDateTime(events.find((event) => stringValue(event.pageUrl, stringValue((event.properties as Record<string, unknown> | undefined)?.path, '/')) === page)?.timestamp),
              stringValue(property.name, property.id),
              stringValue(property.type, 'web'),
            ],
          })),
        emptyMessage: 'No stored page events were found for the Scrolledbrain property.',
      },
    ],
  }
}

export async function buildReportTemplatesSurface(): Promise<AdminBacklogSurfacePayload> {
  return {
    metrics: buildMetrics([
      { label: 'Platform templates', value: String(REPORT_EMAIL_TEMPLATES.length) },
      { label: 'Default template', value: REPORT_EMAIL_TEMPLATES[0]?.name ?? 'Standard performance' },
      { label: 'Email-focused', value: 'Yes', helper: 'Templates currently drive report share/schedule messaging.' },
      { label: 'Deletion model', value: 'Admin only' },
    ]),
    sections: [
      {
        title: 'Template library',
        description: 'Current report email template registry used by share and schedule flows.',
        columns: ['Template', 'Eyebrow', 'Subject', 'Description', 'Status'],
        rows: REPORT_EMAIL_TEMPLATES.map((template) => ({
          id: template.id,
          cells: [
            template.name,
            template.eyebrow,
            template.subject,
            template.description,
            template.id === 'standard' ? 'Default' : 'Available',
          ],
        })),
      },
    ],
  }
}

export async function buildSocialCredentialsSurface(): Promise<AdminBacklogSurfacePayload> {
  const configuredRows = SOCIAL_PLATFORMS.map((platform) => {
    const oauthPlatform = platform.key === 'linkedin_org' ? 'linkedin' : platform.key
    const linkedInMode = platform.key === 'linkedin_org' ? 'organization' : platform.key === 'linkedin' ? 'personal' : undefined
    const config = getOAuthConfig(oauthPlatform as never, linkedInMode ? { linkedinMode: linkedInMode } : {})
    const credentials = getClientCredentials(oauthPlatform as never, linkedInMode ? { linkedinMode: linkedInMode } : {})
    return {
      platform: platform.label,
      clientId: credentials?.clientId ?? '',
      callback: config ? getCallbackUrl(oauthPlatform as never) : 'Uses app passwords / not configured',
      scopes: config?.scopes.length ?? 0,
      status: credentials ? 'configured' : 'missing',
    }
  })

  return {
    metrics: buildMetrics([
      { label: 'Configured', value: String(configuredRows.filter((row) => row.status === 'configured').length) },
      { label: 'Missing', value: String(configuredRows.filter((row) => row.status === 'missing').length) },
      { label: 'Inbox webhook secret', value: process.env.SOCIAL_INBOX_WEBHOOK_SECRET ? 'Present' : 'Missing' },
      { label: 'OAuth variants', value: String(configuredRows.length) },
    ]),
    sections: [
      {
        title: 'Credential registry',
        description: 'Masked client-id presence, callback routes, and requested scopes for the current social OAuth stack.',
        columns: ['Platform', 'Client id', 'Callback', 'Scopes', 'Status'],
        rows: configuredRows.map((row) => ({
          id: row.platform,
          cells: [
            row.platform,
            maskValue(row.clientId),
            row.callback,
            String(row.scopes),
            row.status,
          ],
        })),
      },
    ],
  }
}

export async function buildImportToolsSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const orgs = Array.from((await readOrganizations(user)).values())

  return {
    metrics: buildMetrics([
      { label: 'Accessible orgs', value: String(orgs.length) },
      { label: 'Live import lane', value: 'Contacts CSV' },
      { label: 'Planned lanes', value: 'Social, email, analytics', helper: 'This route now exists so those additions can land without redirect churn.' },
      { label: 'Rollback model', value: 'Operator review' },
    ]),
    sections: [
      {
        title: 'Organization import launchers',
        description: 'Open the existing admin contact importer in the target org scope.',
        columns: ['Organization', 'Slug', 'Status', 'Import lane', 'Route'],
        rows: orgs.map((org) => ({
          id: org.id,
          cells: [
            org.name,
            org.slug,
            org.status,
            'Contacts CSV',
            `/admin/org/${org.slug}/capture-sources/import`,
          ],
          href: `/admin/org/${org.slug}/capture-sources/import`,
          actions: buildActions({ label: 'Open importer', href: `/admin/org/${org.slug}/capture-sources/import` }),
        })),
        emptyMessage: 'No accessible organizations are available for admin-led CSV imports.',
      },
      {
        title: 'Tool lanes',
        columns: ['Lane', 'Scope', 'State', 'Operator action', 'Notes'],
        rows: [
          { id: 'contacts', cells: ['Contacts', 'Per org', 'Live', 'Use org importer', 'Dry-run validation and preview already exist.'] },
          { id: 'social', cells: ['Social posts', 'Platform', 'Planned', 'Spec backlog', 'Needs a safe bulk draft/import contract.'] },
          { id: 'email', cells: ['Email campaigns', 'Platform', 'Planned', 'Spec backlog', 'Needs content + audience validation before import.'] },
          { id: 'analytics', cells: ['Analytics events', 'Property', 'Planned', 'Spec backlog', 'Should stay behind ingest-key and schema validation.'] },
        ],
      },
    ],
  }
}

export async function buildAnnouncementsSurface(user: ApiUser): Promise<AdminBacklogSurfacePayload> {
  const [notifications, changelog] = await Promise.all([
    readOrgScopedCollection(user, 'notifications', 120),
    readGlobalCollection('changelog', 40, 'date'),
  ])

  const highPriority = notifications.filter((notification) => ['high', 'critical'].includes(stringValue(notification.priority)))

  return {
    actions: buildActions(
      { label: 'Open updates council', href: '/admin/updates' },
      { label: 'Open changelog manager', href: '/admin/changelog' },
    ),
    metrics: buildMetrics([
      { label: 'High-priority notices', value: String(highPriority.length) },
      { label: 'Unread alerts', value: String(notifications.filter((notification) => stringValue(notification.status, 'unread') === 'unread').length) },
      { label: 'Portal changelog entries', value: String(changelog.length) },
      { label: 'Current route', value: '/admin/announcements' },
    ]),
    sections: [
      {
        title: 'Recent operator notices',
        description: 'Live notification feed rows with high or critical priority.',
        columns: ['Title', 'Type', 'Priority', 'Status', 'Created'],
        rows: highPriority.slice(0, 40).map((notification) => ({
          id: notification.id,
          cells: [
            stringValue(notification.title, notification.id),
            stringValue(notification.type, 'notice'),
            stringValue(notification.priority, 'high'),
            stringValue(notification.status, 'unread'),
            formatDateTime(notification.createdAt),
          ],
        })),
        emptyMessage: 'No high-priority operator notices are currently stored.',
      },
      {
        title: 'Portal-visible release notes',
        columns: ['Version', 'Date', 'Title', 'Notes', 'Surface'],
        rows: changelog.map((entry) => ({
          id: entry.id,
          cells: [
            stringValue(entry.version, entry.id),
            stringValue(entry.date, formatDate(entry.createdAt)),
            stringValue(entry.title, 'Release note'),
            String(Array.isArray(entry.notes) ? entry.notes.length : 0),
            '/portal/changelog',
          ],
          actions: buildActions({ label: 'Open changelog', href: '/admin/changelog' }),
        })),
        emptyMessage: 'No portal changelog entries exist yet.',
      },
    ],
  }
}

export async function buildChangelogSurface(): Promise<AdminBacklogSurfacePayload> {
  const changelog = await readGlobalCollection('changelog', 60, 'date')

  return {
    actions: buildActions({ label: 'Open portal changelog', href: '/portal/changelog' }),
    metrics: buildMetrics([
      { label: 'Entries', value: String(changelog.length) },
      { label: 'Latest version', value: stringValue(changelog[0]?.version, 'n/a') },
      { label: 'Latest publish date', value: stringValue(changelog[0]?.date, 'n/a') },
      { label: 'Unread badge source', value: 'Portal', helper: 'Portal users read from this collection and persist lastReadAt on their user record.' },
    ]),
    sections: [
      {
        title: 'Changelog entries',
        description: 'Current portal changelog records, newest first.',
        columns: ['Version', 'Date', 'Title', 'Notes', 'Created'],
        rows: changelog.map((entry) => ({
          id: entry.id,
          cells: [
            stringValue(entry.version, entry.id),
            stringValue(entry.date, 'n/a'),
            stringValue(entry.title, 'Release note'),
            String(Array.isArray(entry.notes) ? entry.notes.length : 0),
            formatDateTime(entry.createdAt),
          ],
        })),
        emptyMessage: 'No changelog entries are stored yet.',
      },
    ],
  }
}
