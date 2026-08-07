/**
 * Live record-scope read-back (evidence for record-scope route wiring).
 *
 * Demonstrates on LIVE production data that a member with owned_or_linked
 * record scope (Stean) sees only owned / shared / CRM-linked rows while a
 * full-access actor (agent/owner — resolves 'all') sees the whole set.
 *
 * Method:
 *  1. Fetch the live org team to resolve Stean's uid + stored accessPolicy
 *     recordScopes (source of truth for the gate).
 *  2. Fetch live row sets as the full-access agent: research, campaigns,
 *     social posts, client documents — plus live companies/contacts for the
 *     CRM assignment maps.
 *  3. Apply the SAME algorithm as lib/orgMembers/record-scope.ts
 *     filterOwnedRowsForActor, using the real shipped primitives:
 *     actorOwnsRow / crmRecordAssignedToUid / crmRecordCompanyIds, and the
 *     real recordScopeFor gate. The unit + route tests exercise the real
 *     module function; this script replays the identical algorithm against
 *     live production rows.
 *
 * Read-only. No writes. Run: npx tsx artifacts/qa/record-scope-live-readback-20260806.ts
 */
import { actorOwnsRow } from '@/lib/orgMembers/record-scope'
import { recordScopeFor } from '@/lib/orgMembers/access-policy'
import {
  crmRecordAssignedToUid,
  crmRecordCompanyIds,
  type AssignableCrmRecord,
} from '@/lib/crm/assignment-access'

const ORG = 'pib-platform-owner'
const BASE = process.env.PIB_API_BASE ?? 'https://partnersinbiz.online/api/v1'
const KEY = process.env.PIB_AGENT_API_KEY || process.env.AI_API_KEY
if (!KEY) throw new Error('PIB_AGENT_API_KEY / AI_API_KEY not set')

async function get<T = unknown>(path: string, orgHeader = true): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(orgHeader ? { 'X-Org-Id': ORG } : {}),
    },
  })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

function linkedCompanyIds(row: Record<string, unknown>): string[] {
  const linked = row.linked as Record<string, unknown> | undefined
  const ids = new Set<string>()
  for (const source of [linked, row]) {
    if (!source || typeof source !== 'object') continue
    for (const key of ['companyIds', 'companyId']) {
      const value = source[key]
      if (typeof value === 'string' && value.trim()) ids.add(value.trim())
      if (Array.isArray(value)) for (const id of value) if (typeof id === 'string' && id.trim()) ids.add(id.trim())
    }
  }
  return Array.from(ids)
}

function linkedContactIds(row: Record<string, unknown>): string[] {
  const linked = row.linked as Record<string, unknown> | undefined
  const ids = new Set<string>()
  for (const source of [linked, row]) {
    if (!source || typeof source !== 'object') continue
    for (const key of ['contactIds', 'contactId']) {
      const value = source[key]
      if (typeof value === 'string' && value.trim()) ids.add(value.trim())
      if (Array.isArray(value)) for (const id of value) if (typeof id === 'string' && id.trim()) ids.add(id.trim())
    }
  }
  return Array.from(ids)
}

/** Mirrors filterOwnedRowsForActor exactly (same primitives, same shape). */
function filterOwnedLive(
  uid: string,
  rows: Array<Record<string, unknown>>,
  companies: Map<string, AssignableCrmRecord>,
  contacts: Map<string, AssignableCrmRecord>,
): Array<Record<string, unknown>> {
  return rows.filter((row) => {
    if (actorOwnsRow(row, uid)) return true
    for (const id of linkedCompanyIds(row)) {
      if (crmRecordAssignedToUid(companies.get(id), uid)) return true
    }
    for (const id of linkedContactIds(row)) {
      const contact = contacts.get(id)
      if (crmRecordAssignedToUid(contact, uid)) return true
      for (const companyId of crmRecordCompanyIds(contact)) {
        if (crmRecordAssignedToUid(companies.get(companyId), uid)) return true
      }
    }
    return false
  })
}

async function main() {
  // 1. Team — resolve Stean + stored recordScopes.
  const teamRes = await get<{ data: Array<Record<string, unknown>> }>(
    `/organizations/${ORG}/members`,
    false,
  )
  const team = teamRes.data
  const stean = team.find((m) => m.role === 'member')
  if (!stean) throw new Error('No member-role user found (Stean)')
  const steanUid = String(stean.userId || stean.uid)
  const policy = stean.accessPolicy as Record<string, unknown>
  const recordScopes = (policy?.recordScopes ?? {}) as Record<string, string>
  console.log('STEAN:', steanUid, '| role:', stean.role)
  console.log('STEAN recordScopes (stored):', JSON.stringify(recordScopes))
  console.log('Gate per module (recordScopeFor):',
    'research =', recordScopeFor(policy, 'research'),
    '| documents =', recordScopeFor(policy, 'documents'),
    '| marketing =', recordScopeFor(policy, 'marketing'))

  // 2. Live row sets (full access = agent key, resolves 'all').
  const research = (await get<{ data: Array<Record<string, unknown>> }>(`/research?orgId=${ORG}`)).data
  const campaigns = (await get<{ data: Array<Record<string, unknown>> }>(`/campaigns?orgId=${ORG}&limit=500`)).data
  const socialPosts = (await get<{ data: Array<Record<string, unknown>> }>(`/social/posts?orgId=${ORG}&limit=200`)).data
  const documents = (await get<{ data: Array<Record<string, unknown>> }>(`/client-documents?orgId=${ORG}&limit=100`)).data
  const companiesRes = await get<{ data: { companies?: Array<Record<string, unknown>>; orgId?: string } }>(`/crm/companies?orgId=${ORG}&limit=200`)
  const contactsRes = await get<{ data: Array<Record<string, unknown>> }>(`/crm/contacts?orgId=${ORG}&limit=200`)

  const companies = new Map<string, AssignableCrmRecord>()
  for (const c of (companiesRes.data.companies ?? [])) {
    if (c.deleted === true || c.orgId !== ORG) continue
    companies.set(String(c.id), { ...c, id: c.id } as AssignableCrmRecord)
  }
  const contacts = new Map<string, AssignableCrmRecord>()
  for (const c of contactsRes.data) {
    if (c.deleted === true || c.orgId !== ORG) continue
    contacts.set(String(c.id), { ...c, id: c.id } as AssignableCrmRecord)
  }
  console.log(`\nLive CRM maps: companies=${companies.size} contacts=${contacts.size}`)

  // 3. Apply the filter algorithm per module.
  const sets: Array<{ module: string; rows: Array<Record<string, unknown>> }> = [
    { module: 'research', rows: research },
    { module: 'marketing (campaigns)', rows: campaigns },
    { module: 'marketing (social posts)', rows: socialPosts },
    { module: 'documents (client docs)', rows: documents },
  ]

  console.log('\n=== LIVE READ-BACK: full-access actor vs Stean (owned_or_linked) ===')
  for (const { module, rows } of sets) {
    const scope = recordScopeFor(policy, module.startsWith('marketing') ? 'marketing' : module.startsWith('documents') ? 'documents' : 'research')
    const fullIds = rows.map((r) => String(r.id))
    const steanRows = scope === 'all' ? rows : filterOwnedLive(steanUid, rows, companies, contacts)
    const steanIds = steanRows.map((r) => String(r.id))
    const hidden = fullIds.filter((id) => !steanIds.includes(id))
    console.log(`\n[${module}] scope=${scope}`)
    console.log(`  full-access rows : ${fullIds.length}`)
    console.log(`  Stean rows       : ${steanIds.length} (owned / shared / CRM-linked)`)
    console.log(`  hidden from Stean: ${hidden.length} ${hidden.length > 0 ? '-> ' + hidden.slice(0, 8).join(', ') + (hidden.length > 8 ? ' …' : '') : ''}`)
  }

  console.log('\nFull-access (agent) sample totals — research:', research.length,
    '| campaigns:', campaigns.length,
    '| social posts (paginated):', socialPosts.length,
    '| client documents:', documents.length)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
