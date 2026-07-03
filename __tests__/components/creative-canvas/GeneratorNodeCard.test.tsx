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
