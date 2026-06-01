import { render } from '@testing-library/react'
import { useRef } from 'react'
import { useReveal } from '@/components/client-documents/motion/useReveal'

const originalIntersectionObserver = globalThis.IntersectionObserver

function RevealFixture() {
  const ref = useRef<HTMLElement>(null)
  useReveal(ref, 'v1')
  return (
    <article ref={ref}>
      <section data-motion="reveal" data-testid="reveal-section">
        Tall proposal block
      </section>
    </article>
  )
}

afterEach(() => {
  globalThis.IntersectionObserver = originalIntersectionObserver
})

test('observes reveal blocks with a zero threshold so tall sections are not left hidden', () => {
  const observed: Element[] = []
  const optionsSeen: IntersectionObserverInit[] = []

  class IntersectionObserverMock {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = []

    constructor(_callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      optionsSeen.push(options ?? {})
    }

    observe(element: Element) {
      observed.push(element)
    }

    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }

  globalThis.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver

  render(<RevealFixture />)

  expect(observed).toHaveLength(1)
  expect(optionsSeen[0]).toMatchObject({ rootMargin: '0px 0px -10% 0px', threshold: 0 })
})

test('reveals blocks immediately when IntersectionObserver is unavailable', () => {
  globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver

  const { getByTestId } = render(<RevealFixture />)

  expect(getByTestId('reveal-section')).toHaveStyle({ opacity: '1', transform: 'translateY(0)' })
})
