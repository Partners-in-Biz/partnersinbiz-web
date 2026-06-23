import Link from 'next/link'

export function MaintenanceShell({ message }: { message?: string | null }) {
  return (
    <main className="min-h-screen bg-[var(--pib-bg)] text-[var(--pib-text)]">
      <section className="section">
        <div className="container-pib">
          <div className="mx-auto max-w-3xl py-20">
            <p className="eyebrow mb-6">Maintenance</p>
            <h1 className="h-display text-balance">We are busy with scheduled maintenance.</h1>
            <p className="mt-6 text-lg text-[var(--color-pib-text-muted)]">
              {message?.trim() || 'The platform is temporarily unavailable while we complete maintenance.'}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/status" className="btn-pib-primary">
                Status
              </Link>
              <Link href="/" className="pib-btn-secondary">
                Home
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
