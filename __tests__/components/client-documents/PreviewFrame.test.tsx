import { render, screen } from '@testing-library/react'
import { PreviewFrame } from '@/components/client-documents/PreviewFrame'

test('renders back-to-editor link and children', () => {
  render(
    <PreviewFrame backHref="/admin/documents/abc" versionLabel="Draft · v3">
      <div data-testid="content">x</div>
    </PreviewFrame>,
  )
  const back = screen.getByRole('link', { name: /back to editor/i })
  expect(back.getAttribute('href')).toBe('/admin/documents/abc')
  expect(screen.getByTestId('content')).not.toBeNull()
})

test('keeps preview controls in the page flow instead of overlaying the admin chrome', () => {
  render(
    <PreviewFrame backHref="/admin/documents/abc" versionLabel="Draft · v3">
      <div />
    </PreviewFrame>,
  )

  const toolbar = screen.getByTestId('document-preview-toolbar')
  expect(toolbar.className).toContain('sticky')
  expect(toolbar.className).not.toContain('fixed')
})

test('shows shareUrl link when published prop is true', () => {
  render(
    <PreviewFrame backHref="/admin/documents/abc" versionLabel="v3" shareUrl="https://partnersinbiz.online/d/xyz">
      <span />
    </PreviewFrame>,
  )
  const link = screen.getByRole('link', { name: /open public share/i })
  expect(link.getAttribute('href')).toBe('https://partnersinbiz.online/d/xyz')
})

test('omits shareUrl link when not provided', () => {
  render(
    <PreviewFrame backHref="/admin/documents/abc" versionLabel="v3">
      <span />
    </PreviewFrame>,
  )
  expect(screen.queryByRole('link', { name: /open public share/i })).toBeNull()
})
