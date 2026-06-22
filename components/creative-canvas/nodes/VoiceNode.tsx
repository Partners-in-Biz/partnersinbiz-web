'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { GeneratorNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

/** Used for voice_generator, voiceover and change_voice nodes (audio output). */
function VoiceNodeComponent({ data, selected }: NodeProps) {
  const d = data as CanvasNodeData
  return (
    <GeneratorNodeCard
      type={d.presentationType === 'change_voice' ? 'change_voice' : d.presentationType === 'voiceover' ? 'voiceover' : 'voice_generator'}
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

export default memo(VoiceNodeComponent)
