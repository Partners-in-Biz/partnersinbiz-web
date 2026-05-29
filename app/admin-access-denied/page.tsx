import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function AdminAccessDeniedPage() {
  return (
    <main className="min-h-screen bg-[var(--color-pib-bg)] text-[var(--color-pib-text)] flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-6">
        <p className="eyebrow">Admin</p>
        <h1 className="text-xl font-semibold mt-2">Admin access required</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)] mt-3">
          This account can use the client portal, but it is not a platform admin account.
        </p>
        <div className="flex items-center gap-2 mt-6">
          <Link href="/portal/dashboard" className="btn-pib-accent text-sm">
            Back to portal
          </Link>
          <Link href="/login" className="btn-pib-secondary text-sm">
            Sign in as admin
          </Link>
        </div>
      </section>
    </main>
  )
}
