/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { GeneratorNodeCard } from '@/components/creative-canvas/nodes/nodeFactory'

function renderCard(model?: string) {
  return render(
    <ReactFlowProvider>
      <GeneratorNodeCard type="image_generator" title="Image Generation" showGenerateBar model={model} />
    </ReactFlowProvider>,
  )
}

test('renders the human label for a known registry model id', () => {
  renderCard('text2image_soul_v2')
  expect(screen.getByRole('button', { name: 'Soul 2.0' })).toBeInTheDocument()
})

test('falls back to the raw id for an unknown model id', () => {
  renderCard('some_unknown_model_id')
  expect(screen.getByRole('button', { name: 'some_unknown_model_id' })).toBeInTheDocument()
})

test('falls back to "Select model" when no model is set', () => {
  renderCard(undefined)
  expect(screen.getByRole('button', { name: 'Select model' })).toBeInTheDocument()
})

test('shows an error alert on the card when a run failed', () => {
  render(
    <ReactFlowProvider>
      <GeneratorNodeCard type="video_generator" title="Vertical render" showGenerateBar status="error" errorMessage="Provider is verifying the source image — retrying automatically" />
    </ReactFlowProvider>,
  )
  const alert = screen.getByRole('alert')
  expect(alert).toHaveTextContent(/verifying the source image/i)
  // Generate stays enabled so the user can retry.
  expect(screen.getByRole('button', { name: /Generate/ })).not.toBeDisabled()
})

test('does not show an error alert while generating', () => {
  render(
    <ReactFlowProvider>
      <GeneratorNodeCard type="video_generator" title="Vertical render" showGenerateBar status="running" errorMessage="stale message" />
    </ReactFlowProvider>,
  )
  expect(screen.queryByRole('alert')).toBeNull()
})
