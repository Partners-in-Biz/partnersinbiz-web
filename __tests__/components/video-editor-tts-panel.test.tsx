/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TtsPanel } from '@/components/video-editor/TtsPanel'

describe('TtsPanel', () => {
  const voices = [
    { id: 'alloy', label: 'Alloy', provider: 'gateway' },
    { id: 'el-rachel', label: 'Rachel', provider: 'elevenlabs' },
  ]

  it('shows a live credit estimate for the entered text', () => {
    render(<TtsPanel voices={voices} busy={false} onGenerate={jest.fn()} />)
    fireEvent.change(screen.getByLabelText(/voiceover script/i), { target: { value: 'a'.repeat(2000) } })
    expect(screen.getByText(/credits/i)).toBeInTheDocument()
  })

  it('splits paragraphs into sections and calls onGenerate with voice + sections', async () => {
    const onGenerate = jest.fn().mockResolvedValue(undefined)
    render(<TtsPanel voices={voices} busy={false} onGenerate={onGenerate} />)
    fireEvent.change(screen.getByLabelText(/voiceover script/i), {
      target: { value: 'First section.\n\nSecond section.' },
    })
    fireEvent.change(screen.getByLabelText(/voice/i), { target: { value: 'el-rachel' } })
    fireEvent.click(screen.getByRole('button', { name: /generate voiceover/i }))
    await waitFor(() =>
      expect(onGenerate).toHaveBeenCalledWith({
        voice: 'el-rachel',
        provider: 'elevenlabs',
        sections: [{ text: 'First section.' }, { text: 'Second section.' }],
      }),
    )
  })

  it('disables generate while busy or empty', () => {
    render(<TtsPanel voices={voices} busy onGenerate={jest.fn()} />)
    expect(screen.getByRole('button', { name: /generate voiceover/i })).toBeDisabled()
  })
})
