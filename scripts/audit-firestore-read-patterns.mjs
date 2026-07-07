#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()

const routeChecks = [
  'app/api/v1/crm/contacts/route.ts',
  'app/api/v1/projects/route.ts',
  'app/api/v1/social/posts/route.ts',
  'app/api/v1/campaigns/route.ts',
  'app/api/v1/crm/capture-sources/route.ts',
]

const dashboardDuplicateFetches = [
  '/api/v1/crm/contacts?limit=1',
  '/api/v1/campaigns?status=active',
  '/api/v1/crm/capture-sources',
  '/api/v1/social/stats?orgId=',
  '/api/v1/social/posts?orgId=',
]

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function getBlock(source) {
  const start = source.indexOf('export const GET')
  if (start < 0) return ''
  const rest = source.slice(start + 1)
  const next = rest.search(/\nexport const (POST|PUT|PATCH|DELETE)\b/)
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next)
}

function firstIndexOfAny(source, needles) {
  const indexes = needles
    .map((needle) => source.indexOf(needle))
    .filter((index) => index >= 0)
  return indexes.length > 0 ? Math.min(...indexes) : -1
}

const failures = []

for (const file of routeChecks) {
  const source = read(file)
  const block = getBlock(source)
  if (!block) {
    failures.push(`${file}: missing GET handler`)
    continue
  }
  if (!block.includes("searchParams.get('limit')") && !block.includes('searchParams.get("limit")')) {
    failures.push(`${file}: route is expected to parse a limit param`)
    continue
  }

  const firstGet = block.indexOf('.get()')
  const firstBoundedRead = firstIndexOfAny(block, ['.limit(', '.count('])
  if (firstGet >= 0 && (firstBoundedRead < 0 || firstGet < firstBoundedRead)) {
    failures.push(`${file}: GET handler calls .get() before a Firestore .limit() or .count() guard`)
  }
}

const dashboard = read('app/(portal)/portal/dashboard/page.tsx')
for (const needle of dashboardDuplicateFetches) {
  if (dashboard.includes(needle)) {
    failures.push(`app/(portal)/portal/dashboard/page.tsx: duplicate dashboard list fetch remains: ${needle}`)
  }
}

if (failures.length > 0) {
  console.error('Firestore read-pattern audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Firestore read-pattern audit passed.')
