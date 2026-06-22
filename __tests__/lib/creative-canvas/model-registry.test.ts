import { CANVAS_MODELS, getCanvasModel, modelsForKind, featuredModels } from '@/lib/creative-canvas/model-registry'

test('every model has a stable id, provider key and credit cost', () => {
  for (const m of CANVAS_MODELS) {
    expect(typeof m.id).toBe('string')
    expect(['higgsfield', 'xai', 'agent_task', 'manual_upload']).toContain(m.providerKey)
    expect(m.creditCost).toBeGreaterThanOrEqual(0)
  }
})
test('every model routes through Higgsfield (or an agent), default Higgsfield Soul 2.0', () => {
  // The whole catalog is Higgsfield-backed (agent_task for LLM/voice helpers).
  for (const m of CANVAS_MODELS) {
    expect(['higgsfield', 'agent_task']).toContain(m.providerKey)
  }
  const def = getCanvasModel('text2image_soul_v2')
  expect(def).toBeTruthy()
  expect(def!.kind).toBe('image')
  expect(def!.providerKey).toBe('higgsfield')
  expect(def!.featured).toBe(true)
  expect(def!.unlimited).toBe(true)
  expect(modelsForKind('image').some((m) => m.id === 'text2image_soul_v2')).toBe(true)
  // It is the cheapest-tier default: no image model is cheaper.
  const cheapestImage = Math.min(...modelsForKind('image').map((m) => m.creditCost))
  expect(def!.creditCost).toBe(cheapestImage)
  // generate-route test references still exist in the catalog.
  expect(getCanvasModel('gpt_image_2')).toBeTruthy()
  expect(getCanvasModel('seedance_2_0')).toBeTruthy()
})
test('featuredModels is a non-empty subset', () => {
  expect(featuredModels().length).toBeGreaterThan(0)
  expect(featuredModels().every((m) => m.featured)).toBe(true)
})
