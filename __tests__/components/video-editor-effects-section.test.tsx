import { fireEvent, render, screen } from '@testing-library/react'
import { EffectsSection } from '@/components/video-editor/EffectsSection'
import type { EditorEffectInstance } from '@/lib/video-editor/types'

describe('EffectsSection', () => {
  const luts = [{ id: 'lut-1', title: 'Teal & Orange', url: 'https://x/l.cube' }]

  it('adds a default effect instance when a kind is chosen', () => {
    const onChange = jest.fn()
    render(<EffectsSection effects={[]} luts={luts} target="video" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Add effect'), { target: { value: 'blur' } })
    expect(onChange).toHaveBeenCalledWith([{ kind: 'blur', params: { sigma: 5 } }])
  })

  it('filters addable effects by target', () => {
    const onChange = jest.fn()
    const { rerender } = render(<EffectsSection effects={[]} luts={luts} target="video" onChange={onChange} />)
    expect(screen.getByRole('option', { name: 'Blur' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Noise reduction' })).not.toBeInTheDocument()

    rerender(<EffectsSection effects={[]} luts={luts} target="audio" onChange={onChange} />)
    expect(screen.getByRole('option', { name: 'Noise reduction' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Blur' })).not.toBeInTheDocument()
  })

  it('renders param controls and patches values', () => {
    const onChange = jest.fn()
    const effects: EditorEffectInstance[] = [{ kind: 'blur', params: { sigma: 5 } }]
    render(<EffectsSection effects={effects} luts={luts} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '12' } })
    expect(onChange).toHaveBeenCalledWith([{ kind: 'blur', params: { sigma: 12 } }])
  })

  it('reorders and removes effects', () => {
    const onChange = jest.fn()
    const effects: EditorEffectInstance[] = [
      { kind: 'blur', params: { sigma: 5 } },
      { kind: 'grain', params: { strength: 12 } },
    ]
    render(<EffectsSection effects={effects} luts={luts} onChange={onChange} />)
    fireEvent.click(screen.getAllByLabelText('Move effect up')[1])
    expect(onChange).toHaveBeenCalledWith([
      { kind: 'grain', params: { strength: 12 } },
      { kind: 'blur', params: { sigma: 5 } },
    ])
    fireEvent.click(screen.getAllByLabelText('Remove effect')[0])
    expect(onChange).toHaveBeenCalledWith([{ kind: 'grain', params: { strength: 12 } }])
  })

  it('offers the LUT library for lut effects', () => {
    const onChange = jest.fn()
    render(<EffectsSection effects={[{ kind: 'lut', params: { lutUrl: '', intensity: 1 } }]} luts={luts} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('LUT file'), { target: { value: 'https://x/l.cube' } })
    expect(onChange).toHaveBeenCalledWith([{ kind: 'lut', params: { lutUrl: 'https://x/l.cube', intensity: 1 } }])
  })
})
