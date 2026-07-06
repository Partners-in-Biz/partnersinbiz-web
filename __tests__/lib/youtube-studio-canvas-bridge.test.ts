import { buildCanvasGraphFromVideoProject } from '@/lib/youtube-studio/canvas-bridge'
import { getCanvasModel } from '@/lib/creative-canvas/model-registry'
import { resolveGeneratorKind } from '@/lib/creative-canvas/node-kind'
import type { YouTubeProductionDraft, YouTubeProductionDraftScene, YouTubeVideoProject } from '@/lib/youtube-studio/types'

const ORG_ID = 'org-test-123'
const PROJECT_ID = 'vp-abc'

function makeProject(overrides: Partial<YouTubeVideoProject> = {}): YouTubeVideoProject & { id: string } {
  return {
    id: PROJECT_ID,
    orgId: ORG_ID,
    channelWorkspaceId: 'cw-1',
    title: 'How to grow on YouTube',
    videoType: 'long_form',
    status: 'production',
    objective: 'Teach small businesses the fundamentals of channel growth.',
    source: { intakeType: 'manual' },
    linked: {},
    approvalPolicy: {
      requireInternalBriefApproval: false,
      requireClientBriefApproval: false,
      requireClientScriptApproval: false,
      requireClientDraftApproval: false,
      requireClientThumbnailApproval: false,
      requireClientPublishConfirmation: false,
      requireInternalPublishApproval: false,
    },
    deleted: false,
    ...overrides,
  }
}

function makeScene(n: number, overrides: Partial<YouTubeProductionDraftScene> = {}): YouTubeProductionDraftScene {
  return {
    label: `Scene ${n}`,
    summary: `Beat ${n} summary`,
    voiceover: `Voiceover line for scene ${n}`,
    visualNotes: `Wide shot, brand colours, scene ${n}`,
    ...overrides,
  }
}

function makeDraft(sceneCount: number, overrides: Partial<YouTubeProductionDraft> = {}): YouTubeProductionDraft & { id: string } {
  return {
    id: 'draft-1',
    orgId: ORG_ID,
    channelWorkspaceId: 'cw-1',
    videoProjectId: PROJECT_ID,
    title: 'Script v1',
    draftType: 'script',
    status: 'draft',
    versionNumber: 1,
    summary: 'A three-part explainer on channel growth.',
    hook: 'Most channels die in the first 90 days — here is why.',
    outline: ['Intro hook', 'Three growth levers', 'Call to action'],
    sourceAssetIds: [],
    clipCandidateIds: [],
    scenes: Array.from({ length: sceneCount }, (_, i) => makeScene(i + 1)),
    checks: {
      claims: { status: 'not_applicable', message: '' },
      brand: { status: 'not_applicable', message: '' },
      sourceEvidence: { status: 'not_applicable', message: '' },
      clientApproval: { status: 'not_applicable', message: '' },
    },
    deleted: false,
    ...overrides,
  }
}

describe('buildCanvasGraphFromVideoProject', () => {
  test('3-scene draft yields 1 brief + 3×(prompt+audio+video) + 1 assembly = 11 nodes', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    expect(graph.nodes).toHaveLength(11)

    const briefNodes = graph.nodes.filter((n) => n.type === 'brief')
    expect(briefNodes).toHaveLength(1)

    const promptNodes = graph.nodes.filter((n) => n.type === 'prompt')
    expect(promptNodes).toHaveLength(3)

    const generatorNodes = graph.nodes.filter((n) => n.type === 'model')
    // 3 audio + 3 video + 1 assembly
    expect(generatorNodes).toHaveLength(7)
  })

  test('is deterministic — two calls deep-equal', () => {
    const a = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    const b = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    expect(a).toEqual(b)
  })

  test('node ids are namespaced yt-<projectId>- and stable', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    for (const node of graph.nodes) {
      expect(node.id.startsWith(`yt-${PROJECT_ID}-`)).toBe(true)
    }
    expect(graph.nodes.map((n) => n.id)).toContain(`yt-${PROJECT_ID}-brief`)
    expect(graph.nodes.map((n) => n.id)).toContain(`yt-${PROJECT_ID}-assembly`)
    expect(graph.nodes.map((n) => n.id)).toContain(`yt-${PROJECT_ID}-scene-1-prompt`)
    expect(graph.nodes.map((n) => n.id)).toContain(`yt-${PROJECT_ID}-scene-1-audio`)
    expect(graph.nodes.map((n) => n.id)).toContain(`yt-${PROJECT_ID}-scene-1-video`)
  })

  test('per scene: prompt→audio and prompt→video edges exist', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    for (let i = 1; i <= 3; i++) {
      const prompt = `yt-${PROJECT_ID}-scene-${i}-prompt`
      const audio = `yt-${PROJECT_ID}-scene-${i}-audio`
      const video = `yt-${PROJECT_ID}-scene-${i}-video`
      expect(graph.edges.some((e) => e.sourceNodeId === prompt && e.targetNodeId === audio)).toBe(true)
      expect(graph.edges.some((e) => e.sourceNodeId === prompt && e.targetNodeId === video)).toBe(true)
    }
  })

  test('every scene video and audio generator feeds the assembly node', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    const assembly = `yt-${PROJECT_ID}-assembly`
    for (let i = 1; i <= 3; i++) {
      const audio = `yt-${PROJECT_ID}-scene-${i}-audio`
      const video = `yt-${PROJECT_ID}-scene-${i}-video`
      expect(graph.edges.some((e) => e.sourceNodeId === audio && e.targetNodeId === assembly)).toBe(true)
      expect(graph.edges.some((e) => e.sourceNodeId === video && e.targetNodeId === assembly)).toBe(true)
    }
  })

  test('assembly node is a youtube_render with a registry-valid video model, referencing every scene output', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    const assembly = graph.nodes.find((n) => n.id === `yt-${PROJECT_ID}-assembly`)!
    expect(assembly.edit?.outputKind).toBe('youtube_render')
    expect(assembly.provider?.key).toBe('higgsfield')
    const model = getCanvasModel(assembly.provider!.model!)
    expect(model?.kind).toBe('video')
    // references all 3 scene video + 3 scene audio outputs
    const refIds = (assembly.edit?.references ?? []).map((r) => r.sourceNodeId)
    for (let i = 1; i <= 3; i++) {
      expect(refIds).toContain(`yt-${PROJECT_ID}-scene-${i}-video`)
      expect(refIds).toContain(`yt-${PROJECT_ID}-scene-${i}-audio`)
    }
    expect(resolveGeneratorKind(assembly)).toBe('video')
  })

  test('audio generator nodes resolve kind audio and carry outputKind audio', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    for (let i = 1; i <= 3; i++) {
      const audio = graph.nodes.find((n) => n.id === `yt-${PROJECT_ID}-scene-${i}-audio`)!
      expect(resolveGeneratorKind(audio)).toBe('audio')
      expect(audio.data.outputKind).toBe('audio')
    }
  })

  test('video generator nodes resolve kind video and carry outputKind video', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    for (let i = 1; i <= 3; i++) {
      const video = graph.nodes.find((n) => n.id === `yt-${PROJECT_ID}-scene-${i}-video`)!
      expect(resolveGeneratorKind(video)).toBe('video')
      expect(video.data.outputKind).toBe('video')
    }
  })

  test('scene prompt nodes carry the scene voiceover / narration text', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    const prompt = graph.nodes.find((n) => n.id === `yt-${PROJECT_ID}-scene-1-prompt`)!
    expect(prompt.type).toBe('prompt')
    expect(String(prompt.data.prompt)).toContain('Voiceover line for scene 1')
  })

  test('audio prompt derives from scene voiceover; video prompt from visual notes', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    const audio = graph.nodes.find((n) => n.id === `yt-${PROJECT_ID}-scene-1-audio`)!
    const video = graph.nodes.find((n) => n.id === `yt-${PROJECT_ID}-scene-1-video`)!
    expect(String(audio.edit?.prompt ?? audio.data.prompt)).toContain('Voiceover line for scene 1')
    expect(String(video.edit?.prompt ?? video.data.prompt)).toContain('Wide shot, brand colours, scene 1')
  })

  test('scene cap: 15 scenes collapse to 12', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(15) })
    const promptNodes = graph.nodes.filter((n) => n.type === 'prompt')
    expect(promptNodes).toHaveLength(12)
    // 1 brief + 12×3 + 1 assembly
    expect(graph.nodes).toHaveLength(1 + 12 * 3 + 1)
  })

  test('brief node carries draft brief/outline text when a draft is present', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    const brief = graph.nodes.find((n) => n.type === 'brief')!
    const text = String(brief.data.prompt ?? brief.data.brief ?? '')
    expect(text).toContain('A three-part explainer on channel growth.')
  })

  test('no-draft fallback: brief + single youtube_render generator wired brief→generator', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: null })
    expect(graph.nodes).toHaveLength(2)
    const brief = graph.nodes.find((n) => n.type === 'brief')!
    const gen = graph.nodes.find((n) => n.type === 'model')!
    expect(gen.edit?.outputKind).toBe('youtube_render')
    expect(getCanvasModel(gen.provider!.model!)?.kind).toBe('video')
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].sourceNodeId).toBe(brief.id)
    expect(graph.edges[0].targetNodeId).toBe(gen.id)
    // brief falls back to project title + objective
    const text = String(brief.data.prompt ?? brief.data.brief ?? '')
    expect(text).toContain('How to grow on YouTube')
  })

  test('empty-scenes draft also falls back to the minimal graph', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(0) })
    expect(graph.nodes).toHaveLength(2)
  })

  test('orgId is stamped on every node and edge', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    for (const node of graph.nodes) expect(node.orgId).toBe(ORG_ID)
    for (const edge of graph.edges) expect(edge.orgId).toBe(ORG_ID)
    expect(graph.edges.length).toBeGreaterThan(0)
  })

  test('edge ids are unique and namespaced', () => {
    const graph = buildCanvasGraphFromVideoProject({ project: makeProject(), latestDraft: makeDraft(3) })
    const ids = graph.edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith(`yt-${PROJECT_ID}-`)).toBe(true)
  })
})
