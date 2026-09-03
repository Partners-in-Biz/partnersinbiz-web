import { fireEvent, render, screen } from '@testing-library/react'
import { ArtifactCanvas } from '@/components/chat/context/ArtifactCanvas'
import { ContextDock } from '@/components/chat/context/ContextDock'
import type { RichMessagePart } from '@/lib/hermes/types'

jest.mock('@/lib/firebase/client', () => ({
  db: {},
}))

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => ({ path: 'client_documents/mock' })),
  onSnapshot: jest.fn(() => jest.fn()),
}))

const model = {
  context: { kind: 'studio' as const, id: 's1', orgId: 'o1', label: 'Marketing Studio', icon: 'campaign' },
  pulse: { label: 'Marketing Studio', metrics: [] },
  groups: [], artifacts: [], attention: [], activity: [], capabilities: [], asOf: '2026-09-03T00:00:00Z',
}

const htmlPart: RichMessagePart = {
  type: 'html_artifact',
  title: 'Tall card',
  html: '<p>Canvas body</p>',
  height: 720,
}

describe('ArtifactCanvas', () => {
  it('renders a sandboxed HTML artifact full-height in the canvas', () => {
    const { container } = render(<ArtifactCanvas part={htmlPart} />)
    expect(screen.getByTestId('artifact-canvas')).toBeInTheDocument()
    const iframe = container.querySelector('iframe')
    expect(iframe).toHaveAttribute('sandbox', '')
    expect(iframe?.getAttribute('srcdoc') ?? '').toContain('Canvas body')
  })

  it('shows unsupported content for an invalid part', () => {
    render(<ArtifactCanvas part={{ type: 'html_artifact', html: '' }} />)
    expect(screen.getByText('Unsupported content')).toBeInTheDocument()
  })
})

describe('ContextDock artifact overlay', () => {
  it('opens the dock with the rich part without calling chat-context/artifact', () => {
    const onTakeOver = jest.fn()
    const fetchSpy = jest.spyOn(global, 'fetch')
    render(
      <ContextDock
        model={model}
        open
        onClose={jest.fn()}
        artifactPart={htmlPart}
        onArtifactTakeOver={onTakeOver}
      />,
    )
    expect(screen.getByTestId('artifact-canvas')).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('Take over on a browser frame calls onArtifactTakeOver with the session id', () => {
    const onTakeOver = jest.fn()
    const browserPart: RichMessagePart = {
      type: 'browser_frame',
      sessionId: 'sess-takeover-1',
      url: 'https://example.com',
      screenshotUrl: 'https://cdn.example.com/frame.png',
      title: 'Example',
    }
    render(
      <ContextDock
        model={model}
        open
        onClose={jest.fn()}
        artifactPart={browserPart}
        onArtifactTakeOver={onTakeOver}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /take over/i }))
    expect(onTakeOver).toHaveBeenCalledWith('sess-takeover-1')
  })
})
