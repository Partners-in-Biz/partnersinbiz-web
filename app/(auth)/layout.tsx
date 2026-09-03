import type { Metadata } from 'next'
import '@/components/marketing/stage/stage.css'
import './auth.css'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="sc-stage sc-paper st-auth">{children}</div>
}
