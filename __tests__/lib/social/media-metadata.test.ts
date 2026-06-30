import sharp from 'sharp'

import { probeSocialMediaMetadata } from '@/lib/social/media-metadata'

function box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(payload.length + 8, 0)
  header.write(type, 4, 4, 'ascii')
  return Buffer.concat([header, payload])
}

function fullBoxPayload(payload: Buffer): Buffer {
  return Buffer.concat([Buffer.alloc(4), payload])
}

function makeMvhd(timescale: number, duration: number): Buffer {
  const payload = Buffer.alloc(96)
  payload.writeUInt32BE(0, 0) // creation time
  payload.writeUInt32BE(0, 4) // modification time
  payload.writeUInt32BE(timescale, 8)
  payload.writeUInt32BE(duration, 12)
  return box('mvhd', fullBoxPayload(payload))
}

function makeTkhd(width: number, height: number): Buffer {
  const payload = Buffer.alloc(80)
  payload.writeUInt32BE(0, 0) // creation time
  payload.writeUInt32BE(0, 4) // modification time
  payload.writeUInt32BE(1, 8) // track id
  payload.writeUInt32BE(0, 12) // reserved
  payload.writeUInt32BE(0, 16) // duration
  payload.writeUInt32BE(width * 65536, 72)
  payload.writeUInt32BE(height * 65536, 76)
  return box('tkhd', fullBoxPayload(payload))
}

function makeMp4(width: number, height: number, durationSeconds: number): Buffer {
  const timescale = 1000
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000isom', 'ascii')),
    box('moov', Buffer.concat([
      makeMvhd(timescale, durationSeconds * timescale),
      box('trak', makeTkhd(width, height)),
    ])),
  ])
}

describe('probeSocialMediaMetadata', () => {
  it('reads dimensions from image bytes', async () => {
    const buffer = await sharp({
      create: { width: 12, height: 7, channels: 3, background: '#0f766e' },
    }).png().toBuffer()

    await expect(probeSocialMediaMetadata({ buffer, mimeType: 'image/png' }))
      .resolves.toEqual({ width: 12, height: 7, duration: null })
  })

  it('reads dimensions and duration from mp4 boxes', async () => {
    const buffer = makeMp4(1080, 1920, 20)

    await expect(probeSocialMediaMetadata({ buffer, mimeType: 'video/mp4' }))
      .resolves.toEqual({ width: 1080, height: 1920, duration: 20 })
  })

  it('returns safe placeholders when video metadata is unavailable', async () => {
    await expect(probeSocialMediaMetadata({ buffer: Buffer.from('not an mp4'), mimeType: 'video/mp4' }))
      .resolves.toEqual({ width: 0, height: 0, duration: null })
  })
})
