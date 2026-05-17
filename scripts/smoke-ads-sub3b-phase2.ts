#!/usr/bin/env tsx
// scripts/smoke-ads-sub3b-phase2.ts
//
// End-to-end smoke for Sub-3b LinkedIn Phase 2 — Campaign Group → Campaign → Creative.
// Requires: LINKEDIN_ADS_TEST_ACCESS_TOKEN + LINKEDIN_ADS_TEST_ACCOUNT_URN
// Optional: LINKEDIN_ADS_TEST_REFERENCE_URN (urn:li:share:{id} or asset URN) for the
//           creative sub-step. If absent the creative step is skipped but the smoke
//           still counts as passed (group + campaign verify the bulk of Phase 2).
//
// What this verifies end-to-end against a LIVE LinkedIn test ad account:
//   1. Create a Campaign Group (PAUSED so no spend) — POST /adCampaignGroups
//   2. Create a Campaign (PAUSED, $1/day budget) under the group — POST /adCampaigns
//   3. Create a Creative (DRAFT) under the campaign — POST /creatives
//      (skipped when LINKEDIN_ADS_TEST_REFERENCE_URN is not set)
//   4. Pause + resume transitions on the Campaign Group
//   5. Cleanup: archive all three entities via finally block
//
// Skipped automatically (exit 0) when LINKEDIN_ADS_TEST_ACCESS_TOKEN or
// LINKEDIN_ADS_TEST_ACCOUNT_URN are not set.

import {
  createCampaignGroup,
  pauseCampaignGroup,
  resumeCampaignGroup,
  archiveCampaignGroup,
} from '@/lib/ads/providers/linkedin/campaigns'
import {
  createCampaign,
  archiveCampaign,
} from '@/lib/ads/providers/linkedin/adsets'
import {
  createCreative,
  archiveCreative,
} from '@/lib/ads/providers/linkedin/ads'
import { linkedinObjectiveFromCanonical } from '@/lib/ads/providers/linkedin/mappers'
import type { AdCampaign, AdSet, Ad } from '@/lib/ads/types'
import type { Timestamp } from 'firebase-admin/firestore'

async function main() {
  const accessToken = process.env.LINKEDIN_ADS_TEST_ACCESS_TOKEN
  const accountUrn = process.env.LINKEDIN_ADS_TEST_ACCOUNT_URN
  const referenceUrn = process.env.LINKEDIN_ADS_TEST_REFERENCE_URN  // Share URN or asset URN

  if (!accessToken || !accountUrn) {
    console.log('[smoke-ads-sub3b-phase2] SKIP — LINKEDIN_ADS_TEST_ACCESS_TOKEN or LINKEDIN_ADS_TEST_ACCOUNT_URN not set')
    process.exit(0)
  }

  const ts = Date.now()
  const runTag = `pib-smoke-p2-${ts}`

  console.log(`[smoke-ads-sub3b-phase2] run tag: ${runTag}`)
  console.log(`[smoke-ads-sub3b-phase2] account: ${accountUrn}`)

  let groupUrn: string | undefined
  let campaignUrn: string | undefined
  let creativeUrn: string | undefined

  // Minimal stub Timestamp — the LinkedIn provider functions only read
  // canonical.name, canonical.status, canonical.objective (on AdCampaign) and
  // canonical.targeting (on AdSet). The Timestamp fields are never accessed.
  const stubTs = { _seconds: 0, _nanoseconds: 0 } as unknown as Timestamp

  try {
    // ── Step 1: Campaign Group ─────────────────────────────────────────────
    const canonicalCampaign = {
      id: `${runTag}-campaign`,
      orgId: 'smoke-org',
      adAccountId: accountUrn,
      platform: 'linkedin',
      name: `${runTag} group`,
      objective: 'TRAFFIC',
      status: 'PAUSED',
      cboEnabled: false,
      specialAdCategories: [],
      providerData: {},
      createdBy: 'smoke',
      createdAt: stubTs,
      updatedAt: stubTs,
    } as unknown as AdCampaign

    const group = await createCampaignGroup({
      accountUrn,
      accessToken,
      canonical: canonicalCampaign,
      // No totalBudget — group runs uncapped; budget enforced at campaign level
    })
    groupUrn = group.urn
    console.log(`[smoke] ✓ created campaign group: ${group.urn}`)

    // ── Step 2: Campaign (AdSet) ───────────────────────────────────────────
    const canonicalAdSet = {
      id: `${runTag}-adset`,
      orgId: 'smoke-org',
      adAccountId: accountUrn,
      campaignId: canonicalCampaign.id,
      platform: 'linkedin',
      name: `${runTag} campaign`,
      status: 'PAUSED',
      optimizationGoal: 'LINK_CLICKS',
      billingEvent: 'IMPRESSIONS',
      targeting: {
        geo: { countries: ['US'] },
        demographics: {},
        customAudiences: { include: [], exclude: [] },
      },
      placements: { feeds: true, stories: false, reels: false, marketplace: false },
      providerData: {},
      createdAt: stubTs,
      updatedAt: stubTs,
    } as unknown as AdSet

    const campaign = await createCampaign({
      accountUrn,
      accessToken,
      canonical: canonicalAdSet,
      campaignGroupUrn: group.urn,
      objectiveType: linkedinObjectiveFromCanonical(canonicalCampaign.objective),
      campaignType: 'SPONSORED_UPDATES',
      costType: 'CPM',
      dailyBudgetMajor: 1,  // $1/day cap even though PAUSED — belt-and-suspenders
      currencyCode: 'USD',
    })
    campaignUrn = campaign.urn
    console.log(`[smoke] ✓ created campaign: ${campaign.urn}`)

    // ── Step 3: Creative (Ad) ──────────────────────────────────────────────
    // Phase 2 baseline: requires a referenceUrn to attach to the creative.
    // If LINKEDIN_ADS_TEST_REFERENCE_URN is not set, skip the creative step
    // but still consider the smoke successful.
    if (referenceUrn) {
      const canonicalAd = {
        id: `${runTag}-ad`,
        orgId: 'smoke-org',
        adSetId: canonicalAdSet.id,
        campaignId: canonicalCampaign.id,
        platform: 'linkedin',
        name: `${runTag} creative`,
        format: 'SINGLE_IMAGE',
        status: 'DRAFT',
        creativeIds: [],
        copy: { primaryText: 'smoke', headline: 'smoke' },
        providerData: {},
        createdAt: stubTs,
        updatedAt: stubTs,
      } as unknown as Ad

      const creative = await createCreative({
        accountUrn,
        accessToken,
        canonical: canonicalAd,
        campaignUrn: campaign.urn,
        referenceUrn,
      })
      creativeUrn = creative.urn
      console.log(`[smoke] ✓ created creative: ${creative.urn}`)
    } else {
      console.log('[smoke] ⏭  creative step skipped — LINKEDIN_ADS_TEST_REFERENCE_URN not set')
    }

    // ── Step 4: Status transitions on the Campaign Group ──────────────────
    await pauseCampaignGroup({ accountUrn, accessToken, groupUrn: group.urn })
    console.log('[smoke] ✓ pauseCampaignGroup')
    await resumeCampaignGroup({ accountUrn, accessToken, groupUrn: group.urn })
    console.log('[smoke] ✓ resumeCampaignGroup')

    console.log('\n[smoke-ads-sub3b-phase2] ALL CHECKS PASSED ✅')
  } catch (err) {
    console.error('[smoke-ads-sub3b-phase2] FAILED ❌', err)
    process.exitCode = 1
  } finally {
    // Cleanup — archive everything created so the test account stays tidy.
    // Failures here are warnings only; they do not mask the test result.
    if (creativeUrn) {
      try {
        await archiveCreative({ accountUrn, accessToken, creativeUrn })
        console.log(`[cleanup] archived creative ${creativeUrn}`)
      } catch (e) {
        console.warn(`[cleanup] failed to archive creative: ${(e as Error).message}`)
      }
    }
    if (campaignUrn) {
      try {
        await archiveCampaign({ accountUrn, accessToken, campaignUrn })
        console.log(`[cleanup] archived campaign ${campaignUrn}`)
      } catch (e) {
        console.warn(`[cleanup] failed to archive campaign: ${(e as Error).message}`)
      }
    }
    if (groupUrn) {
      try {
        await archiveCampaignGroup({ accountUrn, accessToken, groupUrn })
        console.log(`[cleanup] archived group ${groupUrn}`)
      } catch (e) {
        console.warn(`[cleanup] failed to archive group: ${(e as Error).message}`)
      }
    }
  }
}

main().catch((err) => {
  console.error('[smoke-ads-sub3b-phase2] FATAL', err)
  process.exit(1)
})
