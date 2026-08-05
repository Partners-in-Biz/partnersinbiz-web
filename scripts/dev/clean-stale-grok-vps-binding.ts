/**
 * Clean the stale Grok VPS binding for pip rt='vps'.
 *
 * The binding predates the linked-device runtime: it carries credentialVersion 2
 * while the xai-oauth connection is at v25 and the real VPS pip target is now a
 * linked-device binding (v25, ready). The stale row only shows as failed/unused
 * in Settings and can never be delivered (version mismatch).
 *
 * Action: mark the stale binding revoked (audit-preserving) instead of deleting.
 *
 * Credentials are read from the live agent-watcher process env (same user) so
 * this script does not require touching root-owned files.
 *
 * Run: npx tsx scripts/dev/clean-stale-grok-vps-binding.ts
 */
import { cert, initializeApp, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import * as fs from 'node:fs'

function readWatcherEnvKeys(): Record<string, string> {
  const pid = fs.readdirSync('/proc')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .map((n) => ({ pid: n, cmd: safeCmd(n) }))
    .find((row) => row.cmd.includes('agent-watcher/dist/index.js'))
  if (!pid) throw new Error('agent-watcher process not found')
  const env = fs.readFileSync(`/proc/${pid.pid}/environ`, 'utf8').split('\0')
  const out: Record<string, string> = {}
  for (const line of env) {
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq)
    if (key.startsWith('FIREBASE_ADMIN_')) out[key] = line.slice(eq + 1)
  }
  return out
}

function safeCmd(pid: number): string {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ') } catch { return '' }
}

async function main() {
  const keys = readWatcherEnvKeys()
  if (!keys.FIREBASE_ADMIN_PROJECT_ID || !keys.FIREBASE_ADMIN_CLIENT_EMAIL || !keys.FIREBASE_ADMIN_PRIVATE_KEY) {
    throw new Error('FIREBASE_ADMIN_* keys missing from watcher env')
  }
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: keys.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: keys.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: keys.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    })
  }
  const db = getFirestore()
  const connectionId = 'org:pib-platform-owner:xai-oauth'
  const snap = await db.collection('llm_credential_bindings')
    .where('connectionId', '==', connectionId)
    .where('runtimeTargetId', '==', 'vps')
    .limit(20)
    .get()
  console.log('vps-target bindings found:', snap.size)
  let targetId: string | null = null
  for (const doc of snap.docs) {
    const d = doc.data()
    console.log('  ', doc.id, JSON.stringify({
      agentId: d.agentId,
      credentialVersion: d.credentialVersion,
      status: d.status,
      liveAuthVerified: d.liveAuthVerified,
      lastError: d.lastError,
    }))
    if (d.agentId === 'pip' && Number(d.credentialVersion) === 2 && d.status !== 'revoked') {
      targetId = doc.id
    }
  }
  if (!targetId) {
    console.log('No stale pip v2 vps binding to clean (already revoked or absent).')
    return
  }
  if (process.argv.includes('--apply')) {
    await db.collection('llm_credential_bindings').doc(targetId).update({
      status: 'revoked',
      liveAuthVerified: false,
      verifiedModelIds: [],
      lastError: 'Legacy vps binding superseded by linked-device generation (v25)',
      updatedAt: FieldValue.serverTimestamp(),
    })
    console.log('MARKED REVOKED:', targetId)
  } else {
    console.log('Dry-run: pass --apply to mark', targetId, 'revoked')
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAIL', e.message); process.exit(1) })
