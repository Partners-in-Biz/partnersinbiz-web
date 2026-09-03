import { render, screen, within } from '@testing-library/react'
import type React from 'react'
import ServicesIndexPage from '@/app/(public)/services/page'
import { SERVICE_CONTENT, SERVICE_ORDER, serviceMeta } from '@/lib/marketing/service-content'

jest.mock('@/components/marketing/Reveal', () => ({
  Reveal: ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

jest.mock('@/components/marketing/stage/ScrollCraft', () => ({
  ScrollCraft: () => null,
}))

describe('public services page', () => {
  it('links the services index into the Properties internal-link cluster', () => {
    render(<ServicesIndexPage />)

    expect(screen.getByRole('link', { name: /Partners in Biz Properties/i }))
      .toHaveAttribute('href', '/properties')
  })

  it('pins the six services in one filmstrip with six acts', () => {
    const { container } = render(<ServicesIndexPage />)

    const strip = container.querySelector('[data-sc-rebuild]')
    expect(strip).not.toBeNull()
    expect(strip).toHaveAttribute('aria-label', 'Everything we do, one at a time')

    const acts = (strip?.getAttribute('data-sc-acts') ?? '').split(',')
    expect(acts).toHaveLength(SERVICE_ORDER.length)
    expect(acts[0]).toBe('s1:0.0000')
    acts.forEach((act, i) => expect(act.startsWith(`s${i + 1}:`)).toBe(true))

    const slides = strip?.querySelectorAll('[data-sc-show]') ?? []
    expect(slides).toHaveLength(SERVICE_ORDER.length)
  })

  it('keeps every service, price, plate and link in the server HTML', () => {
    const { container } = render(<ServicesIndexPage />)
    const slides = Array.from(container.querySelectorAll('[data-sc-rebuild] [data-sc-show]'))

    SERVICE_ORDER.forEach((slug, i) => {
      const slide = within(slides[i] as HTMLElement)
      const content = SERVICE_CONTENT[slug]

      expect(slides[i]).toHaveAttribute('id', slug)
      expect(slide.getByRole('heading', { level: 2, name: content.headline })).toBeInTheDocument()
      expect(slide.getByText(content.price.label)).toBeInTheDocument()
      expect(slide.getByText(content.price.terms)).toBeInTheDocument()
      expect(slide.getByText(serviceMeta(slug).name, { exact: false })).toBeInTheDocument()
      expect(slide.getByRole('link', { name: 'What ships, how it runs, what it costs' })).toHaveAttribute(
        'href',
        `/services/${slug}`
      )

      const figure = slides[i].querySelector('figure')
      expect(figure).not.toBeNull()
      const img = figure?.querySelector('img')
      expect(img).not.toBeNull()
      expect(img?.getAttribute('alt')?.length ?? 0).toBeGreaterThan(10)
      expect(figure?.querySelector('figcaption')?.textContent?.length ?? 0).toBeGreaterThan(5)
    })

    expect(screen.getAllByRole('link', { name: 'What ships, how it runs, what it costs' })).toHaveLength(
      SERVICE_ORDER.length
    )
  })

  it('has one h1, h2 slides and no em dashes', () => {
    const { container } = render(<ServicesIndexPage />)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(SERVICE_ORDER.length)
    expect(container.textContent).not.toContain('\u2014')
  })
})
