import { getCanvasModel } from '@/lib/creative-canvas/model-registry'
import type { CreativeCanvasNode } from '@/lib/creative-canvas/types'

export type GeneratorKind = 'image' | 'video' | 'audio'

/**
 * Authoritative image/video/audio classification for a generator node.
 *
 * The selected model is the strongest signal — pick a video model and the node
 * produces a video. Templates and real graphs use descriptive provider modes
 * (e.g. `vertical_social`) and edit operations rather than the literal string
 * `video`, so mode/outputKind alone is not enough. Both the settings-panel
 * presentation type and the run's requested kind route through this so they can
 * never disagree (a mismatch silently downgraded video runs to image models).
 *
 * @param modelId optional explicit model id (the user's current picker choice),
 *   which overrides the node's stored provider model.
 */
export function resolveGeneratorKind(node: CreativeCanvasNode, modelId?: string): GeneratorKind {
  // A resolved media model is authoritative — the user's explicit choice wins
  // over stale node metadata (a video-moded node switched to an image model
  // produces an image). Only infer from metadata when no media model resolves
  // (empty selection, or a text model like agent-llm).
  const model = getCanvasModel(modelId || node.provider?.model || '')
  if (model?.kind === 'video') return 'video'
  if (model?.kind === 'audio') return 'audio'
  if (model?.kind === 'image') return 'image'

  const data = (node.data ?? {}) as Record<string, unknown>
  const presentationHint = String(data.presentationType ?? '')

  if (
    data.outputKind === 'audio'
    || node.provider?.mode === 'audio'
    || ['voice_generator', 'voiceover', 'change_voice'].includes(presentationHint)
  ) {
    return 'audio'
  }

  if (
    data.outputKind === 'video'
    || node.provider?.mode === 'video'
    || node.edit?.operation === 'video_motion'
    || presentationHint === 'video_generator'
  ) {
    return 'video'
  }

  return 'image'
}
