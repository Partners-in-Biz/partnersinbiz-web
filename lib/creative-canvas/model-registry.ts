import type {
  CreativeCanvasProviderKey,
  CreativeCanvasProviderCapability,
} from '@/lib/creative-canvas/types'

export interface CanvasModel {
  id: string
  label: string
  family: string
  featured: boolean
  kind: 'image' | 'video' | 'audio' | 'text'
  providerKey: CreativeCanvasProviderKey
  capabilities: CreativeCanvasProviderCapability[]
  aspectRatios: string[]
  resolutions?: string[]
  durations?: number[]
  supportsAudio?: boolean
  maxBatch: number
  creditCost: number
  execution: 'sync' | 'async'
  description?: string
}

export const CANVAS_MODELS: CanvasModel[] = [
  {
    id: 'grok-image',
    label: 'Grok Image',
    family: 'xAI',
    featured: true,
    kind: 'image',
    providerKey: 'xai',
    capabilities: ['generate_image', 'create_variants'],
    aspectRatios: ['1:1', '9:16', '16:9'],
    resolutions: ['1k', '2k'],
    maxBatch: 4,
    creditCost: 7,
    execution: 'sync',
    description: 'Fast synchronous Grok image generation for inline rendering.',
  },
  {
    id: 'higgsfield-image',
    label: 'Higgsfield Image',
    family: 'Higgsfield',
    featured: true,
    kind: 'image',
    providerKey: 'higgsfield',
    capabilities: ['generate_image', 'edit_image', 'create_variants'],
    aspectRatios: ['1:1', '9:16', '16:9'],
    resolutions: ['1k', '2k', '4k'],
    maxBatch: 4,
    creditCost: 12,
    execution: 'async',
    description: 'High-fidelity Higgsfield image generation with editing and variants.',
  },
  {
    id: 'higgsfield-video',
    label: 'Higgsfield Video',
    family: 'Higgsfield',
    featured: true,
    kind: 'video',
    providerKey: 'higgsfield',
    capabilities: ['generate_video', 'edit_video'],
    aspectRatios: ['1:1', '9:16', '16:9'],
    durations: [4, 8, 15],
    supportsAudio: true,
    maxBatch: 4,
    creditCost: 68,
    execution: 'async',
    description: 'Higgsfield video generation with optional audio track.',
  },
  {
    id: 'agent-voiceover',
    label: 'Voiceover',
    family: 'PiB Agents',
    featured: false,
    kind: 'audio',
    providerKey: 'agent_task',
    capabilities: ['generate_caption', 'generate_copy'],
    aspectRatios: [],
    maxBatch: 1,
    creditCost: 4,
    execution: 'async',
    description: 'Agent-driven voiceover generation.',
  },
  {
    id: 'agent-llm',
    label: 'LLM Assistant',
    family: 'PiB Agents',
    featured: false,
    kind: 'text',
    providerKey: 'agent_task',
    capabilities: ['generate_copy'],
    aspectRatios: [],
    maxBatch: 1,
    creditCost: 2,
    execution: 'async',
    description: 'Agent-driven LLM text assistant.',
  },
]

export function getCanvasModel(id: string): CanvasModel | undefined {
  return CANVAS_MODELS.find((m) => m.id === id)
}

export function modelsForKind(kind: CanvasModel['kind']): CanvasModel[] {
  return CANVAS_MODELS.filter((m) => m.kind === kind)
}

export function featuredModels(): CanvasModel[] {
  return CANVAS_MODELS.filter((m) => m.featured)
}
