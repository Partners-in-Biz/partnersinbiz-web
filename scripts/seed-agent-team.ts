/**
 * Seed agent_team/<agentId> documents for platform agents.
 * Idempotent — skips docs that already exist (checks by agentId field presence).
 *
 * Run:
 *   npx tsx scripts/seed-agent-team.ts
 *
 * Requires .env.local with SOCIAL_TOKEN_MASTER_KEY and Firebase Admin vars.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { mergeAgentRegistry } from '@/lib/agents/registry'
import { buildAgentSkillPolicyState } from '@/lib/agents/skill-policy'

// ---------------------------------------------------------------------------
// Load .env.local before importing firebase-admin (mirrors seed-agent-dispatch-configs.ts)
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
// Agent definitions
// ---------------------------------------------------------------------------
interface AgentSeed {
  agentId: string
  name: string
  role: string
  persona: string
  defaultModel: string
  iconKey: string
  colorKey: string
}

const AGENTS: AgentSeed[] = [
  {
    agentId: 'pip',
    name: 'Pip',
    role: 'Operator',
    persona: 'Front door — routes client requests, coordinates the team',
    defaultModel: 'claude-sonnet-4-6',
    iconKey: 'smart_toy',
    colorKey: 'violet',
  },
  {
    agentId: 'theo',
    name: 'Theo',
    role: 'Builder',
    persona: 'Full-stack engineer — builds and deploys features',
    defaultModel: 'claude-opus-4-7',
    iconKey: 'code',
    colorKey: 'sky',
  },
  {
    agentId: 'maya',
    name: 'Maya',
    role: 'Marketer',
    persona: 'Creative director — crafts content and campaigns',
    defaultModel: 'claude-sonnet-4-6',
    iconKey: 'brush',
    colorKey: 'amber',
  },
  {
    agentId: 'sage',
    name: 'Sage',
    role: 'Researcher',
    persona: 'Analyst — deep research, competitive intelligence',
    defaultModel: 'claude-opus-4-7',
    iconKey: 'search',
    colorKey: 'emerald',
  },
  {
    agentId: 'nora',
    name: 'Nora',
    role: 'Operations',
    persona: 'Back-office — billing, CRM, reports',
    defaultModel: 'claude-haiku-4-5',
    iconKey: 'receipt_long',
    colorKey: 'rose',
  },
  {
    agentId: 'ads',
    name: 'Ari',
    role: 'Ads',
    persona: 'Paid media specialist — audits, plans, and prepares ad campaigns behind hard spend gates',
    defaultModel: 'gpt-5.5',
    iconKey: 'campaign',
    colorKey: 'amber',
  },
  {
    agentId: 'qa-release',
    name: 'Quinn',
    role: 'QA Release',
    persona: 'Release reviewer — verifies risky work, smoke tests changes, and prepares rollback notes',
    defaultModel: 'gpt-5.5',
    iconKey: 'verified',
    colorKey: 'emerald',
  },
  {
    agentId: 'support',
    name: 'Luca',
    role: 'Support',
    persona: 'Support triage — captures client symptoms, reproduces issues, and routes follow-up',
    defaultModel: 'gpt-5.4',
    iconKey: 'support_agent',
    colorKey: 'sky',
  },
  {
    agentId: 'data',
    name: 'Vera',
    role: 'Data',
    persona: 'Data analyst — owns analytics, attribution, dashboards, and data-quality evidence',
    defaultModel: 'gpt-5.5',
    iconKey: 'monitoring',
    colorKey: 'violet',
  },
  {
    agentId: 'docs',
    name: 'Iris',
    role: 'Docs',
    persona: 'Documents lead — turns strategy into approved specs, reports, and polished deliverables',
    defaultModel: 'gpt-5.5',
    iconKey: 'description',
    colorKey: 'rose',
  },
  {
    agentId: 'seo',
    name: 'Silas',
    role: 'SEO',
    persona: 'SEO specialist — executes SEO sprints, local SEO, and search-performance interpretation',
    defaultModel: 'gpt-5.5',
    iconKey: 'travel_explore',
    colorKey: 'emerald',
  },
]

const PLACEHOLDER_API_KEY = 'PLACEHOLDER_ROTATE_ME'

// ---------------------------------------------------------------------------
async function main() {
  const { adminDb } = await import('@/lib/firebase/admin')
  const { FieldValue } = await import('firebase-admin/firestore')

  // Import the encryption helper from lib/agents/team (compiled at runtime via tsx)
  // We can't import the named export directly without compiling, so replicate
  // the encryption inline using the same algorithm as lib/agents/team.ts.
  // This keeps the seed self-contained and avoids circular imports.
  const crypto = await import('crypto')

  const ALGORITHM = 'aes-256-gcm'
  const IV_LENGTH = 12
  const AGENT_KEY_CONTEXT = 'agent-team-apikey'

  function getMasterKey(): Buffer {
    const key = process.env.SOCIAL_TOKEN_MASTER_KEY?.trim()
    if (!key) throw new Error('Missing env var: SOCIAL_TOKEN_MASTER_KEY')
    if (key.length === 64 && /^[0-9a-f]+$/i.test(key)) {
      return Buffer.from(key, 'hex')
    }
    return crypto.default.createHash('sha256').update(key).digest()
  }

  function encryptAgentApiKey(plaintext: string): string {
    const masterKey = getMasterKey()
    const derivedKey = crypto.default.createHmac('sha256', masterKey).update(AGENT_KEY_CONTEXT).digest()
    const iv = crypto.default.randomBytes(IV_LENGTH)
    const cipher = crypto.default.createCipheriv(ALGORITHM, derivedKey, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return JSON.stringify({
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    })
  }

  const skipped: string[] = []
  const written: string[] = []

  for (const agent of AGENTS) {
    const ref = adminDb.collection('agent_team').doc(agent.agentId)
    const snap = await ref.get()

    if (snap.exists) {
      console.log(`  ⏭  agent_team/${agent.agentId} already exists — skipping`)
      skipped.push(agent.agentId)
      continue
    }

    const baseUrl = `https://hermes-api.partnersinbiz.online/profiles/${agent.agentId}`
    const encryptedKey = encryptAgentApiKey(PLACEHOLDER_API_KEY)
    const registry = mergeAgentRegistry(agent.agentId)
    const skillPolicy = buildAgentSkillPolicyState(agent.agentId)

    await ref.set({
      agentId: agent.agentId,
      name: agent.name,
      role: agent.role,
      persona: agent.persona,
      defaultModel: agent.defaultModel,
      iconKey: agent.iconKey,
      colorKey: agent.colorKey,
      enabled: true,
      baseUrl,
      apiKey: encryptedKey,
      ...registry,
      ...(skillPolicy ? { skillPolicy } : {}),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    console.log(`  ✓  agent_team/${agent.agentId} → ${baseUrl}`)
    written.push(agent.agentId)
  }

  console.log(`\nDone. ${written.length} created, ${skipped.length} skipped.`)
  if (written.length > 0) {
    console.log(
      '\nIMPORTANT: All new docs have apiKey=PLACEHOLDER_ROTATE_ME (encrypted).',
      '\nUpdate real keys via: PUT /api/v1/admin/agents/{agentId} with {"apiKey":"<real-key"}',
    )
  }
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
