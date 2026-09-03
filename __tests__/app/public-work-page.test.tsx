import { render, screen, within } from '@testing-library/react'

import WorkIndexPage from '@/app/(public)/work/page'
import { CASE_STUDIES } from '@/lib/seo/site'
import { WORK_SHOTS } from '@/lib/marketing/stage-content'
import { actFor } from '@/components/marketing/stage/ScrollCraft'
import { caseWindow, WORK_ACTS_ATTR } from '@/components/marketing/paper/WorkPinned'

function imageSources(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('img')).map((img) => decodeURIComponent(img.getAttribute('src') ?? ''))
}

describe('/work is a pinned-plate sequence over the case studies', () => {
  it('keeps one h1 and gives every case its own h2 headline', () => {
    const { container } = render(<WorkIndexPage />)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    for (const c of CASE_STUDIES) {
      expect(screen.getByRole('heading', { level: 2, name: c.headline })).toBeInTheDocument()
    }
    const caseHeadings = Array.from(container.querySelectorAll('.wp-slide h2')).map((h) => h.textContent)
    expect(caseHeadings).toEqual(CASE_STUDIES.map((c) => c.headline))
  })

  it('ships every case in the server HTML: meta line, summary, metrics, and a door to the case', () => {
    const { container } = render(<WorkIndexPage />)
    const slides = Array.from(container.querySelectorAll<HTMLElement>('.wp-slide'))
    expect(slides).toHaveLength(CASE_STUDIES.length)

    slides.forEach((slide, i) => {
      const c = CASE_STUDIES[i]
      expect(slide.getAttribute('data-wp-case')).toBe(c.slug)
      expect(slide.textContent).toContain(`${c.client}. ${c.industry}. ${c.year}.`)
      expect(slide.textContent).toContain(c.summary)
      for (const m of c.metrics) {
        expect(within(slide).getByText(m.value)).toBeInTheDocument()
        expect(within(slide).getByText(m.label)).toBeInTheDocument()
      }
      const link = within(slide).getByRole('link', { name: 'Read the case' })
      expect(link).toHaveAttribute('href', c.href)
      expect(link.className).toContain('sc-link')
    })

    const doors = screen.getAllByRole('link', { name: 'Read the case' })
    expect(doors.map((a) => a.getAttribute('href'))).toEqual(CASE_STUDIES.map((c) => c.href))
  })

  it('pins one real screenshot per case with honest alt text', () => {
    const { container } = render(<WorkIndexPage />)
    const slides = Array.from(container.querySelectorAll<HTMLElement>('.wp-slide'))
    slides.forEach((slide, i) => {
      const c = CASE_STUDIES[i]
      const srcs = imageSources(slide)
      expect(srcs).toHaveLength(1)
      expect(srcs[0]).toContain(c.cover)
      expect(c.cover).toMatch(/^\/images\/shot-[a-z-]+\.jpg$/)
      expect(slide.querySelector('figure img')?.getAttribute('alt')).toBe(`${c.client}: ${c.headline}`)
    })
  })

  it('never renders a generated still: every image is a captured shot', () => {
    const { container } = render(<WorkIndexPage />)
    const srcs = imageSources(container)
    expect(srcs.length).toBeGreaterThan(0)
    for (const src of srcs) {
      expect(src).not.toContain('case-')
      expect(src).toContain('/images/shot-')
    }
  })

  it('gives the head its one terracotta block behind a real plate with a credit', () => {
    const { container } = render(<WorkIndexPage />)
    const head = container.querySelector<HTMLElement>('.sc-article__head--plated')
    expect(head).not.toBeNull()
    expect(container.querySelectorAll('.sc-block')).toHaveLength(1)
    const plate = head?.querySelector('.sc-plate--wide')
    expect(plate).not.toBeNull()
    expect(imageSources(plate as ParentNode)[0]).toContain(WORK_SHOTS.ahsLaw.src)
    expect(plate?.querySelector('img')?.getAttribute('alt')).toBe(WORK_SHOTS.ahsLaw.alt)
    expect(plate?.querySelector('figcaption')?.textContent).toMatch(/^AHS Law\./)
  })

  it('names each slide as its own act so ScrollCraft can make the others inert', () => {
    const { container } = render(<WorkIndexPage />)
    const slides = Array.from(container.querySelectorAll<HTMLElement>('.wp-slide'))
    expect(slides.map((s) => s.getAttribute('data-sc-show'))).toEqual(CASE_STUDIES.map((c) => c.slug))
  })

  it('mounts the scroll stage with one act per case, in order', () => {
    const { container } = render(<WorkIndexPage />)
    const stage = container.querySelector<HTMLElement>('[data-sc-rebuild]')
    expect(stage).not.toBeNull()
    expect(stage?.getAttribute('aria-label')).toBe('Case studies')
    expect(stage?.getAttribute('data-sc-acts')).toBe(WORK_ACTS_ATTR)
    expect(stage?.getAttribute('data-sc-act')).toBe(CASE_STUDIES[0].slug)

    const acts = (stage?.getAttribute('data-sc-acts') ?? '').split(',').map((pair) => {
      const [name, start] = pair.split(':')
      return [name, Number(start)] as const
    })
    expect(acts).toHaveLength(CASE_STUDIES.length)
    expect(acts.map(([name]) => name)).toEqual(CASE_STUDIES.map((c) => c.slug))
    expect(acts[0][1]).toBe(0)
    for (let i = 1; i < acts.length; i += 1) {
      expect(acts[i][1]).toBeGreaterThan(acts[i - 1][1])
    }
    expect(actFor(0, acts)).toBe(CASE_STUDIES[0].slug)
    expect(actFor(1, acts)).toBe(CASE_STUDIES[CASE_STUDIES.length - 1].slug)
  })

  it('opens on the first case, holds the last one through the end, and crossfades at every act boundary', () => {
    const n = CASE_STUDIES.length
    const first = caseWindow(0, n)
    const last = caseWindow(n - 1, n)
    expect(first.s0).toBeLessThan(0)
    expect(last.s1).toBeGreaterThan(1)
    for (let i = 1; i < n; i += 1) {
      const boundary = i / n
      const outgoing = caseWindow(i - 1, n)
      const incoming = caseWindow(i, n)
      // Windows overlap, and the overlap is centred on the act boundary, so
      // neither slide is ever at zero while the other is still coming in.
      expect(incoming.s0).toBeLessThan(outgoing.s1)
      expect((incoming.s0 + outgoing.s1) / 2).toBeCloseTo(boundary)
    }
  })

  it('keeps the page head and the closing CTA sentence', () => {
    render(<WorkIndexPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Real builds. Real names.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'What clients say' })).toBeInTheDocument()
    for (const cta of screen.getAllByRole('link', { name: 'Book a 20-min call' })) {
      expect(cta).toHaveAttribute('href', '/book-a-call')
    }
  })

  it('writes no em dashes into the copy', () => {
    const { container } = render(<WorkIndexPage />)
    expect(container.textContent).not.toContain('\u2014')
  })
})
