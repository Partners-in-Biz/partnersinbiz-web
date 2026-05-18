#!/usr/bin/env tsx
// scripts/smoke-ads-sub3a-ext-offline-conversions.ts
// Smoke test for Sub-3a-ext Offline Conversions CSV bulk upload + reconciliation.
//
// Env vars required:
//   SMOKE_BASE_URL   — e.g. https://partnersinbiz.online
//   SMOKE_API_KEY    — API key with admin access
//   SMOKE_ORG_ID     — org ID to test against
//   SMOKE_ACTION_ID  — valid conversion action ID belonging to that org
//
// If any env var is missing, the script exits 0 (skip mode) — safe for CI.

const BASE_URL = process.env.SMOKE_BASE_URL
const API_KEY = process.env.SMOKE_API_KEY
const ORG_ID = process.env.SMOKE_ORG_ID
const ACTION_ID = process.env.SMOKE_ACTION_ID

if (!BASE_URL || !API_KEY || !ORG_ID || !ACTION_ID) {
  console.log('[smoke] SKIP — set SMOKE_BASE_URL, SMOKE_API_KEY, SMOKE_ORG_ID, SMOKE_ACTION_ID to run')
  process.exit(0)
}

const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'X-Org-Id': ORG_ID,
}

const CSV_CONTENT = [
  'event_id,event_time_iso,email,phone,value,currency,gclid,ttclid,li_fat_id',
  `smoke-001,${new Date().toISOString()},smoke1@partnersinbiz.online,,10.00,USD,,,`,
  `smoke-002,${new Date(Date.now() - 60000).toISOString()},smoke2@partnersinbiz.online,,20.00,USD,,,`,
  `smoke-003,${new Date(Date.now() - 120000).toISOString()},,+27821234567,30.00,ZAR,,,`,
].join('\n')

async function assertOk(res: Response, context: string) {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`[smoke] ${context} failed: HTTP ${res.status} — ${text.slice(0, 200)}`)
  }
  const json = await res.json()
  if (!json.success) {
    throw new Error(`[smoke] ${context} API error: ${json.error ?? JSON.stringify(json)}`)
  }
  return json.data
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  console.log('[smoke] Starting offline conversions smoke test')
  console.log(`[smoke] Base URL: ${BASE_URL}`)
  console.log(`[smoke] Org: ${ORG_ID}`)
  console.log(`[smoke] Conversion Action: ${ACTION_ID}`)

  // 1. Upload CSV
  console.log('\n[smoke] Step 1: Upload CSV')
  const form = new FormData()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form.append('file', new Blob([CSV_CONTENT], { type: 'text/csv' }) as any, 'smoke-test.csv')
  form.append('conversionActionId', ACTION_ID!)

  const uploadRes = await fetch(`${BASE_URL}/api/v1/ads/conversions/offline/upload`, {
    method: 'POST',
    headers: HEADERS,
    body: form,
  })
  const uploadData = await assertOk(uploadRes, 'Upload')
  const batchId = uploadData.batchId as string
  console.log(`[smoke] Batch created: ${batchId} (${uploadData.totalRows} rows)`)
  if (uploadData.parseErrors?.length > 0) {
    console.warn(`[smoke] Parse warnings: ${JSON.stringify(uploadData.parseErrors)}`)
  }

  // 2. List batches — verify batch appears
  console.log('\n[smoke] Step 2: List batches')
  const listRes = await fetch(`${BASE_URL}/api/v1/ads/conversions/offline/batches`, {
    headers: HEADERS,
  })
  const listData = await assertOk(listRes, 'List batches')
  const inList = (listData.batches as Array<{ id: string }>).find((b) => b.id === batchId)
  if (!inList) throw new Error(`[smoke] Batch ${batchId} not found in list`)
  console.log(`[smoke] Batch found in list ✓`)

  // 3. Process batch
  console.log('\n[smoke] Step 3: Process batch')
  const processRes = await fetch(`${BASE_URL}/api/v1/ads/conversions/offline/batches/${batchId}/process`, {
    method: 'POST',
    headers: HEADERS,
  })
  const processData = await assertOk(processRes, 'Process')
  console.log(`[smoke] Process result: ${JSON.stringify(processData)}`)

  // 4. Poll until terminal
  console.log('\n[smoke] Step 4: Poll batch until terminal status')
  const TERMINAL = new Set(['completed', 'failed', 'partial'])
  let attempts = 0
  const maxAttempts = 30

  while (attempts < maxAttempts) {
    await sleep(2000)
    attempts++
    const batchRes = await fetch(`${BASE_URL}/api/v1/ads/conversions/offline/batches/${batchId}`, {
      headers: HEADERS,
    })
    const batchData = await assertOk(batchRes, `Poll ${attempts}`)
    const status = batchData.batch.status as string
    console.log(`[smoke]   Poll ${attempts}: status=${status} processed=${batchData.batch.processedRows}/${batchData.batch.totalRows}`)

    if (TERMINAL.has(status)) {
      console.log(`\n[smoke] Batch reached terminal status: ${status}`)
      if (status === 'failed') {
        throw new Error(`[smoke] Batch failed: ${batchData.batch.errorMessage ?? 'unknown error'}`)
      }
      // Verify rows
      const rowsOk = (batchData.rows as Array<{ status: string }>).every(
        (r) => r.status === 'sent' || r.status === 'failed' || r.status === 'skipped',
      )
      if (!rowsOk) throw new Error('[smoke] Some rows not in terminal status')
      console.log(`[smoke] All ${batchData.rows.length} visible rows in terminal status ✓`)
      break
    }

    if (attempts >= maxAttempts) {
      throw new Error(`[smoke] Batch did not reach terminal status after ${maxAttempts * 2}s`)
    }
  }

  console.log('\n[smoke] All assertions passed ✓')
}

main().catch((err) => {
  console.error(err.message ?? err)
  process.exit(1)
})
