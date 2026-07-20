import { cn } from '@/lib/utils'

/** CSS aurora fallback when WebGL is unavailable or tier < 2. */
export function CssAurora({ className }: { className?: string }) {
  return <div className={cn('pib-aurora-fallback messages-atmosphere-fallback', className)} aria-hidden="true" />
}

export default CssAurora
