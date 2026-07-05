import type {
  CreativeCanvasEdge,
  CreativeCanvasGraph,
  CreativeCanvasNode,
} from '@/lib/creative-canvas/types'
import type { YouTubeProductionDraft, YouTubeVideoProject } from '@/lib/youtube-studio/types'

// ---------------------------------------------------------------------------
// YouTube Studio → Creative Canvas graph builder (Task 5).
//
// Seeds a canvas from a video project + its latest production draft, so the
// canvas can act as the production engine for the video. The output follows the
// exact node/edge conventions used by lib/creative-canvas/starter-templates.ts:
//
//   * generator nodes are `type: 'model'` with `provider: { key, model, mode }`
//   * the media kind is driven by the model id (resolveGeneratorKind is
//     model-authoritative) with a redundant `data.outputKind` hint
//   * combine/assembly is a `model` node whose `edit.outputKind` is the render
//     kind and whose `edit.references[]` point at every upstream node it consumes
//
// Pure & deterministic: no Firestore, no env, node ids `yt-<projectId>-…` so
// re-seeding is idempotent (Task 6 open-in-canvas relies on this).
// ---------------------------------------------------------------------------

/**
 * Default scene-audio model — Sonilo music beds (Higgsfield-native unlimited
 * tier). NOTE: the platform has no TTS model yet (sonilo = music, mirelo =
 * SFX), so seeded audio nodes are MUSIC BEDS, not spoken voiceover. The scene
 * narration text stays on the prompt node so a future TTS provider (e.g.
 * ElevenLabs BYOK) can consume it without re-seeding.
 */
const AUDIO_MODEL = 'sonilo_music'
/**
 * Default video model — Seedance 2.0. Matches the `youtube_render` node in the
 * "YouTube short pipeline" starter template (`starter-templates.ts`), which
 * uses `provider: { key: 'higgsfield', model: 'seedance_2_0', mode: 'video_render' }`.
 */
const VIDEO_MODEL = 'seedance_2_0'
const PROVIDER_KEY = 'higgsfield' as const
const OWNER_AGENT_ID = 'maya'

/** Hard cap on seeded scenes so pathological drafts can't explode the graph. */
const MAX_SCENES = 12

const COL = 320
const ROW = 220
const COL_BRIEF = 0
const COL_PROMPT = COL
const COL_GENERATOR = COL * 2
const COL_ASSEMBLY = COL * 3

export interface CanvasSeedInput {
  project: YouTubeVideoProject & { id: string }
  latestDraft?: (YouTubeProductionDraft & { id: string }) | null
}

function briefText(input: CanvasSeedInput): string {
  const { project, latestDraft } = input
  if (latestDraft) {
    const parts: string[] = []
    if (latestDraft.hook) parts.push(`Hook: ${latestDraft.hook}`)
    if (latestDraft.summary) parts.push(latestDraft.summary)
    if (latestDraft.outline?.length) parts.push('Outline:', ...latestDraft.outline.map((line) => `- ${line}`))
    if (latestDraft.scriptText) parts.push(latestDraft.scriptText)
    const joined = parts.filter(Boolean).join('\n').trim()
    if (joined) return joined
  }
  // No draft (or an empty one) → fall back to the project's own framing.
  return [project.title, project.objective].filter(Boolean).join('\n').trim()
}

function scenePromptText(scene: { label?: string; voiceover?: string; summary?: string; visualNotes?: string }): string {
  return (
    scene.voiceover?.trim()
    || scene.summary?.trim()
    || scene.visualNotes?.trim()
    || scene.label?.trim()
    || 'Scene beat.'
  )
}

export function buildCanvasGraphFromVideoProject(input: CanvasSeedInput): CreativeCanvasGraph {
  const { project, latestDraft } = input
  const orgId = project.orgId
  const projectId = project.id
  const idPrefix = `yt-${projectId}`

  const nodes: CreativeCanvasNode[] = []
  const edges: CreativeCanvasEdge[] = []

  const briefId = `${idPrefix}-brief`
  nodes.push({
    id: briefId,
    orgId,
    type: 'brief',
    title: 'Video brief',
    position: { x: COL_BRIEF, y: 0 },
    data: {
      workflowRole: 'prompt',
      agentId: OWNER_AGENT_ID,
      promptType: 'video_storyboard',
      prompt: briefText(input),
    },
  })

  const scenes = (latestDraft?.scenes ?? []).slice(0, MAX_SCENES)

  // No usable scenes → minimal graph: brief → single youtube_render generator.
  if (scenes.length === 0) {
    const genId = `${idPrefix}-render`
    nodes.push({
      id: genId,
      orgId,
      type: 'model',
      title: 'Full video render',
      position: { x: COL_PROMPT, y: 0 },
      data: { workflowRole: 'generation', ownerAgentId: OWNER_AGENT_ID, outputKind: 'youtube_render' },
      provider: { key: PROVIDER_KEY, model: VIDEO_MODEL, mode: 'video_render' },
      edit: {
        operation: 'video_motion',
        outputKind: 'youtube_render',
        strength: 0.7,
        motion: { mode: 'camera_push', durationSeconds: 15 },
        references: [{ sourceNodeId: briefId, role: 'general', weight: 1 }],
      },
    })
    edges.push({ id: `${idPrefix}-edge-brief-render`, orgId, sourceNodeId: briefId, targetNodeId: genId, label: 'render' })
    return { nodes, edges }
  }

  const assemblyId = `${idPrefix}-assembly`
  const assemblyReferences: NonNullable<CreativeCanvasNode['edit']>['references'] = []

  scenes.forEach((scene, index) => {
    const n = index + 1
    const y = index * ROW
    const promptId = `${idPrefix}-scene-${n}-prompt`
    const audioId = `${idPrefix}-scene-${n}-audio`
    const videoId = `${idPrefix}-scene-${n}-video`

    const beat = scenePromptText(scene)
    const voiceover = scene.voiceover?.trim() || beat
    const visual = scene.visualNotes?.trim() || scene.summary?.trim() || beat

    nodes.push({
      id: promptId,
      orgId,
      type: 'prompt',
      title: scene.label || `Scene ${n}`,
      position: { x: COL_PROMPT, y },
      data: {
        workflowRole: 'prompt',
        agentId: OWNER_AGENT_ID,
        promptType: 'video_storyboard',
        prompt: beat,
        sceneIndex: n,
      },
    })

    nodes.push({
      id: audioId,
      orgId,
      type: 'model',
      title: `Scene ${n} music bed`,
      position: { x: COL_GENERATOR, y: y - 60 },
      data: { workflowRole: 'generation', ownerAgentId: OWNER_AGENT_ID, outputKind: 'audio', sceneIndex: n, narrationText: voiceover },
      provider: { key: PROVIDER_KEY, model: AUDIO_MODEL, mode: 'scene_audio' },
      edit: {
        operation: 'variation',
        outputKind: 'audio',
        prompt: `Instrumental music bed matching this scene's mood: ${voiceover}`,
        references: [{ sourceNodeId: promptId, role: 'general', weight: 1 }],
      },
    })

    nodes.push({
      id: videoId,
      orgId,
      type: 'model',
      title: `Scene ${n} visual`,
      position: { x: COL_GENERATOR, y: y + 60 },
      data: { workflowRole: 'generation', ownerAgentId: OWNER_AGENT_ID, outputKind: 'video', sceneIndex: n },
      provider: { key: PROVIDER_KEY, model: VIDEO_MODEL, mode: 'video_render' },
      edit: {
        operation: 'video_motion',
        outputKind: 'video',
        strength: 0.7,
        prompt: visual,
        motion: { mode: 'camera_push', durationSeconds: 8 },
        references: [{ sourceNodeId: promptId, role: 'general', weight: 1 }],
      },
    })

    edges.push({ id: `${idPrefix}-edge-scene-${n}-prompt-audio`, orgId, sourceNodeId: promptId, targetNodeId: audioId, label: 'voice' })
    edges.push({ id: `${idPrefix}-edge-scene-${n}-prompt-video`, orgId, sourceNodeId: promptId, targetNodeId: videoId, label: 'visual' })
    edges.push({ id: `${idPrefix}-edge-scene-${n}-video-assembly`, orgId, sourceNodeId: videoId, targetNodeId: assemblyId, label: 'clip' })
    edges.push({ id: `${idPrefix}-edge-scene-${n}-audio-assembly`, orgId, sourceNodeId: audioId, targetNodeId: assemblyId, label: 'track' })

    assemblyReferences.push({ sourceNodeId: videoId, role: 'general', weight: 1 })
    assemblyReferences.push({ sourceNodeId: audioId, role: 'general', weight: 1 })
  })

  // Assembly / combine node — consumes every scene video + audio output and
  // renders the final YouTube cut. Mirrors the starter "YouTube short pipeline"
  // youtube_render shape: `type: 'model'`, higgsfield video model,
  // `edit.operation: 'video_motion'`, `edit.outputKind: 'youtube_render'`, with
  // upstream nodes carried in `edit.references`.
  nodes.push({
    id: assemblyId,
    orgId,
    type: 'model',
    title: 'Final YouTube render',
    position: { x: COL_ASSEMBLY, y: Math.max(0, ((scenes.length - 1) * ROW) / 2) },
    data: { workflowRole: 'generation', ownerAgentId: OWNER_AGENT_ID, outputKind: 'youtube_render' },
    provider: { key: PROVIDER_KEY, model: VIDEO_MODEL, mode: 'video_render' },
    edit: {
      operation: 'video_motion',
      outputKind: 'youtube_render',
      strength: 0.7,
      motion: { mode: 'camera_push', durationSeconds: 15 },
      references: assemblyReferences,
    },
  })

  return { nodes, edges }
}
