import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getProduct } from '@/lib/onboarding/products'
import AthleetOnboardingForm from './AthleetOnboardingForm'

interface Props {
  params: Promise<{ product: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { product: slug } = await params
  const product = getProduct(slug)
  if (!product) return {}
  return {
    title: `Get started with ${product.name}`,
    description: product.tagline,
  }
}

export default async function StartProductPage({ params }: Props) {
  const { product: slug } = await params
  const product = getProduct(slug)
  if (!product) notFound()

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      {/* Subtle grid bg */}
      <div className="fixed inset-0 monolithic-grid opacity-30 pointer-events-none" />

      <div className="relative z-10 max-w-screen-xl mx-auto px-8 md:px-16 pt-32 pb-24">
        {/* Header */}
        <div className="mb-16">
          <span className="font-headline font-bold text-white/30 uppercase tracking-[0.3em] mb-4 block text-sm">
            Partners in Biz · Get Started
          </span>
          <h1 className="font-headline font-black uppercase tracking-tight text-white mb-6" style={{ fontSize: 'clamp(2.5rem, 6vw, 5rem)', lineHeight: 0.9 }}>
            Configure Your<br />
            <span className="text-white/30">{product.name}</span>
          </h1>
          <p className="font-body text-lg text-white/50 max-w-2xl leading-relaxed">
            {product.description}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start">
          {/* Form takes 2/3 */}
          <div className="lg:col-span-2">
            <AthleetOnboardingForm />
          </div>

          {/* Sidebar: what's included */}
          <div className="space-y-6 lg:sticky lg:top-28">
            <div className="glass-card p-8 space-y-6">
              <div>
                <p className="font-headline text-[0.65rem] uppercase tracking-widest text-white/30 mb-2">Pricing</p>
                <p className="font-headline font-black text-2xl uppercase">{product.priceLabel}</p>
              </div>
              <div className="h-px bg-white/10" />
              <div>
                <p className="font-headline text-[0.65rem] uppercase tracking-widest text-white/30 mb-4">What&apos;s Included</p>
                <ul className="space-y-3">
                  {product.features.map((f) => (
                    <li key={f} className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-white/60 text-lg mt-0.5 flex-shrink-0">check</span>
                      <span className="font-body text-sm text-white/70 leading-snug">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="h-px bg-white/10" />
              <div className="space-y-2">
                <p className="font-headline text-[0.65rem] uppercase tracking-widest text-white/30">Turnaround</p>
                <p className="font-body text-sm text-white/60">Setup completed within <strong className="text-white">3–5 business days</strong> of receiving your configuration.</p>
              </div>
            </div>
            <div className="glass-card p-6">
              <p className="font-body text-sm text-white/40 leading-relaxed">
                Questions? Email us at{' '}
                <a href="mailto:peet@partnersinbiz.online" className="text-white/70 hover:text-white underline transition-colors">
                  peet@partnersinbiz.online
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
