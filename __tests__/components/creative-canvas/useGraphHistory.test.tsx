import { renderHook, act } from '@testing-library/react'
import { useGraphHistory } from '@/components/creative-canvas/canvas/useGraphHistory'

test('records snapshots and undoes/redoes', () => {
  const { result } = renderHook(() => useGraphHistory({ nodes: [], edges: [] }))

  act(() => {
    result.current.commit({ nodes: [{ id: 'a' }], edges: [] })
  })
  act(() => {
    result.current.commit({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [] })
  })

  expect(result.current.canUndo).toBe(true)

  let snap: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] }
  act(() => {
    snap = result.current.undo()
  })
  expect((snap.nodes as Array<{ id: string }>).map((n) => n.id)).toEqual(['a'])
  expect(result.current.canRedo).toBe(true)

  act(() => {
    snap = result.current.redo()
  })
  expect((snap.nodes as Array<{ id: string }>).map((n) => n.id)).toEqual(['a', 'b'])
})

test('undo with empty history returns present without throwing', () => {
  const { result } = renderHook(() => useGraphHistory({ nodes: [{ id: 'seed' }], edges: [] }))
  let snap: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] }
  act(() => {
    snap = result.current.undo()
  })
  expect((snap.nodes as Array<{ id: string }>).map((n) => n.id)).toEqual(['seed'])
  expect(result.current.canUndo).toBe(false)
})
