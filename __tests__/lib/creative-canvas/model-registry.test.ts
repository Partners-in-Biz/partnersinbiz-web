import { CANVAS_MODELS, getCanvasModel, modelsForKind, featuredModels } from '@/lib/creative-canvas/model-registry'

test('every model has a stable id, provider key and credit cost', () => {
  for (const m of CANVAS_MODELS) {
    expect(typeof m.id).toBe('string')
    expect(['higgsfield', 'xai', 'agent_task', 'manual_upload']).toContain(m.providerKey)
    expect(m.creditCost).toBeGreaterThanOrEqual(0)
  }
})
test('every model routes through Higgsfield (or an agent), default GPT Image 2', () => {
  // The whole catalog is Higgsfield-backed (agent_task for LLM/voice helpers).
  for (const m of CANVAS_MODELS) {
    expect(['higgsfield', 'agent_task']).toContain(m.providerKey)
  }
  const def = getCanvasModel('gpt_image_2')
  expect(def).toBeTruthy()
  expect(def!.kind).toBe('image')
  expect(def!.providerKey).toBe('higgsfield')
  expect(modelsForKind('image').some((m) => m.id === 'gpt_image_2')).toBe(true)
})
test('featuredModels is a non-empty subset', () => {
  expect(featuredModels().length).toBeGreaterThan(0)
  expect(featuredModels().every((m) => m.featured)).toBe(true)
})
