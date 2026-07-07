/** @jest-environment jsdom */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CaptionsPanel } from '@/components/video-editor/CaptionsPanel'
import { emptyEditorTimeline } from '@/lib/video-editor/types'
import type { EditorTimeline } from '@/lib/video-editor/types'

const timelineWithCaptions = (): EditorTimeline => ({
  version: 1,
  tracks: [
    {
      id: 'cap-track',
      kind: 'caption',
      clips: [
        {
          id: 'cue-1',
          timelineStart: 0,
          duration: 2,
          caption: { text: 'Hello world', stylePreset: 'clean', animationPreset: 'none', words: [] },
        },
        {
          id: 'cue-2',
          timelineStart: 2,
          duration: 2,
          caption: { text: 'Second cue', stylePreset: 'clean', animationPreset: 'none', words: [] },
        },
      ],
    },
  ],
})

describe('CaptionsPanel', () => {
  it('shows an empty state with transcribe + generate actions when no caption track exists', () => {
    render(
      <CaptionsPanel
        timeline={emptyEditorTimeline()}
        transcripts={[]}
        busy={false}
        onApplyTimeline={jest.fn()}
        onTranscribe={jest.fn()}
        onGenerateCaptions={jest.fn()}
        onSeek={jest.fn()}
      />,
    )
    expect(screen.getByText(/no captions yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /transcribe project audio/i })).toBeInTheDocument()
  })

  it('renders one editable row per cue and applies a text edit through onApplyTimeline', () => {
    const onApplyTimeline = jest.fn()
    render(
      <CaptionsPanel
        timeline={timelineWithCaptions()}
        transcripts={[]}
        busy={false}
        onApplyTimeline={onApplyTimeline}
        onTranscribe={jest.fn()}
        onGenerateCaptions={jest.fn()}
        onSeek={jest.fn()}
      />,
    )
    const input = screen.getByDisplayValue('Hello world')
    fireEvent.change(input, { target: { value: 'Hello there' } })
    fireEvent.blur(input)
    expect(onApplyTimeline).toHaveBeenCalledTimes(1)
    const next: EditorTimeline = onApplyTimeline.mock.calls[0][0]
    expect(next.tracks[0].clips[0].caption?.text).toBe('Hello there')
  })

  it('splits a cue at its midpoint via the row Split action', () => {
    const onApplyTimeline = jest.fn()
    render(
      <CaptionsPanel
        timeline={timelineWithCaptions()}
        transcripts={[]}
        busy={false}
        onApplyTimeline={onApplyTimeline}
        onTranscribe={jest.fn()}
        onGenerateCaptions={jest.fn()}
        onSeek={jest.fn()}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: /split/i })[0])
    const next: EditorTimeline = onApplyTimeline.mock.calls[0][0]
    expect(next.tracks[0].clips).toHaveLength(3)
  })

  it('disables generate until a completed transcript is selected', () => {
    const onGenerateCaptions = jest.fn()
    render(
      <CaptionsPanel
        timeline={emptyEditorTimeline()}
        transcripts={[{ id: 'tr-1', status: 'completed', label: 'Main audio', language: 'en' }]}
        busy={false}
        onApplyTimeline={jest.fn()}
        onTranscribe={jest.fn()}
        onGenerateCaptions={onGenerateCaptions}
        onSeek={jest.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/transcript/i), { target: { value: 'tr-1' } })
    fireEvent.click(screen.getByRole('button', { name: /generate captions/i }))
    expect(onGenerateCaptions).toHaveBeenCalledWith('tr-1')
  })
})
