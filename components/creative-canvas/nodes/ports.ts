import type { CanvasPortKind } from '@/components/creative-canvas/theme/tokens'

export type CanvasNodeType =
  | 'prompt' | 'image_generator' | 'video_generator' | 'voice_generator'
  | 'llm_assistant' | 'voiceover' | 'change_voice' | 'translate'
  | 'source' | 'output' | 'sticky_note' | 'text' | 'folder' | 'combine'
  | 'character' | 'chapter'
  | 'screen'

export interface Port { id: string; kind: CanvasPortKind }
export interface NodePorts { inputs: Port[]; output: Port }

const MAP: Record<CanvasNodeType, NodePorts> = {
  prompt:           { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'text' } },
  image_generator:  { inputs: [{ id: 'in_img', kind: 'image' }, { id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'image' } },
  video_generator:  { inputs: [{ id: 'in_img', kind: 'image' }, { id: 'in_vid', kind: 'video' }, { id: 'in_aud', kind: 'audio' }, { id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'video' } },
  voice_generator:  { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'audio' } },
  llm_assistant:    { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'text' } },
  voiceover:        { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'audio' } },
  change_voice:     { inputs: [{ id: 'in_aud', kind: 'audio' }], output: { id: 'out', kind: 'audio' } },
  translate:        { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'text' } },
  // Combine accepts every media kind so any node can feed it; the instruction
  // on the node describes how the inputs come together.
  combine:          { inputs: [{ id: 'in_img', kind: 'image' }, { id: 'in_vid', kind: 'video' }, { id: 'in_aud', kind: 'audio' }, { id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'output' } },
  source:           { inputs: [], output: { id: 'out', kind: 'image' } },
  output:           { inputs: [{ id: 'in', kind: 'image' }], output: { id: 'out', kind: 'image' } },
  sticky_note:      { inputs: [], output: { id: 'out', kind: 'text' } },
  text:             { inputs: [], output: { id: 'out', kind: 'text' } },
  folder:           { inputs: [], output: { id: 'out', kind: 'text' } },
  character:        { inputs: [], output: { id: 'out', kind: 'text' } },
  chapter:          { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'text' } },
  // Screen/page planning card: sitemap structure is plain edges between screens.
  screen:           { inputs: [{ id: 'in_text', kind: 'text' }], output: { id: 'out', kind: 'text' } },
}

export function portsForNode(type: CanvasNodeType): NodePorts { return MAP[type] }
// 'output' is the wildcard kind produced by combine/output nodes: their result
// can be image or video depending on the run, so they may feed any input.
export function isValidConnection(from: CanvasPortKind, to: CanvasPortKind): boolean {
  return from === to || from === 'output'
}
