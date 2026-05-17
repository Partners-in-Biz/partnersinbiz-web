// __tests__/lib/ads/providers/linkedin/audiences-upload.test.ts
import {
  uploadAudienceMembers,
  rowToMember,
  type LinkedinAudienceMember,
  type UploadResult,
} from '@/lib/ads/providers/linkedin/audiences-hash'

function makeMember(): LinkedinAudienceMember {
  return rowToMember({ email: 'test@example.com' })
}

function makeMembers(n: number): LinkedinAudienceMember[] {
  return Array.from({ length: n }, (_, i) =>
    rowToMember({ email: `user${i}@example.com` }),
  )
}

describe('uploadAudienceMembers', () => {
  it('chunks + POSTs to /dmpSegments/{id}/users per chunk', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    })

    const members = makeMembers(12500)
    await uploadAudienceMembers({
      accessToken: 'tok_test',
      segmentUrn: 'urn:li:dmpSegment:abc',
      members,
      chunkSize: 5000,
      fetchImpl: mockFetch,
    })

    // Should have been called 3 times (5000 + 5000 + 2500)
    expect(mockFetch).toHaveBeenCalledTimes(3)

    // Each call should hit the correct URL
    for (const call of mockFetch.mock.calls) {
      const url: string = call[0]
      expect(url).toMatch(/\/dmpSegments\/abc\/users$/)
    }

    // Body of first call should have 5000 elements
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(firstBody.elements).toHaveLength(5000)

    // Body of last call should have 2500 elements
    const lastBody = JSON.parse(mockFetch.mock.calls[2][1].body as string)
    expect(lastBody.elements).toHaveLength(2500)
  })

  it('returns correct result shape when all chunks succeed', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    })

    const members = makeMembers(12500)
    const result: UploadResult = await uploadAudienceMembers({
      accessToken: 'tok_test',
      segmentUrn: 'urn:li:dmpSegment:abc',
      members,
      chunkSize: 5000,
      fetchImpl: mockFetch,
    })

    expect(result).toEqual({
      chunksAttempted: 3,
      chunksSucceeded: 3,
      chunksFailed: 0,
      totalMembers: 12500,
    })
  })

  it('handles partial failure — 1 chunk 400, others 200', async () => {
    let callCount = 0
    const mockFetch = jest.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 2) {
        return {
          ok: false,
          status: 400,
          text: async () => 'Bad Request — invalid member data',
        }
      }
      return {
        ok: true,
        status: 200,
        text: async () => '',
      }
    })

    const members = makeMembers(12500)
    const result: UploadResult = await uploadAudienceMembers({
      accessToken: 'tok_test',
      segmentUrn: 'urn:li:dmpSegment:abc',
      members,
      chunkSize: 5000,
      fetchImpl: mockFetch,
    })

    expect(result.chunksFailed).toBe(1)
    expect(result.chunksSucceeded).toBe(2)
    expect(result.firstError).toContain('HTTP 400')
  })

  it('throws on empty members array', async () => {
    const mockFetch = jest.fn()
    await expect(
      uploadAudienceMembers({
        accessToken: 'tok_test',
        segmentUrn: 'urn:li:dmpSegment:abc',
        members: [],
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow('uploadAudienceMembers: members array is empty')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
