import { render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScrollIn } from '@/components/marketing/paper/ScrollIn'

type ObserverCallback = (entries: Array<Partial<IntersectionObserverEntry>>) => void

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly callback: ObserverCallback
  observed: Element[] = []
  unobserve = jest.fn()
  disconnect = jest.fn()

  constructor(callback: ObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }

  observe(el: Element) {
    this.observed.push(el)
  }

  enter() {
    this.callback(this.observed.map((target) => ({ isIntersecting: true, target })))
  }
}

const originalObserver = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
const originalRect = HTMLElement.prototype.getBoundingClientRect

function stubRectTop(top: number) {
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
}

describe('ScrollIn', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true, writable: true })
  })

  afterEach(() => {
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = originalObserver
    HTMLElement.prototype.getBoundingClientRect = originalRect
  })

  it('renders children visible on the server with no motion state attribute', () => {
    const html = renderToStaticMarkup(
      <ScrollIn>
        <figure className="sc-plate">plate</figure>
      </ScrollIn>,
    )

    expect(html).toContain('class="sc-in"')
    expect(html).toContain('sc-plate')
    expect(html).toContain('plate')
    expect(html).not.toContain('data-sc-in')
  })

  it('reveals immediately when the element is already inside the viewport on mount', () => {
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver
    stubRectTop(200)

    render(
      <ScrollIn>
        <p>above the fold</p>
      </ScrollIn>,
    )

    const wrapper = screen.getByText('above the fold').parentElement
    expect(wrapper).toHaveAttribute('data-sc-in', 'in')
    expect(FakeIntersectionObserver.instances).toHaveLength(0)
  })

  it('holds below-the-fold content pending and reveals it when it intersects', () => {
    ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver
    stubRectTop(2000)

    render(
      <ScrollIn as="section" className="extra">
        <p>below the fold</p>
      </ScrollIn>,
    )

    const wrapper = screen.getByText('below the fold').parentElement as HTMLElement
    expect(wrapper.tagName).toBe('SECTION')
    expect(wrapper).toHaveClass('sc-in', 'extra')
    expect(wrapper).toHaveAttribute('data-sc-in', 'pending')
    expect(FakeIntersectionObserver.instances).toHaveLength(1)

    const observer = FakeIntersectionObserver.instances[0]
    observer.enter()

    expect(wrapper).toHaveAttribute('data-sc-in', 'in')
    expect(observer.unobserve).toHaveBeenCalledWith(wrapper)
  })

  it('reveals immediately when IntersectionObserver is unavailable', () => {
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver
    stubRectTop(2000)

    render(
      <ScrollIn>
        <p>no observer</p>
      </ScrollIn>,
    )

    expect(screen.getByText('no observer').parentElement).toHaveAttribute('data-sc-in', 'in')
  })
})
