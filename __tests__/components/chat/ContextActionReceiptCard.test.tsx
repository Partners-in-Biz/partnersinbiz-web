import { render, screen } from '@testing-library/react'

import { ContextActionReceiptCard } from '@/components/chat/context/ContextActionReceiptCard'
import type { ChatContextActionReceipt } from '@/lib/chat-context/types'

const receipt: ChatContextActionReceipt = {
  id: 'abcdef0123456789',
  conversationId: 'conv-1',
  orgId: 'org-1',
  actor: { uid: 'member-1', role: 'client' },
  context: { kind: 'studio_artifact', id: 'video_editor:render-1' },
  action: { id: 'retry', label: 'Retry render', href: '/api/v1/retry', method: 'POST' },
  status: 'succeeded',
  canonicalStatus: 200,
  referenceIds: { runId: 'run-1' },
  resultHref: '/video-editor/render-1',
  createdAt: '2026-07-30T12:00:00.000Z',
  completedAt: '2026-07-30T12:00:01.000Z',
}

describe('ContextActionReceiptCard', () => {
  it('renders verifiable success evidence and a result link', () => {
    render(<ContextActionReceiptCard receipt={receipt} />)
    expect(screen.getByTestId('context-action-receipt')).toHaveAttribute('data-status', 'succeeded')
    expect(screen.getByText('Action completed')).toBeInTheDocument()
    expect(screen.getByText('Retry render')).toBeInTheDocument()
    expect(screen.getByText('runId run-1')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute('href', '/video-editor/render-1')
  })

  it('makes indeterminate execution explicit', () => {
    render(<ContextActionReceiptCard receipt={{
      ...receipt,
      status: 'indeterminate',
      error: 'Execution result is unknown. Check the live record.',
    }} />)
    expect(screen.getByText('Result needs checking')).toBeInTheDocument()
    expect(screen.getByText(/execution result is unknown/i)).toBeInTheDocument()
  })
})
