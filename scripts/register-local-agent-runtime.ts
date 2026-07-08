/*
 * Register this machine as a local Hermes runtime target for the Partners in Biz
 * agent fleet. This does NOT create client workspace agents; it only tells PiB
 * that the existing platform agents (Pip, Theo, Maya, etc.) can be routed to a
 * local Mac/runtime endpoint when Peet chooses "local" or auto-local routing.
 *
 * Required env:
 *   PIB_LOCAL_HERMES_PUBLIC_BASE_URL=https://public-tunnel.example/profiles
 *   PIB_LOCAL_HERMES_API_KEY=<API key accepted by the local Hermes runtime proxy>
 *
 * Optional env:
 *   PIB_LOCAL_RUNTIME_AGENTS=pip,theo,maya,sage,nora,ads,qa-release,support,data,docs,seo,sales
 *   PIB_LOCAL_RUNTIME_HOST_ID=peets-mac-mini
 *   PIB_LOCAL_RUNTIME_URL_TEMPLATE=https://public-tunnel.example/profiles/{agent}
 *
 * Run:
 *   npx tsx scripts/register-local-agent-runtime.ts
 */

import { existsSync, readFileSync } from 'fs'
import { hostname } from 'os'
import { resolve } from 'path'

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

const DEFAULT_AGENTS = ['pip', 'theo', 'maya', 'sage', 'nora', 'ads', 'qa-release', 'support', 'data', 'docs', 'seo', 'sales']
const AGENT_ID_RE = /^[a-z][a-z0-9._-]{1,39}$/

function parseAgents(): string[] {
  const raw = process.env.PIB_LOCAL_RUNTIME_AGENTS
  const agents = (raw ? raw.split(',') : DEFAULT_AGENTS)
    .map((item) => item.trim())
    .filter((item) => AGENT_ID_RE.test(item))
  return Array.from(new Set(agents))
}

function runtimeBaseUrl(agentId: string): string {
  const template = process.env.PIB_LOCAL_RUNTIME_URL_TEMPLATE?.trim()
  if (template) return template.replace(/\{agent\}/g, encodeURIComponent(agentId)).replace(/\/+$/, '')

  const publicBase = process.env.PIB_LOCAL_HERMES_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '')
  if (!publicBase) throw new Error('PIB_LOCAL_HERMES_PUBLIC_BASE_URL or PIB_LOCAL_RUNTIME_URL_TEMPLATE is required')
  return `${publicBase}/${encodeURIComponent(agentId)}`
}

async function main() {
  const apiKey = process.env.PIB_LOCAL_HERMES_API_KEY?.trim()
  if (!apiKey) throw new Error('PIB_LOCAL_HERMES_API_KEY is required')

  const { adminDb } = await import('@/lib/firebase/admin')
  const { FieldPath, FieldValue } = await import('firebase-admin/firestore')
  const agents = parseAgents()
  const hostId = process.env.PIB_LOCAL_RUNTIME_HOST_ID?.trim() || hostname() || 'local-hermes'
  const now = FieldValue.serverTimestamp()

  for (const agentId of agents) {
    const baseUrl = runtimeBaseUrl(agentId)
    const dispatchRuntimeTarget = {
      id: 'local',
      label: `Local Hermes (${hostId})`,
      baseUrl,
      apiKey,
      enabled: true,
      priority: 1,
      hostId,
      capabilities: ['local-files', 'computer-use', 'local-browser', 'terminal:mac'],
      lastSeenAt: now,
      lastHealthStatus: 'ok',
    }
    const teamRuntimeTarget = {
      ...dispatchRuntimeTarget,
      hasApiKey: true,
    }
    delete (teamRuntimeTarget as { apiKey?: string }).apiKey

    const dispatchRef = adminDb.collection('agent_dispatch_configs').doc(agentId)
    await dispatchRef.set({ agentId, updatedAt: now }, { merge: true })
    await dispatchRef.update({
      'runtimeTargets.local': dispatchRuntimeTarget,
      updatedAt: now,
    })
    await dispatchRef.update(new FieldPath('runtimeTargets.local'), FieldValue.delete()).catch(() => undefined)

    const teamRef = adminDb.collection('agent_team').doc(agentId)
    await teamRef.set({ agentId, updatedAt: now }, { merge: true })
    await teamRef.update({
      'runtimeTargets.local': teamRuntimeTarget,
      updatedAt: now,
    })
    await teamRef.update(new FieldPath('runtimeTargets.local'), FieldValue.delete()).catch(() => undefined)

    console.log(`registered local runtime for ${agentId} -> ${baseUrl}`)
  }

  console.log(`Done. ${agents.length} local runtime target(s) registered for host ${hostId}.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
