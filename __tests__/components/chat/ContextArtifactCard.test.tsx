import { fireEvent, render, screen } from '@testing-library/react'
import { ContextArtifactCard } from '@/components/chat/context/ContextArtifactCard'

const artifact = { id: 'a1', studioKind: 'video_editor' as const, resourceType: 'video', resourceId: 'v1', title: 'Launch cut', artifactKind: 'video' as const, state: 'review' as const, statusLabel: 'In review', href: '/videos/v1', actions: [], provenance: { agentId: 'maya', model: 'veo-3', provider: 'google', sourceIds: ['brief-1'] } }

it('activates the Dock on click and reveals provenance progressively', () => {
  const activate = jest.fn()
  render(<ContextArtifactCard artifact={artifact} onActivate={activate} />)
  expect(screen.queryByText(/veo-3/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Inspect Launch cut/i }))
  expect(activate).toHaveBeenCalledWith(artifact)
  fireEvent.click(screen.getByRole('button', { name: /Show provenance/i }))
  expect(screen.getByText(/veo-3/)).toBeInTheDocument()
  expect(screen.getByText(/google/)).toBeInTheDocument()
})

it('renders media preview, lifecycle metadata, review state, and executes actions through the handler', () => {
  const onAction = jest.fn()
  const actionable = { ...artifact, preview: { kind: 'video' as const, url: 'https://cdn.test/cut.mp4', thumbnailUrl: 'https://cdn.test/poster.jpg' }, version: 'v4', updatedAt: '2026-07-13T08:00:00Z', review: { required: true, status: 'Rights cleared · Brand passed', reviewer: 'vera' }, actions: [{ id: 'review', label: 'Review', href: '/api/review', method: 'PUT' as const, body: { action: 'approve' } }] }
  render(<ContextArtifactCard artifact={actionable} onAction={onAction} />)
  expect(screen.getByLabelText('Video preview for Launch cut')).toBeInTheDocument()
  expect(screen.getByText(/v4/)).toBeInTheDocument()
  expect(screen.getByText(/Rights cleared/)).toBeInTheDocument()
  expect(screen.getByText(/vera/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Review' }))
  expect(onAction).toHaveBeenCalledWith(actionable.actions[0])
})

it('rejects executable and data preview URLs', () => {
  const unsafe = { ...artifact, preview: { kind: 'video' as const, url: 'javascript:alert(1)', thumbnailUrl: 'data:text/html,bad' } }
  render(<ContextArtifactCard artifact={unsafe} />)
  expect(screen.queryByLabelText('Video preview for Launch cut')).not.toBeInTheDocument()
  expect(document.querySelector('[src^="javascript:"]')).toBeNull()
  expect(document.querySelector('[src^="data:"]')).toBeNull()
})
