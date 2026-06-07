import Link from 'next/link'
import { SITE, SERVICES } from '@/lib/seo/site'
import NewsletterForm from '@/components/marketing/NewsletterForm'

const SOCIAL_LINKS = [
  { label: 'Facebook', href: SITE.social.facebook },
  { label: 'LinkedIn', href: SITE.social.linkedin },
  { label: 'GitHub', href: SITE.social.github },
].filter((item) => Boolean(item.href))

export default function Footer() {
  return (
    <footer className="relative border-t border-[var(--color-pib-line)] mt-32" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">Footer</h2>

      {/* Big editorial CTA band */}
      <section className="relative overflow-hidden border-b border-[var(--color-pib-line)]">
        <div className="absolute inset-0 pib-mesh pointer-events-none" />
        <div className="container-pib relative py-24 md:py-36 text-center">
          <p className="eyebrow mb-8">Ready when you are</p>
          <h3 className="h-display text-balance max-w-4xl mx-auto">
            Let&rsquo;s build something <em className="text-[var(--color-pib-accent)] not-italic">your competitors will copy.</em>
          </h3>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
            <Link href="/start-a-project" prefetch={false} className="btn-pib-accent">
              Start a project
              <span className="material-symbols-outlined text-base">arrow_outward</span>
            </Link>
            <a
              href={SITE.cal.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-pib-secondary"
            >
              Book a 20-min intro
              <span className="material-symbols-outlined text-base">calendar_month</span>
            </a>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-[var(--color-pib-text-muted)]">
            <a href={`mailto:${SITE.email}`} className="hover:text-[var(--color-pib-text)] transition-colors flex items-center gap-2">
              <span className="material-symbols-outlined text-base">mail</span>
              {SITE.email}
            </a>
            <a
              href={`https://wa.me/${SITE.whatsapp.replace(/\D/g, '')}`}
              className="hover:text-[var(--color-pib-text)] transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-base">chat</span>
              WhatsApp
            </a>
          </div>
        </div>
      </section>

      <div className="container-pib py-16">
        <div className="grid grid-cols-2 md:grid-cols-12 gap-8 md:gap-10">
          <div className="col-span-2 md:col-span-4">
            <Link href="/" prefetch={false} className="flex items-center gap-2.5 mb-5">
              <span className="grid place-items-center w-8 h-8 rounded-lg bg-[var(--color-pib-text)] text-black font-bold text-sm font-mono">P</span>
              <span className="font-display text-xl">Partners <span className="text-[var(--color-pib-text-muted)]">in</span> Biz</span>
            </Link>
            <p className="text-sm text-[var(--color-pib-text-muted)] max-w-xs leading-relaxed">
              {SITE.description}
            </p>
            <address className="not-italic mt-6 text-sm text-[var(--color-pib-text-muted)] space-y-1">
              <div>{SITE.address.addressLocality}, {SITE.address.addressRegion}</div>
              <div>{SITE.address.addressCountry}</div>
            </address>
          </div>

          <div className="md:col-span-2">
            <h4 className="eyebrow mb-5">Services</h4>
            <ul className="space-y-3 text-sm">
              {SERVICES.map((s) => (
                <li key={s.slug}>
                  <Link href={`/services/${s.slug}`} prefetch={false} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-2">
            <h4 className="eyebrow mb-5">Studio</h4>
            <ul className="space-y-3 text-sm">
              <li><Link href="/work" prefetch={false} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors">Work</Link></li>
              <li><Link href="/about" prefetch={false} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors">About</Link></li>
              <li><Link href="/our-process" prefetch={false} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors">Process</Link></li>
              <li><Link href="/insights" prefetch={false} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors">Insights</Link></li>
              <li><Link href="/pricing" prefetch={false} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors">Pricing</Link></li>
            </ul>
          </div>

          <div className="md:col-span-2">
            <h4 className="eyebrow mb-5">Connect</h4>
            <ul className="space-y-3 text-sm">
              {SOCIAL_LINKS.map((item) => (
                <li key={item.href}>
                  <a href={item.href} target="_blank" rel="noopener noreferrer" className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="col-span-2 md:col-span-2">
            <h4 className="eyebrow mb-5">Newsletter</h4>
            <p className="text-sm text-[var(--color-pib-text-muted)] mb-3">Build notes, case studies, and the occasional opinion. Monthly.</p>
            <NewsletterForm source="footer" />
          </div>
        </div>

        <div className="mt-16 pt-8 hairline flex flex-col md:flex-row gap-4 md:items-center md:justify-between text-xs text-[var(--color-pib-text-faint)]">
          <p className="font-mono">
            © {new Date().getFullYear()} Partners in Biz · All rights reserved.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/privacy-policy" prefetch={false} className="hover:text-[var(--color-pib-text-muted)] transition-colors">Privacy</Link>
            <Link href="/terms-of-service" prefetch={false} className="hover:text-[var(--color-pib-text-muted)] transition-colors">Terms</Link>
            <a href="/llms.txt" className="hover:text-[var(--color-pib-text-muted)] transition-colors">llms.txt</a>
            <a href="/sitemap.xml" className="hover:text-[var(--color-pib-text-muted)] transition-colors">Sitemap</a>
            <span className="font-mono">v2026.04 · Made in Pretoria</span>
          </div>
        </div>
      </div>
    </footer>
  )
}
