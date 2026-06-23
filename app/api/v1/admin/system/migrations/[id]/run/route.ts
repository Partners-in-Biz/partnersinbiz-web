// app/api/v1/admin/system/migrations/[id]/run/route.ts
// POST — super-admin only. Executes a registered migration (dry-run or live)
// and records a migration_runs document with a live-pollable log.

import { withAuth } from '@/lib/api/auth'
import { apiSuccess, apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'
import { Timestamp } from 'firebase-admin/firestore'
import type { MemberRef } from '@/lib/orgMembers/memberRef'
import type { Contact } from '@/lib/crm/types'
import {
  groupContactsByCompanyKey,
  applyMigration,
  type MigrationSelection,
} from '@/lib/companies/migration'
import { migrateOrgToDefaultPipeline } from '@/lib/pipelines/migration'

export const dynamic = 'force-dynamic'

export const POST = withAuth('admin', async (req, user, context) => {
  if (!isSuperAdmin(user)) return apiError('Super admin only', 403)

  const { id } = (await context.params) as { id: string }

  const body = (await req.json().catch(() => ({}))) as {
    dryRun?: boolean
    confirm?: string
    orgId?: string
  }

  const dryRun = body.dryRun !== false // default ON
  const orgId = typeof body.orgId === 'string' && body.orgId.trim() ? body.orgId.trim() : undefined

  if (body.confirm !== id) {
    return apiError('Confirmation token must equal the migration id', 400)
  }

  const defRef = adminDb.collection('migrations').doc(id)
  const defSnap = await defRef.get()
  if (!defSnap.exists) return apiError('Migration not found', 404)

  const actor: MemberRef = {
    uid: user.uid,
    displayName:
      (user as unknown as { name?: string; email?: string }).name ??
      (user as unknown as { name?: string; email?: string }).email ??
      user.uid,
    kind: 'human',
  }
  const triggeredBy = {
    uid: user.uid,
    name:
      (user as unknown as { name?: string; email?: string }).name ??
      (user as unknown as { name?: string; email?: string }).email ??
      user.uid,
  }

  // Create the run record up-front (status running) so the client can poll it.
  const runRef = adminDb.collection('migration_runs').doc()
  await runRef.set({
    migrationId: id,
    status: 'running',
    dryRun,
    orgId: orgId ?? null,
    startedAt: Timestamp.now(),
    finishedAt: null,
    log: [],
    itemsProcessed: 0,
    error: null,
    triggeredBy,
  })

  const log: string[] = []
  let itemsProcessed = 0
  let status: 'completed' | 'failed' = 'completed'
  let error: string | null = null

  const push = (line: string) => log.push(`[${new Date().toISOString()}] ${line}`)

  try {
    push(`Starting "${id}" — mode: ${dryRun ? 'DRY RUN' : 'LIVE'}${orgId ? ` — orgId: ${orgId}` : ''}`)

    if (id === 'migrate-companies-from-contacts') {
      if (dryRun) {
        if (orgId) {
          const snap = await adminDb
            .collection('contacts')
            .where('orgId', '==', orgId)
            .limit(5000)
            .get()
          const contacts: Contact[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Contact, 'id'>) }))
          const groups = groupContactsByCompanyKey(contacts)
          const affected = groups.reduce((sum, g) => sum + g.contactIds.length, 0)
          push(`Loaded ${contacts.length} contacts for org ${orgId}.`)
          push(`Would create/link ${groups.length} company group(s), affecting ${affected} contact(s).`)
          itemsProcessed = affected
        } else {
          // Org-wide count: contacts with a company string but no companyId.
          const snap = await adminDb.collection('contacts').limit(5000).get()
          const byOrg = new Map<string, number>()
          let affected = 0
          for (const d of snap.docs) {
            const data = d.data() as { orgId?: string; company?: string; companyId?: string }
            if (data.companyId) continue
            if (typeof data.company === 'string' && data.company.trim()) {
              affected++
              const k = data.orgId ?? '(no-org)'
              byOrg.set(k, (byOrg.get(k) ?? 0) + 1)
            }
          }
          push(`Scanned ${snap.docs.length} contacts across all orgs (capped 5000).`)
          push(`${affected} contact(s) have a company string but no companyId, across ${byOrg.size} org(s).`)
          for (const [k, n] of byOrg.entries()) push(`  org ${k}: ${n} contact(s)`)
          push('Provide an orgId to run this migration live for a specific org.')
          itemsProcessed = affected
        }
      } else {
        // Live run requires an orgId.
        if (!orgId) {
          push('orgId required for live run of this migration')
          throw new Error('orgId required for live run of this migration')
        }
        const snap = await adminDb
          .collection('contacts')
          .where('orgId', '==', orgId)
          .limit(5000)
          .get()
        const contacts: Contact[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Contact, 'id'>) }))
        const groups = groupContactsByCompanyKey(contacts)
        push(`Loaded ${contacts.length} contacts; built ${groups.length} company group(s).`)
        const selections: MigrationSelection[] = groups.map((g) => ({
          normalizedKey: g.normalizedKey,
          companyName: g.suggestedCompanyName,
          applyToContactIds: g.contactIds,
          useExistingCompanyId: g.existingCompanyId ?? undefined,
        }))
        const results = await applyMigration(orgId, selections, actor)
        for (const r of results) {
          push(
            `  ${r.normalizedKey}: ${r.outcome}` +
              (r.companyId ? ` (company ${r.companyId})` : '') +
              ` — ${r.contactsUpdated} contact(s)` +
              (r.error ? ` — ERROR: ${r.error}` : ''),
          )
        }
        itemsProcessed = results.reduce((sum, r) => sum + r.contactsUpdated, 0)
        const failed = results.filter((r) => r.outcome === 'failed').length
        if (failed > 0) push(`${failed} group(s) failed.`)
      }
    } else if (id === 'migrate-org-to-default-pipeline') {
      if (orgId) {
        const result = await migrateOrgToDefaultPipeline(orgId, actor, { dryRun })
        push(`Pipeline ${result.pipelineCreated ? 'created' : 'reused'}: ${result.pipelineId}`)
        push(`${dryRun ? 'Would update' : 'Updated'} ${result.dealsUpdated} deal(s).`)
        for (const e of result.errors) push(`  ERROR: ${e}`)
        itemsProcessed = result.dealsUpdated
        if (result.errors.length > 0) throw new Error(result.errors.join('; '))
      } else if (dryRun) {
        // Org-wide count: deals with a stage string and no pipelineId.
        const snap = await adminDb.collection('deals').limit(5000).get()
        const byOrg = new Map<string, number>()
        let affected = 0
        for (const d of snap.docs) {
          const data = d.data() as { orgId?: string; stage?: unknown; pipelineId?: string }
          if (typeof data.stage === 'string' && !data.pipelineId) {
            affected++
            const k = data.orgId ?? '(no-org)'
            byOrg.set(k, (byOrg.get(k) ?? 0) + 1)
          }
        }
        push(`Scanned ${snap.docs.length} deals across all orgs (capped 5000).`)
        push(`${affected} legacy deal(s) have a string stage and no pipelineId, across ${byOrg.size} org(s).`)
        for (const [k, n] of byOrg.entries()) push(`  org ${k}: ${n} deal(s)`)
        push('Provide an orgId to run this migration live for a specific org.')
        itemsProcessed = affected
      } else {
        push('orgId required for live run of this migration')
        throw new Error('orgId required for live run of this migration')
      }
    } else {
      push(`No handler registered for migration "${id}".`)
      throw new Error(`No handler registered for migration "${id}"`)
    }

    push(`Done. itemsProcessed = ${itemsProcessed}.`)
  } catch (e) {
    status = 'failed'
    error = e instanceof Error ? e.message : String(e)
    push(`FAILED: ${error}`)
  }

  const finishedAt = Timestamp.now()
  await runRef.update({
    status,
    log,
    itemsProcessed,
    error,
    finishedAt,
  })
  await defRef.update({ lastRunAt: finishedAt, status })

  return apiSuccess({ runId: runRef.id, status, itemsProcessed, log })
})
