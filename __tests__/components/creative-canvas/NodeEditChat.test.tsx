/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import NodeEditChat from '@/components/creative-canvas/nodes/NodeEditChat'

describe('NodeEditChat', () => {
  it('submits the prompt with branch placement by default', () => {
    const onSubmit = jest.fn()
    render(<NodeEditChat nodeTitle="Person" mediaKind="image" onSubmit={onSubmit} onClose={jest.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(/how should this image change/i), { target: { value: 'sunset background' } })
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }))
    expect(onSubmit).toHaveBeenCalledWith('sunset background', 'branch')
  })

  it('submits with replace placement when toggled', () => {
    const onSubmit = jest.fn()
    render(<NodeEditChat nodeTitle="Person" mediaKind="image" onSubmit={onSubmit} onClose={jest.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: /replace/i }))
    fireEvent.change(screen.getByPlaceholderText(/how should this image change/i), { target: { value: 'add a dog' } })
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }))
    expect(onSubmit).toHaveBeenCalledWith('add a dog', 'replace')
  })

  it('disables Generate while busy and shows errors', () => {
    render(<NodeEditChat nodeTitle="Person" mediaKind="text" busy error="Edit generation failed" onSubmit={jest.fn()} onClose={jest.fn()} />)
    expect(screen.getByRole('button', { name: /generating/i })).toBeDisabled()
    expect(screen.getByText('Edit generation failed')).toBeInTheDocument()
  })

  it('closes from the close button', () => {
    const onClose = jest.fn()
    render(<NodeEditChat nodeTitle="Person" mediaKind="image" onSubmit={jest.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close ai edit/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
