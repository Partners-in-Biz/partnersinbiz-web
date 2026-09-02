import Image from 'next/image'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { CASE_STUDIES } from '@/lib/seo/site'
import { ScrollCraft } from '@/components/marketing/stage/ScrollCraft'
import './work-pinned.css'

/**
 * The work index as a pinned-plate sequence. One sticky frame, one slide per
 * case study, keyed off --sc-p (ScrollCraft). Copy changes on the left while
 * the real screenshot plate swaps on the right. Every case is one act, so
 * `data-sc-act` names the case that is on. Below 860px, and under reduced
 * motion, the frame unsticks and the cases stack in order.
 */

type CaseStudy = (typeof CASE_STUDIES)[number]

/** Progress a slide fades over, as a share of --sc-p. */
const FADE = 0.02

/** Scroll span per case, in svh. Six cases is 390svh of travel. */
const SPAN_PER_CASE = 65

export const WORK_ACTS_ATTR = CASE_STUDIES.map((c, i) => `${c.slug}:${Number((i / CASE_STUDIES.length).toFixed(4))}`).join(',')

/**
 * The slice of --sc-p a slide owns. Neighbours meet at the act boundary with
 * both at zero, so the visibility switch on `data-sc-act` never shows.
 * The first slide is already on at p=0 and the last stays on through p=1.
 */
export function caseWindow(i: number, count: number): { s0: number; s1: number } {
  const width = 1 / count
  return {
    s0: i === 0 ? -FADE : width * i,
    s1: i === count - 1 ? 1 + FADE : width * (i + 1),
  }
}

/** Only the current act's slide is reachable on the sticky layout. */
function visibilityRules(cases: ReadonlyArray<CaseStudy>): string {
  const rules = cases
    .map((c) => `.wp-root[data-sc-act="${c.slug}"] .wp-slide[data-wp-case="${c.slug}"]{visibility:visible}`)
    .join('')
  return `@media (min-width: 861px) and (prefers-reduced-motion: no-preference){.wp-root .wp-slide{visibility:hidden}${rules}}`
}

export function WorkPinned() {
  const cases = CASE_STUDIES
  const count = cases.length

  return (
    <section
      className="wp-root"
      data-sc-rebuild
      data-sc-acts={WORK_ACTS_ATTR}
      data-sc-act={cases[0].slug}
      aria-label="Case studies"
      style={{ '--wp-fade': FADE, '--wp-span': `${count * SPAN_PER_CASE}svh` } as CSSProperties}
    >
      <ScrollCraft />
      <style>{visibilityRules(cases)}</style>
      <noscript>
        <style>{`.wp-root{--sc-p:1;height:auto}.wp-frame{position:relative;height:auto;overflow:visible}.wp-rail{display:none}.wp-slide{position:relative;inset:auto;opacity:1!important;clip-path:none!important;visibility:visible!important;transform:none!important;padding:calc(var(--sc-u) * 10) 0;border-top:1px solid var(--sc-line)}.wp-copy,.wp-plate{transform:none!important}`}</style>
      </noscript>

      <div className="wp-frame">
        <ol className="wp-rail sc-tiny" aria-hidden="true">
          {cases.map((c, i) => {
            const { s0, s1 } = caseWindow(i, count)
            return (
              <li key={c.slug} className="wp-rail__item" style={{ '--s0': s0, '--s1': s1 } as CSSProperties}>
                <span className="wp-rail__n">{String(i + 1).padStart(2, '0')}</span> {c.client}
              </li>
            )
          })}
        </ol>

        {cases.map((c, i) => {
          const { s0, s1 } = caseWindow(i, count)
          return (
            <article
              key={c.slug}
              className="wp-slide"
              data-wp-case={c.slug}
              style={{ '--s0': s0, '--s1': s1, '--k': i } as CSSProperties}
            >
              <div className="wp-copy">
                <p className="sc-tiny wp-meta">
                  <span className="wp-meta__n">{String(i + 1).padStart(2, '0')}</span>
                  {c.client}. {c.industry}. {c.year}.
                </p>
                <h2 className="wp-h2">{c.headline}</h2>
                <p className="sc-body wp-summary">{c.summary}</p>
                <ul className="wp-metrics">
                  {c.metrics.map((m) => (
                    <li key={m.label} className="wp-metric">
                      <strong className="wp-metric__value">{m.value}</strong>
                      <span className="wp-metric__label">{m.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="sc-body wp-more">
                  <Link href={c.href} prefetch={false} className="sc-link">
                    Read the case
                  </Link>
                </p>
              </div>
              <figure className="wp-plate">
                <Image
                  src={c.cover}
                  alt={`${c.client}: ${c.headline}`}
                  fill
                  sizes="(max-width: 860px) 90vw, 52vw"
                  priority={i === 0}
                />
              </figure>
            </article>
          )
        })}
      </div>
    </section>
  )
}
