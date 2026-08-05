#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const docsUrl = 'https://hermes-agent.nousresearch.com/docs/user-guide/desktop'
const baselinePath = path.join(root, 'config', 'hermes-desktop-parity-baseline.json')
const reportPath = process.env.HERMES_PARITY_REPORT_PATH
  ? path.resolve(root, process.env.HERMES_PARITY_REPORT_PATH)
  : null
const updateBaseline = process.argv.includes('--update-baseline')

const requiredUpstreamPhrases = [
  'Streaming responses with live tool activity',
  'The same conversation history as every other Hermes surface',
  'Drag-and-drop files anywhere in the chat area',
  'A right-hand preview rail',
  'Composer history and queue editing',
  'Per-session YOLO toggle',
  'The model picker lives in the composer',
  'switch the model, reasoning effort, and fast mode',
  'Per-model effort/fast presets',
  'Talk to Hermes and hear it back',
  'Providers settings pane',
  'Every provider and model in the menus',
  'Tool-backend installs from the GUI',
  'Auxiliary-model warning',
  'Skills',
  'Cron',
  'Profiles',
  'Messaging',
  'Command palette',
  'Rebindable shortcuts',
  'Session-list overhaul',
  'Search sessions by id',
  'Concurrent multi-profile sessions',
  'hermes serve',
  'tui_gateway JSON-RPC/WebSocket API',
]

const pibMarkers = [
  {
    feature: 'Sanitized conversation-scoped model/provider catalogue',
    path: 'lib/messages/model-catalog.ts',
    contains: ['getMessageModelCatalog', 'validateMessageModelSelection', 'canSelect'],
  },
  {
    feature: 'Model/provider picker rendered in Messages composer',
    path: 'components/chat/UnifiedChat.tsx',
    contains: ['ModelProviderPicker', 'selectedRuntime', '/models?', 'provider: runtimeForSend.provider'],
  },
  {
    feature: 'Reasoning effort selector and Hermes run injection',
    path: 'components/chat/UnifiedChat.tsx',
    contains: ['agentEffort', 'Thinking effort', 'runtimeForSend?.model', 'runtimeForSend?.provider'],
  },
  {
    feature: 'Server-side model/provider validation before message creation',
    path: 'app/api/v1/conversations/[convId]/messages/route.ts',
    contains: ['validateMessageModelSelection', 'fail without creating a partial thread', 'modelSelection'],
  },
  {
    feature: 'PiB chat context injection into Hermes /v1/runs',
    path: 'app/api/v1/conversations/[convId]/messages/route.ts',
    contains: ['buildConversationHistoryBlock', 'const hermesInput =', 'createHermesRun', 'conversation_id: convId'],
  },
  {
    feature: 'Hermes /v1/runs client, stop, and approval bridge',
    path: 'lib/hermes/server.ts',
    contains: ["'/v1/runs'", '/stop', '/approval', 'provider: request.provider'],
  },
  {
    feature: 'Live event stream proxy and normalization',
    path: 'app/api/v1/admin/agents/[agentId]/runs/[runId]/events/route.ts',
    contains: ['createNormalizedHermesSseStream', '/v1/runs/${encodeURIComponent(runId)}/events'],
  },
  {
    feature: 'Hermes event names normalized for PiB UI',
    path: 'lib/hermes/progress-events.ts',
    contains: ["rawEvent === 'message.delta'", "event: 'assistant.text_delta'", "event: 'approval.required'", "event: 'reasoning.summary'"],
  },
  {
    feature: 'Runtime inspector rail and stop affordance',
    path: 'components/messages/hermes/RuntimeInspectorRail.tsx',
    contains: ['RuntimeInspectorRail', 'Copy run ID', 'onStop', 'selectedRuntime'],
  },
  {
    feature: 'Voice-to-composer input',
    path: 'components/chat/VoiceInputButton.tsx',
    contains: ['SpeechRecognition', 'onTranscript', 'Voice input'],
  },
  {
    feature: 'Drag/drop attachments on composer',
    path: 'components/chat/UnifiedChat.tsx',
    contains: ['onDrop={handleAttachmentDrop}', 'data-testid="chat-input-drop-zone"', 'dataTransferHasFiles'],
  },
  {
    feature: 'Approval resolution from in-flight chat',
    path: 'components/chat/UnifiedChat.tsx',
    contains: ['resolveApproval', '/approval', 'waiting_approval'],
  },
  {
    feature: 'Agent-aware workbench browser (display tab beside chat)',
    path: 'components/messages/workbench/WorkbenchBrowserPanel.tsx',
    contains: ['WorkbenchBrowserPanel', 'snapshot', 'onTakeControl', 'onToggleAllowPrivate'],
  },
  {
    feature: 'Accessibility-tree text snapshot + click-by-ref control plane',
    path: 'app/api/v1/conversations/[convId]/workbench/browser/sessions/[sessionId]/snapshot/route.ts',
    contains: ['enqueueBrowserSessionSnapshot', 'workbenchBrowserActorKindFromHeader', 'x-agent-actor'],
  },
  {
    feature: 'CDP supervisor device worker (dialogs, frames, console ring)',
    path: 'runtime-installers/runtime/workbench-browser.ts',
    contains: ['Page.javascriptDialogOpening', 'Target.setAutoAttach', 'Runtime.consoleAPICalled', 'redactWorkbenchBrowserText'],
  },
  {
    feature: 'Driver arbitration + private-network guard',
    path: 'lib/messages/workbench/browser-session-store.ts',
    contains: ['isWorkbenchBrowserDrivingControl', 'isPrivateWorkbenchBrowserUrl', "driver: binding.actorKind"],
  },
]

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
}

function normalizeText(value) {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractDesktopSection(html) {
  const text = normalizeText(html)
  const lower = text.toLowerCase()
  const start = lower.indexOf("what's in the app")
  if (start === -1) return text
  const endCandidates = [' see also ']
    .map((needle) => lower.indexOf(needle, start + 1))
    .filter((index) => index > start)
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : text.length
  return text.slice(start, end).trim()
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizedIncludes(haystack, needle) {
  const compactHaystack = haystack.toLowerCase().replace(/\s+/g, ' ')
  const compactNeedle = needle.toLowerCase().replace(/\s+/g, ' ')
  return compactHaystack.includes(compactNeedle)
}

function markerLine(source, needle) {
  const lines = source.split(/\r?\n/)
  const index = lines.findIndex((line) => line.includes(needle))
  return index === -1 ? null : index + 1
}

async function fetchDesktopSection() {
  const response = await fetch(docsUrl, {
    headers: {
      Accept: 'text/html, text/markdown;q=0.9, */*;q=0.5',
      'User-Agent': 'partnersinbiz-hermes-parity-monitor/1.0',
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${docsUrl}: ${response.status}`)
  }
  const html = await response.text()
  return extractDesktopSection(html)
}

function loadBaseline() {
  if (!fs.existsSync(baselinePath)) return null
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
}

function writeReport(lines) {
  if (!reportPath) return
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8')
}

function checkPibMarkers() {
  const failures = []
  const details = []
  for (const marker of pibMarkers) {
    const absolute = path.join(root, marker.path)
    if (!fs.existsSync(absolute)) {
      failures.push(`${marker.feature}: missing file ${marker.path}`)
      continue
    }
    const source = fs.readFileSync(absolute, 'utf8')
    const missing = marker.contains.filter((needle) => !source.includes(needle))
    if (missing.length > 0) {
      failures.push(`${marker.feature}: ${marker.path} missing ${missing.map((m) => JSON.stringify(m)).join(', ')}`)
      continue
    }
    details.push(`- ${marker.feature}: ${marker.path}:${markerLine(source, marker.contains[0]) ?? 1}`)
  }
  return { failures, details }
}

const section = await fetchDesktopSection()
const currentHash = sha256(section)
const missingPhrases = requiredUpstreamPhrases.filter((phrase) => !normalizedIncludes(section, phrase))
const markerResult = checkPibMarkers()

if (updateBaseline) {
  const baseline = {
    version: 1,
    docs: {
      url: docsUrl,
      section: "What's in the app through How it works / remote backend",
      contentHash: currentHash,
      extractedChars: section.length,
      updatedAt: new Date().toISOString(),
    },
    requiredUpstreamPhrases,
    pibMarkerCount: pibMarkers.length,
  }
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
  console.log(`Updated Hermes Desktop parity baseline: ${baselinePath}`)
  console.log(`Current hash: ${currentHash}`)
  process.exit(0)
}

const baseline = loadBaseline()
const failures = []
if (!baseline?.docs?.contentHash) {
  failures.push(`Missing baseline at ${baselinePath}; run npm run check:hermes-desktop-parity -- --update-baseline`)
} else if (baseline.docs.contentHash !== currentHash) {
  failures.push([
    'Hermes Desktop docs changed since the PiB parity baseline.',
    `baseline=${baseline.docs.contentHash}`,
    `current=${currentHash}`,
    'Review docs/specs/hermes-desktop-messages-parity.md and update PiB or the baseline deliberately.',
  ].join(' '))
}

for (const phrase of missingPhrases) failures.push(`Upstream docs no longer include expected phrase: ${phrase}`)
failures.push(...markerResult.failures)

const report = [
  '# Hermes Desktop parity monitor',
  '',
  `Docs URL: ${docsUrl}`,
  `Current docs section hash: ${currentHash}`,
  `Baseline docs section hash: ${baseline?.docs?.contentHash ?? '(missing)'}`,
  `Extracted docs chars: ${section.length}`,
  '',
  '## PiB parity markers',
  ...markerResult.details,
  '',
  failures.length > 0 ? '## Failures' : '## Result',
  ...(failures.length > 0 ? failures.map((failure) => `- ${failure}`) : ['Hermes Desktop parity monitor passed.']),
]
writeReport(report)

if (failures.length > 0) {
  console.error(report.join('\n'))
  process.exit(1)
}

console.log(report.join('\n'))
