// Higgsfield-parity design tokens for the Creative Canvas surface.
// Components consume these tokens — never hardcode raw hex in canvas components.
export const canvasTheme = {
  bg: '#0b0d10', // near-black canvas
  bgGridDot: '#23262b', // dotted grid
  surface: '#15181d', // node card / panel bg
  surfaceRaised: '#1c2027',
  border: '#2a2f37',
  borderActive: '#3a4150',
  text: '#e7eaf0',
  textMuted: '#8b93a1',
  accent: '#d4f000', // neon lime — primary actions only
  accentText: '#0b0d10', // text on lime
  accentGlow: '0 0 0 1px #d4f000, 0 0 16px -4px #d4f000',
  nodeShadow: '0 8px 30px -12px rgba(0,0,0,0.7)',
  radius: '14px',
  port: {
    image: '#5aa9ff',
    video: '#a06bff',
    audio: '#ff6bb0',
    text: '#9aa3b2',
    output: '#d4f000',
  },
} as const

export type CanvasPortKind = keyof typeof canvasTheme.port
