import { render, screen, fireEvent } from '@testing-library/react'
import ReferencePicker, {
  type ReferenceAsset,
} from '@/components/creative-canvas/panels/ReferencePicker'

const uploadAsset: ReferenceAsset = {
  id: 'up_1',
  url: 'https://example.com/upload-1.png',
  title: 'My Upload',
  kind: 'image',
}

const imageGenAsset: ReferenceAsset = {
  id: 'img_1',
  url: 'https://example.com/gen-1.png',
  title: 'Generated Image',
  kind: 'image',
}

function renderPicker(overrides: Partial<React.ComponentProps<typeof ReferencePicker>> = {}) {
  const props = {
    position: { x: 100, y: 100 },
    uploads: [uploadAsset],
    imageGenerations: [imageGenAsset],
    videoGenerations: [],
    liked: [],
    onSelect: jest.fn(),
    onUploadNew: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  }
  render(<ReferencePicker {...props} />)
  return props
}

describe('ReferencePicker', () => {
  test('renders four tabs, Uploads tab content, upload control and asset selection', () => {
    const onSelect = jest.fn()
    const onUploadNew = jest.fn()
    renderPicker({ onSelect, onUploadNew })

    expect(screen.getByRole('tab', { name: 'Uploads' })).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Image Generations' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'Video Generations' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Liked' })).toBeInTheDocument()

    const uploadControl = screen.getByText('Upload media')
    fireEvent.click(uploadControl)
    expect(onUploadNew).toHaveBeenCalled()

    const card = screen.getByText('My Upload')
    expect(card).toBeInTheDocument()
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith(uploadAsset)
  })

  test('clicking the Image Generations tab shows an image generation asset', () => {
    renderPicker()

    expect(screen.queryByText('Generated Image')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Image Generations' }))

    expect(screen.getByText('Generated Image')).toBeInTheDocument()
  })
})
