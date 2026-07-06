import { CANVAS_MODELS, getCanvasModel, modelsForKind, featuredModels } from '@/lib/creative-canvas/model-registry'

test('every model has a stable id, provider key and credit cost', () => {
  for (const m of CANVAS_MODELS) {
    expect(typeof m.id).toBe('string')
    expect(['higgsfield', 'xai', 'google', 'fal', 'recraft', 'agent_task', 'manual_upload']).toContain(m.providerKey)
    expect(m.creditCost).toBeGreaterThanOrEqual(0)
  }
})
test('default model is Higgsfield Soul 2.0, cheapest among the unlimited-tier Higgsfield image models', () => {
  const def = getCanvasModel('text2image_soul_v2')
  expect(def).toBeTruthy()
  expect(def!.kind).toBe('image')
  expect(def!.providerKey).toBe('higgsfield')
  expect(def!.featured).toBe(true)
  expect(def!.unlimited).toBe(true)
  expect(modelsForKind('image').some((m) => m.id === 'text2image_soul_v2')).toBe(true)
  // It is the cheapest-tier default among Higgsfield-native (platform-credit) image models.
  const cheapestHiggsfieldImage = Math.min(
    ...modelsForKind('image').filter((m) => m.providerKey === 'higgsfield').map((m) => m.creditCost)
  )
  expect(def!.creditCost).toBe(cheapestHiggsfieldImage)
  // generate-route test references still exist in the catalog.
  expect(getCanvasModel('gpt_image_2')).toBeTruthy()
  expect(getCanvasModel('seedance_2_0')).toBeTruthy()
})
test('featuredModels is a non-empty subset', () => {
  expect(featuredModels().length).toBeGreaterThan(0)
  expect(featuredModels().every((m) => m.featured)).toBe(true)
})
