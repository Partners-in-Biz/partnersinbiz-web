'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  Field,
  Input,
  Notice,
  Panel,
  Select,
} from '@/components/studio'
import type { PropertyType, PropertyStatus } from '@/lib/properties/types'

export default function PortalNewPropertyPage() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [orgId, setOrgId] = useState('')
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [type, setType] = useState<PropertyType>('web')
  const [status, setStatus] = useState<PropertyStatus>('draft')

  useEffect(() => {
    fetch('/api/v1/organizations')
      .then(r => r.json())
      .then(body => setOrgs(body.data ?? []))
      .catch(() => {})
  }, [])

  async function handleCreate() {
    if (!orgId) { setError('Select a client.'); return }
    if (!name.trim()) { setError('Name is required.'); return }
    if (!domain.trim()) { setError('Domain is required.'); return }

    setSaving(true); setError('')
    try {
      const res = await fetch('/api/v1/properties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, name: name.trim(), domain: domain.trim(), type, status }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Creation failed')
      router.push(`/portal/properties/${body.data.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Creation failed')
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <PageHeader
        eyebrow="Properties"
        title="New property."
        description="Add a web or app property for a client organisation."
        actions={
          <Button type="button" variant="ghost" size="sm" onClick={() => router.push('/portal/properties')}>
            Back to properties
          </Button>
        }
      />

      <Panel>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); handleCreate() }}>
          <Field id="prop-org" label="Client">
            <Select id="prop-org" aria-label="Client" value={orgId} onChange={e => setOrgId(e.target.value)}>
              <option value="">Select a client…</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
          <Field id="prop-name" label="Name">
            <Input id="prop-name" aria-label="Name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Scrolled Brain" />
          </Field>
          <Field id="prop-domain" label="Domain">
            <Input id="prop-domain" aria-label="Domain" type="text" value={domain} onChange={e => setDomain(e.target.value)} placeholder="scrolledbrain.com" />
          </Field>
          <div className="flex gap-4">
            <div className="flex-1">
              <Field id="prop-type" label="Type">
                <Select id="prop-type" aria-label="Type" value={type} onChange={e => setType(e.target.value as PropertyType)}>
                  <option value="web">Web</option>
                  <option value="ios">iOS</option>
                  <option value="android">Android</option>
                  <option value="universal">Universal</option>
                </Select>
              </Field>
            </div>
            <div className="flex-1">
              <Field id="prop-status" label="Status">
                <Select id="prop-status" aria-label="Status" value={status} onChange={e => setStatus(e.target.value as PropertyStatus)}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="archived">Archived</option>
                </Select>
              </Field>
            </div>
          </div>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button type="submit" disabled={saving} loading={saving} block>
            Create property
          </Button>
        </form>
      </Panel>
    </div>
  )
}
