'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { GeneratorNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

function ImageGeneratorNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <GeneratorNodeCard
      type="image_generator"
      title={d.title}
      prompt={d.prompt}
      model={d.model}
      creditCost={d.creditCost}
      batch={d.batch}
      assetUrl={d.assetUrl}
      assetKind={d.assetKind ?? 'image'}
      status={d.status}
      selected={Boolean(selected)}
      showGenerateBar
      onPromptChange={d.onPromptChange}
      onBatchChange={d.onBatchChange}
      onOpenModelPicker={d.onOpenModelPicker}
      onGenerate={d.onGenerate}
    />
  )
}

export default memo(ImageGeneratorNodeComponent)
