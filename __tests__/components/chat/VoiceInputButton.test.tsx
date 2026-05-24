import { fireEvent, render, screen } from '@testing-library/react'
import VoiceInputButton from '@/components/chat/VoiceInputButton'

type RecognitionEvent = { results: Array<Array<{ transcript: string }>> }

const recognitionInstances: MockSpeechRecognition[] = []

function dispatchPointer(target: Element, type: string, props: Record<string, number | string> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(event, key, { value, configurable: true })
  }
  fireEvent(target, event)
}

class MockSpeechRecognition {
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((event: RecognitionEvent) => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  onend: (() => void) | null = null
  start = jest.fn()
  stop = jest.fn(() => {
    this.onend?.()
  })
  abort = jest.fn()

  constructor() {
    recognitionInstances.push(this)
  }
}

describe('VoiceInputButton', () => {
  beforeEach(() => {
    recognitionInstances.length = 0
    ;(window as typeof window & { SpeechRecognition?: unknown }).SpeechRecognition = MockSpeechRecognition
    HTMLElement.prototype.setPointerCapture = jest.fn()
    HTMLElement.prototype.releasePointerCapture = jest.fn()
  })

  afterEach(() => {
    delete (window as typeof window & { SpeechRecognition?: unknown }).SpeechRecognition
    jest.restoreAllMocks()
  })

  it('locks recording when the user swipes up and stops on the next press', () => {
    const onTranscript = jest.fn()
    render(<VoiceInputButton onTranscript={onTranscript} />)

    const button = screen.getByRole('button', { name: /click to record or hold to dictate/i })

    dispatchPointer(button, 'pointerdown', { pointerId: 1, clientY: 220 })
    expect(recognitionInstances).toHaveLength(1)
    expect(recognitionInstances[0].start).toHaveBeenCalledTimes(1)

    expect(screen.getByText(/swipe up to lock/i)).toBeInTheDocument()

    dispatchPointer(button, 'pointermove', { pointerId: 1, clientY: 140, movementY: -80 })
    expect(screen.getByText(/locked — tap to stop/i)).toBeInTheDocument()
    expect(recognitionInstances[0].stop).not.toHaveBeenCalled()

    dispatchPointer(button, 'pointerup', { pointerId: 1, clientY: 140 })
    expect(recognitionInstances[0].stop).not.toHaveBeenCalled()

    recognitionInstances[0].onresult?.({ results: [[{ transcript: 'locked note' }]] })
    dispatchPointer(screen.getByRole('button', { name: /stop voice recording/i }), 'pointerdown', { pointerId: 2 })

    expect(recognitionInstances[0].stop).toHaveBeenCalledTimes(1)
    expect(onTranscript).toHaveBeenCalledWith('locked note')
  })

  it('locks recording on a laptop click and stops on the next click', () => {
    const onTranscript = jest.fn()
    render(<VoiceInputButton onTranscript={onTranscript} />)

    const button = screen.getByRole('button', { name: /click to record or hold to dictate/i })

    dispatchPointer(button, 'pointerdown', { pointerId: 1, pointerType: 'mouse', clientY: 220 })
    dispatchPointer(button, 'pointerup', { pointerId: 1, pointerType: 'mouse', clientY: 220 })

    expect(recognitionInstances).toHaveLength(1)
    expect(recognitionInstances[0].start).toHaveBeenCalledTimes(1)
    expect(recognitionInstances[0].stop).not.toHaveBeenCalled()
    expect(screen.getByText(/locked — tap to stop/i)).toBeInTheDocument()

    recognitionInstances[0].onresult?.({ results: [[{ transcript: 'laptop note' }]] })
    const lockedButton = screen.getByRole('button', { name: /stop voice recording/i })
    dispatchPointer(lockedButton, 'pointerdown', { pointerId: 2, pointerType: 'mouse', clientY: 220 })

    expect(recognitionInstances[0].stop).toHaveBeenCalledTimes(1)
    expect(onTranscript).toHaveBeenCalledWith('laptop note')
  })
})
