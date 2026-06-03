import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { POSTS, getPostBySlug, type Post } from '@/lib/content/posts'
import { getFirestorePostBySlug, listLiveSlugs } from '@/lib/content/posts-firestore'
import { SITE } from '@/lib/seo/site'
import { JsonLd, articleSchema, breadcrumbSchema } from '@/lib/seo/schema'
import { Reveal } from '@/components/marketing/Reveal'

interface Params { params: Promise<{ slug: string }> }

export const revalidate = 60

/**
 * Resolve a slug from either the legacy hardcoded array or Firestore
 * (seo_content where status='live'). Firestore is the source of truth for
 * any post produced by the SEO content engine.
 */
async function resolvePost(slug: string): Promise<Post | null> {
  const fromFirestore = await getFirestorePostBySlug(slug).catch(() => null)
  if (fromFirestore) return fromFirestore
  return getPostBySlug(slug)
}

function siteImageUrl(pathOrUrl: string) {
  return pathOrUrl.startsWith('http') ? pathOrUrl : `${SITE.url}${pathOrUrl}`
}

export async function generateStaticParams() {
  const fromArray = POSTS.map(p => p.slug)
  const fromFirestore = await listLiveSlugs().catch(() => [])
  const all = Array.from(new Set([...fromArray, ...fromFirestore]))
  return all.map(slug => ({ slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = await resolvePost(slug)
  if (!post) return { title: 'Post not found' }
  const url = `${SITE.url}/insights/${post.slug}`
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/insights/${post.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: 'article',
      publishedTime: post.datePublished,
      modifiedTime: post.dateModified ?? post.datePublished,
      images: [{ url: siteImageUrl(post.cover) }],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: [siteImageUrl(post.cover)],
    },
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-ZA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// Inline markdown: **bold**, *italic*, `code`, [text](url)
function renderInline(text: string, baseKey: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) tokens.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${baseKey}-${i++}`
    if (tok.startsWith('**')) {
      tokens.push(
        <strong key={key} className="text-[var(--color-pib-text)] font-semibold">
          {tok.slice(2, -2)}
        </strong>
      )
    } else if (tok.startsWith('`')) {
      tokens.push(
        <code key={key} className="font-mono text-sm bg-white/[0.06] px-1.5 py-0.5 rounded">
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('[')) {
      const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)
      if (linkMatch) {
        const [, label, href] = linkMatch
        tokens.push(
          <Link
            key={key}
            href={href}
            className="text-[var(--color-pib-accent)] underline underline-offset-4 decoration-1 hover:decoration-2 transition"
          >
            {label}
          </Link>
        )
      }
    } else if (tok.startsWith('*')) {
      tokens.push(
        <em key={key} className="italic">
          {tok.slice(1, -1)}
        </em>
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) tokens.push(text.slice(last))
  return tokens
}

function renderBody(body: string) {
  const lines = body.split('\n')
  const out: React.ReactNode[] = []
  let listBuffer: string[] = []
  let key = 0

  const flushList = () => {
    if (listBuffer.length === 0) return
    const items = listBuffer
    listBuffer = []
    out.push(
      <ul
        key={`ul-${key++}`}
        className="my-6 ml-6 space-y-3 list-disc text-lg leading-relaxed text-[var(--color-pib-text-muted)] marker:text-[var(--color-pib-accent)]"
      >
        {items.map((item, i) => (
          <li key={i} className="pl-2 text-pretty">
            {renderInline(item, `li-${key}-${i}`)}
          </li>
        ))}
      </ul>
    )
  }

  lines.forEach((raw, idx) => {
    const line = raw.trim()
    if (!line) {
      flushList()
      return
    }
    if (line === '---') {
      flushList()
      out.push(
        <hr
          key={idx}
          className="my-12 border-0 h-px bg-[var(--color-pib-line)]"
        />
      )
    } else if (line.startsWith('### ')) {
      flushList()
      out.push(
        <h3
          key={idx}
          className="font-display text-2xl md:text-3xl text-[var(--color-pib-text)] mt-10 mb-3 text-balance"
        >
          {renderInline(line.slice(4), `h3-${idx}`)}
        </h3>
      )
    } else if (line.startsWith('## ')) {
      flushList()
      out.push(
        <h2
          key={idx}
          className="font-display text-3xl md:text-4xl text-[var(--color-pib-text)] mt-12 mb-4 text-balance"
        >
          {renderInline(line.slice(3), `h2-${idx}`)}
        </h2>
      )
    } else if (line.startsWith('# ')) {
      flushList()
      out.push(
        <h1
          key={idx}
          className="font-display text-4xl text-[var(--color-pib-text)] mt-12 mb-4 text-balance"
        >
          {renderInline(line.slice(2), `h1-${idx}`)}
        </h1>
      )
    } else if (line.startsWith('- ')) {
      listBuffer.push(line.slice(2))
    } else {
      flushList()
      out.push(
        <p
          key={idx}
          className="text-lg leading-relaxed text-[var(--color-pib-text-muted)] my-6 text-pretty"
        >
          {renderInline(line, `p-${idx}`)}
        </p>
      )
    }
  })
  flushList()
  return out
}

export default async function InsightPostPage({ params }: Params) {
  const { slug } = await params
  const post = await resolvePost(slug)
  if (!post) notFound()

  const breadcrumb = breadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: 'Insights', url: '/insights' },
    { name: post.title, url: `/insights/${post.slug}` },
  ])
  const article = articleSchema({
    slug: `insights/${post.slug}`,
    title: post.title,
    description: post.description,
    image: post.cover,
    datePublished: post.datePublished,
    dateModified: post.dateModified,
    section: post.category,
  })

  const related = POSTS.filter((p) => p.slug !== post.slug).slice(0, 2)

  return (
    <main className="relative">
      <JsonLd data={breadcrumb} />
      <JsonLd data={article} />

      <article className="section">
        <div className="container-pib">
          <div className="max-w-3xl mx-auto">
            {/* Back */}
            <Reveal>
              <Link
                href="/insights"
                className="inline-flex items-center gap-2 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-accent)] transition mb-10"
              >
                <span className="material-symbols-outlined text-base">arrow_back</span>
                All insights
              </Link>
            </Reveal>

            <Reveal delay={80}>
              <div className="flex flex-wrap gap-2 mb-6">
                <span className="pill pill-accent">{post.category}</span>
                {post.tags.map((t) => (
                  <span key={t} className="pill">
                    {t}
                  </span>
                ))}
              </div>
            </Reveal>

            <Reveal delay={120}>
              <h1 className="h-display text-balance">{post.title}</h1>
            </Reveal>

            <Reveal delay={180}>
              <p className="mt-6 text-xl text-[var(--color-pib-text-muted)] text-pretty leading-relaxed">
                {post.description}
              </p>
            </Reveal>

            {/* Byline */}
            <Reveal delay={240}>
              <div className="mt-8 flex items-center gap-3 pb-8 border-b border-[var(--color-pib-line)]">
                <div className="w-10 h-10 rounded-full bg-[var(--color-pib-accent)] text-black font-display text-lg grid place-items-center shrink-0">
                  P
                </div>
                <div className="text-sm text-[var(--color-pib-text-muted)]">
                  By <span className="text-[var(--color-pib-text)]">{SITE.founder.name}</span>{' '}
                  · Published {fmtDate(post.datePublished)} · {post.readingTime}
                </div>
              </div>
            </Reveal>
          </div>

          {/* Cover */}
          <Reveal delay={300}>
            <div className="max-w-4xl mx-auto mt-12 relative aspect-[16/9] rounded-2xl overflow-hidden border border-[var(--color-pib-line)]">
              <Image
                src={post.cover}
                alt={post.title}
                width={1600}
                height={900}
                className="absolute inset-0 w-full h-full object-cover"
                priority
              />
            </div>
          </Reveal>

          {/* Body */}
          <div className="max-w-3xl mx-auto mt-16">{renderBody(post.body)}</div>

          {/* Author bio */}
          <div className="max-w-3xl mx-auto mt-20">
            <div className="bento-card p-8 flex items-start gap-5">
              <div className="w-14 h-14 rounded-full bg-[var(--color-pib-accent)] text-black font-display text-2xl grid place-items-center shrink-0">
                P
              </div>
              <div className="flex-1">
                <h3 className="font-display text-xl text-[var(--color-pib-text)]">
                  {SITE.founder.name}
                </h3>
                <p className="text-sm text-[var(--color-pib-text-muted)] mt-1">
                  {SITE.founder.role}
                </p>
                <p className="mt-3 text-[var(--color-pib-text-muted)] leading-relaxed text-pretty">
                  Writes the build notes, ships the code, answers the email. Based in Pretoria,
                  working with clients globally.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link href="/insights#newsletter" className="btn-pib-secondary text-sm">
                    Subscribe
                  </Link>
                  <Link href="/about" className="btn-pib-secondary text-sm">
                    About PiB
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* Related */}
          {related.length > 0 && (
            <div className="max-w-5xl mx-auto mt-20">
              <p className="eyebrow mb-6">Related reads</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
                {related.map((r: Post) => (
                  <Link
                    key={r.slug}
                    href={`/insights/${r.slug}`}
                    className="bento-card p-6 group"
                  >
                    <span className="pill mb-4 inline-flex">{r.category}</span>
                    <h4 className="font-display text-xl text-[var(--color-pib-text)] text-balance group-hover:text-[var(--color-pib-accent)] transition">
                      {r.title}
                    </h4>
                    <p className="mt-2 text-sm text-[var(--color-pib-text-muted)] line-clamp-2">
                      {r.description}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div className="max-w-5xl mx-auto mt-20">
            <div className="bento-card p-10 md:p-14 flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="max-w-xl">
                <p className="eyebrow mb-3">Got a project?</p>
                <h3 className="h-display text-3xl md:text-4xl text-balance">
                  Let&rsquo;s build the next one together.
                </h3>
              </div>
              <Link href="/start-a-project" className="btn-pib-accent shrink-0">
                Start a project
                <span className="material-symbols-outlined text-base">arrow_outward</span>
              </Link>
            </div>
          </div>
        </div>
      </article>
    </main>
  )
}
