#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const previewUrl = arg('--preview-url')
const proofUrl = arg('--proof-url') || `${previewUrl || ''}/portal/creative-canvas`

if (!previewUrl) {
  console.error('Usage: node scripts/creative-canvas-world-class-proof.mjs --preview-url PREVIEW_URL [--proof-url PROOF_URL]')
  process.exit(1)
}

const checkedAt = new Date().toISOString()
const response = await fetch(proofUrl, { redirect: 'manual' })
const protectedRouteOk = response.status === 200 || response.status === 401 || response.status === 307 || response.status === 308

const output = {
  previewUrl,
  proofUrl,
  checkedAt,
  protectedRoute: {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    ok: protectedRouteOk,
  },
  requiredManualSignedInArtifacts: [
    'desktop viewport behavior screenshot and interaction JSON',
    'tablet viewport behavior screenshot and interaction JSON',
    'mobile viewport behavior screenshot and interaction JSON',
    'mobile panel viewport behavior screenshot and interaction JSON',
    'two-user collaboration mutation video or event JSON',
    'runtime/export category evidence JSON',
  ],
}

const dir = path.join(process.cwd(), 'artifacts', 'creative-canvas')
fs.mkdirSync(dir, { recursive: true })

const file = path.join(dir, `world-class-proof-${checkedAt.replace(/[:.]/g, '-')}.json`)
fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`)

console.log(file)

if (!protectedRouteOk) process.exit(2)
