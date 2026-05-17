/**
 * Phase 4 acceptance smoke test.
 *
 * Verifies:
 *  1. Create a small CUSTOMER_LIST CA (no actual CSV upload — just the Meta CA creation)
 *  2. Create a Saved Audience with US targeting + the CA as include
 *  3. Verify SA persisted with the CA reference
 *  4. Cleanup: delete SA + CA from Meta + local
 *
 * Run with: SMOKE_ORG_ID=<id> npx tsx scripts/smoke-ads-meta-phase4.ts
 */
import { listConnections, decryptAccessToken } from '@/lib/ads/connections/store'
import {
  createCustomAudience,
  setCustomAudienceMetaId,
  deleteCustomAudience,
  getCustomAudience,
} from '@/lib/ads/custom-audiences/store'
import {
  createSavedAudience,
  setSavedAudienceMetaId,
  deleteSavedAudience,
  getSavedAudience,
} from '@/lib/ads/saved-audiences/store'
import { metaProvider } from '@/lib/ads/providers/meta'
import { deleteMetaCustomAudience } from '@/lib/ads/providers/meta/custom-audiences'
import { deleteMetaSavedAudience } from '@/lib/ads/providers/meta/saved-audiences'

function require_env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Set ${name} before running this script`)
  return v
}

async function main() {
  const orgId = require_env('SMOKE_ORG_ID')

  const conns = await listConnections({ orgId })
  const meta = conns.find((c) => c.platform === 'meta')
  if (!meta) throw new Error(`No Meta connection on org ${orgId}. Run Phase 1 smoke first.`)
  if (!meta.defaultAdAccountId) throw new Error('Meta connection has no defaultAdAccountId set.')
  const accessToken = decryptAccessToken(meta)
  const adAccountId = meta.defaultAdAccountId
  console.log('✓ Meta connection ok:', meta.id, 'ad account', adAccountId)

  let caId: string | undefined
  let metaCaId: string | undefined
  let saId: string | undefined
  let metaSavId: string | undefined

  try {
    // 1. Create CUSTOMER_LIST CA (Meta-side creation only — no actual upload)
    const ca = await createCustomAudience({
      orgId,
      createdBy: 'smoke-script',
      platform: 'meta',
      input: {
        type: 'CUSTOMER_LIST',
        name: `[SMOKE-P4] CA ${new Date().toISOString()}`,
        description: 'Phase 4 smoke',
        status: 'BUILDING',
        source: {
          kind: 'CUSTOMER_LIST',
          csvStoragePath: '',
          hashCount: 0,
          uploadedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as any,
        },
      },
    })
    caId = ca.id

    const caRes = await metaProvider.customAudienceCRUD!({
      op: 'create',
      accessToken,
      adAccountId,
      ca,
    })
    metaCaId = (caRes as { metaCaId: string }).metaCaId
    await setCustomAudienceMetaId(ca.id, metaCaId)
    console.log('✓ CA created in Meta:', metaCaId)

    // 2. Create Saved Audience with that CA as include
    const sa = await createSavedAudience({
      orgId,
      createdBy: 'smoke-script',
      input: {
        name: `[SMOKE-P4] SA ${new Date().toISOString()}`,
        targeting: {
          geo: { countries: ['US'] },
          demographics: { ageMin: 25, ageMax: 54 },
          customAudiences: { include: [ca.id], exclude: [] },
        },
      },
    })
    saId = sa.id

    const saRes = await metaProvider.savedAudienceCRUD!({
      op: 'create',
      accessToken,
      adAccountId,
      sa,
    })
    metaSavId = (saRes as { metaSavId: string }).metaSavId
    await setSavedAudienceMetaId(sa.id, metaSavId)
    console.log('✓ SA created in Meta:', metaSavId)

    // 3. Verify SA persisted with CA reference
    const saReadback = await getSavedAudience(sa.id)
    const includeIds = saReadback?.targeting.customAudiences?.include ?? []
    if (!includeIds.includes(ca.id)) {
      throw new Error('SA does not reference the created CA')
    }
    console.log('✓ SA references CA correctly')

    console.log('\nPhase 4 acceptance: PASSED')
  } catch (err) {
    console.error('Phase 4 acceptance: FAILED\n', err)
    process.exitCode = 1
  } finally {
    if (metaSavId) {
      try { await deleteMetaSavedAudience({ metaSavId, accessToken }) } catch (e) { console.warn('⚠ SA Meta delete:', (e as Error).message) }
    }
    if (saId) await deleteSavedAudience(saId).catch(() => {})
    if (metaCaId) {
      try { await deleteMetaCustomAudience({ metaCaId, accessToken }) } catch (e) { console.warn('⚠ CA Meta delete:', (e as Error).message) }
    }
    if (caId) await deleteCustomAudience(caId).catch(() => {})
  }
}

main()
