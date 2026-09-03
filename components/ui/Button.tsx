'use client'

// components/ui/Button.tsx
import { Button as StudioButton } from '@/components/studio'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /**
   * Control height. Studio only ships `sm` | `md`.
   * @deprecated Prefer `sm` or `md`. `lg` is accepted for API stability and maps to `md`.
   */
  size?: Size
  loading?: boolean
  children: React.ReactNode
}

/**
 * App Button — thin compatibility wrapper over the Studio kit Button.
 * Keeps the historical ui/Button import path and defaults (`secondary`, `sm`).
 */
export function Button({
  variant = 'secondary',
  size = 'sm',
  loading,
  children,
  className,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const studioSize = size === 'lg' ? 'md' : size

  return (
    <StudioButton
      type={type}
      variant={variant}
      size={studioSize}
      loading={loading}
      disabled={disabled}
      className={className}
      {...props}
    >
      {children}
    </StudioButton>
  )
}
