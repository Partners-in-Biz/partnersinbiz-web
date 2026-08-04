/**
 * Read-only verification of the stale Grok VPS binding cleanup target.
 * Run with: npx tsx scripts/dev/find-stale-grok-binding.ts
 */
import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as fs from 'node:fs'

const envFile = '/var/lib/hermes/backups/etc-hermes-pre-reinstall-20260518-060633/watcher.env'
const envRaw = fs.readFileSync(envFile, 'utf8')
function val(key: string): string {
  const line = envRaw.split('\n').find((l) => l.startsWith(`${key}=`))
  return line ? line.slice(key.length + 1).trim() : ''
}

async function main() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: val('FIREBASE_ADMIN_PROJECT_ID'),
        clientEmail: val('FIREBASE_ADMIN_CLIENT_EMAIL'),
        privateKey: val('FIREBASE_ADMIN_PRIVATE_KEY').replace(/\\n/g, '\n'),
      }),
    })
  }
  const db = getFirestore()
  const snap = await db.collection('llm_credential_bindings')
    .where('connectionId', '==', 'org:pib-platform-owner:xai-oauth')
    .where('runtimeTargetId', '==', 'vps')
    .limit(20)
    .get()
  console.log('READ_OK count=', snap.size)
  for (const doc of snap.docs) {
    const d = doc.data()
    console.log(doc.id, JSON.stringify({
      agentId: d.agentId,
      credentialVersion: d.credentialVersion,
      status: d.status,
      liveAuthVerified: d.liveAuthVerified,
      deviceId: d.deviceId,
      lastError: d.lastError,
    }))
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e.message); process.exit(1) })
