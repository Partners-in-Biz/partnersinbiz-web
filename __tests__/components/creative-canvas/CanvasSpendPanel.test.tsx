/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import CanvasSpendPanel from '@/components/creative-canvas/panels/CanvasSpendPanel'
import type { CreativeCanvasNode, CreativeCanvasRun } from '@/lib/creative-canvas/types'

const nodes = [
  { id: 'gen-1', orgId: 'o', type: 'model', title: 'Hero image', position: { x: 0, y: 0 }, data: {} },
  { id: 'gen-2', orgId: 'o', type: 'model', title: 'Promo video', position: { x: 0, y: 0 }, data: {} },
] as unknown as CreativeCanvasNode[]

// Soul 2.0 = 0.1 credits, Seedance 2.0 = 22 credits (from the model registry).
const runs = [
  { id: 'r1', orgId: 'o', canvasId: 'c', nodeId: 'gen-1', providerKey: 'higgsfield', model: 'text2image_soul_v2', status: 'completed', input: { sourceNodeIds: [], sourceArtifactIds: [], variantCount: 3 }, provenance: { generatedBy: 'user' } },
  { id: 'r2', orgId: 'o', canvasId: 'c', nodeId: 'gen-2', providerKey: 'higgsfield', model: 'seedance_2_0', status: 'completed', input: { sourceNodeIds: [], sourceArtifactIds: [], variantCount: 1 }, provenance: { generatedBy: 'user' } },
] as unknown as Array<CreativeCanvasRun & { id: string }>

describe('CanvasSpendPanel', () => {
  it('sums per-node and per-model spend from model unit costs × variants', () => {
    render(<CanvasSpendPanel runs={runs} nodes={nodes} used={50} limit={100} />)
    // gen-1: 0.1 × 3 = 0.3 ; gen-2: 22 × 1 = 22 ; total est = 22.3
    expect(screen.getByText('Hero image')).toBeInTheDocument()
    expect(screen.getByText('Promo video')).toBeInTheDocument()
    // 0.3 and 22 each appear twice (once in the by-node section, once by-model).
    expect(screen.getAllByText('✦ 0.3').length).toBe(2)
    expect(screen.getAllByText('✦ 22').length).toBe(2)
    // Org-wide used / limit surfaced.
    expect(screen.getByText('✦ 50 / 100')).toBeInTheDocument()
    // Canvas estimate total.
    expect(screen.getByText('✦ 22.3')).toBeInTheDocument()
    // Model labels resolved to human names.
    expect(screen.getByText('Soul 2.0')).toBeInTheDocument()
    expect(screen.getByText('Seedance 2.0')).toBeInTheDocument()
  })

  it('handles an empty run list', () => {
    render(<CanvasSpendPanel runs={[]} nodes={nodes} used={0} limit={null} />)
    expect(screen.getAllByText('No runs yet.').length).toBeGreaterThan(0)
  })
})
