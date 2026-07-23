#!/usr/bin/env node
/**
 * Lightweight contract checks for the system skills pack.
 * Ensures golden payloads exist and invalid examples are documented.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))

let failed = 0
function check( cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    failed += 1
  } else {
    console.log(`ok: ${msg}`)
  }
}

check(typeof manifest.packVersion === 'string' && manifest.packVersion.length > 0, 'packVersion set')
check(manifest.tiers?.core?.skills?.includes('system-auth'), 'core includes system-auth')
check(manifest.tiers?.core?.skills?.includes('client-documents'), 'core includes client-documents')

for (const [name, meta] of Object.entries(manifest.skills || {})) {
  const skillMd = join(root, 'skills', name, 'SKILL.md')
  check(existsSync(skillMd), `skill file exists: ${name}`)
  if (Array.isArray(meta.contracts)) {
    for (const rel of meta.contracts) {
      check(existsSync(join(root, rel)), `contract exists: ${rel}`)
    }
  }
}

const valid = JSON.parse(readFileSync(join(root, 'contracts/client-documents/version-payload.valid.json'), 'utf8'))
check(Array.isArray(valid.blocks) && valid.blocks.length >= 1, 'valid version payload has blocks')
check(valid.blocks.every((b) => typeof b.id === 'string' && typeof b.type === 'string'), 'blocks have id+type')
check(valid.blocks.every((b) => typeof b.required === 'boolean'), 'blocks have required boolean')
check(valid.blocks.every((b) => b.display && typeof b.display === 'object'), 'blocks have display object')
check(valid.theme?.palette?.bg && valid.theme?.typography?.heading, 'theme has palette+typography')

const invalid = JSON.parse(readFileSync(join(root, 'contracts/client-documents/version-payload.invalid.json'), 'utf8'))
check(Array.isArray(invalid.cases) && invalid.cases.length >= 1, 'invalid cases documented')

if (failed) {
  console.error(`\n${failed} contract check(s) failed`)
  process.exit(1)
}
console.log('\nAll contract checks passed')
