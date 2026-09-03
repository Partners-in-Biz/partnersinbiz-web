'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { Status } from '@/components/studio'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  success: () => {},
  error: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

const TOAST_STATUS: Record<ToastType, 'success' | 'danger' | 'info' | 'warning'> = {
  success: 'success',
  error: 'danger',
  info: 'info',
  warning: 'warning',
}

const TOAST_LABEL: Record<ToastType, string> = {
  success: 'Success',
  error: 'Error',
  info: 'Info',
  warning: 'Warning',
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [entered, setEntered] = useState(false)
  const reducedMotion = useRef(false)

  useEffect(() => {
    reducedMotion.current =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const frame = requestAnimationFrame(() => setEntered(true))
    const timer = setTimeout(onDismiss, 4000)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [onDismiss])

  return (
    <div
      role="status"
      className={cn(
        'st-panel flex min-w-64 max-w-sm items-start gap-3 pointer-events-auto',
        'transition-[transform,opacity] duration-200 ease-out',
        entered
          ? 'translate-y-0 opacity-100'
          : reducedMotion.current
            ? 'opacity-0'
            : 'translate-y-3 opacity-0',
      )}
      style={{ padding: 'calc(var(--sc-u) * 3) calc(var(--sc-u) * 4)', gap: 'calc(var(--sc-u) * 3)' }}
    >
      <Status tone={TOAST_STATUS[toast.type]}>{TOAST_LABEL[toast.type]}</Status>
      <p className="sc-body m-0 flex-1 text-[0.875rem] leading-snug text-[var(--sc-ink)]">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="sc-body shrink-0 border-0 bg-transparent p-0 text-[0.875rem] text-[var(--sc-ink-soft)] underline-offset-2 transition-colors duration-150 hover:text-[var(--sc-ink)] hover:underline"
      >
        Dismiss
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev.slice(-4), { id, message, type }])
  }, [])

  const success = useCallback((message: string) => toast(message, 'success'), [toast])
  const error = useCallback((message: string) => toast(message, 'error'), [toast])

  return (
    <ToastContext.Provider value={{ toast, success, error }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[9999] flex flex-col items-center gap-2 px-4 pb-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
