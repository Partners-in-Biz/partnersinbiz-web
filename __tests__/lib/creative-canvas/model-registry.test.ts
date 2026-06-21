import { CANVAS_MODELS, getCanvasModel, modelsForKind, featuredModels } from '@/lib/creative-canvas/model-registry'

test('every model has a stable id, provider key and credit cost', () => {
  for (const m of CANVAS_MODELS) {
    expect(typeof m.id).toBe('string')
    expect(['higgsfield', 'xai', 'agent_task', 'manual_upload']).toContain(m.providerKey)
    expect(m.creditCost).toBeGreaterThanOrEqual(0)
  }
})
test('there is a synchronous xai image model for inline generation', () => {
  const sync = modelsForKind('image').find((m) => m.execution === 'sync' && m.providerKey === 'xai')
  expect(sync).toBeTruthy()
  expect(getCanvasModel(sync!.id)).toEqual(sync)
})
test('featuredModels is a non-empty subset', () => {
  expect(featuredModels().length).toBeGreaterThan(0)
  expect(featuredModels().every((m) => m.featured)).toBe(true)
})
