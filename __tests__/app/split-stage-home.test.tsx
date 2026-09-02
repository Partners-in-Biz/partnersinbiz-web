import { render, screen, within } from '@testing-library/react'

import HomePage from '@/app/(public)/page'
import UsHomePage from '@/app/(public)/us/page'
import StartProjectPage from '@/app/(public)/start-a-project/page'
import { actFor, progressFor, STAGE_ACTS } from '@/components/marketing/stage/ScrollCraft'
import { STUDIO_ACTS_ATTR } from '@/components/marketing/stage/StudioStage'
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

function imageSources(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('img')).map((img) => decodeURIComponent(img.getAttribute('src') ?? ''))
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

describe('/ is the ZA studio stage', () => {
  it('never renders a US price string', () => {
    const { container } = render(<HomePage />)
    const text = allText(container)
    for (const usPrice of US_PRICE_STRINGS) {
      expect(text).not.toContain(usPrice)
    }
    expect(text).toContain(ZA_PRICE_STRING)
  })

  it('opens on the firm, not a parody, with the price one act later', () => {
    const { container } = render(<HomePage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Software that brings in clients.' })).toBeInTheDocument()
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(container.querySelector('h1')?.textContent).not.toContain(ZA_PRICE_STRING)
    expect(allText(container)).not.toContain('Welcome to our website')
    expect(allText(container)).not.toContain('Hit counter')
    const price = screen.getByText('From R35,000')
    expect(price.className).toContain('sh-slide__price')
  })

  it('shows the four things we build, each with a price, a real plate and a door to its page', () => {
    const { container } = render(<HomePage />)
    const slides = container.querySelectorAll('.sh-slide')
    expect(slides).toHaveLength(4)
    const hrefs = Array.from(slides).map((s) => s.querySelector('a')?.getAttribute('href'))
    expect(hrefs).toEqual([
      '/services/web-development',
      '/services/web-applications',
      '/services/mobile-apps',
      '/services/ai-integration',
    ])
    for (const slide of slides) {
      expect(slide.querySelector('.sh-slide__price')?.textContent).toMatch(/^From R[\d,]+$/)
      expect(slide.querySelector('figure img')).not.toBeNull()
      expect(slide.querySelector('figcaption')?.textContent).toMatch(/\./)
    }
  })

  it('puts real names on the proof', () => {
    render(<HomePage />)
    expect(screen.getByRole('heading', { level: 2, name: 'Real names. Real numbers.' })).toBeInTheDocument()
    for (const credit of ['AHS Law, Pretoria', 'Loyalty Plus', 'Athleet', 'Velox and Lumen']) {
      expect(screen.getByText(credit)).toBeInTheDocument()
    }
  })

  it('closes with the process and the three anchors', () => {
    const { container } = render(<HomePage />)
    expect(screen.getByRole('heading', { level: 2, name: 'How it goes.' })).toBeInTheDocument()
    expect(container.querySelectorAll('.sh-step')).toHaveLength(4)
    const anchors = Array.from(container.querySelectorAll('.sh-anchor__price')).map((a) => a.textContent)
    expect(anchors).toEqual(['from R35,000', 'from R120,000', 'from R15,000 a month'])
  })

  it('uses one CTA label and every CTA points at the scheduler', () => {
    render(<HomePage />)
    const ctas = screen.getAllByRole('link', { name: CTA })
    expect(ctas.length).toBeGreaterThanOrEqual(3)
    for (const cta of ctas) {
      expect(cta).toHaveAttribute('href', '/book-a-call')
      expect(cta.tagName).toBe('A')
    }
  })

  it('carries the firm nav in the chrome, ZA / US region links, and the colophon links', () => {
    const { container } = render(<HomePage />)
    expect(container.querySelector('a[href^="#"]')).toBeNull()
    const primary = screen.getByRole('navigation', { name: 'Primary' })
    for (const [name, href] of [
      ['Services', '/services'],
      ['Work', '/work'],
      ['Pricing', '/pricing'],
      ['About', '/about'],
    ]) {
      expect(within(primary).getByRole('link', { name })).toHaveAttribute('href', href)
    }
    const region = screen.getAllByRole('navigation', { name: 'Region' })[0]
    expect(within(region).getByRole('link', { name: 'ZA' })).toHaveAttribute('aria-current', 'page')
    expect(within(region).getByRole('link', { name: 'US' })).toHaveAttribute('href', '/us')
    const colophon = screen.getByRole('contentinfo', { name: 'Colophon' })
    expect(within(colophon).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy-policy')
    expect(within(colophon).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms-of-service')
    expect(within(colophon).getByRole('link', { name: 'Everything we do' })).toHaveAttribute('href', '/services')
  })

  it('mounts the studio stage with real work shots only', () => {
    const { container } = render(<HomePage />)
    const stage = container.querySelector('[data-sc-rebuild]')
    expect(stage).not.toBeNull()
    expect(stage?.getAttribute('data-sc-acts')).toBe(STUDIO_ACTS_ATTR)
    const srcs = imageSources(container)
    expect(srcs.length).toBeGreaterThanOrEqual(7)
    for (const src of srcs) {
      expect(src).toMatch(/\/images\/shot-[a-z-]+\.jpg/)
      expect(src).not.toContain('/marketing/')
    }
    expect(srcs.some((src) => src.includes('/images/shot-ahs-law.jpg'))).toBe(true)
  })

  it('writes no em dashes into the copy', () => {
    const { container } = render(<HomePage />)
    expect(allText(container)).not.toContain('\u2014')
  })
})

describe('/us is the US studio stage', () => {
  it('never renders the ZA price string', () => {
    const { container } = render(<UsHomePage />)
    const text = allText(container)
    expect(text).not.toContain(ZA_PRICE_STRING)
    for (const usPrice of US_PRICE_STRINGS) {
      expect(text).toContain(usPrice)
    }
  })

  it('opens on the 28-day promise and prices the two offers one act later', () => {
    const { container } = render(<UsHomePage />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'A site that makes the phone ring. Live in 28 days.' }),
    ).toBeInTheDocument()
    const prices = Array.from(container.querySelectorAll('.sh-slide__price')).map((p) => p.textContent)
    expect(prices.slice(0, 2)).toEqual(['$9,500', '$4,500'])
  })

  it('points every CTA at the scheduler with the US hint and keeps the retainer an anchor', () => {
    const { container } = render(<UsHomePage />)
    for (const cta of screen.getAllByRole('link', { name: CTA })) {
      expect(cta).toHaveAttribute('href', '/book-a-call?market=us')
    }
    const anchors = Array.from(container.querySelectorAll('.sh-anchor__price')).map((a) => a.textContent)
    expect(anchors).toContain('$2,500 a month')
    for (const src of imageSources(container)) {
      expect(src).not.toContain('/marketing/')
    }
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

  it('walks the default six acts in order, with the peak as the largest span', () => {
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

  it('walks the studio acts in order, with the filmstrip as the largest span', () => {
    const acts = STUDIO_ACTS_ATTR.split(',').map((pair) => {
      const [name, start] = pair.split(':')
      return [name, Number(start)] as const
    })
    expect(actFor(0, acts)).toBe('open')
    expect(actFor(0.3, acts)).toBe('work')
    expect(actFor(0.7, acts)).toBe('proof')
    expect(actFor(1, acts)).toBe('close')
    const spans = acts.map(([name, start], i) => [name, (acts[i + 1]?.[1] ?? 1) - start] as const)
    const widest = spans.reduce((a, b) => (b[1] > a[1] ? b : a))
    expect(widest[0]).toBe('work')
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
