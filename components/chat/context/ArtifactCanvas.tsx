'use client'

import type { RichMessagePart } from '@/lib/hermes/types'
import { validatePart } from '@/lib/chat/parts'
import { ChartPart } from '@/components/chat/parts/ChartPart'
import { MermaidPart } from '@/components/chat/parts/MermaidPart'
import { MathPart } from '@/components/chat/parts/MathPart'
import { HtmlArtifactPart } from '@/components/chat/parts/HtmlArtifactPart'
import { FilePart } from '@/components/chat/parts/FilePart'
import { BrowserFramePart } from '@/components/chat/parts/BrowserFramePart'
import {
  toBrowserFramePart,
  toChartPart,
  toFilePartV2,
  toHtmlArtifactPart,
  toMathPart,
  toMermaidPart,
} from '@/components/chat/parts/from-rich-part'
import { PartStatusBox } from '@/components/chat/parts/status-box'

export function ArtifactCanvas({
  part,
  onTakeOver,
}: {
  part: RichMessagePart
  onTakeOver?: (sessionId?: string) => void
}) {
  const type = String(part.type || '').toLowerCase()
  const checked = validatePart(part)
  if (!checked.ok) {
    return <PartStatusBox>Unsupported content</PartStatusBox>
  }
  const valid = checked.part

  return (
    <section data-testid="artifact-canvas" aria-label="Artifact canvas" className="min-h-[16rem]">
      {type === 'chart' ? renderChart(valid) : null}
      {type === 'mermaid' ? <MermaidPart part={toMermaidPart(valid)} /> : null}
      {type === 'math' ? <MathPart part={toMathPart(valid)} /> : null}
      {type === 'html_artifact' ? renderHtml(valid) : null}
      {type === 'file' ? <FilePart part={toFilePartV2(valid)} /> : null}
      {type === 'browser_frame' ? renderBrowser(valid, onTakeOver) : null}
      {!['chart', 'mermaid', 'math', 'html_artifact', 'file', 'browser_frame'].includes(type)
        ? <PartStatusBox>Unsupported content</PartStatusBox>
        : null}
    </section>
  )
}

function renderChart(part: RichMessagePart) {
  const chart = toChartPart(part)
  if (!chart) return <PartStatusBox>Unsupported content</PartStatusBox>
  return <ChartPart part={chart} />
}

function renderHtml(part: RichMessagePart) {
  const html = toHtmlArtifactPart(part)
  if (!html) return <PartStatusBox>Unsupported content</PartStatusBox>
  return <HtmlArtifactPart part={{ ...html, height: Math.max(html.height ?? 720, 720) }} />
}

function renderBrowser(part: RichMessagePart, onTakeOver?: (sessionId?: string) => void) {
  const frame = toBrowserFramePart(part)
  return (
    <BrowserFramePart
      part={frame}
      onTakeOver={onTakeOver ? () => onTakeOver(frame.sessionId) : undefined}
    />
  )
}
