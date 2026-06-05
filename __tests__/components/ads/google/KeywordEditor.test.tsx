/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom'
import { KeywordEditor } from '@/components/ads/google/KeywordEditor'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

const KEYWORD_RESPONSE = {
  success: true,
  data: {
    keywords: [
      {
        id: 'kw_1',
        orgId: 'org_1',
        campaignId: 'cmp_1',
        adSetId: 'ads_1',
        text: 'running shoes',
        matchType: 'BROAD',
        status: 'ACTIVE',
        negativeKeyword: false,
        cpcBidMicros: undefined,
        createdAt: null,
        updatedAt: null,
      },
    ],
  },
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => KEYWORD_RESPONSE,
  }) as unknown as typeof fetch
})

describe('KeywordEditor', () => {
  it('renders keyword list on mount', async () => {
    await act(async () => {
      render(<KeywordEditor orgId="org_1" adSetId="ads_1" campaignId="cmp_1" />)
    })

    await waitFor(() => {
      expect(screen.getByText('running shoes')).toBeInTheDocument()
    })

    const calls = (global.fetch as jest.Mock).mock.calls
    expect(calls[0][0]).toContain('/api/v1/ads/keywords?adSetId=ads_1')
    expect(calls[0][1].headers['X-Org-Id']).toBe('org_1')
  })

  it('posts new keyword and refreshes list on Add click', async () => {
    // First call: initial load; subsequent calls: POST + reload
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => KEYWORD_RESPONSE })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { keyword: { id: 'kw_2' } } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => KEYWORD_RESPONSE })

    await act(async () => {
      render(<KeywordEditor orgId="org_1" adSetId="ads_1" campaignId="cmp_1" />)
    })

    await waitFor(() => screen.getByText('running shoes'))

    fireEvent.change(screen.getByLabelText('Keyword text'), {
      target: { value: 'blue sneakers' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Add$/i }))
    })

    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls
      const postCall = calls.find(
        (c) => c[1]?.method === 'POST' && c[0].includes('/api/v1/ads/keywords'),
      )
      expect(postCall).toBeTruthy()
      const body = JSON.parse(postCall[1].body)
      expect(body.text).toBe('blue sneakers')
      expect(body.adSetId).toBe('ads_1')
      expect(body.campaignId).toBe('cmp_1')
    })
  })

  it('shows "No keywords yet" when list is empty', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { keywords: [] } }),
    })

    await act(async () => {
      render(<KeywordEditor orgId="org_1" adSetId="ads_1" campaignId="cmp_1" />)
    })

    await waitFor(() => {
      expect(screen.getByText(/No keywords yet/i)).toBeInTheDocument()
    })
  })

  it('disables Add button when keyword text is empty', async () => {
    await act(async () => {
      render(<KeywordEditor orgId="org_1" adSetId="ads_1" campaignId="cmp_1" />)
    })

    await waitFor(() => screen.getByText('running shoes'))

    const addBtn = screen.getByRole('button', { name: /^Add$/i })
    // text input is empty by default → button should be disabled
    expect(addBtn).toBeDisabled()
  })

  it('shows inline remove errors instead of a native alert', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined)
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => KEYWORD_RESPONSE })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false, error: 'Keyword is still syncing' }),
      })

    await act(async () => {
      render(<KeywordEditor orgId="org_1" adSetId="ads_1" campaignId="cmp_1" />)
    })

    await waitFor(() => screen.getByText('running shoes'))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove keyword running shoes' }))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Keyword is still syncing')
    expect(alertSpy).not.toHaveBeenCalled()
  })
})
