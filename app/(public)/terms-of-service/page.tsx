import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service | PiB',
  description: 'The terms and conditions governing your use of Partners in Biz services.',
  alternates: { canonical: '/terms-of-service' },
}

export default function TermsOfServicePage() {
  return (
    <main>
      <header className="relative min-h-[40vh] flex flex-col justify-center px-8 md:px-16 pt-32 pb-20 overflow-hidden">
        <div className="absolute top-1/4 -right-1/4 w-96 h-96 bg-white/5 rounded-full blur-[120px]"></div>
        <div className="max-w-6xl relative z-10">
          <p className="font-label text-[0.6875rem] uppercase tracking-widest text-white/40 mb-6">Legal</p>
          <h1 className="font-headline text-6xl md:text-[6.5rem] leading-[0.9] font-bold tracking-tighter mb-10">
            TERMS OF<br />SERVICE
          </h1>
          <p className="font-body text-white/40 text-sm">Last updated: March 2026</p>
        </div>
      </header>

      <section className="px-8 md:px-16 pb-32 max-w-4xl">
        <div className="space-y-12 font-body text-white/60 leading-relaxed">

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">1. Acceptance of Terms</h2>
            <p>
              By accessing or using any Partners in Biz service, website, or client portal, you agree to be bound by these Terms of Service. If you do not agree with any part of these terms, you may not use our services.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">2. Services</h2>
            <p className="mb-4">
              Partners in Biz provides strategic technology consulting, engineering, design, and growth services to business clients. The specific scope, deliverables, timelines, and commercial terms of any engagement are defined in a separate Statement of Work or Project Agreement signed by both parties.
            </p>
            <p>
              We reserve the right to modify, suspend, or discontinue any aspect of our services at any time, with reasonable notice where possible.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">3. Client Responsibilities</h2>
            <ul className="space-y-3 list-none">
              {[
                'Provide accurate and complete information required to deliver the engagement',
                'Respond to requests for feedback, approval, or materials in a timely manner',
                'Ensure you have authority to engage our services and bind your organisation',
                'Keep your portal credentials confidential and notify us of any unauthorised access',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1 w-1 h-1 rounded-full bg-white/30 flex-shrink-0 block"></span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">4. Intellectual Property</h2>
            <p className="mb-4">
              Upon full payment of all fees, and unless otherwise agreed in writing, intellectual property rights in custom deliverables produced exclusively for your project transfer to you.
            </p>
            <p>
              Partners in Biz retains ownership of all pre-existing tools, methodologies, frameworks, and know-how used in the delivery of services. Nothing in these terms grants you a licence to our proprietary technology beyond what is necessary to use the deliverables.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">5. Payment Terms</h2>
            <p className="mb-4">
              Payment terms are specified in your Project Agreement. Unless otherwise agreed, invoices are due within 14 days of issue. Late payments may incur interest at 2% per month on the outstanding balance.
            </p>
            <p>
              We reserve the right to suspend services for accounts with overdue balances exceeding 30 days.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">6. Confidentiality</h2>
            <p>
              Both parties agree to keep confidential any non-public information shared during the engagement. This obligation survives termination of the engagement for a period of three years, unless a separate Non-Disclosure Agreement provides for a longer term.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">7. Limitation of Liability</h2>
            <p className="mb-4">
              To the maximum extent permitted by law, Partners in Biz&apos;s total liability for any claim arising out of or relating to these terms or our services shall not exceed the total fees paid by you in the three months preceding the claim.
            </p>
            <p>
              We are not liable for any indirect, incidental, special, or consequential damages, including loss of revenue, data, or business opportunity.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">8. Termination</h2>
            <p>
              Either party may terminate an engagement with 30 days&apos; written notice. You remain responsible for payment of all work completed up to the date of termination. Provisions relating to IP ownership, confidentiality, and limitation of liability survive termination.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">9. Governing Law</h2>
            <p>
              These terms are governed by the laws of England and Wales. Any disputes arising from or related to these terms shall be subject to the exclusive jurisdiction of the courts of England and Wales.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">10. Contact</h2>
            <p>
              For any questions regarding these terms, contact Partners in Biz at{' '}
              <a href="mailto:peet.stander@partnersinbiz.online" className="text-white hover:text-white/70 transition-opacity underline underline-offset-4">
                peet.stander@partnersinbiz.online
              </a>.
            </p>
          </div>

        </div>
      </section>
    </main>
  )
}
