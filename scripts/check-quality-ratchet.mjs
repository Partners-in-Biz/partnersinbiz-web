import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const baselinePath = path.join(root, 'config', 'quality-ratchets.json')
const scannedDirs = ['app', 'components', 'lib']
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx'])

function walk(dir) {
  const full = path.join(root, dir)
  if (!fs.existsSync(full)) return []
  const entries = fs.readdirSync(full, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const relative = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'out', 'build'].includes(entry.name)) return []
      return walk(relative)
    }
    if (!entry.isFile() || !extensions.has(path.extname(entry.name))) return []
    return [relative]
  })
}

function countMatches(source, regex) {
  return source.match(regex)?.length ?? 0
}

function collectCounts() {
  const files = scannedDirs.flatMap(walk)
  let explicitAny = 0
  let emptyCatch = 0

  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    explicitAny += countMatches(source, /\b(?:as|:)\s*any\b|<any>/g)
    emptyCatch += countMatches(source, /catch\s*(?:\([^)]*\))?\s*\{\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)?\}/g)
  }

  return { explicitAny, emptyCatch }
}

const current = collectCounts()

if (process.argv.includes('--print')) {
  console.log(JSON.stringify(current, null, 2))
  process.exit(0)
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const failures = Object.entries(baseline).flatMap(([key, allowed]) => {
  const actual = current[key]
  return actual > allowed ? [`${key}: ${actual} > ${allowed}`] : []
})

if (failures.length > 0) {
  console.error('Quality ratchet failed. Counts may go down, but not up.')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Quality ratchet passed:', JSON.stringify(current))
