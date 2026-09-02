import Image from 'next/image'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { NAV, SITE } from '@/lib/seo/site'
import type { StageStill } from '@/lib/marketing/stage-content'
import type { StudioContent } from '@/lib/marketing/studio-content'
import { ScrollCraft } from './ScrollCraft'
import { MarketLinks, Wordmark } from './StageChrome'
import './stage.css'
import './studio.css'

/**
 * The Studio. One sticky frame, four acts, keyed off --sc-p (ScrollCraft).
 *
 *   open   0.00  the firm in one line; three real shots slide in
 *   work   0.16  a filmstrip of four things we build, plate pinned right
 *   proof  0.58  the ink panel rises with four numbers and names
 *   close  0.80  how it goes, the anchors, one CTA
 *
 * Below 860px the frame unsticks and the acts stack in order.
 */

export const STUDIO_ACTS_ATTR = 'open:0,work:0.16,proof:0.58,close:0.8'

/** Filmstrip slice per slide. The last slide holds until the ink panel covers it. */
function slideWindow(i: number, count: number): { s0: number; s1: number } {
  const start = 0.16
  const end = 0.62
  const width = (end - start) / count
  return { s0: start + width * i, s1: i === count - 1 ? end : start + width * (i + 1) }
}

function Shot({ still, sizes, priority = false }: { still: StageStill; sizes: string; priority?: boolean }) {
  return <Image src={still.src} alt={still.alt} fill sizes={sizes} priority={priority} />
}

export function StudioStage({ content }: { content: StudioContent }) {
  const { hero, work, proof, close, colophon } = content
  const waHref = `https://wa.me/${SITE.whatsapp.replace(/\D/g, '')}`

  return (
    <main className="sc-stage sh-stage" data-market={content.market}>
      <ScrollCraft />
      <noscript>
        <style>{`.sh-root{--sc-p:1;height:auto}.sh-frame{position:relative;height:auto}.sh-act,.sh-slide{position:relative;opacity:1!important;transform:none!important}`}</style>
      </noscript>

      <section className="sh-root" data-sc-rebuild data-sc-acts={STUDIO_ACTS_ATTR} data-sc-act="open" aria-label="Partners in Biz">
        <div className="sh-frame">
          <header className="sh-chrome">
            <Wordmark href={content.path} />
            <nav className="sh-chrome__nav sc-tiny" aria-label="Primary">
              <ul>
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} prefetch={false} className="sc-link">
                      {item.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href={content.bookHref} prefetch={false} className="sc-cta sh-chrome__cta">
                    {content.cta}
                  </Link>
                </li>
              </ul>
            </nav>
            <div className="sh-chrome__markets">
              <MarketLinks current={content.market} />
            </div>
          </header>

          {/* 1 Open */}
          <div className="sh-act sh-open" data-sc-show="open">
            <div className="sh-open__copy">
              <p className="sc-tiny">{hero.kicker}</p>
              <h1 className="sh-h1">{hero.h1}</h1>
              <p className="sc-dek sh-open__dek">{hero.dek}</p>
              <p className="sc-body sh-open__cta">
                <Link href={content.bookHref} prefetch={false} className="sc-cta">
                  {content.cta}
                </Link>
                {'. Or see '}
                <Link href="/work" prefetch={false} className="sc-link">
                  the work
                </Link>
                .
              </p>
            </div>
            <div className="sh-open__art" aria-hidden="false">
              <div className="sh-block" aria-hidden="true" />
              {hero.shots.map((shot, i) => (
                <figure key={shot.src} className="sh-shot sh-open__shot" style={{ '--k': i } as CSSProperties}>
                  <Shot still={shot} sizes="(max-width: 860px) 80vw, 34vw" priority={i === 0} />
                </figure>
              ))}
            </div>
          </div>

          {/* 2 Work: the filmstrip */}
          <div className="sh-act sh-work" data-sc-show="work">
            <p className="sc-tiny sh-work__kicker">{work.kicker}</p>
            <ol className="sh-rail sc-tiny" aria-hidden="true">
              {work.slides.map((slide, i) => {
                const { s0, s1 } = slideWindow(i, work.slides.length)
                return (
                  <li key={slide.index} className="sh-rail__item" style={{ '--s0': s0, '--s1': s1 } as CSSProperties}>
                    {slide.index} {slide.service}
                  </li>
                )
              })}
            </ol>
            {work.slides.map((slide, i) => {
              const { s0, s1 } = slideWindow(i, work.slides.length)
              return (
                <article key={slide.index} className="sh-slide" style={{ '--s0': s0, '--s1': s1, '--k': i } as CSSProperties}>
                  <div className="sh-slide__copy">
                    <p className="sc-tiny sh-slide__service">
                      <span className="sh-slide__index">{slide.index}</span> {slide.service}
                    </p>
                    <h2 className="sh-h2">{slide.h2}</h2>
                    <p className="sc-body sh-slide__line">{slide.line}</p>
                    <p className="sh-slide__price">{slide.price}</p>
                    <p className="sc-body sh-slide__terms">{slide.terms}</p>
                    <p className="sc-body">
                      <Link href={slide.href} prefetch={false} className="sc-link">
                        What ships and how it runs
                      </Link>
                    </p>
                  </div>
                  <figure className="sh-shot sh-slide__plate">
                    <Shot still={slide.shot} sizes="(max-width: 860px) 90vw, 52vw" />
                    <figcaption className="sc-tiny sh-slide__credit">{slide.credit}</figcaption>
                  </figure>
                </article>
              )
            })}
          </div>

          {/* 3 Proof: the ink panel */}
          <div className="sh-act sh-ink" data-sc-show="proof">
            <div className="sh-ink__inner">
              <div className="sh-ink__head">
                <h2 className="sh-h2 sh-ink__h2">{proof.h2}</h2>
                <p className="sc-dek sh-ink__dek">{proof.dek}</p>
              </div>
              <ul className="sh-stats">
                {proof.stats.map((stat, i) => (
                  <li key={stat.credit} className="sh-stat" style={{ '--k': i } as CSSProperties}>
                    <p className="sh-stat__n">{stat.n}</p>
                    <p className="sc-body sh-stat__line">{stat.line}</p>
                    <p className="sc-tiny sh-stat__credit">{stat.credit}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 4 Close */}
          <div className="sh-act sh-close" data-sc-show="close">
            <div className="sh-close__how">
              <h2 className="sh-h2">{close.h2}</h2>
              <ol className="sh-steps">
                {close.steps.map((step, i) => (
                  <li key={step} className="sc-body sh-step" style={{ '--k': i } as CSSProperties}>
                    <span className="sh-step__n" aria-hidden="true">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
            <div className="sh-close__offer">
              <ul className="sh-anchors">
                {close.anchors.map((a) => (
                  <li key={a.label} className="sh-anchor">
                    <span className="sc-tiny">{a.label}</span>
                    <span className="sh-anchor__price">{a.price}</span>
                  </li>
                ))}
              </ul>
              <p className="sc-dek sh-close__statement">{close.statement}</p>
              <p className="sc-body sh-close__cta">
                {close.ctaLead}{' '}
                <Link href={content.bookHref} prefetch={false} className="sc-cta">
                  {content.cta}
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="sh-colophon" aria-label="Colophon">
        <div className="sh-colophon__inner">
          <p className="sc-body" style={{ color: 'var(--sc-ink)' }}>
            {colophon.place}{' '}
            <Link href={content.bookHref} prefetch={false} className="sc-cta">
              {content.cta}
            </Link>
            .
          </p>
          <p className="sc-body sh-colophon__note">
            {colophon.note}{' '}
            <Link href={colophon.servicesHref} prefetch={false} className="sc-cta">
              {colophon.servicesLabel}
            </Link>
            .
          </p>
          <ul className="sh-colophon__row sc-tiny">
            <li>
              <a href={waHref} className="sc-link" rel="noopener noreferrer">
                WhatsApp
              </a>
            </li>
            <li>
              <a href={`mailto:${SITE.email}`} className="sc-link">
                {SITE.email}
              </a>
            </li>
            <li>
              <Link href="/privacy-policy" prefetch={false} className="sc-link">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/terms-of-service" prefetch={false} className="sc-link">
                Terms
              </Link>
            </li>
            <li>
              <MarketLinks current={content.market} variant="inline" />
            </li>
          </ul>
        </div>
      </footer>
    </main>
  )
}
