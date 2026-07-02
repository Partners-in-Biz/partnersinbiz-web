'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { GeneratorNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'
import { nodeActionsFor } from '@/components/creative-canvas/nodes/NodeActionBar'

function VideoGeneratorNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <GeneratorNodeCard
      actions={nodeActionsFor(d)}
      type="video_generator"
      title={d.title}
      prompt={d.prompt}
      model={d.model}
      creditCost={d.creditCost}
      batch={d.batch}
      assetUrl={d.assetUrl}
      assetKind={d.assetKind ?? 'video'}
      status={d.status}
      selected={Boolean(selected)}
      references={d.references}
      showGenerateBar
      onPromptChange={d.onPromptChange}
      onBatchChange={d.onBatchChange}
      onOpenModelPicker={d.onOpenModelPicker}
      onAddReference={d.onAddReference}
      onGenerate={d.onGenerate}
    />
  )
}

export default memo(VideoGeneratorNodeComponent)
