import { withAuth } from '@/lib/api/auth'
import { adminDb } from '@/lib/firebase/admin'
import { toMonthlyZar, loadSubscriptions } from '@/lib/billing/metrics'
import type { Plan } from '@/lib/plans/types'

export const dynamic = 'force-dynamic'

function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const GET = withAuth('admin', async () => {
  const [subs, plansSnap, orgsSnap, paidSnap] = await Promise.all([
    loadSubscriptions(),
    adminDb.collection('plans').get(),
    adminDb.collection('organizations').get(),
    adminDb.collection('invoices').where('status', '==', 'paid').get(),
  ])

  const planNameByKey = new Map<string, string>()
  for (const doc of plansSnap.docs) {
    const p = doc.data() as Plan
    if (p.key) planNameByKey.set(p.key, p.name ?? p.key)
  }

  const orgMeta = new Map<string, { name: string; slug: string }>()
  for (const doc of orgsSnap.docs) {
    const o = doc.data() as { name?: string; slug?: string; type?: string }
    if (o.type === 'platform_owner') continue
    orgMeta.set(doc.id, { name: o.name ?? doc.id, slug: o.slug ?? doc.id })
  }

  const lifetimeByOrg = new Map<string, number>()
  for (const doc of paidSnap.docs) {
    const inv = doc.data() as { orgId?: string; paidAmount?: number; total?: number; currency?: string }
    if (inv.currency && inv.currency !== 'ZAR') continue
    if (!inv.orgId) continue
    const amt = typeof inv.paidAmount === 'number' ? inv.paidAmount : (inv.total ?? 0)
    lifetimeByOrg.set(inv.orgId, (lifetimeByOrg.get(inv.orgId) ?? 0) + amt)
  }

  const mrrByOrg = new Map<string, number>()
  for (const sub of subs) {
    if (sub.status !== 'active' || !sub.orgId) continue
    mrrByOrg.set(
      sub.orgId,
      (mrrByOrg.get(sub.orgId) ?? 0) + toMonthlyZar(sub.priceZar ?? 0, sub.interval ?? 'monthly'),
    )
  }

  const topOrgs = Array.from(lifetimeByOrg.entries())
    .filter(([orgId]) => orgMeta.has(orgId))
    .map(([orgId, lifetimeZar]) => ({ orgId, lifetimeZar, mrrZar: mrrByOrg.get(orgId) ?? 0 }))
    .sort((a, b) => b.lifetimeZar - a.lifetimeZar)
    .slice(0, 10)

  // Plan distribution.
  const distMap = new Map<string, { count: number; mrrZar: number }>()
  for (const sub of subs) {
    if (sub.status !== 'active') continue
    const key = sub.planKey ?? 'unknown'
    const entry = distMap.get(key) ?? { count: 0, mrrZar: 0 }
    entry.count += 1
    entry.mrrZar += toMonthlyZar(sub.priceZar ?? 0, sub.interval ?? 'monthly')
    distMap.set(key, entry)
  }

  const lines: string[] = []
  lines.push('Top organisations by lifetime revenue')
  lines.push(['Rank', 'Organisation', 'Slug', 'Lifetime ZAR', 'Active MRR ZAR'].map(csvField).join(','))
  topOrgs.forEach((o, i) => {
    const meta = orgMeta.get(o.orgId)!
    lines.push(
      [i + 1, meta.name, meta.slug, Math.round(o.lifetimeZar), Math.round(o.mrrZar)]
        .map(csvField)
        .join(','),
    )
  })
  lines.push('')
  lines.push('Plan distribution (active subscriptions)')
  lines.push(['Plan key', 'Plan name', 'Active subs', 'MRR ZAR'].map(csvField).join(','))
  Array.from(distMap.entries())
    .sort((a, b) => b[1].mrrZar - a[1].mrrZar)
    .forEach(([key, v]) => {
      lines.push(
        [key, planNameByKey.get(key) ?? key, v.count, Math.round(v.mrrZar)].map(csvField).join(','),
      )
    })

  const csv = lines.join('\n')
  const filename = `revenue-export-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})
