// __tests__/lib/ads/providers/tiktok/creative-sync.test.ts
// Unit tests for Sub-3c TikTok Phase 3 — Creative Sync (image + video upload).

import {
  md5Hex,
  uploadImageBytes,
  uploadImageByUrl,
  uploadVideoBytes,
  uploadVideoByUrl,
} from '@/lib/ads/providers/tiktok/creative-sync'

const BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'

function makeFetchImpl(responseData: unknown, code = 0) {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ code, message: code === 0 ? 'OK' : 'Error', data: responseData }),
    text: async () => '',
  })
}

const BASE_ARGS = {
  advertiserId: 'adv-123',
  accessToken: 'tt-access-token',
}

describe('TikTok Creative Sync', () => {
  describe('md5Hex', () => {
    it('returns a 32-character hex string', () => {
      const result = md5Hex(Buffer.from('hello world'))
      expect(result).toHaveLength(32)
      expect(result).toMatch(/^[0-9a-f]{32}$/)
    })
  })

  describe('uploadImageBytes', () => {
    it('POSTs to /file/image/ad/upload/ with Access-Token header, UPLOAD_BY_FILE, and image_signature', async () => {
      const bytes = Buffer.from('fake-image-data')
      const fetchImpl = makeFetchImpl({ image_id: 'IMG1', image_url: 'https://cdn.tiktok.com/img1.jpg' })

      await uploadImageBytes({ ...BASE_ARGS, bytes, fetchImpl })

      expect(fetchImpl).toHaveBeenCalledTimes(1)
      const [calledUrl, calledInit] = fetchImpl.mock.calls[0]
      expect(calledUrl).toBe(`${BASE_URL}/file/image/ad/upload/`)
      expect(calledInit.method).toBe('POST')
      expect(calledInit.headers['Access-Token']).toBe('tt-access-token')

      // Verify FormData contains required fields
      const body = calledInit.body as FormData
      expect(body.get('upload_type')).toBe('UPLOAD_BY_FILE')
      expect(body.get('advertiser_id')).toBe('adv-123')
      // image_signature should be an MD5 hex (32 chars)
      const sig = body.get('image_signature') as string
      expect(sig).toMatch(/^[0-9a-f]{32}$/)
    })

    it('returns mapped result {imageId, imageUrl, ...} from envelope {code:0, data:{image_id, image_url}}', async () => {
      const bytes = Buffer.from('fake-image-data')
      const fetchImpl = makeFetchImpl({
        image_id: 'IMG1',
        image_url: 'https://cdn.tiktok.com/img1.jpg',
        format: 'JPEG',
        width: 1080,
        height: 1080,
        size: 12345,
        signature: 'abc123',
      })

      const result = await uploadImageBytes({ ...BASE_ARGS, bytes, fetchImpl })

      expect(result.imageId).toBe('IMG1')
      expect(result.imageUrl).toBe('https://cdn.tiktok.com/img1.jpg')
      expect(result.format).toBe('JPEG')
      expect(result.width).toBe(1080)
      expect(result.height).toBe(1080)
      expect(result.size).toBe(12345)
      expect(result.signature).toBe('abc123')
    })

    it('throws when envelope code !== 0', async () => {
      const bytes = Buffer.from('fake-image-data')
      const fetchImpl = makeFetchImpl({}, 40002)
      // Override message
      fetchImpl.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ code: 40002, message: 'Invalid signature', data: {} }),
        text: async () => '',
      })

      await expect(
        uploadImageBytes({ ...BASE_ARGS, bytes, fetchImpl }),
      ).rejects.toThrow('code=40002 message=Invalid signature')
    })
  })

  describe('uploadImageByUrl', () => {
    it('POSTs UPLOAD_BY_URL with image_url field', async () => {
      const fetchImpl = makeFetchImpl({ image_id: 'IMG2', image_url: 'https://cdn.tiktok.com/img2.jpg' })

      await uploadImageByUrl({
        ...BASE_ARGS,
        imageUrl: 'https://example.com/photo.jpg',
        fetchImpl,
      })

      expect(fetchImpl).toHaveBeenCalledTimes(1)
      const [calledUrl, calledInit] = fetchImpl.mock.calls[0]
      expect(calledUrl).toBe(`${BASE_URL}/file/image/ad/upload/`)
      expect(calledInit.headers['Access-Token']).toBe('tt-access-token')

      const body = calledInit.body as FormData
      expect(body.get('upload_type')).toBe('UPLOAD_BY_URL')
      expect(body.get('image_url')).toBe('https://example.com/photo.jpg')
      expect(body.get('advertiser_id')).toBe('adv-123')
    })
  })

  describe('uploadVideoBytes', () => {
    it('POSTs to /file/video/ad/upload/ with video_file part and video_signature', async () => {
      const bytes = Buffer.from('fake-video-data')
      const fetchImpl = makeFetchImpl({
        video_id: 'VID1',
        video_cover_url: 'https://cdn.tiktok.com/cover1.jpg',
        duration: 30,
      })

      const result = await uploadVideoBytes({ ...BASE_ARGS, bytes, fetchImpl })

      expect(fetchImpl).toHaveBeenCalledTimes(1)
      const [calledUrl, calledInit] = fetchImpl.mock.calls[0]
      expect(calledUrl).toBe(`${BASE_URL}/file/video/ad/upload/`)
      expect(calledInit.method).toBe('POST')
      expect(calledInit.headers['Access-Token']).toBe('tt-access-token')

      const body = calledInit.body as FormData
      expect(body.get('upload_type')).toBe('UPLOAD_BY_FILE')
      expect(body.get('advertiser_id')).toBe('adv-123')
      const sig = body.get('video_signature') as string
      expect(sig).toMatch(/^[0-9a-f]{32}$/)
      // video_file part should be present
      expect(body.get('video_file')).toBeTruthy()

      // Mapped result
      expect(result.videoId).toBe('VID1')
      expect(result.videoCoverUrl).toBe('https://cdn.tiktok.com/cover1.jpg')
      expect(result.duration).toBe(30)
    })
  })

  describe('uploadVideoByUrl', () => {
    it('POSTs UPLOAD_BY_URL with video_url field to /file/video/ad/upload/', async () => {
      const fetchImpl = makeFetchImpl({ video_id: 'VID2', video_cover_url: 'https://cdn.tiktok.com/cover2.jpg' })

      const result = await uploadVideoByUrl({
        ...BASE_ARGS,
        videoUrl: 'https://example.com/video.mp4',
        fetchImpl,
      })

      const [calledUrl, calledInit] = fetchImpl.mock.calls[0]
      expect(calledUrl).toBe(`${BASE_URL}/file/video/ad/upload/`)
      const body = calledInit.body as FormData
      expect(body.get('upload_type')).toBe('UPLOAD_BY_URL')
      expect(body.get('video_url')).toBe('https://example.com/video.mp4')
      expect(result.videoId).toBe('VID2')
    })
  })
})
