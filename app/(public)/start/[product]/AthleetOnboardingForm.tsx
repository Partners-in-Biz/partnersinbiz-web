'use client'

import { useState } from 'react'
import type { AthleetSubmission, Coach, Program, Stat } from '@/lib/onboarding/types'

// ─── Default form state ────────────────────────────────────────────────────

const defaultCoach: Coach   = { name: '', title: 'Head Coach', bio: '', photoUrl: '' }
const defaultProgram: Program = { name: '', description: '', ageRange: '' }
const defaultStat: Stat     = { value: '', label: '' }

const INITIAL: Omit<AthleetSubmission, 'product'> = {
  // Step 1
  clubName: '', shortName: '', sport: 'wrestling', tagline: '', city: '', state: '', country: 'United States', foundedYear: '',
  // Step 2
  primaryColor: '#ffffff', secondaryColor: '#c6c6c7', accentColor: '#ff5000', logoUrl: '', heroVideoUrl: '',
  // Step 3
  address: '', phone: '', contactEmail: '', timezone: 'America/New_York', currency: 'USD',
  // Step 4
  facebook: '', instagram: '', x: '', youtube: '', tiktok: '',
  // Step 5
  coaches: [{ ...defaultCoach }],
  // Step 6
  programs: [{ ...defaultProgram }, { ...defaultProgram }],
  // Step 7
  stats: [
    { value: '', label: 'Athletes Trained' },
    { value: '', label: 'Sessions / Week' },
    { value: '', label: 'Retention Rate' },
    { value: '', label: 'Injury Rate' },
  ],
  // Step 8
  enableRegistrations: true, enablePayments: true, enableScheduling: true,
  enableAthleteRecords: true, enableTournaments: true, enableParentPortal: true,
  enableEmailNotifications: true,
  // Step 9
  hasDomain: false, existingDomain: '', subdomainPreference: '', adminName: '', adminEmail: '', adminPhone: '',
}

const TOTAL_STEPS = 10

const STEP_TITLES = [
  'Club Identity',
  'Brand & Design',
  'Contact Details',
  'Social Media',
  'Coaches & Staff',
  'Programs & Divisions',
  'Club Stats',
  'Features',
  'Domain & Admin',
  'Review & Submit',
]

// ─── Shared input components ───────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="font-headline text-[0.65rem] uppercase tracking-widest text-white/40">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'bg-transparent border-0 border-b border-white/20 py-3 text-white font-body placeholder:text-white/15 focus:border-white focus:outline-none transition-colors w-full'
const selectCls = `${inputCls} cursor-pointer appearance-none`

function TextInput({ name, value, onChange, placeholder, required, type = 'text' }: {
  name: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; type?: string
}) {
  return (
    <input
      name={name} type={type} value={value} required={required}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className={inputCls}
    />
  )
}

function Toggle({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-5 border-b border-white/10 last:border-0">
      <div>
        <p className="font-headline font-bold text-sm uppercase tracking-widest">{label}</p>
        <p className="text-white/40 text-xs mt-1 font-body">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ml-6 ${checked ? 'bg-white' : 'bg-white/20'}`}
      >
        <span className={`absolute top-1 w-4 h-4 rounded-full transition-all ${checked ? 'bg-black left-7' : 'bg-white/60 left-1'}`} />
      </button>
    </div>
  )
}

// ─── Step components ───────────────────────────────────────────────────────

function Step1({ d, set }: { d: typeof INITIAL; set: (k: keyof typeof INITIAL, v: unknown) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
      <Field label="Club Name *">
        <TextInput name="clubName" value={d.clubName} onChange={v => set('clubName', v)} placeholder="ATLAS WRESTLING CLUB" required />
      </Field>
      <Field label="Short Name (for nav / logo)">
        <TextInput name="shortName" value={d.shortName} onChange={v => set('shortName', v)} placeholder="ATLAS" />
      </Field>
      <Field label="Sport / Vertical *">
        <div className="relative">
          <select value={d.sport} onChange={e => set('sport', e.target.value)} className={selectCls}>
            {['wrestling', 'boxing', 'jiu-jitsu', 'judo', 'mma', 'soccer', 'basketball', 'gym / fitness', 'martial arts', 'other']
              .map(s => <option key={s} value={s} className="bg-neutral-900">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          <span className="material-symbols-outlined absolute right-0 top-3 text-white/30 pointer-events-none">expand_more</span>
        </div>
      </Field>
      <Field label="Tagline / Slogan">
        <TextInput name="tagline" value={d.tagline} onChange={v => set('tagline', v)} placeholder="BUILT ON DISCIPLINE." />
      </Field>
      <Field label="City *">
        <TextInput name="city" value={d.city} onChange={v => set('city', v)} placeholder="AUSTIN" required />
      </Field>
      <Field label="State / Province">
        <TextInput name="state" value={d.state} onChange={v => set('state', v)} placeholder="TX" />
      </Field>
      <Field label="Country *">
        <div className="relative">
          <select value={d.country} onChange={e => set('country', e.target.value)} className={selectCls}>
            {['United States', 'United Kingdom', 'Canada', 'Australia', 'New Zealand', 'South Africa', 'Germany', 'France', 'Netherlands', 'Other']
              .map(c => <option key={c} value={c} className="bg-neutral-900">{c}</option>)}
          </select>
          <span className="material-symbols-outlined absolute right-0 top-3 text-white/30 pointer-events-none">expand_more</span>
        </div>
      </Field>
      <Field label="Year Founded">
        <TextInput name="foundedYear" value={d.foundedYear} onChange={v => set('foundedYear', v)} placeholder="2018" type="number" />
      </Field>
    </div>
  )
}

function Step2({ d, set }: { d: typeof INITIAL; set: (k: keyof typeof INITIAL, v: unknown) => void }) {
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {([
          { key: 'primaryColor',   label: 'Primary Color',   hint: 'Main brand color (usually white or your club color)' },
          { key: 'secondaryColor', label: 'Secondary Color', hint: 'Supporting text and accents' },
          { key: 'accentColor',    label: 'Accent / CTA',    hint: 'Buttons, highlights, call-to-action' },
        ] as const).map(({ key, label, hint }) => (
          <div key={key} className="flex flex-col gap-3">
            <label className="font-headline text-[0.65rem] uppercase tracking-widest text-white/40">{label}</label>
            <div className="flex items-center gap-4">
              <input
                type="color"
                value={d[key] as string}
                onChange={e => set(key, e.target.value)}
                className="w-12 h-12 rounded-lg cursor-pointer border border-white/20 bg-transparent p-0.5 flex-shrink-0"
              />
              <input
                type="text"
                value={d[key] as string}
                onChange={e => set(key, e.target.value)}
                placeholder="#ffffff"
                className={`${inputCls} flex-1 font-mono text-sm uppercase`}
              />
            </div>
            <p className="text-white/25 text-xs font-body">{hint}</p>
          </div>
        ))}
      </div>
      <div className="glass rounded-xl p-6 flex items-center gap-6">
        <div className="w-16 h-16 rounded-xl border border-white/20 flex-shrink-0" style={{ backgroundColor: d.primaryColor as string }} />
        <div className="w-16 h-16 rounded-xl border border-white/20 flex-shrink-0" style={{ backgroundColor: d.secondaryColor as string }} />
        <div className="w-16 h-16 rounded-xl border border-white/20 flex-shrink-0" style={{ backgroundColor: d.accentColor as string }} />
        <div>
          <p className="font-headline font-bold text-sm uppercase tracking-widest mb-1">Color Preview</p>
          <p className="text-white/40 text-xs font-body">Primary · Secondary · Accent</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Field label="Logo URL">
          <TextInput name="logoUrl" value={d.logoUrl} onChange={v => set('logoUrl', v)} placeholder="https://..." />
          <p className="text-white/25 text-xs font-body mt-1">Leave blank — we&apos;ll upload your logo during setup.</p>
        </Field>
        <Field label="Hero Background Video URL">
          <TextInput name="heroVideoUrl" value={d.heroVideoUrl} onChange={v => set('heroVideoUrl', v)} placeholder="https://..." />
          <p className="text-white/25 text-xs font-body mt-1">MP4 URL for the landing page background. Optional.</p>
        </Field>
      </div>
    </div>
  )
}

function Step3({ d, set }: { d: typeof INITIAL; set: (k: keyof typeof INITIAL, v: unknown) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
      <div className="md:col-span-2">
        <Field label="Street Address">
          <TextInput name="address" value={d.address} onChange={v => set('address', v)} placeholder="123 Main St, Suite 100" />
        </Field>
      </div>
      <Field label="Phone Number">
        <TextInput name="phone" value={d.phone} onChange={v => set('phone', v)} placeholder="+1 (512) 555-0100" type="tel" />
      </Field>
      <Field label="Contact Email *">
        <TextInput name="contactEmail" value={d.contactEmail} onChange={v => set('contactEmail', v)} placeholder="coach@yourclub.com" type="email" required />
      </Field>
      <Field label="Timezone">
        <div className="relative">
          <select value={d.timezone} onChange={e => set('timezone', e.target.value)} className={selectCls}>
            {[
              ['America/New_York',    'US Eastern (UTC-5)'],
              ['America/Chicago',     'US Central (UTC-6)'],
              ['America/Denver',      'US Mountain (UTC-7)'],
              ['America/Los_Angeles', 'US Pacific (UTC-8)'],
              ['Europe/London',       'London (UTC+0)'],
              ['Europe/Berlin',       'Central Europe (UTC+1)'],
              ['Australia/Sydney',    'Sydney (UTC+10)'],
              ['Africa/Johannesburg', 'South Africa (UTC+2)'],
              ['Asia/Tokyo',          'Tokyo (UTC+9)'],
            ].map(([v, l]) => <option key={v} value={v} className="bg-neutral-900">{l}</option>)}
          </select>
          <span className="material-symbols-outlined absolute right-0 top-3 text-white/30 pointer-events-none">expand_more</span>
        </div>
      </Field>
      <Field label="Currency">
        <div className="relative">
          <select value={d.currency} onChange={e => set('currency', e.target.value)} className={selectCls}>
            {[['USD','USD — US Dollar'],['EUR','EUR — Euro'],['GBP','GBP — British Pound'],['AUD','AUD — Australian Dollar'],['CAD','CAD — Canadian Dollar'],['ZAR','ZAR — South African Rand'],['NZD','NZD — New Zealand Dollar']]
              .map(([v, l]) => <option key={v} value={v} className="bg-neutral-900">{l}</option>)}
          </select>
          <span className="material-symbols-outlined absolute right-0 top-3 text-white/30 pointer-events-none">expand_more</span>
        </div>
      </Field>
    </div>
  )
}

function Step4({ d, set }: { d: typeof INITIAL; set: (k: keyof typeof INITIAL, v: unknown) => void }) {
  const links = [
    { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/yourclub' },
    { key: 'facebook',  label: 'Facebook',  placeholder: 'https://facebook.com/yourclub' },
    { key: 'x',         label: 'X / Twitter', placeholder: 'https://x.com/yourclub' },
    { key: 'youtube',   label: 'YouTube',   placeholder: 'https://youtube.com/@yourclub' },
    { key: 'tiktok',    label: 'TikTok',    placeholder: 'https://tiktok.com/@yourclub' },
  ] as const
  return (
    <div className="space-y-8">
      <p className="text-white/40 font-body text-sm">All social links are optional. Leave blank if you don&apos;t have that channel.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
        {links.map(({ key, label, placeholder }) => (
          <Field key={key} label={label}>
            <TextInput name={key} value={d[key] as string} onChange={v => set(key, v)} placeholder={placeholder} type="url" />
          </Field>
        ))}
      </div>
    </div>
  )
}

function Step5({ d, set }: { d: typeof INITIAL; set: (k: keyof typeof INITIAL, v: unknown) => void }) {
  const coaches = d.coaches as Coach[]
  const update = (i: number, k: keyof Coach, v: string) => {
    const next = coaches.map((c, idx) => idx === i ? { ...c, [k]: v } : c)
    set('coaches', next)
  }
  const add = () => {
    if (coaches.length < 6) set('coaches', [...coaches, { name: '', title: 'Coach', bio: '', photoUrl: '' }])
  }
  const remove = (i: number) => {
    if (coaches.length > 1) set('coaches', coaches.filter((_, idx) => idx !== i))
  }
  return (
    <div className="space-y-10">
      {coaches.map((coach, i) => (
        <div key={i} className="glass rounded-xl p-8 space-y-6 relative">
          <div className="flex justify-between items-center">
            <h3 className="font-headline font-bold uppercase tracking-widest text-sm">
              {i === 0 ? 'Head Coach' : `Coach ${i + 1}`}
            </h3>
            {i > 0 && (
              <button type="button" onClick={() => remove(i)} className="text-white/30 hover:text-white transition-colors">
                <span className="material-symbols-outlined">delete</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
            <Field label="Name *">
              <input type="text" value={coach.name} onChange={e => update(i, 'name', e.target.value)}
                     placeholder="JOHN SMITH" className={inputCls} />
            </Field>
            <Field label="Title">
              <input type="text" value={coach.title} onChange={e => update(i, 'title', e.target.value)}
                     placeholder="Head Coach" className={inputCls} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Short Bio">
                <textarea value={coach.bio} onChange={e => update(i, 'bio', e.target.value)}
                          placeholder="20 years of competitive experience, 3x state champion..."
                          rows={3} className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Photo URL">
                <input type="url" value={coach.photoUrl} onChange={e => update(i, 'photoUrl', e.target.value)}
                       placeholder="https://... (or leave blank, we'll upload during setup)"
                       className={inputCls} />
              </Field>
            </div>
          </div>
        </div>
      ))}
      {coaches.length < 6 && (
        <button type="button" onClick={add}
                className="flex items-center gap-2 font-headline uppercase text-sm tracking-widest text-white/40 hover:text-white transition-colors">
          <span className="material-symbols-outlined">add</span> Add Another Coach
        </button>
      )}
    </div>
  )
}

function Step6({ d, set }: { d: typeof INITIAL; set: (k: keyof typeof INITIAL, v: unknown) => void }) {
  const programs = d.programs as Program[]
  const update = (i: number, k: keyof Program, v: string) => {
    set('programs', programs.map((p, idx) => idx === i ? { ...p, [k]: v } : p))
  }
  const add = () => {
    if (programs.length < 8) set('programs', [...programs, { name: '', description: '', ageRange: '' }])
  }
  const remove = (i: number) => {
    if (programs.length > 1) set('programs', programs.filter((_, idx) => idx !== i))
  }
  return (
    <div className="space-y-8">
      <p className="text-white/40 font-body text-sm">
        List the training programs or membership tiers your club offers. These appear in your navigation and footer.
      </p>
      {programs.map((prog, i) => (
        <div key={i} className="glass rounded-xl p-8 relative">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-headline font-bold uppercase tracking-widest text-sm">Program {i + 1}</h3>
            {programs.length > 1 && (
              <button type="button" onClick={() => remove(i)} className="text-white/30 hover:text-white transition-colors">
                <span className="material-symbols-outlined">delete</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
            <Field label="Program Name *">
              <input type="text" value={prog.name} onChange={e => update(i, 'name', e.target.value)}
                     placeholder="Greco-Roman Elite" className={inputCls} />
            </Field>
            <Field label="Age Range">
              <input type="text" value={prog.ageRange} onChange={e => update(i, 'ageRange', e.target.value)}
                     placeholder="Ages 14–18" className={inputCls} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Short Description">
                <input type="text" value={prog.description} onChange={e => update(i, 'description', e.target.value)}
                       placeholder="Master classical wrestling technique." className={inputCls} />
              </Field>
            </div>
          </div>
        </div>
      ))}
      {programs.length < 8 && (
        <button type="button" onClick={add}
                className="flex items-center gap-2 font-headline uppercase text-sm tracking-widest text-white/40 hover:text-white transition-colors">
          <span className="material-symbols-outlined">add</span> Add Program
        </button>
      )}
    </div>
  )
}

function Step7({ d, set }: { d: typeof INITIAL; set: (k: keyof typeof INITIAL, v: unknown) => void }) {
  const stats = d.stats as Stat[]
  const update = (i: number, k: keyof Stat, v: string) => {
    set('stats', stats.map((s, idx) => idx === i ? { ...s, [k]: v } : s))
  }
  return (
    <div className="space-y-6">
      <p className="text-white/40 font-body text-sm">
        Four key numbers displayed prominently on your homepage. Use real data if you have it — coaches and clubs with strong numbers convert better.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="glass rounded-xl p-8 space-y-6">
            <h3 className="font-headline font-bold uppercase tracking-widest text-sm">Stat {i + 1}</h3>
            <Field label="Value (e.g. 200+, 98%, 4×)">
              <input type="text" value={stat.value} onChange={e => update(i, 'value', e.target.value)}
                     placeholder="500+" className={inputCls} />
            </Field>
            <Field label="Label">
              <input type="text" value={stat.label} onChange={e => update(i, 'label', e.target.value)}
                     className={inputCls} />
            </Field>
          </div>
        ))}
      </div>
    </div>
  )
}

function Step8({ d, set }: { d: typeof INITIAL; set: (k: keyof typeof INITIAL, v: unknown) => void }) {
  const toggles: { key: keyof typeof INITIAL; label: string; description: string }[] = [
    { key: 'enableRegistrations',      label: 'Online Registrations',   description: 'Athletes can register and submit membership forms online.' },
    { key: 'enablePayments',           label: 'Payments & Invoicing',   description: 'Collect membership fees and generate invoices.' },
    { key: 'enableScheduling',         label: 'Training Schedules',     description: 'Publish and manage session timetables.' },
    { key: 'enableAthleteRecords',     label: 'Athlete Records',        description: 'Track athlete profiles, stats, and progress over time.' },
    { key: 'enableTournaments',        label: 'Tournament / Match Log', description: 'Record match results and tournament history.' },
    { key: 'enableParentPortal',       label: 'Parent Portal',          description: 'Parents can log in to view their child\'s progress and invoices.' },
    { key: 'enableEmailNotifications', label: 'Email Notifications',    description: 'Automated emails for schedules, payments, and announcements.' },
  ]
  return (
    <div className="glass rounded-xl p-8">
      <p className="text-white/40 font-body text-sm mb-6">
        All features are included. Toggle off anything you don&apos;t need — we&apos;ll hide those modules from your interface.
      </p>
      {toggles.map(({ key, label, description }) => (
        <Toggle
          key={key}
          label={label}
          description={description}
          checked={d[key] as boolean}
          onChange={v => set(key, v)}
        />
      ))}
    </div>
  )
}

function Step9({ d, set }: { d: typeof INITIAL; set: (k: keyof typeof INITIAL, v: unknown) => void }) {
  return (
    <div className="space-y-10">
      <div className="glass rounded-xl p-8 space-y-6">
        <h3 className="font-headline font-bold uppercase tracking-widest text-sm">Domain</h3>
        <div className="flex gap-8">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" checked={!d.hasDomain} onChange={() => set('hasDomain', false)} className="accent-white" />
            <span className="font-body text-sm text-white/70">Use a free subdomain <span className="text-white/40">(yourclub.athleet.space)</span></span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" checked={!!d.hasDomain} onChange={() => set('hasDomain', true)} className="accent-white" />
            <span className="font-body text-sm text-white/70">I have my own domain</span>
          </label>
        </div>
        {!d.hasDomain && (
          <Field label="Subdomain Preference">
            <div className="flex items-center gap-2">
              <TextInput name="subdomainPreference" value={d.subdomainPreference} onChange={v => set('subdomainPreference', v)} placeholder="atlasclub" />
              <span className="text-white/40 font-body text-sm whitespace-nowrap">.athleet.space</span>
            </div>
          </Field>
        )}
        {d.hasDomain && (
          <Field label="Your Domain *">
            <TextInput name="existingDomain" value={d.existingDomain} onChange={v => set('existingDomain', v)} placeholder="wrestlingatlas.com" />
            <p className="text-white/25 text-xs font-body mt-1">We&apos;ll send you DNS instructions after setup.</p>
          </Field>
        )}
      </div>
      <div className="glass rounded-xl p-8 space-y-6">
        <h3 className="font-headline font-bold uppercase tracking-widest text-sm">Admin Account</h3>
        <p className="text-white/40 font-body text-sm">This will be your primary admin login for the management portal.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
          <Field label="Your Full Name *">
            <TextInput name="adminName" value={d.adminName} onChange={v => set('adminName', v)} placeholder="JOHN SMITH" required />
          </Field>
          <Field label="Admin Email *">
            <TextInput name="adminEmail" value={d.adminEmail} onChange={v => set('adminEmail', v)} placeholder="you@yourclub.com" type="email" required />
          </Field>
          <Field label="Phone (for setup communication)">
            <TextInput name="adminPhone" value={d.adminPhone} onChange={v => set('adminPhone', v)} placeholder="+1 (512) 555-0100" type="tel" />
          </Field>
        </div>
      </div>
    </div>
  )
}

function ReviewSection({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="glass rounded-xl p-8 space-y-4">
      <h3 className="font-headline font-bold uppercase tracking-widest text-sm text-white/60">{title}</h3>
      <div className="space-y-2">
        {rows.map(([label, value]) => value ? (
          <div key={label} className="flex gap-4">
            <span className="font-headline text-[0.65rem] uppercase tracking-widest text-white/30 w-40 flex-shrink-0 pt-0.5">{label}</span>
            <span className="font-body text-sm text-white break-all">{value}</span>
          </div>
        ) : null)}
      </div>
    </div>
  )
}

function Step10Review({ d }: { d: typeof INITIAL }) {
  const coaches = d.coaches as Coach[]
  const programs = d.programs as Program[]
  const stats = d.stats as Stat[]
  const enabledFeatures = [
    d.enableRegistrations && 'Registrations',
    d.enablePayments && 'Payments',
    d.enableScheduling && 'Scheduling',
    d.enableAthleteRecords && 'Athlete Records',
    d.enableTournaments && 'Tournaments',
    d.enableParentPortal && 'Parent Portal',
    d.enableEmailNotifications && 'Email Notifications',
  ].filter(Boolean).join(' · ')

  return (
    <div className="space-y-6">
      <p className="text-white/50 font-body text-sm">
        Review everything below. This is exactly what we&apos;ll use to configure your Athleet instance.
      </p>
      <ReviewSection title="Club Identity" rows={[
        ['Club Name', d.clubName], ['Short Name', d.shortName], ['Sport', d.sport],
        ['Tagline', d.tagline], ['Location', [d.city, d.state, d.country].filter(Boolean).join(', ')],
        ['Founded', d.foundedYear],
      ]} />
      <ReviewSection title="Brand Colors" rows={[
        ['Primary', d.primaryColor], ['Secondary', d.secondaryColor], ['Accent', d.accentColor],
      ]} />
      <ReviewSection title="Contact" rows={[
        ['Email', d.contactEmail], ['Phone', d.phone], ['Address', d.address],
        ['Timezone', d.timezone], ['Currency', d.currency],
      ]} />
      <ReviewSection title="Social" rows={[
        ['Instagram', d.instagram], ['Facebook', d.facebook], ['X', d.x],
        ['YouTube', d.youtube], ['TikTok', d.tiktok],
      ]} />
      <ReviewSection title="Coaches" rows={coaches.map((c, i) => [`Coach ${i + 1}`, `${c.name} — ${c.title}`])} />
      <ReviewSection title="Programs" rows={programs.map((p, i) => [`Program ${i + 1}`, `${p.name}${p.ageRange ? ` (${p.ageRange})` : ''}`])} />
      <ReviewSection title="Stats" rows={stats.map(s => [s.label, s.value])} />
      <ReviewSection title="Features" rows={[['Enabled', enabledFeatures]]} />
      <ReviewSection title="Domain & Admin" rows={[
        ['Domain', d.hasDomain ? d.existingDomain : `${d.subdomainPreference}.athleet.space`],
        ['Admin Name', d.adminName], ['Admin Email', d.adminEmail],
      ]} />
    </div>
  )
}

// ─── Main wizard ───────────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'success' | 'error'

export default function AthleetOnboardingForm() {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<typeof INITIAL>({ ...INITIAL })
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [submissionId, setSubmissionId] = useState('')

  function setField(k: keyof typeof INITIAL, v: unknown) {
    setData(prev => ({ ...prev, [k]: v }))
  }

  function validateStep(): string | null {
    if (step === 1) {
      if (!data.clubName.trim()) return 'Club name is required.'
      if (!data.city.trim()) return 'City is required.'
    }
    if (step === 3 && !data.contactEmail.trim()) return 'Contact email is required.'
    if (step === 9) {
      if (!data.adminName.trim()) return 'Your name is required.'
      if (!data.adminEmail.trim()) return 'Admin email is required.'
    }
    return null
  }

  function next() {
    const err = validateStep()
    if (err) { setErrorMsg(err); return }
    setErrorMsg('')
    setStep(s => Math.min(s + 1, TOTAL_STEPS))
  }

  function prev() {
    setErrorMsg('')
    setStep(s => Math.max(s - 1, 1))
  }

  async function handleSubmit() {
    setStatus('loading')
    setErrorMsg('')
    try {
      const payload: AthleetSubmission = { ...data, product: 'athleet-management' }
      const res = await fetch('/api/v1/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Submission failed')
      setSubmissionId(json.id)
      setStatus('success')
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.')
      setStatus('error')
    }
  }

  // ── Success screen ──
  if (status === 'success') {
    return (
      <div className="glass-card p-16 text-center max-w-2xl mx-auto">
        <span className="material-symbols-outlined text-5xl text-white/60 mb-8 block">check_circle</span>
        <h2 className="font-headline text-3xl font-bold tracking-tighter mb-4 uppercase">
          Configuration Received
        </h2>
        <p className="text-white/50 font-body leading-relaxed mb-8">
          We&apos;ve got everything we need to build your Athleet instance. We&apos;ll be in touch within 24 hours with your deployment details.
        </p>
        <p className="font-mono text-xs text-white/20">Ref: {submissionId}</p>
      </div>
    )
  }

  const progressPct = ((step - 1) / (TOTAL_STEPS - 1)) * 100

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Progress header */}
      <div className="mb-10">
        <div className="flex justify-between items-center mb-4">
          <span className="font-headline text-[0.65rem] uppercase tracking-widest text-white/30">
            Step {step} of {TOTAL_STEPS}
          </span>
          <span className="font-headline text-[0.65rem] uppercase tracking-widest text-white/30">
            {STEP_TITLES[step - 1]}
          </span>
        </div>
        <div className="h-[2px] bg-white/10 rounded-full">
          <div
            className="h-full bg-white rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {/* Step dots */}
        <div className="flex justify-between mt-3">
          {STEP_TITLES.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i + 1 < step ? 'bg-white' : i + 1 === step ? 'bg-white scale-150' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Step title */}
      <div className="mb-10">
        <h2 className="font-headline text-3xl md:text-4xl font-black uppercase tracking-tight">
          {STEP_TITLES[step - 1]}
        </h2>
      </div>

      {/* Step content */}
      <div className="glass-card p-8 md:p-12 mb-8">
        {step === 1  && <Step1 d={data} set={setField} />}
        {step === 2  && <Step2 d={data} set={setField} />}
        {step === 3  && <Step3 d={data} set={setField} />}
        {step === 4  && <Step4 d={data} set={setField} />}
        {step === 5  && <Step5 d={data} set={setField} />}
        {step === 6  && <Step6 d={data} set={setField} />}
        {step === 7  && <Step7 d={data} set={setField} />}
        {step === 8  && <Step8 d={data} set={setField} />}
        {step === 9  && <Step9 d={data} set={setField} />}
        {step === 10 && <Step10Review d={data} />}
      </div>

      {/* Error */}
      {errorMsg && (
        <p className="text-red-400 text-sm font-body mb-6">{errorMsg}</p>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={prev}
          disabled={step === 1}
          className="group flex items-center gap-2 font-headline uppercase text-sm tracking-widest text-white/40 hover:text-white transition-colors disabled:opacity-0 disabled:pointer-events-none"
        >
          <span className="material-symbols-outlined transition-transform group-hover:-translate-x-1">arrow_back</span>
          Back
        </button>

        {step < TOTAL_STEPS ? (
          <button
            type="button"
            onClick={next}
            className="group flex items-center gap-3 bg-white text-black px-10 py-4 rounded-md font-headline font-bold uppercase tracking-widest text-sm hover:bg-white/90 transition-all active:scale-[0.98]"
          >
            Continue
            <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">arrow_forward</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={status === 'loading'}
            className="group flex items-center gap-3 bg-white text-black px-10 py-4 rounded-md font-headline font-bold uppercase tracking-widest text-sm hover:bg-white/90 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {status === 'loading' ? 'Submitting...' : 'Submit Configuration'}
            {status !== 'loading' && (
              <span className="material-symbols-outlined transition-transform group-hover:translate-x-1">send</span>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
