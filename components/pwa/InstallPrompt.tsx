'use client'

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISSED_KEY = 'pib.installPrompt.dismissedAt'
const DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 14 // 14 days

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mql = window.matchMedia('(display-mode: standalone)')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return mql.matches || (window.navigator as any).standalone === true
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) && !/Windows/.test(ua)
}

function wasDismissedRecently(): boolean {
  if (typeof window === 'undefined') return false
  const ts = Number(localStorage.getItem(DISMISSED_KEY) || 0)
  return ts > 0 && Date.now() - ts < DISMISS_TTL_MS
}

/**
 * Floating "Install Partners in Biz" pill.
 *
 * On Chromium-family browsers we wait for `beforeinstallprompt` and trigger
 * the native install dialog. On iOS Safari (which never fires that event) we
 * show a hint pointing to Share → Add to Home Screen.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isStandalone()) return
    if (wasDismissedRecently()) return

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    const onInstalled = () => {
      setDeferredPrompt(null)
      setVisible(false)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)

    // iOS Safari — no install event, so show the manual hint after a delay.
    if (isIos()) {
      const t = setTimeout(() => {
        setIosHint(true)
        setVisible(true)
      }, 4000)
      return () => {
        clearTimeout(t)
        window.removeEventListener('beforeinstallprompt', onBeforeInstall)
        window.removeEventListener('appinstalled', onInstalled)
      }
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!visible) return null

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    setVisible(false)
  }

  const install = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'dismissed') {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    }
    setDeferredPrompt(null)
    setVisible(false)
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] sm:bottom-6 sm:left-auto sm:right-6 sm:max-w-sm">
      <div className="rounded-2xl border border-white/10 bg-[var(--pib-bg)]/95 backdrop-blur px-4 py-3 shadow-lg shadow-black/30">
        <div className="flex items-start gap-3">
          <img src="/icons/icon-192.png" alt="" className="w-10 h-10 rounded-lg flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Install Partners in Biz</p>
            {iosHint ? (
              <p className="text-xs text-[var(--pib-muted)] mt-1">
                Tap <span className="font-medium">Share</span> in Safari, then{' '}
                <span className="font-medium">Add to Home Screen</span>.
              </p>
            ) : (
              <p className="text-xs text-[var(--pib-muted)] mt-1">
                Get faster access, work offline, and receive push notifications.
              </p>
            )}
            <div className="flex items-center gap-2 mt-3">
              {!iosHint && deferredPrompt && (
                <button
                  type="button"
                  onClick={install}
                  className="pib-btn-primary text-xs"
                >
                  Install
                </button>
              )}
              <button
                type="button"
                onClick={dismiss}
                className="text-xs text-[var(--pib-muted)] rounded-full border border-white/15 px-3 py-1.5"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
