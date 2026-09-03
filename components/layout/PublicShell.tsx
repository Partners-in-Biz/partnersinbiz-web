'use client'

import { usePathname } from 'next/navigation'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import { isStageRoute } from '@/lib/marketing/stage-routes'
import '@/components/marketing/stage/stage.css'

/**
 * One theme for every public page. Stage routes bring their own chrome and
 * their own `.sc-stage`; every other public page is wrapped in the paper shell
 * so the legacy `--color-pib-*` tokens resolve to the stage palette.
 */
export default function PublicShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  if (isStageRoute(pathname)) return <>{children}</>

  return (
    <div className="sc-stage sc-paper sc-public">
      <Navbar />
      {children}
      <Footer />
    </div>
  )
}
