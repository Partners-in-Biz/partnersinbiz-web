#!/usr/bin/env tsx
// scripts/smoke-ads-sub3b-phase3.ts
//
// End-to-end smoke for Sub-3b LinkedIn Phase 3 — Matched Audiences (4 subtypes
// exercised: CUSTOMER_LIST + WEBSITE + LOOKALIKE + ENGAGEMENT). APP subtype is
// skipped because LinkedIn has no native equivalent (createAppAudience throws
// an explicit shim error by design).
//
// Required env vars:
//   LINKEDIN_ADS_TEST_ACCESS_TOKEN   — OAuth access token with r_ads+rw_ads
//   LINKEDIN_ADS_TEST_ACCOUNT_URN    — urn:li:sponsoredAccount:{id}
//
// Optional env vars (subtype-specific):
//   LINKEDIN_ADS_TEST_INSIGHT_TAG_ID   — for WEBSITE audience
//   LINKEDIN_ADS_TEST_ORGANIZATION_URN — for ENGAGEMENT audience
//
// Skipped automatically if the required env vars are not set.

import {
  createContactListAudience,
  createWebsiteAudience,
  createLookalikeAudience,
  createEngagementAudience,
  getAudienceStatus,
  archiveAudience,
} from '@/lib/ads/providers/linkedin/audiences'
import {
  createSavedAudience,
  archiveSavedAudience,
} from '@/lib/ads/providers/linkedin/saved-audiences'
import { rowToMember, uploadAudienceMembers } from '@/lib/ads/providers/linkedin/audiences-hash'

async function main() {
  const accessToken = process.env.LINKEDIN_ADS_TEST_ACCESS_TOKEN
  const accountUrn = process.env.LINKEDIN_ADS_TEST_ACCOUNT_URN
  const insightTagId = process.env.LINKEDIN_ADS_TEST_INSIGHT_TAG_ID
  const organizationUrn = process.env.LINKEDIN_ADS_TEST_ORGANIZATION_URN

  if (!accessToken || !accountUrn) {
    console.log('[smoke-ads-sub3b-phase3] SKIP — LINKEDIN_ADS_TEST_ACCESS_TOKEN or LINKEDIN_ADS_TEST_ACCOUNT_URN not set')
    return
  }

  const ts = Date.now()
  const runTag = `pib-smoke-p3-${ts}`
  console.log(`[smoke-ads-sub3b-phase3] run tag: ${runTag}`)
  console.log(`[smoke-ads-sub3b-phase3] account: ${accountUrn}`)

  const created: Array<{ kind: 'audience' | 'saved'; urn: string }> = []

  try {
    // ── CUSTOMER_LIST (contact list with 3 test members) ───────────────────
    const contactList = await createContactListAudience({
      accountUrn,
      accessToken,
      name: `${runTag} contact list`,
    })
    created.push({ kind: 'audience', urn: contactList.urn })
    console.log(`[smoke] ✓ created contact list audience: ${contactList.urn}`)

    const members = [
      rowToMember({ email: 'smoketest+1@example.com' }),
      rowToMember({ email: 'smoketest+2@example.com', phone: '+15555550101' }),
      rowToMember({ phone: '+15555550102' }),
    ]
    const upload = await uploadAudienceMembers({
      accessToken,
      segmentUrn: contactList.urn,
      members,
    })
    if (upload.chunksFailed > 0) {
      console.warn(`[smoke] ⚠ uploadAudienceMembers had ${upload.chunksFailed} failed chunks: ${upload.firstError}`)
    } else {
      console.log(`[smoke] ✓ uploaded ${upload.totalMembers} members in ${upload.chunksSucceeded} chunks`)
    }

    // ── Status read ────────────────────────────────────────────────────────
    const status = await getAudienceStatus({
      accountUrn,
      accessToken,
      segmentUrn: contactList.urn,
    })
    console.log(`[smoke] ✓ getAudienceStatus → ${status.status} (members: ${status.approximateMemberCount ?? 'n/a'})`)

    // ── WEBSITE (only if insightTagId provided) ────────────────────────────
    if (insightTagId) {
      const website = await createWebsiteAudience({
        accountUrn,
        accessToken,
        name: `${runTag} website`,
        insightTagId,
        rules: [{ matchType: 'CONTAINS', url: '/pricing' }],
      })
      created.push({ kind: 'audience', urn: website.urn })
      console.log(`[smoke] ✓ created website audience: ${website.urn}`)
    } else {
      console.log('[smoke] ⏭ WEBSITE subtype skipped — LINKEDIN_ADS_TEST_INSIGHT_TAG_ID not set')
    }

    // ── LOOKALIKE (from the contact list we just created) ──────────────────
    const lookalike = await createLookalikeAudience({
      accountUrn,
      accessToken,
      name: `${runTag} lookalike`,
      sourceSegmentUrn: contactList.urn,
    })
    created.push({ kind: 'audience', urn: lookalike.urn })
    console.log(`[smoke] ✓ created lookalike audience: ${lookalike.urn}`)

    // ── ENGAGEMENT (only if organizationUrn provided) ──────────────────────
    if (organizationUrn) {
      const engagement = await createEngagementAudience({
        accountUrn,
        accessToken,
        name: `${runTag} engagement`,
        organizationUrn,
        engagementType: 'VISITORS',
      })
      created.push({ kind: 'audience', urn: engagement.urn })
      console.log(`[smoke] ✓ created engagement audience: ${engagement.urn}`)
    } else {
      console.log('[smoke] ⏭ ENGAGEMENT subtype skipped — LINKEDIN_ADS_TEST_ORGANIZATION_URN not set')
    }

    // ── Saved Audience (Audience Template) ─────────────────────────────────
    const saved = await createSavedAudience({
      accountUrn,
      accessToken,
      name: `${runTag} saved`,
      targeting: {
        include: {
          and: [{ or: { 'urn:li:adTargetingFacet:locations': ['urn:li:country:us'] } }],
        },
      },
    })
    created.push({ kind: 'saved', urn: saved.urn })
    console.log(`[smoke] ✓ created saved audience: ${saved.urn}`)

    console.log('\n[smoke-ads-sub3b-phase3] ALL CHECKS PASSED ✅')
  } catch (err) {
    console.error('[smoke-ads-sub3b-phase3] FAILED ❌', err)
    process.exitCode = 1
  } finally {
    // Cleanup: archive everything we created
    for (const item of created) {
      try {
        if (item.kind === 'audience') {
          await archiveAudience({ accountUrn: accountUrn!, accessToken: accessToken!, segmentUrn: item.urn })
          console.log(`[cleanup] archived audience ${item.urn}`)
        } else {
          await archiveSavedAudience({ accountUrn: accountUrn!, accessToken: accessToken!, templateUrn: item.urn })
          console.log(`[cleanup] archived saved audience ${item.urn}`)
        }
      } catch (e) {
        console.warn(`[cleanup] failed to archive ${item.urn}: ${(e as Error).message}`)
      }
    }
  }
}

main().catch((err) => {
  console.error('[smoke-ads-sub3b-phase3] FATAL', err)
  process.exit(1)
})
