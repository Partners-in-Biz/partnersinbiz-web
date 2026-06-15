import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy | PiB',
  description: 'How Partners in Biz collects, uses, and protects your personal information.',
  alternates: { canonical: '/privacy-policy' },
}

export default function PrivacyPolicyPage() {
  return (
    <main>
      <header className="relative min-h-[40vh] flex flex-col justify-center px-8 md:px-16 pt-32 pb-20 overflow-hidden">
        <div className="absolute top-1/4 -right-1/4 w-96 h-96 bg-white/5 rounded-full blur-[120px]"></div>
        <div className="max-w-6xl relative z-10">
          <p className="font-label text-[0.6875rem] uppercase tracking-widest text-white/40 mb-6">Legal</p>
          <h1 className="font-headline text-6xl md:text-[6.5rem] leading-[0.9] font-bold tracking-tighter mb-10">
            PRIVACY<br />POLICY
          </h1>
          <p className="font-body text-white/40 text-sm">Last updated: June 2026</p>
        </div>
      </header>

      <section className="px-8 md:px-16 pb-32 max-w-4xl">
        <div className="space-y-12 font-body text-white/60 leading-relaxed">

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">1. Information We Collect</h2>
            <p className="mb-4">
              When you interact with Partners in Biz, we may collect information you provide directly, such as your name, email address, company name, phone number, form consent choices, project details, support messages, uploaded files, and portal conversations.
            </p>
            <p>
              We also collect usage and security data automatically, including IP addresses, browser type, pages visited, interaction timestamps, export/delete activity, and audit events, to help us improve our services and protect client workspaces.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">2. How We Use Your Information</h2>
            <ul className="space-y-3 list-none">
              {[
                'To respond to project enquiries and onboard new clients',
                'To manage your portal access, client workspaces, project communications, and consent preferences',
                'To provide AI-assisted drafting, research, summaries, and operational support under human approval gates where required',
                'To improve our website, services, security controls, and client experience',
                'To comply with legal obligations and protect our rights',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1 w-1 h-1 rounded-full bg-white/30 flex-shrink-0 block"></span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">3. Sharing of Information</h2>
            <p>
              We do not sell or rent your personal information to third parties. We may share data with trusted service providers who assist in operating our platform (such as hosting and analytics providers), under strict confidentiality agreements. We may also disclose information when required by law.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">4. Data Retention</h2>
            <p>
              We retain personal information only for as long as needed to provide the service, maintain security/audit records, resolve disputes, meet legal obligations, and preserve agreed client project history. Client project and finance records may be retained for at least five years after completion where business, tax, or contractual obligations require it. Short-lived logs, previews, and failed run diagnostics should be removed or anonymised when no longer operationally necessary.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">5. Your Rights</h2>
            <p className="mb-4">
              Depending on your jurisdiction, you may have the right to access, export, correct, or delete your personal data. You may also have the right to object to or restrict certain processing activities, withdraw marketing consent, and request that a client workspace administrator review access to your records.
            </p>
            <p>
              The portal may provide self-service exports for selected datasets. For a full access, export, correction, or deletion request, contact us at <a href="mailto:peet.stander@partnersinbiz.online" className="text-white hover:text-white/70 transition-opacity underline underline-offset-4">peet.stander@partnersinbiz.online</a>. We may need to verify your identity, preserve records we are legally required to keep, and coordinate with the relevant client organisation before deleting shared business records.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">6. Cookies</h2>
            <p>
              Our website uses essential cookies to maintain session state and security. We do not use third-party advertising cookies. You can disable cookies in your browser settings, though some portal features may not function correctly as a result.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">7. Security, Access Controls, and Auditability</h2>
            <p>
              We use role-based access controls, organisation scoping, authentication, audit/activity logs, and operational approval gates to reduce unauthorised access, alteration, disclosure, or destruction. Client users should only access organisations they belong to; platform administrators and AI agents must use the correct organisation scope. No method of transmission over the internet is completely secure, and we cannot guarantee absolute security.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">8. AI-Assisted Processing and Sensitive Information</h2>
            <p>
              Some portal features use AI-assisted tools to draft, summarise, classify, research, or suggest next actions. AI output can be wrong and should not be treated as legal, financial, medical, mental-health, or other professional advice. Please do not submit sensitive medical or mental-health information unless it is strictly necessary for an agreed business purpose.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Material changes will be communicated via email or a prominent notice on our website. Continued use of our services after changes constitutes acceptance of the updated policy.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl">
            <h2 className="font-headline text-2xl font-bold text-white mb-4">10. Contact</h2>
            <p>
              For any privacy-related questions, please contact Partners in Biz at{' '}
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
