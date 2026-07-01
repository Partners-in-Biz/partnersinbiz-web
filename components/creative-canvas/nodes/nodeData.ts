import type { CreativeCanvasNode } from '@/lib/creative-canvas/types'
import type { CanvasNodeType } from '@/components/creative-canvas/nodes/ports'
import type { CanvasNodeStatus } from '@/components/creative-canvas/nodes/nodeFactory'

/**
 * The structured data attached to every React Flow node by `toFlowNode`.
 * Replaces the legacy "JSX-in-data.label" approach. The backend node is kept
 * on `canvasNode` so all existing features keep working.
 */
export interface CanvasNodeData {
  canvasNode?: CreativeCanvasNode
  presentationType: CanvasNodeType
  title: string
  prompt?: string
  model?: string
  creditCost?: number
  batch?: number
  assetUrl?: string
  assetKind?: 'image' | 'video'
  status?: CanvasNodeStatus
  reviewStatus?: string
  text?: string
  references?: string[]
  /** Combine node: desired output type. */
  outputKind?: 'image' | 'video'
  /** Combine node: number of upstream nodes linked in. */
  inputCount?: number
  /** Combine node: preview thumbnails of linked media inputs. */
  inputPreviews?: string[]
  onOutputKindChange?: (kind: 'image' | 'video') => void
  onPromptChange?: (value: string) => void
  onBatchChange?: (next: number) => void
  onTextChange?: (value: string) => void
  onOpenModelPicker?: () => void
  onAddReference?: () => void
  onGenerate?: () => void
  [key: string]: unknown
}
