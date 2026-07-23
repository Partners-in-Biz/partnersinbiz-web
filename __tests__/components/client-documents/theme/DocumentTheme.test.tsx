import { render } from '@testing-library/react'
import { DocumentTheme } from '@/components/client-documents/theme/DocumentTheme'

test('injects CSS vars from theme.palette', () => {
  const { container } = render(
    <DocumentTheme palette={{ bg: '#0A0A0B', text: '#F7F4EE', accent: '#F5A623' }}>
      <div data-testid="child">x</div>
    </DocumentTheme>,
  )
  const wrapper = container.firstChild as HTMLElement
  expect(wrapper.style.getPropertyValue('--doc-bg')).toBe('#0A0A0B')
  expect(wrapper.style.getPropertyValue('--doc-text')).toBe('#F7F4EE')
  expect(wrapper.style.getPropertyValue('--doc-accent')).toBe('#F5A623')
})

test('derives --doc-accent-soft from accent with alpha', () => {
  const { container } = render(
    <DocumentTheme palette={{ bg: '#000', text: '#fff', accent: '#F5A623' }}>
      <span />
    </DocumentTheme>,
  )
  const wrapper = container.firstChild as HTMLElement
  expect(wrapper.style.getPropertyValue('--doc-accent-soft')).toMatch(/^#f5a62326$/i)
})

test('falls back to PiB defaults when palette omits a field', () => {
  const { container } = render(
    <DocumentTheme palette={{ bg: '', text: '', accent: '' }}>
      <span />
    </DocumentTheme>,
  )
  const wrapper = container.firstChild as HTMLElement
  expect(wrapper.style.getPropertyValue('--doc-bg')).toBe('#0A0A0B')
  expect(wrapper.style.getPropertyValue('--doc-text')).toBe('#F7F4EE')
  expect(wrapper.style.getPropertyValue('--doc-accent')).toBe('#F5A623')
  expect(wrapper.style.getPropertyValue('--doc-surface')).toBe('#141416')
})

test('derives light surface/border/muted when bg is light and those fields are omitted', () => {
  const { container } = render(
    <DocumentTheme palette={{ bg: '#FFFFFF', text: '#111827', accent: '#D5A138' }}>
      <span />
    </DocumentTheme>,
  )
  const wrapper = container.firstChild as HTMLElement
  expect(wrapper.style.getPropertyValue('--doc-surface')).toBe('#F3F4F6')
  expect(wrapper.style.getPropertyValue('--doc-border')).toBe('#E5E7EB')
  expect(wrapper.style.getPropertyValue('--doc-muted')).toBe('#6B7280')
})

test('keeps dark surface defaults when bg is dark and surface is omitted', () => {
  const { container } = render(
    <DocumentTheme palette={{ bg: '#0B0B0C', text: '#F7F4EE', accent: '#D5A138' }}>
      <span />
    </DocumentTheme>,
  )
  const wrapper = container.firstChild as HTMLElement
  expect(wrapper.style.getPropertyValue('--doc-surface')).toBe('#141416')
})
