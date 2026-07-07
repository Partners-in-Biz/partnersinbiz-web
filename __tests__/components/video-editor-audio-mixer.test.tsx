import { fireEvent, render, screen } from '@testing-library/react'
import { AudioMixerPanel } from '@/components/video-editor/AudioMixerPanel'
import type { EditorTimeline } from '@/lib/video-editor/types'

describe('AudioMixerPanel', () => {
  const timeline: EditorTimeline = {
    version: 1,
    tracks: [
      { id: 'video-1', kind: 'video', label: 'A Cam', clips: [] },
      { id: 'audio-1', kind: 'audio', label: 'Music', gainDb: -6, pan: -0.25, clips: [] },
      { id: 'text-1', kind: 'text', label: 'Titles', clips: [] },
    ],
  }

  it('renders only video and audio tracks', () => {
    render(<AudioMixerPanel timeline={timeline} onPatchTrack={jest.fn()} />)
    expect(screen.getByText('A Cam')).toBeInTheDocument()
    expect(screen.getByText('Music')).toBeInTheDocument()
    expect(screen.queryByText('Titles')).not.toBeInTheDocument()
  })

  it('patches gain and pan on the selected track', () => {
    const onPatchTrack = jest.fn()
    render(<AudioMixerPanel timeline={timeline} onPatchTrack={onPatchTrack} />)

    fireEvent.change(screen.getByLabelText('Gain (dB) Music'), { target: { value: '-12' } })
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { gainDb: -12 })

    fireEvent.change(screen.getByLabelText('Pan A Cam'), { target: { value: '0.4' } })
    expect(onPatchTrack).toHaveBeenCalledWith('video-1', { pan: 0.4 })
  })

  it('clears neutral gain and pan values instead of storing defaults', () => {
    const onPatchTrack = jest.fn()
    render(<AudioMixerPanel timeline={timeline} onPatchTrack={onPatchTrack} />)

    fireEvent.change(screen.getByLabelText('Gain (dB) Music'), { target: { value: '0' } })
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { gainDb: undefined })

    fireEvent.change(screen.getByLabelText('Pan Music'), { target: { value: '0' } })
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { pan: undefined })
  })

  it('patches mute, solo, ducking, and role controls', () => {
    const onPatchTrack = jest.fn()
    render(<AudioMixerPanel timeline={timeline} onPatchTrack={onPatchTrack} />)

    fireEvent.click(screen.getByLabelText('Mute Music'))
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { muted: true })

    fireEvent.click(screen.getByLabelText('Solo Music'))
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { solo: true })

    fireEvent.click(screen.getByLabelText('Duck under voice Music'))
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { duckUnderVoice: true })

    fireEvent.change(screen.getByLabelText('Role Music'), { target: { value: 'music' } })
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { audioRole: 'music' })
  })

  it('keeps renderer-only audio controls off video strips', () => {
    render(<AudioMixerPanel timeline={timeline} onPatchTrack={jest.fn()} />)
    expect(screen.queryByLabelText('Duck under voice A Cam')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Role A Cam')).not.toBeInTheDocument()
    expect(screen.getByText('Video audio is treated as voice.')).toBeInTheDocument()
  })

  it('clears toggles and role values back to defaults', () => {
    const onPatchTrack = jest.fn()
    const mixedTimeline: EditorTimeline = {
      version: 1,
      tracks: [
        { id: 'audio-1', kind: 'audio', label: 'Music', muted: true, solo: true, duckUnderVoice: true, audioRole: 'music', clips: [] },
      ],
    }
    render(<AudioMixerPanel timeline={mixedTimeline} onPatchTrack={onPatchTrack} />)

    fireEvent.click(screen.getByLabelText('Mute Music'))
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { muted: undefined })

    fireEvent.click(screen.getByLabelText('Solo Music'))
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { solo: undefined })

    fireEvent.click(screen.getByLabelText('Duck under voice Music'))
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { duckUnderVoice: undefined })

    fireEvent.change(screen.getByLabelText('Role Music'), { target: { value: '' } })
    expect(onPatchTrack).toHaveBeenCalledWith('audio-1', { audioRole: undefined })
  })
})
