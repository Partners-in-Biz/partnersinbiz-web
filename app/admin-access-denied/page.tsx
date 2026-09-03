import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function AdminAccessDeniedPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-8 py-24">
      <p className="sc-tiny">Admin</p>
      <h1 className="sc-article__h2 mt-4">Admin access required.</h1>
      <p className="sc-body mt-4">
        This account can use the client portal, but it is not a platform admin account.
      </p>
      <div className="mt-8">
        <Link href="/portal/dashboard" prefetch={false} className="st-btn st-btn--ghost">
          Back to portal
        </Link>
      </div>
    </main>
  )
}
