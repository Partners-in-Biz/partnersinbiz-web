/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import NodePublishMenu from '@/components/creative-canvas/nodes/NodePublishMenu'

describe('NodePublishMenu', () => {
  it('publishes to social draft with a caption by default', () => {
    const onPublish = jest.fn()
    render(<NodePublishMenu nodeTitle="Combine output" onPublish={onPublish} onClose={jest.fn()} />)

    fireEvent.change(screen.getByLabelText(/social caption/i), { target: { value: 'Fresh drop' } })
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(onPublish).toHaveBeenCalledWith('social_draft', 'Fresh drop', ['instagram'])
  })

  it('publishes to the org vault when selected (caption field hidden)', () => {
    const onPublish = jest.fn()
    render(<NodePublishMenu nodeTitle="Combine output" onPublish={onPublish} onClose={jest.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: /org vault/i }))
    expect(screen.queryByLabelText(/social caption/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(onPublish).toHaveBeenCalledWith('workspace_artifact', '', ['instagram'])
  })

  it('publishes to Book Studio when selected (caption field hidden)', () => {
    const onPublish = jest.fn()
    render(<NodePublishMenu nodeTitle="Combine output" onPublish={onPublish} onClose={jest.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: /book studio/i }))
    expect(screen.queryByLabelText(/social caption/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(onPublish).toHaveBeenCalledWith('book_studio', '', ['instagram'])
  })

  it('publishes to YouTube Studio when selected (caption field hidden)', () => {
    const onPublish = jest.fn()
    render(<NodePublishMenu nodeTitle="Combine output" onPublish={onPublish} onClose={jest.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: /youtube studio/i }))
    expect(screen.queryByLabelText(/social caption/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(onPublish).toHaveBeenCalledWith('youtube_studio', '', ['instagram'])
  })

  it('publishes to the ad creative, email block, and SEO content targets when selected', () => {
    const cases = [
      [/ad creative/i, 'ads_creative'],
      [/email block/i, 'email_block'],
      [/seo content/i, 'seo_content'],
    ] as const

    for (const [pattern, target] of cases) {
      const onPublish = jest.fn()
      const { unmount } = render(<NodePublishMenu nodeTitle="Combine output" onPublish={onPublish} onClose={jest.fn()} />)

      fireEvent.click(screen.getByRole('radio', { name: pattern }))
      expect(screen.queryByLabelText(/social caption/i)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
      expect(onPublish).toHaveBeenCalledWith(target, '', ['instagram'])
      unmount()
    }
  })

  it('publishes to research when selected', () => {
    const onPublish = jest.fn()
    render(<NodePublishMenu nodeTitle="Combine output" onPublish={onPublish} onClose={jest.fn()} />)

    fireEvent.click(screen.getByRole('radio', { name: /research/i }))
    expect(screen.queryByLabelText(/social caption/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(onPublish).toHaveBeenCalledWith('research', '', ['instagram'])
  })

  it('shows busy, success, and error states', () => {
    const { rerender } = render(
      <NodePublishMenu nodeTitle="Out" busy onPublish={jest.fn()} onClose={jest.fn()} />,
    )
    expect(screen.getByRole('button', { name: /publishing/i })).toBeDisabled()

    rerender(<NodePublishMenu nodeTitle="Out" successMessage="Social draft created" error="" onPublish={jest.fn()} onClose={jest.fn()} />)
    expect(screen.getByText(/social draft created/i)).toBeInTheDocument()

    rerender(<NodePublishMenu nodeTitle="Out" error="Publish failed" onPublish={jest.fn()} onClose={jest.fn()} />)
    expect(screen.getByText('Publish failed')).toBeInTheDocument()
  })

  it('requires at least one platform for social drafts', () => {
    const onPublish = jest.fn()
    render(<NodePublishMenu nodeTitle="Out" onPublish={onPublish} onClose={jest.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /^instagram$/i })) // deselect the default
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /^linkedin$/i }))
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(onPublish).toHaveBeenCalledWith('social_draft', '', ['linkedin'])
  })

  it('closes from the close button', () => {
    const onClose = jest.fn()
    render(<NodePublishMenu nodeTitle="Out" onPublish={jest.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close publish menu/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
