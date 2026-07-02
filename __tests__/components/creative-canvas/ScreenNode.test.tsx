import { render, screen, fireEvent } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import ScreenNode from '@/components/creative-canvas/nodes/ScreenNode'
import type { CanvasNodeData } from '@/components/creative-canvas/nodes/nodeData'

function renderNode(data: CanvasNodeData) {
  return render(
    <ReactFlowProvider>
      <ScreenNode
        id="n1"
        type="screen"
        data={data}
        selected={false}
        isConnectable
        dragging={false}
        zIndex={0}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        deletable
        selectable
        draggable
        width={240}
        height={200}
      />
    </ReactFlowProvider>,
  )
}

test('renders title and description text', () => {
  renderNode({
    presentationType: 'screen',
    title: 'Home Page',
    text: 'Hero, features grid, CTA footer',
  })
  expect(screen.getByText('Home Page')).toBeInTheDocument()
  expect(screen.getByPlaceholderText(/describe this screen/i)).toHaveValue('Hero, features grid, CTA footer')
})

test('falls back to "Screen" title when none provided', () => {
  renderNode({ presentationType: 'screen', title: '' })
  expect(screen.getByText('Screen')).toBeInTheDocument()
})

test('editing the description calls onTextChange', () => {
  const onTextChange = jest.fn()
  renderNode({
    presentationType: 'screen',
    title: 'Pricing',
    text: '',
    onTextChange,
  })
  fireEvent.change(screen.getByPlaceholderText(/describe this screen/i), {
    target: { value: 'Three tiers with comparison table' },
  })
  expect(onTextChange).toHaveBeenCalledWith('Three tiers with comparison table')
})

test('shows the image slot when assetUrl is set', () => {
  renderNode({
    presentationType: 'screen',
    title: 'Dashboard',
    assetUrl: 'https://example.com/mockup.png',
  })
  const img = screen.getByRole('img', { name: 'Dashboard' })
  expect(img).toHaveAttribute('src', 'https://example.com/mockup.png')
})

test('hides the image slot when assetUrl is not set', () => {
  renderNode({ presentationType: 'screen', title: 'Dashboard' })
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

test('hides the mockup button when the description is empty', () => {
  renderNode({ presentationType: 'screen', title: 'Dashboard', text: '' })
  expect(screen.queryByRole('button', { name: /mockup/i })).not.toBeInTheDocument()
})

test('shows "Generate mockup" when described and fires onGenerateMockup', () => {
  const onGenerateMockup = jest.fn()
  renderNode({
    presentationType: 'screen',
    title: 'Dashboard',
    text: 'KPI cards and charts',
    onGenerateMockup,
  })
  const button = screen.getByRole('button', { name: /✨ generate mockup/i })
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(onGenerateMockup).toHaveBeenCalled()
})

test('shows "Regenerate mockup" below the image when a mockup already exists', () => {
  renderNode({
    presentationType: 'screen',
    title: 'Dashboard',
    text: 'KPI cards and charts',
    assetUrl: 'https://example.com/mockup.png',
  })
  expect(screen.getByRole('img', { name: 'Dashboard' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /↻ regenerate mockup/i })).toBeInTheDocument()
})

test('disables the mockup button with a busy label while running', () => {
  const onGenerateMockup = jest.fn()
  renderNode({
    presentationType: 'screen',
    title: 'Dashboard',
    text: 'KPI cards and charts',
    status: 'running',
    onGenerateMockup,
  })
  const button = screen.getByRole('button', { name: /generating…/i })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(onGenerateMockup).not.toHaveBeenCalled()
})
