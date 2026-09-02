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

export function ArticleHead({
  kicker,
  title,
  lede,
  children,
}: {
  kicker?: ReactNode
  title: string
  lede?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="sc-article__head">
      {kicker && <p className="sc-tiny">{kicker}</p>}
      <h1 className="sc-h1">{title}</h1>
      {lede && <p className="sc-article__lede">{lede}</p>}
      {children}
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

export function Plate({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return (
    <div className="sc-photo sc-article__photo">
      <Image src={src} alt={alt} fill sizes="(max-width: 900px) 90vw, 26rem" priority={priority} />
    </div>
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
