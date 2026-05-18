#!/usr/bin/env tsx
// End-to-end smoke for Sub-5 A/B Testing.
//
// Required env vars:
//   PIB_SMOKE_ORG_ID
//   PIB_SMOKE_CAMPAIGN_ID    — canonical campaign id (parent for level=adset experiment)
//   PIB_SMOKE_AD_SET_ID      — canonical ad-set id to duplicate as source for variants

import { createExperiment, archiveExperiment, getExperiment, updateExperimentStatus, appendResult } from '@/lib/ads/experiments/store'
import { generateVariantEntities } from '@/lib/ads/experiments/start'
import { aggregateAllVariants } from '@/lib/ads/experiments/results'
import { computeSignificance } from '@/lib/ads/experiments/significance'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

async function main() {
  const orgId = process.env.PIB_SMOKE_ORG_ID
  const campaignId = process.env.PIB_SMOKE_CAMPAIGN_ID
  const adSetId = process.env.PIB_SMOKE_AD_SET_ID
  if (!orgId || !campaignId || !adSetId) {
    console.log('[smoke-ads-sub5-experiments] SKIP — PIB_SMOKE_ORG_ID / PIB_SMOKE_CAMPAIGN_ID / PIB_SMOKE_AD_SET_ID not all set')
    return
  }

  const ts = Date.now()
  console.log(`[smoke-ads-sub5-experiments] orgId=${orgId} run=${ts}`)

  // Step 1: Create experiment (draft)
  const experiment = await createExperiment({
    orgId, createdBy: 'smoke',
    input: {
      name: `Smoke experiment ${ts}`,
      level: 'adset',
      parentEntityId: campaignId,
      sourceEntityId: adSetId,
      platform: 'meta',
      variants: [
        { id: 'a', name: 'Control', trafficPercent: 50 },
        { id: 'b', name: 'Variant B', trafficPercent: 50, overrides: { name: `${ts}-variant-b` } },
      ],
      successMetric: 'conv_rate',
      minDays: 0,  // smoke runs immediately
      significanceThreshold: 0.05,
      autoWinner: false,
    },
  })
  console.log(`[smoke] ✓ created experiment ${experiment.id} (draft)`)

  const syntheticMetricIds: string[] = []
  try {
    // Step 2: Start — generate variant entities
    const started = await generateVariantEntities({ experiment })
    await adminDb.collection('ad_experiments').doc(experiment.id).update({
      variants: started.variants,
      updatedAt: Timestamp.now(),
    })
    await updateExperimentStatus(experiment.id, 'running', { startedAt: Timestamp.now() })
    console.log(`[smoke] ✓ started — variant entityIds populated:`)
    for (const v of started.variants) {
      console.log(`    ${v.id} (${v.name}) → ${v.entityId}`)
    }

    // Step 3: Inject synthetic metrics. Make variant B clearly better (higher conv_rate).
    const today = new Date().toISOString().slice(0, 10)
    const synthetic = [
      // Variant A — 1000 impressions, 50 clicks, 1 conversion (2% conv rate)
      { dimensionId: started.variants[0].entityId!, metric: 'impressions', value: 1000 },
      { dimensionId: started.variants[0].entityId!, metric: 'clicks', value: 50 },
      { dimensionId: started.variants[0].entityId!, metric: 'conversions', value: 1 },
      { dimensionId: started.variants[0].entityId!, metric: 'spend_cents', value: 5000 },
      // Variant B — 1000 impressions, 50 clicks, 10 conversions (20% conv rate — clear winner)
      { dimensionId: started.variants[1].entityId!, metric: 'impressions', value: 1000 },
      { dimensionId: started.variants[1].entityId!, metric: 'clicks', value: 50 },
      { dimensionId: started.variants[1].entityId!, metric: 'conversions', value: 10 },
      { dimensionId: started.variants[1].entityId!, metric: 'spend_cents', value: 5000 },
    ]
    for (const m of synthetic) {
      const docId = `smoke_${ts}_${m.dimensionId}_${m.metric}`
      syntheticMetricIds.push(docId)
      await adminDb.collection('metrics').doc(docId).set({
        orgId, source: 'meta_ads', level: 'adset',
        dimensionId: m.dimensionId, date: today,
        metric: m.metric, value: m.value,
        updatedAt: Timestamp.now(),
      })
    }
    console.log(`[smoke] ✓ injected ${synthetic.length} synthetic metric rows`)

    // Step 4: Compute significance
    const fresh = await getExperiment(experiment.id)
    if (!fresh) throw new Error('experiment vanished')
    const results = await aggregateAllVariants({ experiment: fresh, fromDate: today, toDate: today })
    console.log(`[smoke] ✓ aggregated ${results.length} variant results:`)
    for (const r of results) {
      console.log(`    ${r.variantId}: imp=${r.impressions} clicks=${r.clicks} conv=${r.conversions} convRate=${(r.convRate*100).toFixed(2)}%`)
    }

    const sig = computeSignificance({
      input: {
        metric: 'conv_rate',
        variants: results.map((r) => ({
          id: r.variantId, impressions: r.impressions, clicks: r.clicks,
          conversions: r.conversions, spendCents: r.spendCents,
        })),
      },
      threshold: 0.05,
    })
    console.log(`[smoke] ✓ significance: pValue=${sig.pValue.toFixed(5)} confident=${sig.confident} winner=${sig.winnerVariantId ?? 'none'}`)
    if (!sig.confident) throw new Error(`Expected confident significance (variant B has 10x conv rate of A) but got pValue=${sig.pValue}`)
    if (sig.winnerVariantId !== 'b') throw new Error(`Expected winner=b but got ${sig.winnerVariantId}`)

    // Step 5: Persist results
    for (const r of results) {
      await appendResult({ experimentId: experiment.id, result: r })
    }
    await updateExperimentStatus(experiment.id, 'running', {
      significance: { pValue: sig.pValue, confident: sig.confident, winnerVariantId: sig.winnerVariantId, computedAt: Timestamp.now() },
    })
    console.log(`[smoke] ✓ persisted results + significance`)

    // Step 6: Declare winner
    await updateExperimentStatus(experiment.id, 'winner_declared', {
      declaredWinnerVariantId: 'b',
      endedAt: Timestamp.now(),
    })
    console.log('[smoke] ✓ winner declared: variant b')

    console.log('\n[smoke-ads-sub5-experiments] ALL CHECKS PASSED ✅')
  } catch (err) {
    console.error('[smoke-ads-sub5-experiments] FAILED ❌', err)
    process.exitCode = 1
  } finally {
    // Cleanup synthetic metrics
    for (const id of syntheticMetricIds) {
      try { await adminDb.collection('metrics').doc(id).delete() } catch {}
    }
    if (syntheticMetricIds.length > 0) console.log(`[cleanup] deleted ${syntheticMetricIds.length} synthetic metric rows`)

    // Cleanup the variant entities (non-control) we created
    try {
      const fresh = await getExperiment(experiment.id)
      if (fresh) {
        const collection = fresh.level === 'adset' ? 'ad_sets' : 'ads'
        for (let i = 1; i < fresh.variants.length; i++) {
          const v = fresh.variants[i]
          if (v.entityId) {
            try { await adminDb.collection(collection).doc(v.entityId).delete() } catch {}
          }
        }
      }
    } catch {}

    // Archive the experiment
    try {
      await archiveExperiment(experiment.id)
      console.log(`[cleanup] archived experiment ${experiment.id}`)
    } catch (e) {
      console.warn(`[cleanup] failed: ${(e as Error).message}`)
    }
  }
}

main().catch((err) => {
  console.error('[smoke-ads-sub5-experiments] FATAL', err)
  process.exit(1)
})
