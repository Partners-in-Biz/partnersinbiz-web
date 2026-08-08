/**
 * Direction deck — world catalog.
 *
 * P2 recommendation from research item ZTTo7g6CU80u1uUSZvoC (Impeccable):
 * start with 20-50 human-vetted 'worlds' (graphic systems) relevant to
 * local-business categories instead of a 375-world catalog. Catalog authoring
 * is agent work; `status: 'vetted'` is the human approval gate — only vetted
 * worlds roll by default, and bumping POOL_REVISION changes rolls even for the
 * same seed (reproducible seed + pool revision semantics).
 *
 * Every world is a born-designed system (era/school anchored), not a template
 * skin: palette, type stack, composition rules, controls rules, motion rules,
 * plus one spark scene (hero/first-viewport) that is the build target.
 */

import type { DirectionWorld, WorldCategory } from './types'

export const POOL_REVISION = 'worlds-v1'

/** World ids currently under review (draft) — excluded from rolls by default. */
export const DRAFT_WORLD_IDS: readonly string[] = ['tech-dark-ops', 'kids-playful-learning', 'event-festive']

export const WORLD_CATEGORIES: readonly WorldCategory[] = [
  'restaurant', 'cafe', 'bar', 'salon', 'barber', 'spa', 'wellness', 'gym', 'fitness',
  'real-estate', 'legal', 'accounting', 'medical', 'dental', 'trades', 'home-services',
  'landscaping', 'cleaning', 'retail', 'boutique', 'auto', 'education', 'events',
  'photography', 'construction', 'pet', 'bakery', 'hotel', 'creative', 'general',
] as const

export const WORLD_CATALOG: readonly DirectionWorld[] = [
  {
    id: 'swiss-modern',
    name: 'Swiss Modern',
    school: 'International Typographic Style (1950s-60s)',
    summary: 'Grid-perfect grotesque type, stark red-on-white, engineered hierarchy.',
    categories: ['creative', 'accounting', 'real-estate', 'general'],
    status: 'vetted',
    flagship: true,
    system: {
      palette: [
        { name: 'primary', value: '#E30613' },
        { name: 'background', value: '#F7F5F2' },
        { name: 'surface', value: '#FFFFFF' },
        { name: 'text', value: '#111111' },
        { name: 'muted', value: '#6B6B6B' },
      ],
      type: [
        { role: 'display', family: 'Helvetica Neue / Inter Tight, sans-serif', scale: 'clamp(3rem, 8vw, 7rem)' },
        { role: 'heading', family: 'Helvetica Neue / Inter, sans-serif', scale: '1.75rem' },
        { role: 'body', family: 'Helvetica Neue / Inter, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'JetBrains Mono, monospace', scale: '0.875rem' },
        { role: 'label', family: 'Helvetica Neue / Inter, sans-serif', scale: '0.75rem, uppercase, letterspaced' },
      ],
      composition: [
        'Strict 12-column grid, every element snaps to a column',
        'Hero: oversized statement headline over a hard-rule divider',
        'Asymmetric two-field layouts with deliberate negative space',
        'Rules and hairlines replace boxes as separators',
      ],
      controls: [
        'Flat rectangular buttons, no border-radius, high-contrast red primary',
        'Links underlined with 2px rules on hover',
        'Forms: minimal, bottom-border inputs only',
        'Cards: flat surfaces with 1px border, no shadow',
      ],
      motion: [
        'Snap/ease-out 150ms transitions, no bounce',
        'Reveal on scroll: translate-y + opacity, staggered by grid',
      ],
    },
    sparkScene: 'A brutal-red headline "BUILT ON FACTS" over a hairline grid, one photo cropped to a perfect column, and a single red CTA button — nothing else.',
  },
  {
    id: 'coastal-calm',
    name: 'Coastal Calm',
    school: 'Contemporary West Coast / airy minimalism',
    summary: 'Sand, sea, and sky palette; soft rounded type; generous whitespace for wellness brands.',
    categories: ['spa', 'wellness', 'hotel', 'salon', 'real-estate'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#2C7A7B' },
        { name: 'accent', value: '#D69E6A' },
        { name: 'background', value: '#F6F3EE' },
        { name: 'surface', value: '#FFFFFF' },
        { name: 'text', value: '#24403F' },
        { name: 'muted', value: '#7E9A99' },
      ],
      type: [
        { role: 'display', family: 'Fraunces, serif', scale: 'clamp(2.5rem, 6vw, 5rem)' },
        { role: 'heading', family: 'Fraunces, serif', scale: '1.5rem' },
        { role: 'body', family: 'Karla / Inter, sans-serif', scale: '1.0625rem' },
        { role: 'label', family: 'Karla, sans-serif', scale: '0.8rem, uppercase, letterspaced' },
      ],
      composition: [
        'Loose generous spacing, whitespace as the hero',
        'Rounded image frames (24px radius) in a relaxed stack',
        'Centered short-form headers, left-aligned body',
        'One large atmospheric photo per section',
      ],
      controls: [
        'Pill buttons, 999px radius, teal primary, soft hover lift',
        'Cards: 20-24px radius, subtle 2% shadow',
        'Inputs: rounded 12px with soft focus ring',
      ],
      motion: [
        'Slow fade + rise 400ms ease, gentle',
        'Parallax drift on hero imagery, 0.5x speed',
      ],
    },
    sparkScene: 'A sun-bleached hero: "RESTORE YOUR RHYTHM" in soft serif over a misty shoreline photo, a teal pill CTA, and a scroll hint fading below.',
  },
  {
    id: 'artisan-letterpress',
    name: 'Artisan Letterpress',
    school: 'Vintage print shop / letterpress revival',
    summary: 'Warm paper tones, ink-swell serifs, and a hand-crafted feel for makers and food.',
    categories: ['bakery', 'cafe', 'retail', 'creative', 'restaurant'],
    status: 'vetted',
    flagship: true,
    system: {
      palette: [
        { name: 'primary', value: '#8A3B12' },
        { name: 'accent', value: '#C99A3C' },
        { name: 'background', value: '#F4EBDD' },
        { name: 'surface', value: '#FBF6EC' },
        { name: 'text', value: '#3A2A20' },
        { name: 'muted', value: '#8C7A68' },
      ],
      type: [
        { role: 'display', family: 'Playfair Display / Cormorant, serif', scale: 'clamp(2.75rem, 7vw, 6rem)' },
        { role: 'heading', family: 'Playfair Display, serif', scale: '1.6rem' },
        { role: 'body', family: 'Source Serif 4 / Lora, serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Courier Prime, monospace', scale: '0.875rem' },
        { role: 'label', family: 'Playfair Display, serif', scale: '0.85rem, italic' },
      ],
      composition: [
        'Off-center editorial layouts with big margins',
        'Rough paper texture background, ink registration marks as decoration',
        'Display headline overlaid on a duotone photograph',
        'Footer styled as a colophon (small caps, centered)',
      ],
      controls: [
        'Buttons: ink-filled rectangle with 2px offset shadow (letterpress dip)',
        'Links: serif italic with hand-drawn underline',
        'Badges as wax-seal circles',
      ],
      motion: [
        'Press-down micro-interaction on buttons (translate-y 2px + shadow)',
        'Fade-in with slight paper grain, 350ms',
      ],
    },
    sparkScene: 'A bakery hero: "BAKED AT DAWN" in swelled serif over a flour-dusted counter photo, a wax-seal badge, and a rough-paper grain across the whole page.',
  },
  {
    id: 'neo-grotesque-tech',
    name: 'Neo-Grotesque Tech',
    school: 'Contemporary SaaS / neo-grotesque',
    summary: 'Clean, sharp, and credible — the anti-slop SaaS system with real hierarchy and no purple gradients.',
    categories: ['accounting', 'legal', 'creative', 'general'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#2563EB' },
        { name: 'background', value: '#FFFFFF' },
        { name: 'surface', value: '#F8FAFC' },
        { name: 'text', value: '#0F172A' },
        { name: 'muted', value: '#64748B' },
        { name: 'border', value: '#E2E8F0' },
      ],
      type: [
        { role: 'display', family: 'Inter / Plus Jakarta Sans, sans-serif', scale: 'clamp(2.5rem, 6vw, 4.5rem)' },
        { role: 'heading', family: 'Inter, sans-serif', scale: '1.25rem' },
        { role: 'body', family: 'Inter, sans-serif', scale: '1rem' },
        { role: 'mono', family: 'JetBrains Mono, monospace', scale: '0.875rem' },
        { role: 'label', family: 'Inter, sans-serif', scale: '0.75rem, uppercase, letterspaced' },
      ],
      composition: [
        'Product-shot hero with a clean two-column feature grid',
        'Metrics band with big numerals, no decorative gradients',
        'Left-aligned marketing copy, max 65ch',
        'Consistent 8px spacing system throughout',
      ],
      controls: [
        'Buttons: 8px radius, blue primary, subtle 1px border secondary',
        'Cards: 12px radius, 1px border + very light shadow',
        'Inputs: 8px radius, border-gray, blue focus ring',
        'No glassmorphism, no icon-tile stacks',
      ],
      motion: [
        'Fast 150ms ease, purpose-driven only',
        'Chart/stat count-up on scroll into view',
      ],
    },
    sparkScene: 'A product hero: "YOUR BOOKS, WITHOUT THE BUSY WORK" in tight Inter over a real dashboard screenshot, one blue CTA and a metrics band of three bold numbers.',
  },
  {
    id: 'editorial-broadsheet',
    name: 'Editorial Broadsheet',
    school: 'Broadsheet newspaper / magazine editorial',
    summary: 'Masthead-scale serif headlines, columns, and a red banner accent — authority for professionals.',
    categories: ['legal', 'accounting', 'education', 'real-estate', 'general'],
    status: 'vetted',
    flagship: true,
    system: {
      palette: [
        { name: 'primary', value: '#B01E23' },
        { name: 'background', value: '#FCFBF7' },
        { name: 'surface', value: '#FFFFFF' },
        { name: 'text', value: '#1A1A1A' },
        { name: 'muted', value: '#555555' },
        { name: 'rule', value: '#D8D3C8' },
      ],
      type: [
        { role: 'display', family: 'Libre Caslon / Playfair Display, serif', scale: 'clamp(2.75rem, 7vw, 6.5rem)' },
        { role: 'heading', family: 'Libre Caslon, serif', scale: '1.5rem' },
        { role: 'body', family: 'Source Serif 4, serif', scale: '1.0625rem' },
        { role: 'mono', family: 'IBM Plex Mono, monospace', scale: '0.8125rem' },
        { role: 'label', family: 'Libre Caslon, serif', scale: '0.75rem, uppercase, letterspaced' },
      ],
      composition: [
        'Masthead banner with double rules top and bottom',
        'Multi-column article grids (2-3 columns on desktop)',
        'Drop caps on long-form sections',
        'Pull quotes with heavy side rules',
      ],
      controls: [
        'Buttons: square, serif label, 1px border, fill on hover',
        'Navigation as a thin masthead rule with serif links',
        'Forms: serif labels, bordered fields with boxed focus',
      ],
      motion: [
        'Static-first; reveal only as 200ms fade',
        'No bounce, no parallax — content is the motion',
      ],
    },
    sparkScene: 'A masthead in huge Caslon "THE STANDARD OF TRUST" with a red top rule, a two-column opening article, and a bordered pull-quote midway.',
  },
  {
    id: 'vintage-americana',
    name: 'Vintage Americana',
    school: 'Mid-century American sign painting',
    summary: 'Badges, stars, and confident slab serifs — heritage appeal for auto, barber, and diners.',
    categories: ['auto', 'barber', 'restaurant', 'retail', 'bar'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#C1272D' },
        { name: 'secondary', value: '#1F3A93' },
        { name: 'accent', value: '#F2C94C' },
        { name: 'background', value: '#F6F1E7' },
        { name: 'text', value: '#2B2B2B' },
      ],
      type: [
        { role: 'display', family: 'Bungee / Alfa Slab One, display', scale: 'clamp(2.5rem, 6vw, 5rem)' },
        { role: 'heading', family: 'Bungee, display', scale: '1.4rem' },
        { role: 'body', family: 'Karla, sans-serif', scale: '1rem' },
        { role: 'mono', family: 'Special Elite, monospace', scale: '0.875rem' },
        { role: 'label', family: 'Special Elite, monospace', scale: '0.8rem, uppercase' },
      ],
      composition: [
        'Badge-shaped heroes: circle or shield framing the headline',
        'Banners with angled ends (ribbon strips)',
        'Stars and stripes as section dividers',
        'Centered stacked layouts with heavy borders',
      ],
      controls: [
        'Buttons: chunky slab with 3px solid border, offset hard shadow',
        'Cards: thick 2px borders, corner ticks',
        'Toggles styled as license plates',
      ],
      motion: [
        'Hard 100ms snaps, no easing curves',
        'Sticker-peel on hover (rotate 1-2deg)',
      ],
    },
    sparkScene: 'A shield badge hero: "EST. 1962 — FAMILY OWNED" in Bungee over a checkered garage floor, a red ribbon CTA, and a star divider below.',
  },
  {
    id: 'botanical-natural',
    name: 'Botanical Natural',
    school: 'Victorian botanical illustration meets modern organic design',
    summary: 'Deep greens, leaf motifs, and structured serif — for landscaping, wellness, and organic retail.',
    categories: ['landscaping', 'wellness', 'retail', 'spa', 'cleaning'],
    status: 'vetted',
    flagship: true,
    system: {
      palette: [
        { name: 'primary', value: '#1F5B3D' },
        { name: 'accent', value: '#8FB996' },
        { name: 'background', value: '#F2F5EC' },
        { name: 'surface', value: '#FFFFFF' },
        { name: 'text', value: '#1C2B21' },
        { name: 'muted', value: '#6B7A6E' },
      ],
      type: [
        { role: 'display', family: 'Cormorant Garamond, serif', scale: 'clamp(2.75rem, 7vw, 5.5rem)' },
        { role: 'heading', family: 'Cormorant Garamond, serif', scale: '1.6rem' },
        { role: 'body', family: 'Karla / Work Sans, sans-serif', scale: '1.0625rem' },
        { role: 'label', family: 'Karla, sans-serif', scale: '0.8rem, uppercase, letterspaced' },
      ],
      composition: [
        'Botanical line-art illustrations as section frames',
        'Organic, non-rectangular section dividers (leaf silhouettes)',
        'Alternating full-bleed green and cream panels',
        'Large type over soft-focus foliage photography',
      ],
      controls: [
        'Buttons: leaf-green pill or rectangular with leaf icon',
        'Cards: 16px radius, white on green-tint background',
        'Inputs with rounded 10px corners, green focus',
      ],
      motion: [
        'Gentle sway/float on leaf motifs, 3s loop',
        'Fade-up reveals with 500ms ease-out',
      ],
    },
    sparkScene: 'A full-bleed canopy photo, "LET NATURE DO THE TALKING" in Cormorant over the green, with a line-art fern divider and a white pill CTA.',
  },
  {
    id: 'brutalist-utility',
    name: 'Brutalist Utility',
    school: 'Swiss brutalism / raw functionalism',
    summary: 'Raw, honest, and loud: mono type, hard shadows, and no decoration for trades and builders.',
    categories: ['trades', 'construction', 'auto', 'home-services', 'general'],
    status: 'vetted',
    flagship: true,
    system: {
      palette: [
        { name: 'primary', value: '#FFB800' },
        { name: 'background', value: '#EDEDED' },
        { name: 'surface', value: '#D9D9D9' },
        { name: 'text', value: '#111111' },
        { name: 'accent', value: '#333333' },
      ],
      type: [
        { role: 'display', family: 'Archivo Black / Space Grotesk, sans-serif', scale: 'clamp(3rem, 9vw, 8rem)' },
        { role: 'heading', family: 'Archivo Black, sans-serif', scale: '1.5rem' },
        { role: 'body', family: 'Space Grotesk, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'IBM Plex Mono, monospace', scale: '0.9375rem' },
        { role: 'label', family: 'IBM Plex Mono, monospace', scale: '0.8rem, uppercase' },
      ],
      composition: [
        'Hard offset shadows (4px 4px 0 black) on every block',
        'Uppercase oversized headlines, often with outlined words',
        'Visible grid lines and measurement ticks',
        'Marquee/strip banners with repeated text',
      ],
      controls: [
        'Buttons: black fill, yellow border, 2px offset white shadow',
        'Cards: gray surface, 3px black border, hard shadow',
        'No rounded corners anywhere except 0',
      ],
      motion: [
        'Instant 0ms state changes (no easing)',
        'Marquee scroll on repeat, 20s linear',
      ],
    },
    sparkScene: 'A construction hero: "WE BUILD. WE DELIVER." in Archivo Black with one outlined word, hard yellow-on-black CTA, and measurement ticks along the edge.',
  },
  {
    id: 'art-deco-glam',
    name: 'Art Deco Glam',
    school: 'Art Deco / 1920s-30s glamour',
    summary: 'Gold geometry, black lacquer, and fan motifs — luxury for salons, hotels, and events.',
    categories: ['salon', 'hotel', 'events', 'boutique', 'bar'],
    status: 'vetted',
    flagship: true,
    system: {
      palette: [
        { name: 'primary', value: '#C9A227' },
        { name: 'background', value: '#121212' },
        { name: 'surface', value: '#1E1C1A' },
        { name: 'text', value: '#F5EFE0' },
        { name: 'muted', value: '#A89F8C' },
        { name: 'line', value: '#C9A227' },
      ],
      type: [
        { role: 'display', family: 'Marcellus / Cinzel, serif', scale: 'clamp(2.75rem, 7vw, 6rem)' },
        { role: 'heading', family: 'Marcellus, serif', scale: '1.5rem' },
        { role: 'body', family: 'Jost / Outfit, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Spectral, serif', scale: '0.875rem' },
        { role: 'label', family: 'Jost, sans-serif', scale: '0.75rem, uppercase, letterspaced' },
      ],
      composition: [
        'Symmetric mirrored layouts with center golden axis',
        'Geometric frame corners (double-line right angles)',
        'Fan and sunburst motifs behind the hero',
        'Thin gold rules separating every section',
      ],
      controls: [
        'Buttons: gold-outlined rectangle, fill gold on hover, 2px border',
        'Cards: black with gold hairline border, 0 radius',
        'Inputs: bottom gold rule only, gold focus line',
      ],
      motion: [
        'Reveal with clip-path corner expansion, 400ms',
        'Gold shimmer sweep across CTAs, 2.5s loop',
      ],
    },
    sparkScene: 'A black lacquer hero with a gold sunburst, "TIMELESS, BY DESIGN" in Marcellus, a gold hairline frame, and a single gold-outline CTA.',
  },
  {
    id: 'playful-pop',
    name: 'Playful Pop',
    school: 'Swiss pop / Memphis-adjacent fun',
    summary: 'Bright candy colors, chunky rounded forms, and a cheerful bounce for kids and creative services.',
    categories: ['education', 'creative', 'retail', 'events', 'general'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#FF5A5F' },
        { name: 'secondary', value: '#4ECDC4' },
        { name: 'accent', value: '#FFD93D' },
        { name: 'background', value: '#FFF8F0' },
        { name: 'text', value: '#2D2A32' },
        { name: 'surface', value: '#FFFFFF' },
      ],
      type: [
        { role: 'display', family: 'Baloo 2 / Fredoka, rounded sans', scale: 'clamp(2.75rem, 7vw, 5.5rem)' },
        { role: 'heading', family: 'Baloo 2, sans-serif', scale: '1.5rem' },
        { role: 'body', family: 'Nunito, sans-serif', scale: '1.0625rem' },
        { role: 'label', family: 'Nunito, sans-serif', scale: '0.8rem, bold, uppercase' },
      ],
      composition: [
        'Big rounded cards on a soft cream background',
        'Squiggle/star decorations scattered with restraint',
        'Hero with character illustration, headline as a speech bubble',
        'Offset rotated blocks for section rhythm',
      ],
      controls: [
        'Buttons: 999px radius, candy fill, 3px darker border, press-down bounce',
        'Cards: 24px radius, 3px border, hard small shadow',
        'Inputs: rounded 16px with happy focus ring',
      ],
      motion: [
        'Bounce-in on reveal (scale 0.8 -> 1, overshoot), 500ms',
        'Hover wiggle 2deg on illustrations',
      ],
    },
    sparkScene: 'A sunny hero: "LEARN BY PLAYING" in Baloo 2 over a doodle illustration, a speech-bubble headline, candy-colored CTA, and a star divider.',
  },
  {
    id: 'farmhouse-rustic',
    name: 'Farmhouse Rustic',
    school: 'Modern farmhouse / country kitchen',
    summary: 'Warm wood, chalkboard accents, and honest textures for home services and farm-to-table.',
    categories: ['home-services', 'restaurant', 'bakery', 'cafe', 'landscaping'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#6B4E31' },
        { name: 'accent', value: '#A8763E' },
        { name: 'background', value: '#F7F1E5' },
        { name: 'surface', value: '#FFFDF7' },
        { name: 'text', value: '#3B2E20' },
        { name: 'muted', value: '#8A7B66' },
      ],
      type: [
        { role: 'display', family: 'DM Serif Display, serif', scale: 'clamp(2.5rem, 6vw, 5rem)' },
        { role: 'heading', family: 'DM Serif Display, serif', scale: '1.5rem' },
        { role: 'body', family: 'Karla, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Special Elite, monospace', scale: '0.875rem' },
        { role: 'label', family: 'Karla, sans-serif', scale: '0.8rem, uppercase, letterspaced' },
      ],
      composition: [
        'Chalkboard-style text blocks on dark green-black panels',
        'Rough wood texture as a thin header band',
        'Large serif headlines over muted photographs',
        'Masonry layout for gallery sections',
      ],
      controls: [
        'Buttons: wood-tone fill, 6px radius, chalk-outline hover',
        'Cards: off-white with 1px warm border, slight texture',
        'Inputs: bordered with warm focus tint',
      ],
      motion: [
        'Fade-up 300ms, no bounce',
        'Chalk draw-in on hover (stroke-dashoffset animation)',
      ],
    },
    sparkScene: 'A chalkboard hero: "GOOD PEOPLE. HONEST WORK." in DM Serif over a rustic tool photo, a wood band at the top, and a warm tan CTA.',
  },
  {
    id: 'medical-calm',
    name: 'Medical Calm',
    school: 'Evidence-based healthcare / clinical trust',
    summary: 'Clear, reassuring, and accessible — blue-teal palette with strong contrast for clinics and dental.',
    categories: ['medical', 'dental', 'wellness', 'spa'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#0E7490' },
        { name: 'secondary', value: '#2DD4BF' },
        { name: 'background', value: '#F0F9FF' },
        { name: 'surface', value: '#FFFFFF' },
        { name: 'text', value: '#0F172A' },
        { name: 'muted', value: '#475569' },
      ],
      type: [
        { role: 'display', family: 'Public Sans / Inter, sans-serif', scale: 'clamp(2.25rem, 6vw, 4rem)' },
        { role: 'heading', family: 'Public Sans, sans-serif', scale: '1.25rem' },
        { role: 'body', family: 'Public Sans, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Roboto Mono, monospace', scale: '0.875rem' },
        { role: 'label', family: 'Public Sans, sans-serif', scale: '0.78rem, semibold' },
      ],
      composition: [
        'Calm centered hero with one real team/office photo',
        'Services in a clean 3-column card grid',
        'Trust band: certifications, hours, insurance icons',
        'Accessible contrast: AA on all text (verified)',
      ],
      controls: [
        'Buttons: 10px radius, teal primary, white secondary outline',
        'Cards: 14px radius, 1px border, flat',
        'Inputs: 10px radius, generous height for touch',
        'Focus rings 2.5px for visibility',
      ],
      motion: [
        'Slow 250ms ease, no decoration',
        'No parallax, no bounce — calm and predictable',
      ],
    },
    sparkScene: 'A clinic hero: "CARE THAT PUTS YOU FIRST" in Public Sans over a warm waiting-room photo, a teal appointment CTA, and a trust band of four simple icons.',
  },
  {
    id: 'athletic-bold',
    name: 'Athletic Bold',
    school: 'Sports poster / athletic typography',
    summary: 'Italic impact type, diagonal energy, and a black-white-voltage palette for gyms and fitness.',
    categories: ['gym', 'fitness', 'events', 'education'],
    status: 'vetted',
    flagship: true,
    system: {
      palette: [
        { name: 'primary', value: '#FF3D00' },
        { name: 'background', value: '#0B0B0D' },
        { name: 'surface', value: '#16161A' },
        { name: 'text', value: '#FFFFFF' },
        { name: 'muted', value: '#8A8A93' },
        { name: 'line', value: '#2E2E36' },
      ],
      type: [
        { role: 'display', family: 'Anton / Archivo Black, sans-serif', scale: 'clamp(3rem, 10vw, 8rem)' },
        { role: 'heading', family: 'Anton, sans-serif', scale: '1.6rem' },
        { role: 'body', family: 'Inter, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'JetBrains Mono, monospace', scale: '0.9375rem' },
        { role: 'label', family: 'Inter, sans-serif', scale: '0.8rem, bold, uppercase' },
      ],
      composition: [
        'Diagonal slash panels and skewed headline blocks',
        'Countdown/stat numerals huge over photo',
        'Black background with one voltage accent',
        'Grid of program cards with hard borders',
      ],
      controls: [
        'Buttons: skewed (-4deg) parallelogram, voltage fill, black text',
        'Cards: 0 radius, 1px gray border on black',
        'Progress bars with hard-edge fill',
      ],
      motion: [
        'Punch-in reveal (scale 1.1 -> 1), 200ms',
        'Marquee of class times, 25s linear',
      ],
    },
    sparkScene: 'A gym hero: "NO SHORTCUTS" in Anton, skewed, over a chalk-dusted barbell photo on black, a diagonal voltage CTA and a huge stat "800+ MEMBERS".',
  },
  {
    id: 'minimal-japanese',
    name: 'Minimal Japanese',
    school: 'Japanese minimalism / wabi-sabi',
    summary: 'Ink, paper, and empty space — a whisper of a system for boutique and creative clients.',
    categories: ['boutique', 'creative', 'spa', 'retail', 'general'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#1A1A1A' },
        { name: 'accent', value: '#C0392B' },
        { name: 'background', value: '#FAF9F6' },
        { name: 'surface', value: '#FFFFFF' },
        { name: 'text', value: '#262626' },
        { name: 'muted', value: '#8C8C8C' },
      ],
      type: [
        { role: 'display', family: 'Shippori Mincho / Noto Serif JP, serif', scale: 'clamp(2.5rem, 6vw, 5rem)' },
        { role: 'heading', family: 'Shippori Mincho, serif', scale: '1.375rem' },
        { role: 'body', family: 'Noto Sans JP / Inter, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Noto Sans Mono, monospace', scale: '0.8125rem' },
        { role: 'label', family: 'Noto Sans JP, sans-serif', scale: '0.75rem, letterspaced' },
      ],
      composition: [
        'Extreme whitespace: one element per viewport section',
        'Thin hairline rules, generous 96px+ section padding',
        'Small en-dash separators, katakana accents for texture',
        'One small image, cropped tight, never full-bleed',
      ],
      controls: [
        'Buttons: 0 radius, 1px border, fill on hover only',
        'Cards: borderless, separated by space alone',
        'Inputs: bottom rule only, no boxes',
      ],
      motion: [
        'Slow fade 600ms, nothing moves quickly',
        'Single subtle transition, no loop animations',
      ],
    },
    sparkScene: 'A near-empty hero: one line "静けさ — QUIET CRAFT" in Shippori Mincho on warm paper, a single red accent dot, and a hairline rule below.',
  },
  {
    id: 'retro-diner',
    name: 'Retro Diner',
    school: '1950s American diner',
    summary: 'Chrome, red vinyl, and checkered floors — a nostalgic system for diners, burgers, and bars.',
    categories: ['restaurant', 'cafe', 'bar', 'bakery'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#D62828' },
        { name: 'secondary', value: '#F77F00' },
        { name: 'accent', value: '#E5E5E5' },
        { name: 'background', value: '#FFF8E7' },
        { name: 'text', value: '#2B2B2B' },
        { name: 'checker', value: '#111111' },
      ],
      type: [
        { role: 'display', family: 'Lilita One / Bungee Shade, display', scale: 'clamp(2.75rem, 7vw, 6rem)' },
        { role: 'heading', family: 'Lilita One, display', scale: '1.5rem' },
        { role: 'body', family: 'Karla, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Special Elite, monospace', scale: '0.9375rem' },
        { role: 'label', family: 'Karla, sans-serif', scale: '0.8rem, bold, uppercase' },
      ],
      composition: [
        'Checkerboard band as a section divider',
        'Chrome gradient text (silver sweep) on display type',
        'Menu boards styled as overhead light panels',
        'Rounded booths framing photos',
      ],
      controls: [
        'Buttons: red pill with white outline, chrome shine',
        'Cards: rounded 18px, white with red trim',
        'Inputs: rounded with chrome border',
      ],
      motion: [
        'Neon flicker on headline, 3s loop',
        'Bounce on CTA, 250ms',
      ],
    },
    sparkScene: 'A diner hero: "OPEN TILL MIDNIGHT" in Lilita One with chrome shine over a red vinyl booth photo, a checkerboard divider, and a chrome pill CTA.',
  },
  {
    id: 'midnight-luxury',
    name: 'Midnight Luxury',
    school: 'Modern luxury / dark editorial',
    summary: 'Deep navy-black, champagne type, and cinematic imagery for premium services.',
    categories: ['hotel', 'events', 'real-estate', 'boutique', 'auto'],
    status: 'vetted',
    flagship: true,
    system: {
      palette: [
        { name: 'primary', value: '#C9A227' },
        { name: 'background', value: '#0A0E1A' },
        { name: 'surface', value: '#111827' },
        { name: 'text', value: '#F3EFE6' },
        { name: 'muted', value: '#9CA3AF' },
        { name: 'line', value: '#2A3142' },
      ],
      type: [
        { role: 'display', family: 'Cormorant Garamond / Playfair Display, serif', scale: 'clamp(2.75rem, 7vw, 6rem)' },
        { role: 'heading', family: 'Cormorant Garamond, serif', scale: '1.5rem' },
        { role: 'body', family: 'Jost, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Spectral, serif', scale: '0.875rem' },
        { role: 'label', family: 'Jost, sans-serif', scale: '0.75rem, uppercase, letterspaced' },
      ],
      composition: [
        'Full-bleed cinematic photography with dark gradient scrim',
        'Small-caps eyebrow over huge serif headline',
        'Letter-spaced body in short elegant lines',
        'One thin gold line as the only decoration',
      ],
      controls: [
        'Buttons: 0 radius, gold 1px border, fill on hover',
        'Cards: dark surface, 1px muted border, 0 radius',
        'Inputs: dark with gold focus rule',
      ],
      motion: [
        'Slow cinematic zoom on hero (Ken Burns), 20s',
        'Fade + rise 700ms, luxurious pace',
      ],
    },
    sparkScene: 'A dark hero: "AN EVENING TO REMEMBER" in Cormorant over a candlelit event photo, a small-caps eyebrow, one gold hairline, and a bordered gold CTA.',
  },
  {
    id: 'urban-street',
    name: 'Urban Street',
    school: 'Streetwear / graffiti-influenced',
    summary: 'Scuffed type, sticker layers, and bold spray accents for barbers, streetwear, and nightlife.',
    categories: ['barber', 'retail', 'events', 'bar', 'boutique'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#FFC107' },
        { name: 'secondary', value: '#E53935' },
        { name: 'background', value: '#181818' },
        { name: 'surface', value: '#222222' },
        { name: 'text', value: '#F5F5F5' },
        { name: 'muted', value: '#9E9E9E' },
      ],
      type: [
        { role: 'display', family: 'Permanent Marker / Bangers, display', scale: 'clamp(2.75rem, 8vw, 6.5rem)' },
        { role: 'heading', family: 'Bangers, display', scale: '1.5rem' },
        { role: 'body', family: 'Space Grotesk, sans-serif', scale: '1rem' },
        { role: 'mono', family: 'IBM Plex Mono, monospace', scale: '0.875rem' },
        { role: 'label', family: 'Space Grotesk, sans-serif', scale: '0.8rem, bold, uppercase' },
      ],
      composition: [
        'Sticker-tape labels rotated over photos',
        'Spray-can drips and arrow motifs',
        'Asymmetric collage layouts, overlapping blocks',
        'Price/offer stamped like a rubber stamp',
      ],
      controls: [
        'Buttons: yellow spray fill, black outline, rough edge (clip-path)',
        'Cards: dark with 1px border, sticker corner',
        'Inputs: dark, yellow focus',
      ],
      motion: [
        'Sticker slap-in (scale 1.3 -> 1 + rotate), 250ms',
        'Marquee of tag text, 18s linear',
      ],
    },
    sparkScene: 'A barbershop hero: "FRESH CUTS, REAL TALK" in Permanent Marker over a concrete wall photo, a rotated sticker CTA, and a spray-drip accent.',
  },
  {
    id: 'parisian-bistro',
    name: 'Parisian Bistro',
    school: 'French bistro / belle époque signage',
    summary: 'Navy, cream, and gold script — effortless charm for cafes, bakeries, and restaurants.',
    categories: ['cafe', 'restaurant', 'bakery', 'bar', 'hotel'],
    status: 'vetted',
    flagship: true,
    system: {
      palette: [
        { name: 'primary', value: '#1F2A44' },
        { name: 'accent', value: '#B08D57' },
        { name: 'background', value: '#FAF6EF' },
        { name: 'surface', value: '#FFFFFF' },
        { name: 'text', value: '#20242E' },
        { name: 'muted', value: '#7A7E8A' },
      ],
      type: [
        { role: 'display', family: 'Playfair Display / Cormorant, serif', scale: 'clamp(2.5rem, 6vw, 5rem)' },
        { role: 'heading', family: 'Playfair Display, serif', scale: '1.5rem' },
        { role: 'body', family: 'Karla, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Courier Prime, monospace', scale: '0.875rem' },
        { role: 'label', family: 'Great Vibes / Pacifico, script', scale: '1.25rem' },
      ],
      composition: [
        'Script accent word floating over a serif headline',
        'Menu as a café chalkboard or paper card',
        'Cream background with navy text blocks',
        'Gold rule framing the hero photo',
      ],
      controls: [
        'Buttons: navy fill, 0 radius, gold hover underline',
        'Cards: white with 1px warm border',
        'Inputs: bordered, navy focus',
      ],
      motion: [
        'Script word draws in (stroke animation), 600ms',
        'Fade-up 350ms, gentle',
      ],
    },
    sparkScene: 'A café hero: "Bonjour - TODAY SPECIAL" with a gold script flourish over a croissant counter photo, navy headline, and a navy CTA with gold underline.',
  },
  {
    id: 'eco-earth',
    name: 'Eco Earth',
    school: 'Eco-conscious / recycled materials',
    summary: 'Kraft, forest tones, and honest textures for cleaning, landscaping, and sustainability brands.',
    categories: ['cleaning', 'landscaping', 'retail', 'home-services', 'wellness'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#4A7C59' },
        { name: 'accent', value: '#C98F4A' },
        { name: 'background', value: '#F3EDE3' },
        { name: 'surface', value: '#FBF7EF' },
        { name: 'text', value: '#2C2C2C' },
        { name: 'muted', value: '#7D7468' },
      ],
      type: [
        { role: 'display', family: 'Fraunces, serif', scale: 'clamp(2.5rem, 6vw, 5rem)' },
        { role: 'heading', family: 'Fraunces, serif', scale: '1.4rem' },
        { role: 'body', family: 'Work Sans, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Space Mono, monospace', scale: '0.875rem' },
        { role: 'label', family: 'Work Sans, sans-serif', scale: '0.78rem, uppercase, letterspaced' },
      ],
      composition: [
        'Kraft paper texture backgrounds and recycled edges',
        'Leaf/stamp icons instead of generic icon tiles',
        'Impact-statement hero with one big number',
        'Process steps as a vertical timeline',
      ],
      controls: [
        'Buttons: forest fill, 8px radius, leaf icon option',
        'Cards: kraft-tinted with 1px warm border',
        'Inputs: bordered, forest focus',
      ],
      motion: [
        'Reveal with 400ms ease, natural feel',
        'Leaf float on hero, 4s loop (subtle)',
      ],
    },
    sparkScene: 'A kraft-paper hero: "CLEAN THAT DOES NOT COST THE EARTH" in Fraunces over a green-tinted cleaning photo, a forest CTA, and a stamp-style trust badge.',
  },
  {
    id: 'fitness-charge',
    name: 'Fitness Charge',
    school: 'Contemporary fitness brand / energetic minimal',
    summary: 'Electric lime on black, condensed type, and fast motion for modern gyms and studios.',
    categories: ['gym', 'fitness', 'wellness', 'events'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#CCFF00' },
        { name: 'background', value: '#0E0E0E' },
        { name: 'surface', value: '#1A1A1A' },
        { name: 'text', value: '#FFFFFF' },
        { name: 'muted', value: '#888888' },
      ],
      type: [
        { role: 'display', family: 'Archivo Expanded / Space Grotesk, sans-serif', scale: 'clamp(2.5rem, 7vw, 6rem)' },
        { role: 'heading', family: 'Archivo, sans-serif', scale: '1.5rem' },
        { role: 'body', family: 'Space Grotesk, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'JetBrains Mono, monospace', scale: '0.9375rem' },
        { role: 'label', family: 'Space Grotesk, sans-serif', scale: '0.8rem, bold, uppercase' },
      ],
      composition: [
        'Electric lime as a thin accent line, never a gradient',
        'Condensed uppercase headline, tight tracking',
        'Black-and-white photography with lime overlays',
        'Schedule cards in a dense, efficient grid',
      ],
      controls: [
        'Buttons: lime fill, black text, 4px radius, hard shadow',
        'Cards: dark, 12px radius, 1px border',
        'Inputs: dark, lime focus',
      ],
      motion: [
        'Fast 120ms snaps, energetic',
        'Lime progress bar pulses on hover',
      ],
    },
    sparkScene: 'A studio hero: "TRAIN HARD. RECOVER HARDER." in condensed Archivo over a sweat-lit photo, a thin lime rule, and a lime CTA with black text.',
  },
  {
    id: 'heritage-wine',
    name: 'Heritage Wine',
    school: 'Old-world winery / heritage crest',
    summary: 'Burgundy, cream, and gold crest details for restaurants, tasting rooms, and luxury retail.',
    categories: ['restaurant', 'bar', 'retail', 'hotel', 'events'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#722F37' },
        { name: 'accent', value: '#C2A26B' },
        { name: 'background', value: '#FAF5EC' },
        { name: 'surface', value: '#FFFFFF' },
        { name: 'text', value: '#2E2019' },
        { name: 'muted', value: '#8B7B6E' },
      ],
      type: [
        { role: 'display', family: 'Cormorant Garamond, serif', scale: 'clamp(2.75rem, 7vw, 5.5rem)' },
        { role: 'heading', family: 'Cormorant Garamond, serif', scale: '1.5rem' },
        { role: 'body', family: 'Jost, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Spectral, serif', scale: '0.875rem' },
        { role: 'label', family: 'Jost, sans-serif', scale: '0.75rem, uppercase, letterspaced' },
      ],
      composition: [
        'Crest/emblem in the header, drawn in gold lines',
        'Wine-label framing around hero imagery',
        'Serif headlines over cream panels',
        'Tasting notes as a bordered card list',
      ],
      controls: [
        'Buttons: burgundy fill, 0 radius, gold border on hover',
        'Cards: cream, 1px gold hairline, 0 radius',
        'Inputs: bottom rule, burgundy focus',
      ],
      motion: [
        'Fade-up 400ms, dignified',
        'Gold hairline draws across on hover, 300ms',
      ],
    },
    sparkScene: 'A tasting-room hero: "ESTATE GROWN, ESTATE BOTTLED" in Cormorant under a gold crest, burgundy CTA, and a cream card listing three tasting notes.',
  },
  {
    id: 'boutique-fashion',
    name: 'Boutique Fashion',
    school: 'Fashion editorial / refined feminine',
    summary: 'Blush, ivory, and black with elegant serifs — for boutiques, salons, and photography.',
    categories: ['boutique', 'salon', 'photography', 'retail', 'events'],
    status: 'vetted',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#3D3D3D' },
        { name: 'accent', value: '#D6A2A2' },
        { name: 'background', value: '#FAF7F5' },
        { name: 'surface', value: '#FFFFFF' },
        { name: 'text', value: '#2B2B2B' },
        { name: 'muted', value: '#8F8A87' },
      ],
      type: [
        { role: 'display', family: 'Cormorant Garamond / Didot, serif', scale: 'clamp(2.5rem, 6vw, 5rem)' },
        { role: 'heading', family: 'Cormorant Garamond, serif', scale: '1.4rem' },
        { role: 'body', family: 'Jost / Montserrat, sans-serif', scale: '1.0625rem' },
        { role: 'mono', family: 'Spectral, serif', scale: '0.875rem' },
        { role: 'label', family: 'Jost, sans-serif', scale: '0.75rem, uppercase, letterspaced' },
      ],
      composition: [
        'Editorial fashion layouts with asymmetric frames',
        'Lookbook: full-bleed imagery, small type captions',
        'Blush tint panels between white sections',
        'Large serif pull-quotes over images',
      ],
      controls: [
        'Buttons: black fill, 0 radius, blush hover sweep',
        'Cards: borderless white with generous padding',
        'Inputs: hairline underline, blush focus',
      ],
      motion: [
        'Slow elegant fade 500ms',
        'Image crossfade on lookbook hover, 400ms',
      ],
    },
    sparkScene: 'A boutique hero: "DRESSED TO FEEL LIKE YOU" in Cormorant over an editorial fashion photo, a blush tint band, and a black CTA with a blush hover sweep.',
  },
  {
    id: 'tech-dark-ops',
    name: 'Tech Dark Ops',
    school: 'Dark-mode product / developer aesthetic',
    summary: 'True dark surfaces, mono accents, and terminal-grade clarity — for B2B tools and agencies.',
    categories: ['creative', 'accounting', 'legal', 'general'],
    status: 'draft',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#22D3EE' },
        { name: 'background', value: '#0B0F19' },
        { name: 'surface', value: '#111827' },
        { name: 'text', value: '#E5E7EB' },
        { name: 'muted', value: '#9CA3AF' },
        { name: 'line', value: '#1F2937' },
      ],
      type: [
        { role: 'display', family: 'Space Grotesk, sans-serif', scale: 'clamp(2.25rem, 6vw, 4.5rem)' },
        { role: 'heading', family: 'Space Grotesk, sans-serif', scale: '1.25rem' },
        { role: 'body', family: 'Inter, sans-serif', scale: '1rem' },
        { role: 'mono', family: 'JetBrains Mono, monospace', scale: '0.875rem' },
        { role: 'label', family: 'JetBrains Mono, monospace', scale: '0.78rem, uppercase' },
      ],
      composition: [
        'Terminal prompt hero with typed commands',
        'Dark layered cards, no glow, no purple',
        'Mono labels over sans body',
        'Tight code-like data tables',
      ],
      controls: [
        'Buttons: cyan fill on dark, 6px radius, no glow',
        'Cards: 1px line border on surface',
        'Inputs: dark, mono cursor',
      ],
      motion: [
        'Typing animation on hero, 2s',
        'Fast 150ms, mechanical',
      ],
    },
    sparkScene: 'A terminal hero: "$ ./build --trust" in mono over a dark dashboard mock, a cyan CTA, and a data table of three uptime stats.',
  },
  {
    id: 'kids-playful-learning',
    name: 'Kids Playful Learning',
    school: 'Children\'s book / friendly education',
    summary: 'Warm primary colors, storybook illustration, and rounded friendliness for education and care.',
    categories: ['education', 'events', 'general'],
    status: 'draft',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#FF8C42' },
        { name: 'secondary', value: '#4ECDC4' },
        { name: 'accent', value: '#FFD166' },
        { name: 'background', value: '#FFF6EA' },
        { name: 'text', value: '#33312E' },
        { name: 'surface', value: '#FFFFFF' },
      ],
      type: [
        { role: 'display', family: 'Fredoka / Baloo 2, rounded sans', scale: 'clamp(2.75rem, 7vw, 5.5rem)' },
        { role: 'heading', family: 'Fredoka, sans-serif', scale: '1.5rem' },
        { role: 'body', family: 'Nunito, sans-serif', scale: '1.0625rem' },
        { role: 'label', family: 'Nunito, sans-serif', scale: '0.8rem, bold' },
      ],
      composition: [
        'Storybook scene hero with illustrated characters',
        'Rounded shape dividers (clouds, waves)',
        'Activity cards like game boards',
        'Big touch targets, high contrast text',
      ],
      controls: [
        'Buttons: 999px radius, thick 3px border, fun press-down',
        'Cards: 20px radius, soft color fills',
        'Inputs: large, rounded 16px',
      ],
      motion: [
        'Gentle bob on illustrations, 2s loop',
        'Pop-in 300ms with overshoot',
      ],
    },
    sparkScene: 'A storybook hero: "WHERE LEARNING FEELS LIKE PLAY" in Fredoka over an illustrated classroom, a cloud divider, and a big orange CTA.',
  },
  {
    id: 'event-festive',
    name: 'Event Festive',
    school: 'Festival / celebration graphics',
    summary: 'Vivid confetti palette and bold type for events, launches, and celebrations.',
    categories: ['events', 'bar', 'restaurant', 'creative'],
    status: 'draft',
    flagship: false,
    system: {
      palette: [
        { name: 'primary', value: '#E91E63' },
        { name: 'secondary', value: '#3F51B5' },
        { name: 'accent', value: '#FFC107' },
        { name: 'background', value: '#FFFFFF' },
        { name: 'text', value: '#212121' },
        { name: 'surface', value: '#F8F8F8' },
      ],
      type: [
        { role: 'display', family: 'Bebas Neue / Archivo Black, sans-serif', scale: 'clamp(3rem, 9vw, 7rem)' },
        { role: 'heading', family: 'Archivo, sans-serif', scale: '1.5rem' },
        { role: 'body', family: 'Inter, sans-serif', scale: '1.0625rem' },
        { role: 'label', family: 'Inter, sans-serif', scale: '0.8rem, bold, uppercase' },
      ],
      composition: [
        'Confetti/shape scatter as section borders',
        'Bold stacked display type, one word per line',
        'Countdown timer as a marquee strip',
        'Vivid color blocking with white space between',
      ],
      controls: [
        'Buttons: 999px radius, gradient-free bright fill, thick border',
        'Cards: 16px radius, color top edge',
        'Inputs: rounded, vivid focus',
      ],
      motion: [
        'Confetti burst on load, 1.5s',
        'Pulse on CTA, 1.8s loop',
      ],
    },
    sparkScene: 'A launch hero: "THE PARTY STARTS NOW" in stacked Bebas over a confetti photo, a marquee countdown, and a pink CTA with a pulse.',
  },
]

/** Vetted (human-approved) worlds only. */
export function vettedWorlds(): DirectionWorld[] {
  return WORLD_CATALOG.filter((world) => world.status === 'vetted')
}

/** Worlds relevant to a category (includes all statuses). */
export function worldsForCategory(category: WorldCategory | undefined): DirectionWorld[] {
  if (!category) return [...WORLD_CATALOG]
  return WORLD_CATALOG.filter((world) => world.categories.includes(category))
}

export function getWorldById(id: string): DirectionWorld | undefined {
  return WORLD_CATALOG.find((world) => world.id === id)
}

export function isWorldId(value: string): boolean {
  return WORLD_CATALOG.some((world) => world.id === value)
}
