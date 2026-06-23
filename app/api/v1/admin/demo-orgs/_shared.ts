/**
 * Shared helpers for the demo-org admin endpoints (US-291).
 *
 * A "demo org" is an `organizations` doc with `isDemo: true` plus demo metadata
 * (demoPersona, demoToken, seededAt, resetAt). Seeded demo data is written as
 * real `contacts` docs scoped to the org with a `demoSeed: true` flag so it can
 * be deleted + re-seeded idempotently.
 */
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { randomBytes } from 'crypto'

export type PersonaKey = 'agency' | 'ecommerce' | 'coach' | 'saas'

export interface Persona {
  key: PersonaKey
  label: string
  description: string
  /** Modest, REAL sample contacts seeded for this persona. */
  contacts: Array<{ name: string; email: string; company: string; stage: string; tags: string[] }>
}

export const PERSONAS: Record<PersonaKey, Persona> = {
  agency: {
    key: 'agency',
    label: 'Marketing Agency',
    description: 'A full-service agency managing several client retainers.',
    contacts: [
      { name: 'Lerato Mokoena', email: 'lerato@brightwave.co.za', company: 'Brightwave Media', stage: 'lead', tags: ['retainer', 'social'] },
      { name: 'James Carter', email: 'james@northpeak.io', company: 'Northpeak Studio', stage: 'qualified', tags: ['seo'] },
      { name: 'Aisha Patel', email: 'aisha@lumengrowth.com', company: 'Lumen Growth', stage: 'client', tags: ['retainer', 'ppc'] },
    ],
  },
  ecommerce: {
    key: 'ecommerce',
    label: 'E-commerce Brand',
    description: 'A DTC online store focused on email + paid acquisition.',
    contacts: [
      { name: 'Mia Thompson', email: 'mia@verdantgoods.com', company: 'Verdant Goods', stage: 'lead', tags: ['shopify', 'email'] },
      { name: 'Sipho Dlamini', email: 'sipho@kasiwear.co.za', company: 'Kasi Wear', stage: 'qualified', tags: ['apparel'] },
      { name: 'Elena Rossi', email: 'elena@borealishome.com', company: 'Borealis Home', stage: 'client', tags: ['homeware', 'vip'] },
    ],
  },
  coach: {
    key: 'coach',
    label: 'Coach / Creator',
    description: 'A solo coach building an audience and a course funnel.',
    contacts: [
      { name: 'Daniel Reyes', email: 'daniel@reyescoaching.com', company: 'Reyes Coaching', stage: 'lead', tags: ['course'] },
      { name: 'Naledi Khumalo', email: 'naledi@mindsetlab.co.za', company: 'Mindset Lab', stage: 'qualified', tags: ['webinar'] },
      { name: 'Sara Lindqvist', email: 'sara@flowstate.fit', company: 'Flowstate Fitness', stage: 'client', tags: ['membership'] },
    ],
  },
  saas: {
    key: 'saas',
    label: 'SaaS Startup',
    description: 'An early-stage B2B SaaS running outbound + product-led growth.',
    contacts: [
      { name: 'Tom Becker', email: 'tom@stackflowhq.com', company: 'Stackflow', stage: 'lead', tags: ['trial'] },
      { name: 'Priya Naidoo', email: 'priya@cloudpilot.io', company: 'Cloudpilot', stage: 'qualified', tags: ['demo-booked'] },
      { name: 'Marcus Webb', email: 'marcus@gridsync.dev', company: 'Gridsync', stage: 'client', tags: ['annual', 'enterprise'] },
    ],
  },
}

export function isPersonaKey(value: unknown): value is PersonaKey {
  return typeof value === 'string' && value in PERSONAS
}

/** Cryptographically-random, URL-safe demo token. */
export function generateDemoToken(): string {
  return randomBytes(18).toString('base64url')
}

/** Delete every demoSeed contact scoped to an org. Returns count removed. */
export async function clearSeededDemoData(orgId: string): Promise<number> {
  const snap = await adminDb
    .collection('contacts')
    .where('orgId', '==', orgId)
    .where('demoSeed', '==', true)
    .get()
  if (snap.empty) return 0
  // Batch deletes in chunks of 400 to stay under the 500-op limit.
  const docs = snap.docs
  for (let i = 0; i < docs.length; i += 400) {
    const batch = adminDb.batch()
    for (const doc of docs.slice(i, i + 400)) batch.delete(doc.ref)
    await batch.commit()
  }
  return docs.length
}

/** Seed the persona's sample contacts. Returns count written. */
export async function seedDemoData(orgId: string, persona: PersonaKey): Promise<number> {
  const preset = PERSONAS[persona]
  const batch = adminDb.batch()
  for (const c of preset.contacts) {
    const ref = adminDb.collection('contacts').doc()
    batch.set(ref, {
      orgId,
      name: c.name,
      email: c.email,
      company: c.company,
      stage: c.stage,
      type: 'lead',
      tags: c.tags,
      source: 'demo-seed',
      demoSeed: true,
      notes: `Demo data (${preset.label}) — safe to delete.`,
      assignedTo: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastContactedAt: null,
    })
  }
  await batch.commit()
  return preset.contacts.length
}

/** Count demoSeed contacts currently scoped to the org. */
export async function countSeededDemoData(orgId: string): Promise<number> {
  const snap = await adminDb
    .collection('contacts')
    .where('orgId', '==', orgId)
    .where('demoSeed', '==', true)
    .count()
    .get()
  return snap.data().count
}
