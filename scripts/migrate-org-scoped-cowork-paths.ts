#!/usr/bin/env tsx
/**
 * Migrate Partners-era flat Cowork folders into the org-scoped `partners/` nest.
 *
 * From: ~/Cowork/{FolderName}  /  /var/lib/hermes/Cowork/{FolderName}
 * To:   ~/Cowork/partners/{FolderName}  /  /var/lib/hermes/Cowork/partners/{FolderName}
 *
 * Dry-run by default. Leaves compatibility symlinks at old flat Mac/VPS paths.
 * Also rewrites Firestore path fields, `.pib-workspace.json`, and the Mac
 * linked-computer mapping for `partners-mac-workspace`.
 *
 * Usage:
 *   npx tsx scripts/migrate-org-scoped-cowork-paths.ts
 *   npx tsx scripts/migrate-org-scoped-cowork-paths.ts --commit
 *   npx tsx scripts/migrate-org-scoped-cowork-paths.ts --mac-only
 *   npx tsx scripts/migrate-org-scoped-cowork-paths.ts --vps-only --commit
 *   npx tsx scripts/migrate-org-scoped-cowork-paths.ts --firestore-only
 *   npx tsx scripts/migrate-org-scoped-cowork-paths.ts --skip-vps --skip-firestore --commit
 *
 * Env:
 *   PIB_VPS_HOST  SSH host (default 65.108.146.144)
 *   PIB_VPS_USER  SSH user (default root)
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import * as admin from 'firebase-admin'
import {
  PIB_COWORK_NESTING_SLUG,
  VPS_COWORK_ROOT,
} from '@/lib/client-provisioning/cowork-paths'
import { ORG_WORKSPACES_COLLECTION } from '@/lib/client-provisioning/workspace-context'
import {
  type CliFlags,
  type FsEntryKind,
  type MoveCandidateClassification,
  DEFAULT_PIB_VPS_HOST,
  PARTNERS_MAC_WORKSPACE_NESTED_PATH,
  buildFirestoreMergePatch,
  buildVpsMigrationBash,
  classifyMoveCandidate,
  formatMoveSummaryRow,
  parseFlags,
  planLinkedComputerMappingsUpdate,
  resolveMigrationScopes,
  rewriteConversationDoc,
  rewriteOrganizationDoc,
  rewriteOrgWorkspaceDoc,
  rewritePibWorkspaceJson,
} from '@/scripts/lib/org-scoped-cowork-migration'

export {
  parseFlags,
  resolveMigrationScopes,
  classifyMoveCandidate,
  rewriteCoworkPathValue,
  rewritePathFieldsInObject,
  rewriteOrgWorkspaceDoc,
  rewriteOrganizationDoc,
  rewriteConversationDoc,
  rewritePibWorkspaceJson,
  planLinkedComputerMappingsUpdate,
  buildVpsMigrationBash,
  buildFirestoreMergePatch,
  formatMoveSummaryRow,
  RESERVED_COWORK_ROOT_NAMES,
  COWORK_PATH_FIELD_KEYS,
  PARTNERS_MAC_WORKSPACE_MAPPING_ID,
  PARTNERS_MAC_WORKSPACE_NESTED_PATH,
  DEFAULT_PIB_VPS_HOST,
  DEFAULT_MAC_COWORK_ROOT,
  DEFAULT_MAPPINGS_PATH,
} from '@/scripts/lib/org-scoped-cowork-migration'

export interface MoveRow {
  scope: 'mac' | 'vps'
  folderName: string
  fromPath: string
  toPath: string
  action: string
  symlink: string
  reason: string
}

export interface FirestoreRewriteCounts {
  orgWorkspacesScanned: number
  orgWorkspacesRewritten: number
  organizationsScanned: number
  organizationsRewritten: number
  conversationsScanned: number
  conversationsRewritten: number
  pathFieldChanges: number
}

export interface MigrationSummary {
  dryRun: boolean
  macRows: MoveRow[]
  vpsRows: MoveRow[]
  macSkipped: MoveCandidateClassification[]
  mappingsChanges: Array<{ mappingId: string; from: string; to: string }>
  pibWorkspaceJsonUpdates: Array<{ path: string; changes: number }>
  firestore: FirestoreRewriteCounts
}

function loadEnv(): void {
  for (const filename of ['.env.local', '.env']) {
    const envPath = resolve(process.cwd(), filename)
    if (!existsSync(envPath)) continue
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 0) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
      if (!process.env[key]) process.env[key] = value
    }
  }
}

function initAdmin(): typeof admin {
  if (admin.apps.length > 0) return admin

  const keyPath = resolve(process.cwd(), 'service-account.json')
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim()
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim()
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()

  if (existsSync(keyPath)) {
    const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8')) as admin.ServiceAccount
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  } else if (projectId && clientEmail && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    })
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault() })
  }
  return admin
}

function entryKind(fullPath: string): FsEntryKind {
  try {
    const stat = lstatSync(fullPath)
    if (stat.isSymbolicLink()) return 'symlink'
    if (stat.isDirectory()) return 'directory'
    if (stat.isFile()) return 'file'
    return 'other'
  } catch {
    return 'other'
  }
}

function moveDirectoryPreferRename(fromPath: string, toPath: string): void {
  mkdirSync(dirname(toPath), { recursive: true })
  try {
    renameSync(fromPath, toPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw error
    cpSync(fromPath, toPath, { recursive: true, dereference: false })
    rmSync(fromPath, { recursive: true, force: true })
  }
}

function ensureCompatibilitySymlink(oldPath: string, newPath: string): 'created' | 'skipped_exists' | 'skipped_gone' {
  try {
    lstatSync(oldPath)
    return 'skipped_exists'
  } catch {
    // path gone — create compatibility symlink
  }
  try {
    symlinkSync(newPath, oldPath)
    return 'created'
  } catch {
    return 'skipped_gone'
  }
}

function listMacMoveCandidates(macCoworkRoot: string): {
  moves: MoveCandidateClassification[]
  skipped: MoveCandidateClassification[]
} {
  if (!existsSync(macCoworkRoot)) {
    throw new Error(`Mac Cowork root not found: ${macCoworkRoot}`)
  }
  const moves: MoveCandidateClassification[] = []
  const skipped: MoveCandidateClassification[] = []
  for (const name of readdirSync(macCoworkRoot)) {
    const classification = classifyMoveCandidate({
      name,
      kind: entryKind(join(macCoworkRoot, name)),
    })
    if (classification.action === 'move') moves.push(classification)
    else skipped.push(classification)
  }
  moves.sort((a, b) => a.folderName.localeCompare(b.folderName))
  skipped.sort((a, b) => a.folderName.localeCompare(b.folderName))
  return { moves, skipped }
}

/** Folder names to migrate on VPS (includes already-nested Mac partners/ dirs + flat move candidates). */
function discoverPartnerWorkspaceFolderNames(macCoworkRoot: string): string[] {
  const names = new Set<string>()
  if (!existsSync(macCoworkRoot)) return []
  const { moves, skipped } = listMacMoveCandidates(macCoworkRoot)
  for (const move of moves) names.add(move.folderName)
  for (const skip of skipped) {
    if (skip.reason.includes('symlink')) names.add(skip.folderName)
  }
  const nestRoot = join(macCoworkRoot, PIB_COWORK_NESTING_SLUG)
  if (existsSync(nestRoot) && entryKind(nestRoot) === 'directory') {
    for (const name of readdirSync(nestRoot)) {
      if (entryKind(join(nestRoot, name)) === 'directory') names.add(name)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

function findPibWorkspaceJsonFiles(rootDir: string): string[] {
  const results: string[] = []
  const skipDirNames = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.turbo'])

  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (name === '.pib-workspace.json') {
        results.push(join(dir, name))
        continue
      }
      if (skipDirNames.has(name) || name.startsWith('.')) continue
      const full = join(dir, name)
      if (entryKind(full) === 'directory') walk(full, depth + 1)
    }
  }

  walk(rootDir, 0)
  return results
}

function updatePibWorkspaceJsonFiles(
  workspaceRoot: string,
  dryRun: boolean,
): Array<{ path: string; changes: number }> {
  const updates: Array<{ path: string; changes: number }> = []
  for (const filePath of findPibWorkspaceJsonFiles(workspaceRoot)) {
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }
    const rewritten = rewritePibWorkspaceJson(parsed)
    if (!rewritten.changed) continue
    updates.push({ path: filePath, changes: rewritten.changes.length })
    if (!dryRun) {
      writeFileSync(filePath, `${JSON.stringify(rewritten.next, null, 2)}\n`, 'utf8')
    }
  }
  return updates
}

function migrateMac(flags: CliFlags): {
  rows: MoveRow[]
  skipped: MoveCandidateClassification[]
  mappingsChanges: MigrationSummary['mappingsChanges']
  pibWorkspaceJsonUpdates: MigrationSummary['pibWorkspaceJsonUpdates']
} {
  const nestRoot = join(flags.macCoworkRoot, PIB_COWORK_NESTING_SLUG)
  const { moves, skipped } = listMacMoveCandidates(flags.macCoworkRoot)
  const rows: MoveRow[] = []
  const pibWorkspaceJsonUpdates: MigrationSummary['pibWorkspaceJsonUpdates'] = []

  if (!flags.dryRun) mkdirSync(nestRoot, { recursive: true })

  for (const move of moves) {
    const fromPath = join(flags.macCoworkRoot, move.folderName)
    const toPath = join(nestRoot, move.folderName)
    let action = flags.dryRun ? 'would_move' : 'moved'
    let symlink = flags.dryRun ? 'would_create' : ''
    let reason = move.reason

    if (existsSync(toPath) && entryKind(toPath) === 'directory') {
      if (entryKind(fromPath) === 'directory' && !lstatSync(fromPath).isSymbolicLink()) {
        action = 'skip_dest_exists'
        symlink = 'skipped'
        reason = 'destination already exists; left source in place'
      } else {
        action = 'already_nested'
        reason = 'destination exists (idempotent)'
        if (flags.dryRun) {
          symlink = entryKind(fromPath) === 'symlink' ? 'already_linked' : 'would_create_if_missing'
        } else {
          const linkResult = ensureCompatibilitySymlink(fromPath, toPath)
          symlink = linkResult
        }
      }
    } else if (flags.dryRun) {
      action = 'would_move'
      symlink = 'would_create'
    } else {
      moveDirectoryPreferRename(fromPath, toPath)
      const linkResult = ensureCompatibilitySymlink(fromPath, toPath)
      symlink = linkResult
      action = 'moved'
    }

    if (action === 'moved' || action === 'would_move' || action === 'already_nested') {
      const targetForManifest = existsSync(toPath) ? toPath : fromPath
      if (existsSync(targetForManifest) && entryKind(targetForManifest) === 'directory') {
        pibWorkspaceJsonUpdates.push(...updatePibWorkspaceJsonFiles(targetForManifest, flags.dryRun))
      }
    }

    rows.push({
      scope: 'mac',
      folderName: move.folderName,
      fromPath,
      toPath,
      action,
      symlink,
      reason,
    })
  }

  let mappingsChanges: MigrationSummary['mappingsChanges'] = []
  if (existsSync(flags.mappingsPath)) {
    const raw = JSON.parse(readFileSync(flags.mappingsPath, 'utf8')) as Record<string, string>
    const plan = planLinkedComputerMappingsUpdate(raw, PARTNERS_MAC_WORKSPACE_NESTED_PATH)
    mappingsChanges = plan.changes
    if (plan.changed && !flags.dryRun) {
      writeFileSync(flags.mappingsPath, `${JSON.stringify(plan.next)}\n`, 'utf8')
    }
  } else {
    const plan = planLinkedComputerMappingsUpdate({}, PARTNERS_MAC_WORKSPACE_NESTED_PATH)
    mappingsChanges = plan.changes
    if (!flags.dryRun) {
      mkdirSync(dirname(flags.mappingsPath), { recursive: true })
      writeFileSync(flags.mappingsPath, `${JSON.stringify(plan.next)}\n`, 'utf8')
    }
  }

  return { rows, skipped, mappingsChanges, pibWorkspaceJsonUpdates }
}

function parseVpsOutputLines(stdout: string): MoveRow[] {
  const rows: MoveRow[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('NEST_DIR|')) continue
    const [action, folderName = '', fromPath = '', toPath = ''] = trimmed.split('|')
    if (!action || !folderName) continue
    let symlink = ''
    let mappedAction = action.toLowerCase()
    if (action === 'MOVED') {
      mappedAction = 'moved'
      symlink = 'created'
    } else if (action === 'WOULD_MOVE') {
      mappedAction = 'would_move'
      symlink = 'would_create'
    } else if (action === 'SYMLINK_CREATED' || action === 'WOULD_SYMLINK') {
      mappedAction = action === 'WOULD_SYMLINK' ? 'would_symlink' : 'symlink_created'
      symlink = action === 'WOULD_SYMLINK' ? 'would_create' : 'created'
    } else if (action === 'SKIP_SYMLINK') {
      mappedAction = 'skip_symlink'
      symlink = 'already_linked'
    } else if (action === 'ALREADY_MOVED') {
      mappedAction = 'already_nested'
    } else if (action === 'DEST_EXISTS') {
      mappedAction = 'skip_dest_exists'
    } else if (action === 'MISSING') {
      mappedAction = 'missing'
    }
    rows.push({
      scope: 'vps',
      folderName,
      fromPath: fromPath || `${VPS_COWORK_ROOT}/${folderName}`,
      toPath: toPath || `${VPS_COWORK_ROOT}/${PIB_COWORK_NESTING_SLUG}/${folderName}`,
      action: mappedAction,
      symlink,
      reason: action,
    })
  }
  return rows
}

function migrateVps(flags: CliFlags, folderNames: string[]): MoveRow[] {
  const user = process.env.PIB_VPS_USER?.trim() || 'root'
  const host = flags.host || DEFAULT_PIB_VPS_HOST
  const script = buildVpsMigrationBash({
    folderNames,
    dryRun: flags.dryRun,
  })
  const result = spawnSync(
    'ssh',
    [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=20',
      '-o', 'StrictHostKeyChecking=yes',
      `${user}@${host}`,
      'bash',
      '-s',
    ],
    {
      input: script,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `VPS migration SSH failed (status ${result.status}): ${result.stderr || result.stdout || 'no output'}`,
    )
  }
  return parseVpsOutputLines(result.stdout || '')
}

async function migrateFirestore(dryRun: boolean): Promise<FirestoreRewriteCounts> {
  const app = initAdmin()
  const db = app.firestore()
  db.settings({ ignoreUndefinedProperties: true })

  const counts: FirestoreRewriteCounts = {
    orgWorkspacesScanned: 0,
    orgWorkspacesRewritten: 0,
    organizationsScanned: 0,
    organizationsRewritten: 0,
    conversationsScanned: 0,
    conversationsRewritten: 0,
    pathFieldChanges: 0,
  }

  const orgWorkspaces = await db.collection(ORG_WORKSPACES_COLLECTION).get()
  for (const doc of orgWorkspaces.docs) {
    counts.orgWorkspacesScanned += 1
    const rewritten = rewriteOrgWorkspaceDoc(doc.data() ?? {})
    if (!rewritten.changed) continue
    counts.orgWorkspacesRewritten += 1
    counts.pathFieldChanges += rewritten.changes.length
    if (!dryRun) await doc.ref.set(buildFirestoreMergePatch(rewritten), { merge: true })
  }

  const organizations = await db.collection('organizations').get()
  for (const doc of organizations.docs) {
    counts.organizationsScanned += 1
    const rewritten = rewriteOrganizationDoc(doc.data() ?? {})
    if (!rewritten.changed) continue
    counts.organizationsRewritten += 1
    counts.pathFieldChanges += rewritten.changes.length
    if (!dryRun) await doc.ref.set(buildFirestoreMergePatch(rewritten), { merge: true })
  }

  const pageSize = 200
  let last: FirebaseFirestore.QueryDocumentSnapshot | undefined
  for (;;) {
    let query: FirebaseFirestore.Query = db
      .collection('conversations')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize)
    if (last) query = query.startAfter(last)
    const snap = await query.get()
    if (snap.empty) break

    const batch = db.batch()
    let batchWrites = 0
    for (const doc of snap.docs) {
      counts.conversationsScanned += 1
      const rewritten = rewriteConversationDoc(doc.data() ?? {})
      if (!rewritten.changed) continue
      counts.conversationsRewritten += 1
      counts.pathFieldChanges += rewritten.changes.length
      if (!dryRun) {
        batch.set(doc.ref, buildFirestoreMergePatch(rewritten), { merge: true })
        batchWrites += 1
      }
    }
    if (!dryRun && batchWrites > 0) await batch.commit()

    last = snap.docs[snap.docs.length - 1]
    if (snap.size < pageSize) break
  }

  return counts
}

function printSummary(summary: MigrationSummary): void {
  console.log('\n=== Org-scoped Cowork path migration summary ===')
  console.log(`Mode: ${summary.dryRun ? 'DRY-RUN (no writes)' : 'COMMIT'}`)

  console.log('\n--- Mac filesystem ---')
  if (summary.macRows.length === 0) {
    console.log('(no mac moves in scope)')
  } else {
    console.log('scope\tfolder\taction\tfrom\t→\tto\tsymlink')
    for (const row of summary.macRows) {
      console.log(
        formatMoveSummaryRow({
          scope: row.scope,
          folderName: row.folderName,
          fromPath: row.fromPath,
          toPath: row.toPath,
          action: row.action,
          symlink: row.symlink,
        }),
      )
    }
  }
  if (summary.macSkipped.length > 0) {
    console.log(`\nMac skipped (${summary.macSkipped.length}):`)
    for (const skip of summary.macSkipped) {
      console.log(`  - ${skip.folderName}: ${skip.reason}`)
    }
  }

  if (summary.mappingsChanges.length > 0) {
    console.log('\n--- Linked-computer mappings ---')
    for (const change of summary.mappingsChanges) {
      console.log(`  ${change.mappingId}: ${change.from} → ${change.to}`)
    }
  } else {
    console.log('\n--- Linked-computer mappings ---\n  (no change)')
  }

  if (summary.pibWorkspaceJsonUpdates.length > 0) {
    console.log('\n--- .pib-workspace.json ---')
    for (const update of summary.pibWorkspaceJsonUpdates) {
      console.log(`  ${update.path} (${update.changes} field${update.changes === 1 ? '' : 's'})`)
    }
  }

  console.log('\n--- VPS filesystem ---')
  if (summary.vpsRows.length === 0) {
    console.log('(no vps moves in scope)')
  } else {
    console.log('scope\tfolder\taction\tfrom\t→\tto\tsymlink')
    for (const row of summary.vpsRows) {
      console.log(
        formatMoveSummaryRow({
          scope: row.scope,
          folderName: row.folderName,
          fromPath: row.fromPath,
          toPath: row.toPath,
          action: row.action,
          symlink: row.symlink,
        }),
      )
    }
  }

  console.log('\n--- Firestore ---')
  const fs = summary.firestore
  console.log(`org_workspaces: ${fs.orgWorkspacesRewritten}/${fs.orgWorkspacesScanned} rewritten`)
  console.log(`organizations:  ${fs.organizationsRewritten}/${fs.organizationsScanned} rewritten`)
  console.log(`conversations:  ${fs.conversationsRewritten}/${fs.conversationsScanned} rewritten`)
  console.log(`path field changes (all collections): ${fs.pathFieldChanges}`)
  console.log('')
}

export async function run(flags: CliFlags): Promise<MigrationSummary> {
  loadEnv()
  const scopes = resolveMigrationScopes(flags)
  const emptyFirestore: FirestoreRewriteCounts = {
    orgWorkspacesScanned: 0,
    orgWorkspacesRewritten: 0,
    organizationsScanned: 0,
    organizationsRewritten: 0,
    conversationsScanned: 0,
    conversationsRewritten: 0,
    pathFieldChanges: 0,
  }

  const summary: MigrationSummary = {
    dryRun: flags.dryRun,
    macRows: [],
    vpsRows: [],
    macSkipped: [],
    mappingsChanges: [],
    pibWorkspaceJsonUpdates: [],
    firestore: emptyFirestore,
  }

  if (scopes.mac) {
    const mac = migrateMac(flags)
    summary.macRows = mac.rows
    summary.macSkipped = mac.skipped
    summary.mappingsChanges = mac.mappingsChanges
    summary.pibWorkspaceJsonUpdates = mac.pibWorkspaceJsonUpdates
  }

  if (scopes.vps) {
    const moveFolderNames = discoverPartnerWorkspaceFolderNames(flags.macCoworkRoot)
    if (moveFolderNames.length === 0) {
      console.warn('No move candidates discovered for VPS; skipping remote moves.')
    } else {
      summary.vpsRows = migrateVps(flags, moveFolderNames)
    }
  }

  if (scopes.firestore) {
    summary.firestore = await migrateFirestore(flags.dryRun)
  }

  printSummary(summary)
  return summary
}

if (require.main === module) {
  run(parseFlags(process.argv.slice(2)))
    .then((summary) => {
      if (summary.dryRun) console.log('Dry-run complete. Re-run with --commit to apply.')
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
