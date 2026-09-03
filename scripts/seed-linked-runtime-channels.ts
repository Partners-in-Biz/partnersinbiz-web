/**
 * Seed platform_config/linked_runtime_channels when missing.
 *
 * Run:
 *   npx tsx scripts/seed-linked-runtime-channels.ts
 *
 * Idempotent — creates the document only when it does not exist.
 */

import { readFileSync, existsSync } from 'fs'
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

async function main() {
  const { adminDb } = await import('@/lib/firebase/admin')
  const { FieldValue } = await import('firebase-admin/firestore')
  const {
    DEFAULT_RUNTIME_CHANNELS,
    LINKED_RUNTIME_CHANNELS_COLLECTION,
    LINKED_RUNTIME_CHANNELS_DOC,
  } = await import('@/lib/linked-computers/runtime-config')

  const ref = adminDb.collection(LINKED_RUNTIME_CHANNELS_COLLECTION).doc(LINKED_RUNTIME_CHANNELS_DOC)
  const snap = await ref.get()
  if (snap.exists) {
    console.log(`platform_config/${LINKED_RUNTIME_CHANNELS_DOC} already exists — leaving it unchanged.`)
    return
  }

  await ref.set({
    ...DEFAULT_RUNTIME_CHANNELS,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: 'scripts/seed-linked-runtime-channels.ts',
  })
  console.log(`Created platform_config/${LINKED_RUNTIME_CHANNELS_DOC}`)
  console.log(JSON.stringify(DEFAULT_RUNTIME_CHANNELS, null, 2))
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
