#!/usr/bin/env tsx
/**
 * Design Finish Gate CLI — the fresh-reviewer finish gate runner.
 *
 * Research ZTTo7g6CU80u1uUSZvoC recommendation P2: before marking a
 * web/design/Studio task done, a SEPARATE vision review pass (fresh context,
 * never the builder thread, never self-grading) grades the delivered surface
 * against the brief contract and returns a verdict: ship / fix / rebuild,
 * scored promise-by-promise, with at most 2 fix rounds and
 * resolved/partial/unresolved scoring.
 *
 * Two modes:
 *   prepare — build a ReviewContract from a brief (+ screenshots, optional
 *             ModLens vision transcripts) and print the self-contained
 *             fresh-reviewer prompt (JSON envelope). Hand that prompt to a
 *             FRESH reviewer context; never answer it in the builder thread.
 *   verify  — read the contract + the reviewer's JSON verdict, enforce the
 *             never-self-grade rule and the fix-round budget, print the
 *             aggregated report.
 *
 * Exit codes: 0 ship / 2 fix (rounds remain) / 3 rebuild (or fix-rounds
 * exhausted) / 1 failure.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildContract, extractPromises, resolveScreenshots } from '../lib/design-finish-gate/contract'
import { buildReport, parseReviewerOutput } from '../lib/design-finish-gate/reviewer'
import { renderVerdictLine, renderVerdictMarkdown } from '../lib/design-finish-gate/report'
import { buildVisionTranscripts } from '../lib/design-finish-gate/vision'
import type { ReviewContract, ReviewerOutput } from '../lib/design-finish-gate/types'

interface CliOptions {
  mode: 'prepare' | 'verify' | 'help'
  title?: string
  briefFile?: string
  briefText?: string
  promisesFile?: string
  screenshots?: string[]
  builderAgentId?: string
  round?: number
  maxFixRounds?: number
  contractFile?: string
  reviewerFile?: string
  vision?: boolean
  json?: boolean
}

function fail(msg: string): never {
  process.stderr.write(`design-finish-gate: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { mode: 'help' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case 'prepare':
        opts.mode = 'prepare'
        break
      case 'verify':
        opts.mode = 'verify'
        break
      case '--title':
        opts.title = argv[++i]
        break
      case '--brief-file':
        opts.briefFile = argv[++i]
        break
      case '--brief':
        opts.briefText = argv[++i]
        break
      case '--promises-file':
        opts.promisesFile = argv[++i]
        break
      case '--screenshots':
        opts.screenshots = (argv[++i] ?? '').split(',').filter(Boolean)
        break
      case '--builder-agent':
        opts.builderAgentId = argv[++i]
        break
      case '--round':
        opts.round = Number(argv[++i])
        break
      case '--max-fix-rounds':
        opts.maxFixRounds = Number(argv[++i])
        break
      case '--contract':
        opts.contractFile = argv[++i]
        break
      case '--reviewer-output':
        opts.reviewerFile = argv[++i]
        break
      case '--vision':
        opts.vision = true
        break
      case '--json':
        opts.json = true
        break
      case '-h':
      case '--help':
        opts.mode = 'help'
        break
      default:
        fail(`unknown argument: ${arg}`)
    }
  }
  return opts
}

function readBrief(opts: CliOptions): string {
  if (opts.briefFile) {
    const resolved = path.resolve(opts.briefFile)
    if (!fs.existsSync(resolved)) fail(`brief file not found: ${resolved}`)
    return fs.readFileSync(resolved, 'utf8')
  }
  if (opts.briefText !== undefined) return opts.briefText
  fail('prepare requires --brief-file or --brief')
}

function readPromisesFile(p: string): { id: string; label: string; contract?: string }[] {
  const resolved = path.resolve(p)
  if (!fs.existsSync(resolved)) fail(`promises file not found: ${resolved}`)
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as unknown
  if (!Array.isArray(raw)) fail('promises file must be a JSON array')
  return raw.map((item, idx) => {
    const label = typeof (item as { label?: unknown }).label === 'string' ? (item as { label: string }).label : String(item)
    return { id: `p${idx + 1}`, label, contract: label }
  })
}

function readJsonFile(p: string): unknown {
  const resolved = path.resolve(p)
  if (!fs.existsSync(resolved)) fail(`file not found: ${resolved}`)
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch {
    fail(`invalid JSON in ${resolved}`)
  }
}

function help(): void {
  process.stdout.write(`Design Finish Gate — fresh-reviewer verdict for design/Studio tasks

Usage:
  design-finish-gate prepare --brief-file brief.md [--title "Task"] \\
      [--promises-file promises.json] [--screenshots a.png,b.png] \\
      [--builder-agent theo] [--round 1] [--max-fix-rounds 2] [--vision] [--json]

  design-finish-gate verify --contract contract.json --reviewer-output verdict.json \\
      [--json]

  Hand contract.reviewerPrompt to a FRESH reviewer context (never the builder
  thread), then verify its JSON output. Exit codes: 0 ship / 2 fix / 3 rebuild
  / 1 failure.
`)
}

async function main(): Promise<number> {
  let opts: CliOptions
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }

  if (opts.mode === 'help') {
    help()
    return 0
  }

  if (opts.mode === 'prepare') {
    const brief = readBrief(opts)
    const title = opts.title ?? 'Untitled design task'
    const builderAgentId = opts.builderAgentId ?? 'unknown'
    const screenshots = resolveScreenshots(opts.screenshots ?? [])
    let promises: { id: string; label: string; contract?: string }[] | undefined
    if (opts.promisesFile) promises = readPromisesFile(opts.promisesFile)

    let visionTranscripts: Record<string, string> | undefined
    const visionNotes: string[] = []
    if (opts.vision && screenshots.length) {
      const result = buildVisionTranscripts(screenshots)
      visionTranscripts = result.transcripts
      visionNotes.push(...result.notes)
    }

    const contract = buildContract({
      title,
      brief,
      promises,
      screenshots,
      visionTranscripts,
      builderAgentId,
      round: opts.round,
      maxFixRounds: opts.maxFixRounds,
    })

    if (opts.json) {
      const envelope = { schema: 'pib-design-finish-gate-prepare/v1', contract, visionNotes }
      process.stdout.write(JSON.stringify(envelope, null, 2) + '\n')
    } else {
      process.stdout.write(`Design Finish Gate — prepare (round ${contract.round}, max ${contract.maxFixRounds} fix rounds)\n`)
      process.stdout.write(`Title: ${title}\nPromises: ${contract.promises.length} · Screenshots: ${screenshots.length} · Vision transcripts: ${Object.keys(visionTranscripts ?? {}).length}\n`)
      if (visionNotes.length) process.stdout.write(`Vision notes:\n${visionNotes.map((n) => `  - ${n}`).join('\n')}\n`)
      process.stdout.write('\n--- FRESH REVIEWER PROMPT (hand to a fresh context, never self-grade) ---\n')
      process.stdout.write(contract.reviewerPrompt)
      process.stdout.write('\n--- END REVIEWER PROMPT ---\n')
      process.stdout.write('\nContract JSON (for verify --contract):\n')
      process.stdout.write(JSON.stringify(contract, null, 2) + '\n')
    }
    return 0
  }

  if (opts.mode === 'verify') {
    if (!opts.contractFile || !opts.reviewerFile) fail('verify requires --contract and --reviewer-output')
    const contractRaw = readJsonFile(opts.contractFile) as Partial<ReviewContract>
    const reviewerRaw = readJsonFile(opts.reviewerFile) as Partial<ReviewerOutput>
    if (!contractRaw || typeof contractRaw !== 'object' || !Array.isArray(contractRaw.promises)) {
      fail('contract file is not a finish-gate contract')
    }
    const reviewerText = typeof reviewerRaw === 'string' ? reviewerRaw : JSON.stringify(reviewerRaw)

    let reviewer: ReviewerOutput
    try {
      reviewer = parseReviewerOutput(reviewerText, { builderAgentId: contractRaw.builderAgentId })
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
      return 1
    }
    const contract = contractRaw as ReviewContract
    const report = buildReport({ contract, reviewer, round: opts.round })

    if (opts.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    } else {
      process.stdout.write(renderVerdictMarkdown(report) + '\n')
      process.stdout.write(renderVerdictLine(report) + '\n')
    }
    return report.exitCode
  }

  fail('unknown mode')
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`design-finish-gate: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
