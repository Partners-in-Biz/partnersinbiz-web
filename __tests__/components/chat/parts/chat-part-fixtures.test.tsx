import { render, screen } from '@testing-library/react'
import MessageBubble from '@/components/chat/MessageBubble'
import { HtmlArtifactPart } from '@/components/chat/parts/HtmlArtifactPart'
import { validatePart } from '@/lib/chat/parts'
import type { RichMessagePart } from '@/lib/hermes/types'
import chart from '../../../fixtures/chat-parts/chart.json'
import mermaid from '../../../fixtures/chat-parts/mermaid.json'
import math from '../../../fixtures/chat-parts/math.json'
import htmlArtifact from '../../../fixtures/chat-parts/html_artifact.json'
import filePart from '../../../fixtures/chat-parts/file.json'
import browserFrame from '../../../fixtures/chat-parts/browser_frame.json'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverStub,
  })
})

jest.mock('mermaid', () => ({
  __esModule: true,
  default: {
    initialize: jest.fn(),
    render: async (_id: string, source: string) => ({
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${source.includes('Client') ? 'Client' : 'diagram'}</text></svg>`,
    }),
  },
}))

const fixtures: RichMessagePart[] = [
  chart as RichMessagePart,
  mermaid as RichMessagePart,
  math as RichMessagePart,
  htmlArtifact as RichMessagePart,
  filePart as RichMessagePart,
  browserFrame as RichMessagePart,
]

function assistantMessage(part: RichMessagePart) {
  return {
    id: `msg-${part.type}`,
    conversationId: 'conv-1',
    role: 'assistant' as const,
    content: '',
    authorKind: 'agent' as const,
    authorId: 'pip',
    authorDisplayName: 'Pip',
    status: 'completed' as const,
    richParts: [part],
  }
}

function portalBubbleProps(part: RichMessagePart) {
  return { currentUserUid: 'user-1', message: assistantMessage(part) }
}

function adminBubbleProps(part: RichMessagePart) {
  return {
    ...portalBubbleProps(part),
    onOpenArtifact: jest.fn(),
    onUiAction: jest.fn(),
    onStopRun: jest.fn(),
  }
}

function assertHostileIframe(container: HTMLElement) {
  const iframe = container.querySelector('iframe')
  expect(iframe).toHaveAttribute('sandbox', '')
  expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
  const srcDoc = iframe?.getAttribute('srcdoc') ?? ''
  expect(srcDoc).toContain("default-src 'none'")
  expect(srcDoc).toContain('Visible')
}

describe('chat part golden fixtures', () => {
  it.each(fixtures.map((part) => [part.type, part] as const))('validates the %s fixture', (_type, part) => {
    expect(validatePart(part).ok).toBe(true)
  })

  it('renders each fixture through MessageBubble (portal prop set)', () => {
    for (const part of fixtures) {
      const { unmount } = render(<MessageBubble {...portalBubbleProps(part)} />)
      expect(screen.queryByText('Unsupported content')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('renders each fixture through MessageBubble (admin prop set)', () => {
    for (const part of fixtures) {
      const { unmount } = render(<MessageBubble {...adminBubbleProps(part)} />)
      expect(screen.queryByText('Unsupported content')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('keeps hostile html_artifact sandboxed through MessageBubble (portal)', () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response('no', { status: 500 }))
    fetchSpy.mockClear()
    const { container } = render(<MessageBubble {...portalBubbleProps(htmlArtifact as RichMessagePart)} />)
    assertHostileIframe(container)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('keeps hostile html_artifact sandboxed through MessageBubble (admin)', () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response('no', { status: 500 }))
    fetchSpy.mockClear()
    const { container } = render(<MessageBubble {...adminBubbleProps(htmlArtifact as RichMessagePart)} />)
    assertHostileIframe(container)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('keeps hostile html_artifact sandboxed and does not fetch', () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response('no', { status: 500 }))
    fetchSpy.mockClear()
    const { container } = render(
      <HtmlArtifactPart part={{
        type: 'html_artifact',
        title: String(htmlArtifact.title),
        html: String(htmlArtifact.html),
        height: Number(htmlArtifact.height),
      }}
      />,
    )
    assertHostileIframe(container)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
