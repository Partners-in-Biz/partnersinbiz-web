#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(__dirname)
const taxonomyPath = join(repoRoot, 'config', 'okf-taxonomy.json')
const taxonomy = JSON.parse(readFileSync(taxonomyPath, 'utf8'))

const defaultOptions = {
  root: '/var/lib/hermes/cowork-wiki',
  domain: 'agents/partners',
  sections: ['wiki', 'raw', 'logs'],
  allDomains: false,
  json: false,
  strict: false,
  writeExport: false,
  exportDir: join(repoRoot, 'tmp', 'okf-export'),
  copyMarkdown: false,
  includeSensitive: false,
  sampleLimit: 25,
}

function printHelp() {
  console.log(`Usage: node scripts/okf-validate-export.mjs [options]

Validates Partners in Biz Cowork/Obsidian markdown against the incremental OKF v0.1 compatibility policy.

Default mode is dry-run/report-only: it reads files and prints a summary, but writes nothing and exits 0 for legacy gaps.

Options:
  --root <path>            Cowork wiki root. Default: ${defaultOptions.root}
  --domain <path>          Domain under root to scan. Default: ${defaultOptions.domain}
  --all-domains            Scan the whole root instead of one domain.
  --sections <csv>         Relative files/directories under the domain. Default: ${defaultOptions.sections.join(',')}
  --json                   Print the full report as JSON.
  --strict                 Exit non-zero when OKF hard requirements fail.
  --write-export           Write a metadata-only export report under --export-dir.
  --export-dir <path>      Export directory. Default: ${defaultOptions.exportDir}
  --copy-markdown          With --write-export, also copy source markdown into notes/.
                           Sensitive files are skipped unless --include-sensitive is also set.
  --include-sensitive      Permit --copy-markdown to copy files marked visibility: sensitive.
  --sample-limit <number>  Max sample paths per warning bucket. Default: ${defaultOptions.sampleLimit}
  --help                   Show this help.
`)
}

function parseArgs(argv) {
  const options = { ...defaultOptions }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      index += 1
      if (index >= argv.length || argv[index].startsWith('--')) {
        throw new Error(`${arg} requires a value`)
      }
      return argv[index]
    }

    if (arg === '--root') options.root = next()
    else if (arg === '--domain') options.domain = next()
    else if (arg === '--all-domains') options.allDomains = true
    else if (arg === '--sections') options.sections = next().split(',').map((part) => part.trim()).filter(Boolean)
    else if (arg === '--json') options.json = true
    else if (arg === '--strict') options.strict = true
    else if (arg === '--write-export') options.writeExport = true
    else if (arg === '--export-dir') options.exportDir = next()
    else if (arg === '--copy-markdown') options.copyMarkdown = true
    else if (arg === '--include-sensitive') options.includeSensitive = true
    else if (arg === '--sample-limit') options.sampleLimit = Number(next())
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!Number.isFinite(options.sampleLimit) || options.sampleLimit < 0) {
    throw new Error('--sample-limit must be a non-negative number')
  }

  options.root = resolve(options.root)
  options.exportDir = resolve(options.exportDir)
  return options
}

function toPosixPath(value) {
  return value.split(sep).join('/')
}

function isInside(child, parent) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith('..'))
}

function listMarkdownFiles(path) {
  if (!existsSync(path)) return []
  const stats = statSync(path)
  if (stats.isFile()) return path.endsWith('.md') ? [path] : []
  if (!stats.isDirectory()) return []

  const entries = readdirSync(path, { withFileTypes: true })
  return entries.flatMap((entry) => {
    if (entry.name.startsWith('.') || ['node_modules', '.git', '.obsidian', '.trash'].includes(entry.name)) return []
    const fullPath = join(path, entry.name)
    if (entry.isDirectory()) return listMarkdownFiles(fullPath)
    return entry.isFile() && entry.name.endsWith('.md') ? [fullPath] : []
  })
}

function resolveScanTargets(options) {
  const targets = []
  if (options.allDomains) {
    targets.push(options.root)
  } else {
    const domainRoot = join(options.root, options.domain)
    for (const section of options.sections) {
      targets.push(join(domainRoot, section))
    }
  }

  return [...new Set(targets.map((target) => resolve(target)))]
}

function readMarkdownFiles(options) {
  if (!existsSync(options.root)) throw new Error(`Root does not exist: ${options.root}`)
  const targets = resolveScanTargets(options)
  const files = targets.flatMap(listMarkdownFiles)
  return [...new Set(files.map((file) => resolve(file)))].sort()
}

function extractFrontmatter(source) {
  const normalized = source.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---\n') && !normalized.startsWith('---\r\n')) {
    return { hasFrontmatter: false, metadata: {}, errors: [] }
  }

  const lines = normalized.split(/\r?\n/)
  let closingIndex = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') {
      closingIndex = index
      break
    }
  }

  if (closingIndex < 0) {
    return { hasFrontmatter: true, metadata: {}, errors: ['frontmatter opening marker has no closing --- line'] }
  }

  const raw = lines.slice(1, closingIndex).join('\n')
  const parsed = parseFrontmatterSubset(raw)
  return { hasFrontmatter: true, rawFrontmatter: raw, metadata: parsed.metadata, errors: parsed.errors }
}

function parseFrontmatterSubset(raw) {
  const metadata = {}
  const errors = []
  const lines = raw.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (/^\s/.test(line)) continue

    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
    if (!match) {
      errors.push(`line ${index + 1}: expected key: value`)
      continue
    }

    const [, key, rawValue] = match
    if (rawValue === '|' || rawValue === '>') {
      const block = []
      while (index + 1 < lines.length && /^\s/.test(lines[index + 1])) {
        index += 1
        block.push(lines[index].replace(/^\s{2,}/, ''))
      }
      metadata[key] = block.join(rawValue === '>' ? ' ' : '\n').trim()
      continue
    }

    if (rawValue === '') {
      const list = []
      let lookahead = index + 1
      while (lookahead < lines.length && /^\s+-\s+/.test(lines[lookahead])) {
        list.push(parseScalar(lines[lookahead].replace(/^\s+-\s+/, '').trim()))
        lookahead += 1
      }
      if (list.length > 0) {
        metadata[key] = list
        index = lookahead - 1
      } else {
        metadata[key] = ''
      }
      continue
    }

    metadata[key] = parseScalar(rawValue.trim())
  }

  return { metadata, errors }
}

function parseScalar(value) {
  if (value === 'null' || value === '~') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith('[') && value.endsWith(']')) return parseInlineList(value)
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value.replace(/\s+#.*$/, '')
}

function parseInlineList(value) {
  const inner = value.slice(1, -1).trim()
  if (!inner) return []
  const items = []
  let current = ''
  let quote = null
  for (const char of inner) {
    if ((char === '"' || char === "'") && quote === null) {
      quote = char
      current += char
    } else if (char === quote) {
      quote = null
      current += char
    } else if (char === ',' && quote === null) {
      items.push(parseScalar(current.trim()))
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) items.push(parseScalar(current.trim()))
  return items
}

function stringValue(value) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value).trim()
}

function titleFromSource(source, file) {
  const h1 = source.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  return file.replace(/\.md$/, '').split(/[\\/]/).pop()
}

function normalizeType(typeValue) {
  const value = stringValue(typeValue)
  if (!value) return { status: 'missing', value: '', canonical: '' }
  const canonicalSet = new Set(taxonomy.canonicalTypes)
  if (canonicalSet.has(value)) return { status: 'canonical', value, canonical: value }
  const lower = value.toLowerCase()
  const alias = taxonomy.aliases[lower]
  if (alias) return { status: 'alias', value, canonical: alias }
  const caseMatch = taxonomy.canonicalTypes.find((candidate) => candidate.toLowerCase() === lower)
  if (caseMatch) return { status: 'alias', value, canonical: caseMatch }
  return { status: 'unknown', value, canonical: value }
}

function addSample(bucket, file, sampleLimit) {
  if (bucket.length < sampleLimit) bucket.push(file)
}

function increment(map, key) {
  const normalized = key || '(missing)'
  map[normalized] = (map[normalized] ?? 0) + 1
}

function analyzeFile(fullPath, options) {
  const source = readFileSync(fullPath, 'utf8')
  const rootForRelative = options.allDomains ? options.root : join(options.root, options.domain)
  const relativePath = toPosixPath(relative(rootForRelative, fullPath))
  const rootRelativePath = toPosixPath(relative(options.root, fullPath))
  const basename = fullPath.split(/[\\/]/).pop().toLowerCase()
  const reserved = taxonomy.reservedFilenames.includes(basename)
  const frontmatter = extractFrontmatter(source)
  const metadata = frontmatter.metadata ?? {}
  const typeInfo = normalizeType(metadata.type)
  const parseErrors = frontmatter.errors ?? []
  const okfCompatible = reserved || (frontmatter.hasFrontmatter && parseErrors.length === 0 && typeInfo.status !== 'missing')
  const visibility = stringValue(metadata.visibility) || 'internal'
  const orgId = stringValue(metadata.orgId)
  const platformParent = orgId && taxonomy.platformParentOrgIds.includes(orgId)

  return {
    path: relativePath,
    rootPath: rootRelativePath,
    absolutePath: fullPath,
    reserved,
    hasFrontmatter: frontmatter.hasFrontmatter,
    parseErrors,
    okfCompatible,
    type: typeInfo.value,
    canonicalType: typeInfo.canonical,
    typeStatus: typeInfo.status,
    title: stringValue(metadata.title) || stringValue(metadata.name) || titleFromSource(source, fullPath),
    description: stringValue(metadata.description),
    timestamp: stringValue(metadata.timestamp),
    tags: Array.isArray(metadata.tags) ? metadata.tags.map(stringValue).filter(Boolean) : stringValue(metadata.tags),
    domain: stringValue(metadata.domain),
    visibility,
    status: stringValue(metadata.status),
    sourceOfTruth: stringValue(metadata.source_of_truth),
    orgId,
    clientOrgId: stringValue(metadata.clientOrgId),
    ownerAgent: stringValue(metadata.ownerAgent),
    approvalTaskId: stringValue(metadata.approvalTaskId),
    platformParent,
  }
}

function buildReport(files, options) {
  const summary = {
    okfTarget: taxonomy.okfTarget,
    taxonomyVersion: taxonomy.version,
    dryRun: !options.writeExport,
    root: options.root,
    domain: options.allDomains ? '(all domains)' : options.domain,
    sections: options.allDomains ? ['(all)'] : options.sections,
    strict: options.strict,
    writeExport: options.writeExport,
    copyMarkdown: options.copyMarkdown,
    totalMarkdown: files.length,
    reserved: 0,
    conceptCandidates: 0,
    withFrontmatter: 0,
    withNonEmptyType: 0,
    okfCompatible: 0,
    parseError: 0,
    missingType: 0,
    canonicalType: 0,
    aliasType: 0,
    unknownType: 0,
    sensitive: 0,
    platformParentOrg: 0,
  }

  const byType = {}
  const byOrgId = {}
  const byVisibility = {}
  const optionalMissing = Object.fromEntries(taxonomy.recommendedFields.map((field) => [field, 0]))
  const samples = {
    parseErrors: [],
    missingType: [],
    aliasType: [],
    unknownType: [],
    sensitive: [],
    platformParentOrg: [],
  }

  const analyzedFiles = files.map((file) => analyzeFile(file, options))

  for (const file of analyzedFiles) {
    if (file.reserved) summary.reserved += 1
    else summary.conceptCandidates += 1

    if (file.hasFrontmatter) summary.withFrontmatter += 1
    if (file.type) summary.withNonEmptyType += 1
    if (file.okfCompatible) summary.okfCompatible += 1
    if (file.parseErrors.length > 0) {
      summary.parseError += 1
      addSample(samples.parseErrors, { path: file.rootPath, errors: file.parseErrors }, options.sampleLimit)
    }

    if (!file.reserved && !file.type) {
      summary.missingType += 1
      addSample(samples.missingType, file.rootPath, options.sampleLimit)
    }

    if (file.typeStatus === 'canonical') summary.canonicalType += 1
    if (file.typeStatus === 'alias') {
      summary.aliasType += 1
      addSample(samples.aliasType, { path: file.rootPath, type: file.type, canonicalType: file.canonicalType }, options.sampleLimit)
    }
    if (file.typeStatus === 'unknown') {
      summary.unknownType += 1
      addSample(samples.unknownType, { path: file.rootPath, type: file.type }, options.sampleLimit)
    }
    if (file.visibility === 'sensitive') {
      summary.sensitive += 1
      addSample(samples.sensitive, file.rootPath, options.sampleLimit)
    }
    if (file.platformParent) {
      summary.platformParentOrg += 1
      addSample(samples.platformParentOrg, file.rootPath, options.sampleLimit)
    }

    increment(byType, file.canonicalType || '(missing)')
    increment(byOrgId, file.orgId || '(missing)')
    increment(byVisibility, file.visibility)

    for (const field of taxonomy.recommendedFields) {
      const value = field === 'source_of_truth' ? file.sourceOfTruth : file[field]
      if (!stringValue(value)) optionalMissing[field] += 1
    }
  }

  summary.compatibilityPct = summary.conceptCandidates === 0
    ? 100
    : Number(((summary.okfCompatible - summary.reserved) / summary.conceptCandidates * 100).toFixed(2))

  const strictFailures = []
  if (summary.parseError > 0) strictFailures.push(`${summary.parseError} file(s) have frontmatter parse errors`)
  if (summary.missingType > 0) strictFailures.push(`${summary.missingType} non-reserved concept file(s) are missing non-empty type`)

  return {
    generatedAt: new Date().toISOString(),
    actor: 'pip',
    mode: options.writeExport ? 'metadata-export' : 'dry-run',
    summary,
    byType,
    byOrgId,
    byVisibility,
    optionalMissing,
    samples,
    strictFailures,
    files: analyzedFiles.map(({ absolutePath, ...file }) => file),
  }
}

function writeExport(report, options) {
  if (!options.writeExport) return null
  if (!isInside(options.exportDir, join(repoRoot, 'tmp'))) {
    throw new Error(`Refusing to write export outside repo tmp/: ${options.exportDir}`)
  }

  mkdirSync(options.exportDir, { recursive: true })
  const reportPath = join(options.exportDir, 'okf-validation-report.json')
  const manifestPath = join(options.exportDir, 'okf-files.jsonl')
  const readmePath = join(options.exportDir, 'README.md')

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(manifestPath, `${report.files.map((file) => JSON.stringify(file)).join('\n')}\n`)
  writeFileSync(readmePath, `# PiB OKF compatibility export\n\nGenerated: ${report.generatedAt}\nMode: metadata-only by default.\n\nThis phase-1 export is internal evidence for OKF compatibility. It is not client-visible, not a permissions layer, and not a source rewrite. Source markdown is copied only when --copy-markdown is used.\n`)

  let copiedMarkdown = 0
  let skippedSensitive = 0
  if (options.copyMarkdown) {
    const notesRoot = join(options.exportDir, 'notes')
    mkdirSync(notesRoot, { recursive: true })
    for (const file of report.files) {
      if (file.visibility === 'sensitive' && !options.includeSensitive) {
        skippedSensitive += 1
        continue
      }
      const source = join(options.root, file.rootPath)
      const destination = join(notesRoot, file.rootPath)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
      copiedMarkdown += 1
    }
  }

  return { exportDir: options.exportDir, reportPath, manifestPath, readmePath, copiedMarkdown, skippedSensitive }
}

function printHuman(report, exportResult) {
  const { summary } = report
  console.log('OKF compatibility dry-run')
  console.log(`- scope: ${summary.domain} / ${summary.sections.join(',')}`)
  console.log(`- markdown files: ${summary.totalMarkdown}`)
  console.log(`- concept candidates: ${summary.conceptCandidates}`)
  console.log(`- OKF compatible: ${summary.okfCompatible} (${summary.compatibilityPct}%)`)
  console.log(`- with non-empty type: ${summary.withNonEmptyType}`)
  console.log(`- missing type: ${summary.missingType}`)
  console.log(`- parse errors: ${summary.parseError}`)
  console.log(`- canonical/alias/unknown types: ${summary.canonicalType}/${summary.aliasType}/${summary.unknownType}`)
  console.log(`- sensitive visibility markers: ${summary.sensitive}`)
  console.log(`- platform parent org markers: ${summary.platformParentOrg}`)

  if (report.strictFailures.length > 0) {
    console.log('Strict failures:')
    for (const failure of report.strictFailures) console.log(`- ${failure}`)
  }

  if (exportResult) {
    console.log(`Export written: ${exportResult.exportDir}`)
    if (summary.copyMarkdown) {
      console.log(`Markdown copied: ${exportResult.copiedMarkdown}; sensitive skipped: ${exportResult.skippedSensitive}`)
    }
  }
}

try {
  const options = parseArgs(process.argv.slice(2))
  const files = readMarkdownFiles(options)
  const report = buildReport(files, options)
  const exportResult = writeExport(report, options)

  if (options.json) console.log(JSON.stringify({ ...report, export: exportResult }, null, 2))
  else printHuman(report, exportResult)

  if (options.strict && report.strictFailures.length > 0) process.exit(1)
} catch (error) {
  if (process.env.OKF_DEBUG_STACK && error instanceof Error) console.error(error.stack)
  else console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}
