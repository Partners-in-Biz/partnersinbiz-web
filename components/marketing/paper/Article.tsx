import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CTA_LABEL } from '@/lib/seo/site'

/**
 * Paper article primitives for the firm pages. Running text, an asymmetric
 * two-column rhythm, a single CTA sentence. Styles live in stage.css under
 * `.sc-article`.
 */

export function Article({ children }: { children: ReactNode }) {
  return <main className="sc-article">{children}</main>
}

/**
 * Page head. With `plate`, the copy sits left and the plate sits right over an
 * offset terracotta block: the one colour move each paper page gets.
 */
export function ArticleHead({
  kicker,
  title,
  lede,
  plate,
  children,
}: {
  kicker?: ReactNode
  title: string
  lede?: ReactNode
  plate?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className={`sc-article__head${plate ? ' sc-article__head--plated' : ''}`}>
      <div className="sc-article__head-copy">
        {kicker && <p className="sc-tiny">{kicker}</p>}
        <h1 className="sc-h1">{title}</h1>
        {lede && <p className="sc-article__lede">{lede}</p>}
        {children}
      </div>
      {plate && (
        <div className="sc-article__head-art">
          <div className="sc-block" aria-hidden="true" />
          {plate}
        </div>
      )}
    </header>
  )
}

export function ArticleRow({
  title,
  flip = false,
  aside,
  children,
  id,
}: {
  title?: string
  flip?: boolean
  aside?: ReactNode
  children: ReactNode
  id?: string
}) {
  return (
    <section id={id} className={`sc-article__row${flip ? ' sc-article__row--flip' : ''}`}>
      <div className="sc-article__body sc-body">
        {title && <h2 className="sc-article__h2">{title}</h2>}
        {children}
      </div>
      {aside && <aside className="sc-article__aside">{aside}</aside>}
    </section>
  )
}

export function ArticleList({ items }: { items: readonly string[] }) {
  return (
    <ul className="sc-article__list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export function Proof({ line, credit, href }: { line: string; credit: string; href?: string }) {
  return (
    <div className="sc-article__proof sc-body">
      <p>{line}</p>
      <p className="sc-tiny">
        {href ? (
          <Link href={href} prefetch={false} className="sc-link">
            {credit}
          </Link>
        ) : (
          credit
        )}
      </p>
    </div>
  )
}

/** A real screenshot on paper with the terracotta drop. `wide` is for page heads. */
export function Plate({
  src,
  alt,
  caption,
  priority = false,
  wide = false,
}: {
  src: string
  alt: string
  caption?: string
  priority?: boolean
  wide?: boolean
}) {
  return (
    <figure className={`sc-plate sc-article__photo${wide ? ' sc-plate--wide' : ''}`}>
      <Image
        src={src}
        alt={alt}
        fill
        sizes={wide ? '(max-width: 900px) 92vw, 44rem' : '(max-width: 900px) 90vw, 26rem'}
        priority={priority}
      />
      {caption && <figcaption className="sc-tiny sc-plate__caption">{caption}</figcaption>}
    </figure>
  )
}

export function CtaSentence({ lead, href = '/book-a-call' }: { lead: string; href?: string }) {
  return (
    <p className="sc-article__cta">
      {lead}{' '}
      <Link href={href} prefetch={false} className="sc-cta">
        {CTA_LABEL}
      </Link>
      .
    </p>
  )
}

export function Quote({ quote, by }: { quote: string; by: string }) {
  return (
    <blockquote className="sc-article__quote">
      <p>{quote}</p>
      <footer className="sc-tiny">{by}</footer>
    </blockquote>
  )
}
