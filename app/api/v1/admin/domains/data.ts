// app/api/v1/admin/domains/data.ts
//
// Shared loader + helpers for the admin white-label domain management surface
// (US-279). Reads custom-domain config from organizations.{id}.settings.customDomain,
// scoped to the calling admin's accessible orgs.

import type { ApiUser } from '@/lib/api/types'
import { restrictedAdminOrgIds, canAccessOrg } from '@/lib/api/platformAdmin'
import { adminDb } from '@/lib/firebase/admin'

// The CNAME target every white-label domain must point at. Kept in sync with
// app/api/v1/org/domain/route.ts (DOMAIN_CNAME_TARGET).
export const DOMAIN_CNAME_TARGET = 'cname.partnersinbiz.online'
export const ROOT_DOMAIN = 'partnersinbiz.online'

export type SslStatus = 'pending' | 'active' | 'failed'

export interface DomainRow {
  orgId: string
  orgName: string
  slug: string
  subdomain: string
  customDomain: string
  portalAlias: string
  verified: boolean
  sslStatus: SslStatus
  dnsTarget: string
  verifiedAt: string | null
  lastCheckedAt: string | null
  lastError: string | null
}

export interface DomainsResult {
  rows: DomainRow[]
  scope: 'all' | 'restricted'
  cnameTarget: string
  rootDomain: string
  counts: {
    total: number
    verified: number
    active: number
    pending: number
    failed: number
  }
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function readCustomDomain(settings: Record<string, unknown> | undefined): {
  subdomain: string
  customDomain: string
  verified: boolean
  sslStatus: SslStatus
  verifiedAt: string | null
  lastCheckedAt: string | null
  lastError: string | null
} {
  const cfg = ((settings?.customDomain ?? {}) as Record<string, unknown>) || {}
  const sslStatus =
    cfg.sslStatus === 'active' || cfg.sslStatus === 'failed' ? (cfg.sslStatus as SslStatus) : 'pending'
  return {
    subdomain: typeof cfg.subdomain === 'string' ? cfg.subdomain : '',
    customDomain: typeof cfg.customDomain === 'string' ? cfg.customDomain : '',
    verified: cfg.verified === true,
    sslStatus,
    verifiedAt: typeof cfg.verifiedAt === 'string' ? cfg.verifiedAt : null,
    lastCheckedAt: typeof cfg.lastCheckedAt === 'string' ? cfg.lastCheckedAt : null,
    lastError: typeof cfg.lastError === 'string' ? cfg.lastError : null,
  }
}

export function toDomainRow(doc: { id: string; data: Record<string, unknown> }): DomainRow {
  const orgName = str(doc.data.name, doc.id)
  const slug = str(doc.data.slug, doc.id)
  const settings = (doc.data.settings ?? {}) as Record<string, unknown>
  const cfg = readCustomDomain(settings)
  return {
    orgId: doc.id,
    orgName,
    slug,
    subdomain: cfg.subdomain,
    customDomain: cfg.customDomain,
    portalAlias: cfg.subdomain ? `${cfg.subdomain}.${ROOT_DOMAIN}` : '',
    verified: cfg.verified,
    sslStatus: cfg.sslStatus,
    dnsTarget: DOMAIN_CNAME_TARGET,
    verifiedAt: cfg.verifiedAt,
    lastCheckedAt: cfg.lastCheckedAt,
    lastError: cfg.lastError,
  }
}

async function readScopedOrgDocs(
  user: ApiUser,
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
  const restricted = restrictedAdminOrgIds(user)
  if (restricted.length > 0) {
    const docs = await Promise.all(
      restricted.map((id) => adminDb.collection('organizations').doc(id).get().catch(() => null)),
    )
    return docs
      .filter((d): d is FirebaseFirestore.DocumentSnapshot => !!d && d.exists)
      .map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, unknown> }))
  }
  const snapshot = await adminDb.collection('organizations').limit(400).get().catch(() => null)
  return (snapshot?.docs ?? []).map((d) => ({ id: d.id, data: (d.data() ?? {}) as Record<string, unknown> }))
}

export async function loadDomains(user: ApiUser): Promise<DomainsResult> {
  const orgDocs = await readScopedOrgDocs(user)
  const rows = orgDocs
    .map(toDomainRow)
    // Only orgs that have set up a custom domain or portal alias.
    .filter((row) => row.customDomain || row.subdomain)
    .sort((a, b) => a.orgName.localeCompare(b.orgName))

  return {
    rows,
    scope: restrictedAdminOrgIds(user).length > 0 ? 'restricted' : 'all',
    cnameTarget: DOMAIN_CNAME_TARGET,
    rootDomain: ROOT_DOMAIN,
    counts: {
      total: rows.length,
      verified: rows.filter((r) => r.verified).length,
      active: rows.filter((r) => r.sslStatus === 'active').length,
      pending: rows.filter((r) => r.sslStatus === 'pending').length,
      failed: rows.filter((r) => r.sslStatus === 'failed').length,
    },
  }
}

// Load a single org's domain row, enforcing access scope. Returns null when
// the org does not exist; throws-style { forbidden } when out of scope.
export async function loadDomainForOrg(
  user: ApiUser,
  orgId: string,
): Promise<{ ok: true; row: DomainRow } | { ok: false; reason: 'not_found' | 'forbidden' }> {
  if (!canAccessOrg(user, orgId)) return { ok: false, reason: 'forbidden' }
  const snap = await adminDb.collection('organizations').doc(orgId).get().catch(() => null)
  if (!snap || !snap.exists) return { ok: false, reason: 'not_found' }
  return { ok: true, row: toDomainRow({ id: snap.id, data: (snap.data() ?? {}) as Record<string, unknown> }) }
}

export function buildDomainsCsv(rows: DomainRow[]): string {
  const header = [
    'Organization',
    'Slug',
    'Custom domain',
    'Portal alias',
    'Verified',
    'SSL status',
    'DNS target',
    'Verified at',
    'Last checked',
    'Last error',
  ]
  const cell = (v: string) => {
    let raw = v ?? ''
    // Prevent CSV/formula injection: a cell starting with one of these characters
    // executes as a formula in Excel/Sheets. Prefix with an apostrophe to neutralise.
    if (/^[=+\-@\t\r]/.test(raw)) raw = `'${raw}`
    return `"${raw.replace(/"/g, '""')}"`
  }
  const lines = [header.map(cell).join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.orgName,
        row.slug,
        row.customDomain,
        row.portalAlias,
        row.verified ? 'yes' : 'no',
        row.sslStatus,
        row.dnsTarget,
        row.verifiedAt ?? '',
        row.lastCheckedAt ?? '',
        row.lastError ?? '',
      ]
        .map(cell)
        .join(','),
    )
  }
  return lines.join('\r\n')
}
