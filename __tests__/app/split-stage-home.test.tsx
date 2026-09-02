import { render, screen, within } from '@testing-library/react'

import HomePage from '@/app/(public)/page'
import UsHomePage from '@/app/(public)/us/page'
import StartProjectPage from '@/app/(public)/start-a-project/page'
import { actFor, progressFor, STAGE_ACTS } from '@/components/marketing/stage/ScrollCraft'
import { isStageRoute } from '@/lib/marketing/stage-routes'

const redirectMock = jest.fn((href: string) => {
  throw new Error(`NEXT_REDIRECT:${href}`)
})

jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  redirect: (href: string) => redirectMock(href),
  usePathname: () => '/',
}))

const US_PRICE_STRINGS = ['$9,500', '$4,500', '90-Day Fill'] as const
const ZA_PRICE_STRING = 'R35,000'
const CTA = 'Book a 20-min call'

/** Visible text plus inline JSON-LD, so a leaked price in schema fails too. */
function allText(container: HTMLElement): string {
  return container.textContent ?? ''
}

describe('start-a-project redirects to the scheduler', () => {
  beforeEach(() => redirectMock.mockClear())

  it('redirects a plain visit to /book-a-call', async () => {
    await expect(StartProjectPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/book-a-call')
    expect(redirectMock).toHaveBeenCalledWith('/book-a-call')
  })

  it('carries a known market hint across to the scheduler', async () => {
    await expect(
      StartProjectPage({ searchParams: Promise.resolve({ market: 'us', offer: '4-week-site' } as { market?: string }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/book-a-call?market=us')
  })

  it('drops an unknown market hint', async () => {
    await expect(StartProjectPage({ searchParams: Promise.resolve({ market: 'mars' }) })).rejects.toThrow(
      'NEXT_REDIRECT:/book-a-call',
    )
    expect(redirectMock).toHaveBeenCalledWith('/book-a-call')
  })
})

describe('/ is the ZA stage only', () => {
  it('never renders a US price string', () => {
    const { container } = render(<HomePage />)
    const text = allText(container)
    for (const usPrice of US_PRICE_STRINGS) {
      expect(text).not.toContain(usPrice)
    }
    expect(text).toContain(ZA_PRICE_STRING)
  })

  it('lands 50/50 with both headlines in the document at once', () => {
    render(<HomePage />)
    expect(screen.getByRole('heading', { level: 1, name: 'You have a site. The phone is quiet.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'A marketing site from R35,000' })).toBeInTheDocument()
    expect(screen.getByText('Yours in 2 to 4 weeks. You own it.')).toBeInTheDocument()
  })

  it('uses running-text CTAs that all point at the existing scheduler', () => {
    render(<HomePage />)
    const ctas = screen.getAllByRole('link', { name: CTA })
    expect(ctas.length).toBeGreaterThanOrEqual(2)
    for (const cta of ctas) {
      expect(cta).toHaveAttribute('href', '/book-a-call')
      expect(cta.tagName).toBe('A')
    }
  })

  it('has no jump nav, only tiny ZA / US text links plus privacy and terms in the colophon', () => {
    const { container } = render(<HomePage />)
    expect(container.querySelector('a[href^="#"]')).toBeNull()
    const region = screen.getAllByRole('navigation', { name: 'Region' })[0]
    expect(within(region).getByRole('link', { name: 'ZA' })).toHaveAttribute('aria-current', 'page')
    expect(within(region).getByRole('link', { name: 'US' })).toHaveAttribute('href', '/us')
    const colophon = screen.getByRole('contentinfo', { name: 'Colophon' })
    expect(within(colophon).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy-policy')
    expect(within(colophon).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms-of-service')
    for (const forbidden of ['/about', '/services', '/work', '/pricing', '/faq', '/insights', '/tools', '/start-a-project']) {
      expect(container.querySelector(`a[href="${forbidden}"]`)).toBeNull()
    }
  })

  it('mounts the rebuild stage with the ten committed stills', () => {
    const { container } = render(<HomePage />)
    const stage = container.querySelector('[data-sc-rebuild]')
    expect(stage).not.toBeNull()
    const srcs = Array.from(container.querySelectorAll('img')).map((img) => decodeURIComponent(img.getAttribute('src') ?? ''))
    for (const name of [
      'dead-interior.png',
      'dead-welcome.png',
      'storefront-before.png',
      'storefront-after.png',
      'keys-desk.png',
      'tape-draw.png',
      'rebuild-scrub.png',
      'collapse-paper.png',
    ]) {
      expect(srcs.some((src) => src.includes(`/marketing/${name}`))).toBe(true)
    }
    expect(srcs.some((src) => src.includes('city-grid-night.png'))).toBe(false)
  })

  it('writes no em dashes into the copy', () => {
    const { container } = render(<HomePage />)
    expect(allText(container)).not.toContain('\u2014')
  })
})

describe('/us is the US stage only', () => {
  it('never renders the ZA price string', () => {
    const { container } = render(<UsHomePage />)
    const text = allText(container)
    expect(text).not.toContain(ZA_PRICE_STRING)
    for (const usPrice of US_PRICE_STRINGS) {
      expect(text).toContain(usPrice)
    }
  })

  it('lands with both headlines and the 28-day dek', () => {
    render(<UsHomePage />)
    expect(screen.getByRole('heading', { level: 1, name: 'You have a site. The phone is quiet.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'The 4-Week Site' })).toBeInTheDocument()
    expect(screen.getByText('$9,500. Yours in 28 days.')).toBeInTheDocument()
  })

  it('keeps the retainer small and points every CTA at the scheduler with the US hint', () => {
    const { container } = render(<UsHomePage />)
    for (const cta of screen.getAllByRole('link', { name: CTA })) {
      expect(cta).toHaveAttribute('href', '/book-a-call?market=us')
    }
    const retainer = screen.getByText(/\$2,500 a month/)
    expect(retainer.className).toContain('sc-close__small')
    expect(container.querySelector('img[src*="city-grid-night"]')).not.toBeNull()
    expect(container.querySelector('img[src*="keys-desk"]')).toBeNull()
    expect(allText(container)).not.toContain('\u2014')
  })
})

describe('scroll-craft progress', () => {
  it('maps the sticky span to 0..1 and clamps outside it', () => {
    const viewport = 800
    const height = 800 + 5600
    expect(progressFor(0, height, viewport)).toBe(0)
    expect(progressFor(200, height, viewport)).toBe(0)
    expect(progressFor(-2800, height, viewport)).toBeCloseTo(0.5)
    expect(progressFor(-5600, height, viewport)).toBe(1)
    expect(progressFor(-9000, height, viewport)).toBe(1)
    expect(progressFor(0, 400, viewport)).toBe(0)
  })

  it('walks the six acts in order, with the peak as the largest span', () => {
    expect(actFor(0, STAGE_ACTS)).toBe('recognition')
    expect(actFor(0.1, STAGE_ACTS)).toBe('unease')
    expect(actFor(0.3, STAGE_ACTS)).toBe('relief')
    expect(actFor(0.5, STAGE_ACTS)).toBe('silence')
    expect(actFor(0.7, STAGE_ACTS)).toBe('peak')
    expect(actFor(1, STAGE_ACTS)).toBe('resolve')

    const spans = STAGE_ACTS.map(([name, start], i) => [name, (STAGE_ACTS[i + 1]?.[1] ?? 1) - start] as const)
    const widest = spans.reduce((a, b) => (b[1] > a[1] ? b : a))
    expect(widest[0]).toBe('peak')
  })

  it('knows which routes carry their own chrome', () => {
    expect(isStageRoute('/')).toBe(true)
    expect(isStageRoute('/us')).toBe(true)
    expect(isStageRoute('/book-a-call')).toBe(true)
    expect(isStageRoute('/uk')).toBe(false)
    expect(isStageRoute('/about')).toBe(false)
    expect(isStageRoute(null)).toBe(false)
  })
})
