/**
 * Dry-run-first email event reconciliation/backfill.
 *
 *   npx tsx scripts/reconcile-email-events.ts --org org-id
 *   npx tsx scripts/reconcile-email-events.ts --org org-id --apply
 *
 * --apply writes only deterministic `email_event_rollups/<orgId>:<programId>`
 * read models. Immutable `email_events` and legacy stats are never changed.
 */
import { adminDb } from '../lib/firebase/admin'
import { buildReconciliationReport } from '../lib/email-events/reconciliation'

const args = process.argv.slice(2)
const value = (flag: string) => {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}
const orgId = value('--org')?.trim()
const apply = args.includes('--apply')
if (!orgId) throw new Error('Required: --org <organisation-id>')

async function main() {
  const snapshot = await adminDb.collection('email_events').where('orgId', '==', orgId).get()
  const groups = new Map<string, Array<Record<string, unknown>>>()
  for (const doc of snapshot.docs) {
    const data = doc.data()
    if (data.orgId !== orgId) throw new Error(`Tenant mismatch in email event ${doc.id}`)
    const programId = typeof data.programId === 'string' && data.programId ? data.programId : '_unattributed'
    const rows = groups.get(programId) ?? []
    rows.push({ id: doc.id, ...data })
    groups.set(programId, rows)
  }

  const reports = []
  for (const [programId, events] of groups) {
    const rollupId = `${orgId}:${programId}`
    const ref = adminDb.collection('email_event_rollups').doc(rollupId)
    const current = await ref.get()
    const stored = (current.data()?.metrics ?? {}) as Record<string, number>
    const report = buildReconciliationReport({ orgId, events: events as never, stored })
    reports.push({ programId, sourceEvents: events.length, ...report })
    if (apply) {
      await ref.set({ orgId, programId, metrics: report.rebuilt, sourceEvents: events.length, schemaVersion: 1 }, { merge: false })
    }
  }
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', orgId, reports }, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
