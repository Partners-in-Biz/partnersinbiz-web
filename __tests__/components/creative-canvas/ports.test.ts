import { portsForNode, isValidConnection } from '@/components/creative-canvas/nodes/ports'

test('image generator exposes image+text inputs and image output', () => {
  const p = portsForNode('image_generator')
  expect(p.inputs.map((i) => i.kind).sort()).toEqual(['image', 'text'])
  expect(p.output.kind).toBe('image')
})

test('rejects connecting a video output into an image-only input', () => {
  expect(isValidConnection('video', 'image')).toBe(false)
  expect(isValidConnection('image', 'image')).toBe(true)
  expect(isValidConnection('image', 'text')).toBe(false)
})
