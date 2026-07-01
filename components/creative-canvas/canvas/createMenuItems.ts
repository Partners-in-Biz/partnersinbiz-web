import type { CanvasNodeType } from '@/components/creative-canvas/nodes/ports'

export interface CreateMenuItem {
  type: CanvasNodeType
  label: string
  mode?: string
}

export interface CreateMenuGroup {
  group: string
  items: CreateMenuItem[]
}

export const createMenuGroups: CreateMenuGroup[] = [
  {
    group: '',
    items: [
      { type: 'combine', label: 'Combine' },
      { type: 'prompt', label: 'Prompt' },
      { type: 'image_generator', label: 'Image Generator' },
      { type: 'video_generator', label: 'Video Generator' },
      { type: 'voice_generator', label: 'Voice Generator' },
      { type: 'llm_assistant', label: 'LLM Assistant' },
      { type: 'folder', label: 'Folders' },
    ],
  },
  {
    group: 'References',
    items: [
      { type: 'source', label: 'Upload', mode: 'upload' },
      { type: 'source', label: 'Assets', mode: 'assets' },
    ],
  },
  {
    group: 'Audio',
    items: [
      { type: 'voiceover', label: 'Voiceover' },
      { type: 'change_voice', label: 'Change Voice' },
      { type: 'translate', label: 'Translate' },
    ],
  },
  {
    group: 'Utilities',
    items: [
      { type: 'text', label: 'Text' },
      { type: 'sticky_note', label: 'Sticky Note' },
    ],
  },
]
