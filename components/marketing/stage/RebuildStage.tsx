import Image from 'next/image'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { SITE } from '@/lib/seo/site'
import { STAGE_STILLS, type StageContent, type StageStill, type StageTell } from '@/lib/marketing/stage-content'
import { ScrollCraft, STAGE_ACTS_ATTR } from './ScrollCraft'
import { MarketLinks, Wordmark } from './StageChrome'
import './stage.css'

/**
 * The Rebuild. One sticky frame, two cells, one panel whose edge is the divider.
 * Scroll is the contractor: CSS reads --sc-p and keys every act off it.
 *
 *   1 Recognition  50/50, both headlines readable
 *   2 Unease       the dead side fills with amateur tells
 *   3 Relief       the owned side rebuilds in place
 *   4 Silence      empty paper, divider still 50/50
 *   5 Peak         the largest span
 *   6 Resolve      the divider collapses, the owned side takes the frame
 */

function Still({
  still,
  sizes,
  priority = false,
  className = '',
}: {
  still: StageStill
  sizes: string
  priority?: boolean
  className?: string
}) {
  return (
    <Image
      src={still.src}
      alt={still.alt}
      fill
      sizes={sizes}
      priority={priority}
      className={className}
    />
  )
}

function Tell({ tell, index }: { tell: StageTell; index: number }) {
  const style = { '--t': (index * 0.11).toFixed(2) } as CSSProperties
  switch (tell.kind) {
    case 'shout':
      return <li className="sc-tell sc-tell--shout" style={style}>{tell.text}</li>
    case 'menu':
      return <li className="sc-tell sc-tell--menu" style={style}>{tell.text}</li>
    case 'filler':
      return <li className="sc-tell" style={style}>{tell.text}</li>
    case 'broken':
      return (
        <li className="sc-tell sc-tell--broken" style={style} aria-hidden="true">
          [{tell.text}]
        </li>
      )
    case 'photo':
      return (
        <li className="sc-tell sc-tell--photo" style={style}>
          <div className="sc-photo sc-photo--dead">
            <Still still={tell.still} sizes="(max-width: 700px) 60vw, 24rem" />
          </div>
        </li>
      )
    case 'meta':
      return <li className="sc-tell sc-tell--menu" style={style}>{tell.text}</li>
  }
}

export function RebuildStage({ content }: { content: StageContent }) {
  const { dead, own, peak, close, colophon } = content
  const waHref = `https://wa.me/${SITE.whatsapp.replace(/\D/g, '')}`

  return (
    <main className="sc-stage" data-market={content.market}>
      <ScrollCraft />
      <noscript>
        <style>{`.sc-rebuild{--sc-p:1;height:auto}.sc-frame{position:relative}.sc-close{pointer-events:auto}`}</style>
      </noscript>

      <section
        className="sc-rebuild"
        data-sc-rebuild
        data-sc-acts={STAGE_ACTS_ATTR}
        data-sc-act="recognition"
        aria-label="The rebuild"
      >
        <div className="sc-frame">
          <Wordmark href={content.path} />
          <div className="sc-chrome">
            <MarketLinks current={content.market} />
          </div>

          {/* Left: the site they have. */}
          <div className="sc-cell sc-cell--dead">
            <div className="sc-dead-copy" data-sc-show="recognition,unease,relief">
              <h1 className="sc-h1">{dead.h1}</h1>
              <div className="sc-photo sc-photo--dead sc-photo--hero">
                <Still still={STAGE_STILLS.deadInterior} sizes="22rem" priority />
              </div>
              <ul className="sc-dead-list" aria-label="What the current site says">
                {dead.tells.map((tell, i) => (
                  <Tell key={i} tell={tell} index={i} />
                ))}
              </ul>
            </div>

            <div className="sc-peak-photo" aria-hidden="true">
              <div className="sc-photo">
                <Still still={peak.still} sizes="(max-width: 700px) 100vw, 50vw" />
              </div>
            </div>
          </div>

          {/* The owned panel. Its edge is the divider. */}
          <div className="sc-panel" aria-hidden="true" />

          {/* Right: the site they leave with. */}
          <div className="sc-cell sc-cell--own">
            <div className="sc-own-copy" data-sc-show="recognition,unease,relief">
              <div>
                <h1 className="sc-h1">{own.h1}</h1>
                <p className="sc-dek">{own.dek}</p>
              </div>

              <div className="sc-wipe sc-photo">
                <div className="sc-wipe__layer">
                  <Still still={STAGE_STILLS.rebuildScrub} sizes="(max-width: 700px) 60vw, 22rem" />
                </div>
                <div className="sc-wipe__layer sc-wipe__stage1">
                  <Still still={STAGE_STILLS.deadWelcome} sizes="(max-width: 700px) 60vw, 22rem" priority />
                </div>
                <div className="sc-wipe__layer sc-wipe__reveal">
                  <div className="sc-wipe__inner">
                    <Still still={STAGE_STILLS.storefrontAfter} sizes="(max-width: 700px) 60vw, 22rem" />
                  </div>
                </div>
              </div>

              <ul className="sc-own-lines sc-body">
                {own.lines.map((line, i) => (
                  <li key={line} className="sc-line" style={{ '--i': i } as CSSProperties}>
                    {line}
                  </li>
                ))}
                <li className="sc-line" style={{ '--i': own.lines.length } as CSSProperties}>
                  <strong>{own.ownership}</strong>
                </li>
                <li className="sc-line" style={{ '--i': own.lines.length + 1 } as CSSProperties}>
                  <Link href={content.bookHref} prefetch={false} className="sc-cta">
                    {content.cta}
                  </Link>
                </li>
              </ul>
            </div>

            <div className="sc-peak-copy" data-sc-show="peak">
              <div className="sc-tape" aria-hidden="true">
                <div className="sc-tape__inner">
                  <Still still={STAGE_STILLS.tapeDraw} sizes="(max-width: 700px) 50vw, 26rem" />
                </div>
              </div>
              <h2 className="sc-h1 sc-h1--peak">{peak.h1}</h2>
              <p className="sc-dek">{peak.dek}</p>
            </div>
          </div>

          <p className="sc-silence-note sc-tiny" aria-hidden="true">
            Quiet on purpose.
          </p>

          {/* Close: one price, running-text CTA. */}
          <div className="sc-close" data-sc-show="resolve">
            <div className="sc-close__inner">
              <div className="sc-close__lead">
                <p className="sc-tiny">{close.priceLabel}</p>
                <p className="sc-price">{close.price}</p>
                <p className="sc-dek" style={{ marginTop: 0 }}>{close.priceTerms}</p>
              </div>
              <div className="sc-close__lines">
                <p className="sc-dek" style={{ marginTop: 0, color: 'var(--sc-ink)' }}>{close.statement}</p>
                <p className="sc-body sc-close__cta">
                  {close.ctaLead}{' '}
                  <Link href={content.bookHref} prefetch={false} className="sc-cta">
                    {content.cta}
                  </Link>
                  .
                </p>
                {close.extras?.map((line) => (
                  <p key={line} className="sc-body">
                    {line}
                  </p>
                ))}
                {close.small && <p className="sc-body sc-close__small">{close.small}</p>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Colophon on the collapse ground. */}
      <footer className="sc-colophon" aria-label="Colophon">
        <div className="sc-colophon__ground" aria-hidden="true">
          <Still still={STAGE_STILLS.collapsePaper} sizes="100vw" />
        </div>
        <p className="sc-body" style={{ color: 'var(--sc-ink)' }}>
          {colophon.place}{' '}
          <Link href={content.bookHref} prefetch={false} className="sc-cta">
            {content.cta}
          </Link>
          .
        </p>
        {colophon.note && <p className="sc-body sc-colophon__note">{colophon.note}</p>}
        <ul className="sc-colophon__row sc-tiny">
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
      </footer>
    </main>
  )
}
