'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { GeneratorNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

function LLMAssistantNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <GeneratorNodeCard
      type="llm_assistant"
      title={d.title}
      prompt={d.prompt}
      model={d.model}
      creditCost={d.creditCost}
      batch={d.batch}
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

export default memo(LLMAssistantNodeComponent)
