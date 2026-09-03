/**
 * Shared stage vocabulary: the market split, the still shape, and the real
 * work screenshots every stage and paper page draws from. `/` is ZA only,
 * `/us` is US only; prices never cross markets. Home copy lives in
 * studio-content.ts.
 */

export type StageMarket = 'za' | 'us'

export interface StageStill {
  src: string
  alt: string
}

/** Real screenshots of live client work. Captured from the public sites, not generated. */
export const WORK_SHOTS = {
  ahsLaw: { src: '/images/shot-ahs-law.jpg', alt: 'The AHS Law home page: a dark hero, gold book-a-consultation button, and a bronze statue of Justice' },
  athleet: { src: '/images/shot-athleet.jpg', alt: 'The Athleet home page: "Your club. Your brand. Our software." beside a live club dashboard card' },
  velox: { src: '/images/shot-velox.jpg', alt: 'The Velox site: "Beat your calculator in 60 seconds" with App Store and Google Play buttons' },
  lumen: { src: '/images/shot-lumen.jpg', alt: 'The Lumen site: "Train reading in any language" above a live 600 words-per-minute demo' },
  scrolledBrain: { src: '/images/shot-scrolledbrain.jpg', alt: 'The Scrolled Brain landing page: "How cooked is your attention span?" with a take-the-test button' },
} as const satisfies Record<string, StageStill>

export const CTA_TEXT = 'Book a 20-min call'
