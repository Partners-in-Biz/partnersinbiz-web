'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'

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

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: 'rgba(74,222,128,0.1)', border: '#4ade80', icon: '✓' },
  error:   { bg: 'rgba(239,68,68,0.1)',  border: '#ef4444', icon: '✕' },
  info:    { bg: 'rgba(96,165,250,0.1)', border: '#60a5fa', icon: 'i' },
  warning: { bg: 'rgba(245,158,11,0.1)', border: 'var(--color-accent-v2)', icon: '!' },
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const colors = TOAST_COLORS[toast.type]

  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-card)] shadow-lg min-w-72 max-w-sm animate-[slideIn_0.2s_ease-out]"
      style={{ background: 'var(--color-sidebar)', border: `1px solid ${colors.border}` }}
    >
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{ background: colors.bg, color: colors.border }}
      >
        {colors.icon}
      </span>
      <p className="text-sm text-[var(--color-pib-text)] flex-1">{toast.message}</p>
      <button onClick={onDismiss} className="text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors text-lg leading-none shrink-0">×</button>
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
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
