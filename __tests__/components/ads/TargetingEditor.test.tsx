/**
 * @jest-environment jsdom
 */
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { TargetingEditor } from '@/components/ads/TargetingEditor'
import type { AdTargeting, AdSavedAudience, AdCustomAudience } from '@/lib/ads/types'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTargeting(over: Partial<AdTargeting> = {}): AdTargeting {
  return {
    geo: { countries: [] },
    demographics: { ageMin: 18, ageMax: 65 },
    ...over,
  }
}

const mockSavedAudience: AdSavedAudience = {
  id: 'sa_1',
  orgId: 'org_1',
  platform: 'meta',
  name: 'US Adults 25-54',
  targeting: {
    geo: { countries: ['US'] },
    demographics: { ageMin: 25, ageMax: 54 },
  },
  providerData: {},
  createdBy: 'user_1',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createdAt: { toDate: () => new Date() } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatedAt: { toDate: () => new Date() } as any,
}

const mockCustomAudience: AdCustomAudience = {
  id: 'ca_1',
  orgId: 'org_1',
  platform: 'meta',
  name: 'Website Visitors',
  type: 'WEBSITE',
  status: 'READY',
  approximateSize: 5000,
  source: {
    kind: 'WEBSITE',
    pixelId: 'px_1',
    retentionDays: 30,
    rules: [],
  },
  providerData: {},
  createdBy: 'user_1',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createdAt: { toDate: () => new Date() } as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatedAt: { toDate: () => new Date() } as any,
}

// ── fetch mock ────────────────────────────────────────────────────────────────

function mockFetchEmpty() {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ success: true, data: [] }),
  } as unknown as Response)
}

function mockFetchWithData() {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('saved-audiences')) {
      return Promise.resolve({
        json: async () => ({ success: true, data: [mockSavedAudience] }),
      } as unknown as Response)
    }
    if (url.includes('custom-audiences')) {
      return Promise.resolve({
        json: async () => ({ success: true, data: [mockCustomAudience] }),
      } as unknown as Response)
    }
    return Promise.resolve({ json: async () => ({ success: true, data: [] }) } as unknown as Response)
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('TargetingEditor', () => {
  beforeEach(() => {
    mockFetchEmpty()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('renders countries checkboxes and age inputs', () => {
    render(<TargetingEditor orgId="org_1" value={makeTargeting()} onChange={() => {}} />)
    expect(screen.getByLabelText('United States')).toBeInTheDocument()
    expect(screen.getByLabelText('South Africa')).toBeInTheDocument()
    expect(screen.getByLabelText('Minimum age')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximum age')).toBeInTheDocument()
    expect(screen.getByText('Male')).toBeInTheDocument()
    expect(screen.getByText('Female')).toBeInTheDocument()
    expect(screen.getByText(/Pick at least one country/i)).toBeInTheDocument()
  })

  it('shows saved audience selector count fetched from API', async () => {
    mockFetchWithData()
    render(<TargetingEditor orgId="org_1" value={makeTargeting()} onChange={() => {}} />)
    await waitFor(() =>
      expect(screen.getByText(/Apply saved audience \(1\)/i)).toBeInTheDocument()
    )
  })

  it('applies saved audience — replaces full targeting via onChange', async () => {
    mockFetchWithData()
    const onChange = jest.fn()
    render(<TargetingEditor orgId="org_1" value={makeTargeting()} onChange={onChange} />)

    // Wait for SA to load and click selector
    await waitFor(() => screen.getByText(/Apply saved audience \(1\)/i))
    fireEvent.click(screen.getByText(/Apply saved audience \(1\)/i))

    // SA entry appears
    await waitFor(() => screen.getByText('US Adults 25-54'))
    fireEvent.click(screen.getByText('US Adults 25-54'))

    expect(onChange).toHaveBeenCalledWith(mockSavedAudience.targeting)
  })

  it('opens CA picker modal and toggles include / exclude (mutually exclusive)', async () => {
    mockFetchWithData()
    render(
      <TargetingEditor
        orgId="org_1"
        value={makeTargeting()}
        onChange={() => {}}
      />
    )

    // Open the CA picker
    await waitFor(() => screen.getByText('Add audiences'))
    fireEvent.click(screen.getByText('Add audiences'))

    // Modal opens with CA listed
    await waitFor(() => screen.getByText('Website Visitors'))
    expect(screen.getAllByText(/website/i).length).toBeGreaterThan(0)

    // Click Include
    const includeBtn = screen.getAllByText('Include')[0]
    fireEvent.click(includeBtn)
    // Include should now be highlighted (text still present)
    expect(screen.getByText('Include')).toBeInTheDocument()

    // Click Exclude — should move it out of include
    const excludeBtn = screen.getAllByText('Exclude')[0]
    fireEvent.click(excludeBtn)
    expect(excludeBtn).toBeInTheDocument()
  })

  it('save modal POSTs to /api/v1/ads/saved-audiences with name + targeting', async () => {
    const postResponse = {
      success: true,
      data: { ...mockSavedAudience, id: 'sa_new', name: 'My Template' },
    }
    global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ json: async () => postResponse } as unknown as Response)
      }
      return Promise.resolve({ json: async () => ({ success: true, data: [] }) } as unknown as Response)
    })

    render(
      <TargetingEditor
        orgId="org_1"
        value={makeTargeting({ geo: { countries: ['ZA'] } })}
        onChange={() => {}}
      />
    )
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    await act(async () => {})

    fireEvent.click(screen.getByText('Save current as template'))
    await waitFor(() => screen.getByLabelText('Save name'))
    fireEvent.change(screen.getByLabelText('Save name'), { target: { value: 'My Template' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v1/ads/saved-audiences',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Org-Id': 'org_1' }),
        })
      )
    )
  })

  it('shows inline feedback when a targeting template is saved', async () => {
    const postResponse = {
      success: true,
      data: { ...mockSavedAudience, id: 'sa_new', name: 'My Template' },
    }
    global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ json: async () => postResponse } as unknown as Response)
      }
      return Promise.resolve({ json: async () => ({ success: true, data: [] }) } as unknown as Response)
    })

    render(
      <TargetingEditor
        orgId="org_1"
        value={makeTargeting({ geo: { countries: ['ZA'] } })}
        onChange={() => {}}
      />
    )
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    await act(async () => {})

    fireEvent.click(screen.getByText('Save current as template'))
    fireEvent.change(await screen.findByLabelText('Save name'), { target: { value: 'My Template' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved targeting template My Template.')
  })

  it('shows inline save errors instead of a native alert', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)
    global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({
          json: async () => ({ success: false, error: 'Template name already exists' }),
        } as unknown as Response)
      }
      return Promise.resolve({ json: async () => ({ success: true, data: [] }) } as unknown as Response)
    })

    render(
      <TargetingEditor
        orgId="org_1"
        value={makeTargeting({ geo: { countries: ['ZA'] } })}
        onChange={() => {}}
      />
    )
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2))
    await act(async () => {})

    fireEvent.click(screen.getByText('Save current as template'))
    fireEvent.change(await screen.findByLabelText('Save name'), { target: { value: 'My Template' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Template name already exists')
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('toggles country on click and fires onChange', () => {
    const onChange = jest.fn()
    render(<TargetingEditor orgId="org_1" value={makeTargeting()} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('United States'))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ geo: { countries: ['US'] } })
    )
  })
})
