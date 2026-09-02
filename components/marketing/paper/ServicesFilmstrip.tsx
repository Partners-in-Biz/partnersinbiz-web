import Image from 'next/image'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import { WORK_SHOTS } from '@/lib/marketing/stage-content'
import { SERVICE_CONTENT, SERVICE_ORDER, caseFor, serviceMeta, type ServiceSlug } from '@/lib/marketing/service-content'
import { ScrollCraft } from '@/components/marketing/stage/ScrollCraft'
import './services-filmstrip.css'

/**
 * The six services as one pinned filmstrip, the same move as the home "work"
 * act. ScrollCraft writes --sc-p onto the section; each slide opens its own
 * aperture from --s0/--s1 in CSS. Below 860px, under reduced motion and
 * without JS the frame unsticks and the slides stack in order.
 */

const COUNT = SERVICE_ORDER.length
const WIDTH = 1 / COUNT

/** Real screenshots only. Where the proof case has no shot, the nearest one that does, credited honestly. */
const PLATES: Record<ServiceSlug, { shot: { src: string; alt: string }; credit: string }> = {
  'web-development': { shot: WORK_SHOTS.ahsLaw, credit: 'AHS Law. Number one on Google in eight weeks.' },
  'web-applications': { shot: WORK_SHOTS.athleet, credit: 'Athleet. Club platform live for three clubs in under four weeks.' },
  'mobile-apps': { shot: WORK_SHOTS.velox, credit: 'Velox. In the App Store and on Google Play.' },
  'ai-integration': { shot: WORK_SHOTS.lumen, credit: 'Lumen. AI-generated reading passages in three languages.' },
  'growth-systems': { shot: WORK_SHOTS.scrolledBrain, credit: 'Scrolled Brain. A 38% sign-up rate on the new landing page.' },
  'bespoke-builds': { shot: WORK_SHOTS.athleet, credit: 'Athleet. Club platform live for three clubs in under four weeks.' },
}

export const SERVICES_FILMSTRIP_ACTS_ATTR = SERVICE_ORDER.map((_, i) => `s${i + 1}:${(i * WIDTH).toFixed(4)}`).join(',')

/** The first slide is already open at p = 0 and the last one holds to p = 1. */
function slideWindow(i: number): { s0: number; s1: number } {
  return {
    s0: i === 0 ? -0.1 : i * WIDTH,
    s1: i === COUNT - 1 ? 1.1 : (i + 1) * WIDTH,
  }
}

export function ServicesFilmstrip() {
  return (
    <>
      <ScrollCraft />
      <noscript>
        <style>{`.sf-strip{height:auto}.sf-frame{position:relative;top:auto;height:auto;overflow:visible}.sf-kicker{position:static}.sf-rail{display:none}.sf-slide{position:relative;inset:auto;opacity:1!important;clip-path:none!important}.sf-slide__copy,.sf-plate{transform:none!important}`}</style>
      </noscript>

      <section
        className="sf-strip"
        data-sc-rebuild
        data-sc-acts={SERVICES_FILMSTRIP_ACTS_ATTR}
        data-sc-act="s1"
        aria-label="Everything we do, one at a time"
      >
        <div className="sf-frame">
          <p className="sc-tiny sf-kicker">What we build</p>
          <ol className="sf-rail sc-tiny" aria-hidden="true">
            {SERVICE_ORDER.map((slug, i) => {
              const { s0, s1 } = slideWindow(i)
              return (
                <li key={slug} className="sf-rail__item" style={{ '--s0': s0, '--s1': s1 } as CSSProperties}>
                  {String(i + 1).padStart(2, '0')} {serviceMeta(slug).name}
                </li>
              )
            })}
          </ol>

          {SERVICE_ORDER.map((slug, i) => {
            const meta = serviceMeta(slug)
            const content = SERVICE_CONTENT[slug]
            const study = caseFor(content.proof.caseSlug)
            const plate = content.plate
              ? { shot: content.plate, credit: `${study.client}, ${study.industry}.` }
              : PLATES[slug]
            const { s0, s1 } = slideWindow(i)
            return (
              <article
                key={slug}
                id={slug}
                className="sf-slide"
                data-sc-show={`s${i + 1}`}
                style={{ '--s0': s0, '--s1': s1 } as CSSProperties}
              >
                <div className="sf-slide__copy">
                  <p className="sc-tiny sf-slide__service">
                    <span className="sf-slide__index">{String(i + 1).padStart(2, '0')}</span> {meta.name}
                  </p>
                  <h2 className="sf-h2">{content.headline}</h2>
                  <p className="sc-body sf-slide__line">{content.lede}</p>
                  <p className="sf-slide__price">{content.price.label}</p>
                  <p className="sc-body sf-slide__terms">{content.price.terms}</p>
                  <p className="sc-body sf-slide__more">
                    <Link href={`/services/${slug}`} prefetch={false} className="sc-link">
                      What ships, how it runs, what it costs
                    </Link>
                  </p>
                </div>
                <figure className="sf-plate">
                  {/* All six plates sit in the pinned frame, so lazy loading would leave empty frames mid-scroll. */}
                  <Image
                    src={plate.shot.src}
                    alt={plate.shot.alt}
                    fill
                    sizes="(max-width: 860px) 90vw, 52vw"
                    priority={i === 0}
                    loading={i === 0 ? undefined : 'eager'}
                  />
                  <figcaption className="sc-tiny sf-plate__credit">{plate.credit}</figcaption>
                </figure>
              </article>
            )
          })}
        </div>
      </section>
    </>
  )
}
