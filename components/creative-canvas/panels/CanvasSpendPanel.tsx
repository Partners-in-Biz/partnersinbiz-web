'use client'

import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import { getCanvasModel } from '@/lib/creative-canvas/model-registry'
import type { CreativeCanvasNode, CreativeCanvasRun } from '@/lib/creative-canvas/types'

export interface CanvasSpendPanelProps {
  runs: Array<CreativeCanvasRun & { id: string }>
  nodes: CreativeCanvasNode[]
  used?: number
  limit?: number | null
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Estimated credit cost of a run: model unit cost × variant count. Runs don't
 *  store a resolved cost, so we derive it from the model registry  -  matches the
 *  Generate-button estimate the user saw at dispatch. */
function runCost(run: CreativeCanvasRun): number {
  const model = getCanvasModel(run.model ?? '')
  if (typeof model?.creditCost !== 'number') return 0
  return model.creditCost * Math.max(1, run.input.variantCount ?? 1)
}

/** Per-node / per-model spend breakdown so it's obvious which node ate credits. */
export default function CanvasSpendPanel({ runs, nodes, used, limit }: CanvasSpendPanelProps) {
  const titleByNode = new Map(nodes.map((node) => [node.id, node.title]))

  const byNode = new Map<string, { label: string; cost: number; runs: number }>()
  const byModel = new Map<string, { label: string; cost: number; runs: number }>()
  let estimatedTotal = 0

  for (const run of runs) {
    const cost = runCost(run)
    estimatedTotal += cost
    const nodeKey = run.nodeId || 'unknown'
    const nodeLabel = titleByNode.get(run.nodeId) ?? run.nodeId ?? 'Unknown node'
    const nodeEntry = byNode.get(nodeKey) ?? { label: nodeLabel, cost: 0, runs: 0 }
    nodeEntry.cost += cost
    nodeEntry.runs += 1
    byNode.set(nodeKey, nodeEntry)

    const modelKey = run.model ?? 'unknown'
    const modelLabel = getCanvasModel(run.model ?? '')?.label ?? run.model ?? 'Unknown model'
    const modelEntry = byModel.get(modelKey) ?? { label: modelLabel, cost: 0, runs: 0 }
    modelEntry.cost += cost
    modelEntry.runs += 1
    byModel.set(modelKey, modelEntry)
  }

  const nodeRows = [...byNode.values()].sort((a, b) => b.cost - a.cost)
  const modelRows = [...byModel.values()].sort((a, b) => b.cost - a.cost)

  const section = (heading: string, rows: Array<{ label: string; cost: number; runs: number }>) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: canvasTheme.textMuted }}>{heading}</p>
      {rows.length ? rows.map((row) => (
        <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottom: `1px solid ${canvasTheme.border}`, padding: '6px 0' }}>
          <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'baseline', flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: canvasTheme.textMuted }}>{row.runs} run{row.runs === 1 ? '' : 's'}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: canvasTheme.accent }}>✦ {round2(row.cost)}</span>
          </span>
        </div>
      )) : (
        <p style={{ fontSize: 12, color: canvasTheme.textMuted }}>No runs yet.</p>
      )}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 120, border: `1px solid ${canvasTheme.border}`, borderRadius: 10, padding: '10px 12px' }}>
          <p style={{ fontSize: 11, color: canvasTheme.textMuted, fontWeight: 600 }}>Credits used</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: canvasTheme.accent }}>✦ {round2(used ?? estimatedTotal)}{typeof limit === 'number' ? ` / ${round2(limit)}` : ''}</p>
        </div>
        <div style={{ flex: 1, minWidth: 120, border: `1px solid ${canvasTheme.border}`, borderRadius: 10, padding: '10px 12px' }}>
          <p style={{ fontSize: 11, color: canvasTheme.textMuted, fontWeight: 600 }}>This canvas (est.)</p>
          <p style={{ fontSize: 20, fontWeight: 700 }}>✦ {round2(estimatedTotal)}</p>
        </div>
      </div>
      {section('By node', nodeRows)}
      {section('By model', modelRows)}
      <p style={{ fontSize: 11, color: canvasTheme.textMuted }}>
        Per-node/model figures are estimated from model unit costs × variants for this canvas&apos;s runs. &quot;Credits used&quot; is the org-wide metered balance.
      </p>
    </div>
  )
}
