import type { NodeTypes } from '@xyflow/react'
import ImageGeneratorNode from '@/components/creative-canvas/nodes/ImageGeneratorNode'
import VideoGeneratorNode from '@/components/creative-canvas/nodes/VideoGeneratorNode'
import VoiceNode from '@/components/creative-canvas/nodes/VoiceNode'
import LLMAssistantNode from '@/components/creative-canvas/nodes/LLMAssistantNode'
import PromptNode from '@/components/creative-canvas/nodes/PromptNode'
import TextNode from '@/components/creative-canvas/nodes/TextNode'
import StickyNoteNode from '@/components/creative-canvas/nodes/StickyNoteNode'
import SourceNode from '@/components/creative-canvas/nodes/SourceNode'
import OutputNode from '@/components/creative-canvas/nodes/OutputNode'
import FolderNode from '@/components/creative-canvas/nodes/FolderNode'

/** Maps each presentation node type to its custom React Flow component. */
export const canvasNodeTypes: NodeTypes = {
  image_generator: ImageGeneratorNode,
  video_generator: VideoGeneratorNode,
  voice_generator: VoiceNode,
  voiceover: VoiceNode,
  change_voice: VoiceNode,
  llm_assistant: LLMAssistantNode,
  prompt: PromptNode,
  translate: PromptNode,
  text: TextNode,
  sticky_note: StickyNoteNode,
  source: SourceNode,
  output: OutputNode,
  folder: FolderNode,
}
