'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'
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

const TOAST_TONES: Record<ToastType, { edge: string; bg: string; icon: string; iconColor: string }> = {
  success: {
    edge: 'border-l-[var(--color-pib-green,#4ade80)]',
    bg: 'rgba(74,222,128,0.1)',
    icon: '✓',
    iconColor: 'var(--color-pib-green, #4ade80)',
  },
  error: {
    edge: 'border-l-red-500',
    bg: 'rgba(239,68,68,0.1)',
    icon: '✕',
    iconColor: '#ef4444',
  },
  info: {
    edge: 'border-l-[var(--color-pib-blue,#60a5fa)]',
    bg: 'rgba(96,165,250,0.1)',
    icon: 'i',
    iconColor: 'var(--color-pib-blue, #60a5fa)',
  },
  warning: {
    edge: 'border-l-[var(--color-accent-v2)]',
    bg: 'rgba(245,158,11,0.1)',
    icon: '!',
    iconColor: 'var(--color-accent-v2)',
  },
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const tone = TOAST_TONES[toast.type]

  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div
      className={cn(
        'flex items-center gap-2 border border-[var(--color-pib-line)] border-l-[3px] px-3 py-2 rounded-[var(--radius-card)] shadow-lg min-w-64 max-w-sm animate-[slideIn_0.2s_ease-out]',
        tone.edge,
      )}
      style={{ background: 'var(--color-sidebar)' }}
    >
      <span
        className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{ background: tone.bg, color: tone.iconColor }}
      >
        {tone.icon}
      </span>
      <p className="text-xs leading-snug text-[var(--color-pib-text)] flex-1">{toast.message}</p>
      <button onClick={onDismiss} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors text-base leading-none shrink-0">×</button>
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts(prev => [...prev.slice(-4), { id, message, type }])
  }, [])

  const success = useCallback((message: string) => toast(message, 'success'), [toast])
  const error = useCallback((message: string) => toast(message, 'error'), [toast])

  return (
    <ToastContext.Provider value={{ toast, success, error }}>
      {children}
      {/* Toast container */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-1.5 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
