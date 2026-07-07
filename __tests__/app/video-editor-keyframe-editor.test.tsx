import { fireEvent, render, screen } from '@testing-library/react'
import { BezierCurveEditor } from '@/components/video-editor/BezierCurveEditor'
import { KeyframeEditor } from '@/components/video-editor/KeyframeEditor'
import { SpeedRampSection } from '@/components/video-editor/SpeedRampSection'
import type { EditorClip } from '@/lib/video-editor/types'

const clip: EditorClip = {
  id: 'c1',
  timelineStart: 10,
  duration: 4,
  media: { type: 'upload', fileId: 'f', url: 'https://x.test/a.mp4', mediaKind: 'video' },
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  keyframes: [{ property: 'transform.opacity', atSeconds: 1, value: 0.5, easing: 'ease_in' }],
}

describe('KeyframeEditor', () => {
  it('adds a keyframe at the playhead with the current property value', () => {
    const onPatch = jest.fn()
    render(<KeyframeEditor clip={clip} playheadSeconds={12} onPatch={onPatch} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add opacity keyframe at playhead' }))
    const patch = onPatch.mock.calls[0][0]
    expect(patch.keyframes).toContainEqual(expect.objectContaining({ property: 'transform.opacity', atSeconds: 2 }))
    expect(patch.keyframes).toHaveLength(2)
  })

  it('edits a keyframe value and easing, and removes keyframes', () => {
    const onPatch = jest.fn()
    render(<KeyframeEditor clip={clip} playheadSeconds={10} onPatch={onPatch} />)
    fireEvent.change(screen.getByLabelText('opacity keyframe 1 value'), { target: { value: '0.9' } })
    expect(onPatch).toHaveBeenCalledWith({ keyframes: [expect.objectContaining({ value: 0.9 })] })
    fireEvent.change(screen.getByLabelText('opacity keyframe 1 easing'), { target: { value: 'bezier' } })
    expect(onPatch).toHaveBeenLastCalledWith({ keyframes: [expect.objectContaining({ easing: 'bezier', bezier: [0.42, 0, 0.58, 1] })] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove opacity keyframe 1' }))
    expect(onPatch).toHaveBeenLastCalledWith({ keyframes: undefined })
  })

  it('shows the bezier editor only for bezier keyframes', () => {
    const bezierClip: EditorClip = {
      ...clip,
      keyframes: [{ property: 'volume', atSeconds: 0, value: 1, easing: 'bezier', bezier: [0.3, 0, 0.7, 1] }],
    }
    render(<KeyframeEditor clip={bezierClip} playheadSeconds={10} onPatch={jest.fn()} />)
    expect(screen.getByTestId('bezier-editor')).toBeInTheDocument()
  })
})

describe('BezierCurveEditor', () => {
  it('reports control point changes from the numeric inputs', () => {
    const onChange = jest.fn()
    render(<BezierCurveEditor value={[0.3, 0, 0.7, 1]} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('P1 x'), { target: { value: '0.5' } })
    expect(onChange).toHaveBeenCalledWith([0.5, 0, 0.7, 1])
  })
})

describe('SpeedRampSection', () => {
  it('applies a preset replacing existing speed keyframes and clears ramps', () => {
    const onPatch = jest.fn()
    const ramped: EditorClip = {
      ...clip,
      keyframes: [
        ...clip.keyframes!,
        { property: 'speed', atSeconds: 0, value: 1 },
        { property: 'speed', atSeconds: 4, value: 2 },
      ],
    }
    render(<SpeedRampSection clip={ramped} onPatch={onPatch} />)
    fireEvent.click(screen.getByRole('button', { name: 'Hero Time' }))
    const applied = onPatch.mock.calls[0][0].keyframes as Array<{ property: string }>
    expect(applied.filter((k) => k.property === 'speed')).toHaveLength(4)
    expect(applied.filter((k) => k.property === 'transform.opacity')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear ramp' }))
    const cleared = onPatch.mock.calls[1][0].keyframes as Array<{ property: string }>
    expect(cleared.every((k) => k.property !== 'speed')).toBe(true)
  })
})
