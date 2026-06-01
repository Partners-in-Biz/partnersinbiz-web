/**
 * Seed agent_dispatch_configs/<agentId> documents from the platform owner's
 * Hermes profile link. The agent-watcher daemon reads these docs to know
 * which Hermes endpoint + API key to use per agent.
 *
 * Run:
 *   npx tsx scripts/seed-agent-dispatch-configs.ts
 *
 * Idempotent — safe to re-run.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// ---------------------------------------------------------------------------
// Load .env.local before importing firebase-admin
// (Mirror of scripts/seed-pib-brand.ts — supports multi-line quoted values.)
// ---------------------------------------------------------------------------
;(function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const raw = readFileSync(envPath, 'utf-8')
  const lines = raw.split('\n')
  let currentKey = ''
  let currentVal = ''
  let inMultiline = false

  for (const line of lines) {
    if (inMultiline) {
      currentVal += '\n' + line
      if (line.includes('"')) {
        inMultiline = false
        const val = currentVal.replace(/^"|"$/g, '').replace(/\\n/g, '\n')
        if (!process.env[currentKey]) process.env[currentKey] = val
        currentKey = ''
        currentVal = ''
      }
      continue
    }

    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue

    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()

    if (val.startsWith('"') && !val.slice(1).includes('"')) {
      currentKey = key
      currentVal = val
      inMultiline = true
      continue
    }

    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }

    if (!process.env[key]) process.env[key] = val
  }
})()

// ---------------------------------------------------------------------------
// Source profile + target agents
// ---------------------------------------------------------------------------
const SOURCE_PROFILE_DOC_ID = 'pib-platform-owner'

// Map of agent id → which profile doc to copy credentials from. This script is
// a legacy bootstrap fallback; normal new-agent creation should use
// POST /api/v1/admin/agents so each specialist receives its own profile/key.
const AGENT_SOURCE_MAP: Record<string, string> = {
  pip: SOURCE_PROFILE_DOC_ID,
  theo: SOURCE_PROFILE_DOC_ID,
  maya: SOURCE_PROFILE_DOC_ID,
  sage: SOURCE_PROFILE_DOC_ID,
  nora: SOURCE_PROFILE_DOC_ID,
  ads: SOURCE_PROFILE_DOC_ID,
  'qa-release': SOURCE_PROFILE_DOC_ID,
  support: SOURCE_PROFILE_DOC_ID,
  data: SOURCE_PROFILE_DOC_ID,
  docs: SOURCE_PROFILE_DOC_ID,
  seo: SOURCE_PROFILE_DOC_ID,
  sales: SOURCE_PROFILE_DOC_ID,
}

// ---------------------------------------------------------------------------
async function main() {
  // Use the lazy admin singleton from the Next app so we share its env contract.
  const { adminDb } = await import('@/lib/firebase/admin')
  const { FieldValue } = await import('firebase-admin/firestore')

  const sourceIds = Array.from(new Set(Object.values(AGENT_SOURCE_MAP)))
  const sourceProfiles = new Map<string, { baseUrl: string; apiKey: string }>()

  for (const profileId of sourceIds) {
    const snap = await adminDb.collection('hermes_profile_links').doc(profileId).get()
    if (!snap.exists) {
      console.error(`hermes_profile_links/${profileId} does not exist.`)
      process.exit(1)
    }
    const data = snap.data() ?? {}
    const baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl.trim().replace(/\/+$/, '') : ''
    const apiKey = typeof data.apiKey === 'string' ? data.apiKey.trim() : ''

    if (!baseUrl || !apiKey) {
      console.error(`hermes_profile_links/${profileId} is missing baseUrl or apiKey.`)
      process.exit(1)
    }

    sourceProfiles.set(profileId, { baseUrl, apiKey })
  }

  const written: Array<{ agentId: string; baseUrl: string }> = []

  for (const [agentId, sourceId] of Object.entries(AGENT_SOURCE_MAP)) {
    const profile = sourceProfiles.get(sourceId)
    if (!profile) continue

    await adminDb.collection('agent_dispatch_configs').doc(agentId).set(
      {
        agentId,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        enabled: true,
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: 'scripts/seed-agent-dispatch-configs.ts',
        sourceProfileId: sourceId,
      },
      { merge: true },
    )

    written.push({ agentId, baseUrl: profile.baseUrl })
  }

  console.log('Wrote agent_dispatch_configs:')
  for (const { agentId, baseUrl } of written) {
    console.log(`  - ${agentId} → ${baseUrl}`)
  }
  console.log(`Done. ${written.length} document(s) upserted.`)
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
