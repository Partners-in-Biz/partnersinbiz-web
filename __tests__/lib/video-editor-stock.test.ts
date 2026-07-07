import { isAllowedStockImportUrl, normalizePexelsResults, normalizePixabayResults } from '@/lib/video-editor/stock'

describe('stock normalizers', () => {
  it('normalizes pexels photos and videos to StockResult', () => {
    const photos = normalizePexelsResults({
      photos: [{
        id: 1,
        alt: 'Beach',
        src: {
          large2x: 'https://images.pexels.com/1.jpg',
          medium: 'https://images.pexels.com/1-m.jpg',
        },
        photographer: 'Ann',
      }],
    })
    expect(photos).toEqual([{
      id: 'pexels-photo-1',
      provider: 'pexels',
      mediaKind: 'image',
      title: 'Beach',
      thumbnailUrl: 'https://images.pexels.com/1-m.jpg',
      downloadUrl: 'https://images.pexels.com/1.jpg',
      attribution: 'Ann - Pexels',
    }])

    const videos = normalizePexelsResults({
      videos: [{
        id: 2,
        image: 'https://images.pexels.com/v2.jpg',
        duration: 12,
        user: { name: 'Bo' },
        video_files: [
          { link: 'https://videos.pexels.com/2-sd.mp4', height: 540 },
          { link: 'https://videos.pexels.com/2-hd.mp4', height: 1080 },
        ],
      }],
    })
    expect(videos[0]).toMatchObject({
      id: 'pexels-video-2',
      provider: 'pexels',
      mediaKind: 'video',
      downloadUrl: 'https://videos.pexels.com/2-hd.mp4',
      durationSeconds: 12,
      attribution: 'Bo - Pexels',
    })
  })

  it('normalizes pixabay hits', () => {
    const images = normalizePixabayResults({
      hits: [{
        id: 3,
        tags: 'sky, clouds',
        previewURL: 'https://cdn.pixabay.com/3-p.jpg',
        largeImageURL: 'https://cdn.pixabay.com/3.jpg',
        user: 'Cy',
      }],
    })
    expect(images[0]).toMatchObject({
      id: 'pixabay-image-3',
      provider: 'pixabay',
      mediaKind: 'image',
      title: 'sky, clouds',
      attribution: 'Cy - Pixabay',
    })

    const videos = normalizePixabayResults({
      hits: [{
        id: 4,
        tags: 'waves',
        previewURL: 'https://cdn.pixabay.com/4-p.jpg',
        videos: { medium: { url: 'https://cdn.pixabay.com/video/4.mp4' } },
        user: 'Dee',
        duration: 9,
      }],
    })
    expect(videos[0]).toMatchObject({
      id: 'pixabay-video-4',
      provider: 'pixabay',
      mediaKind: 'video',
      downloadUrl: 'https://cdn.pixabay.com/video/4.mp4',
      durationSeconds: 9,
    })
  })

  it('allows only pexels/pixabay hosts for import', () => {
    expect(isAllowedStockImportUrl('https://videos.pexels.com/x.mp4')).toBe(true)
    expect(isAllowedStockImportUrl('https://cdn.pixabay.com/x.jpg')).toBe(true)
    expect(isAllowedStockImportUrl('https://evil.example.com/x.mp4')).toBe(false)
    expect(isAllowedStockImportUrl('http://169.254.169.254/latest')).toBe(false)
  })
})
