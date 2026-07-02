import sharp from 'sharp'

export interface SocialMediaMetadata {
  width: number
  height: number
  duration: number | null
}

const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts'])

function fixed16(value: number): number {
  return Math.round(value / 65536)
}

function walkMp4Boxes(
  buffer: Buffer,
  start: number,
  end: number,
  visitor: (type: string, payloadStart: number, payloadEnd: number) => void,
): void {
  let offset = start
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    let headerSize = 8
    if (size === 1) {
      if (offset + 16 > end) return
      const largeSize = buffer.readBigUInt64BE(offset + 8)
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return
      size = Number(largeSize)
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }

    const boxEnd = offset + size
    if (size < headerSize || boxEnd > end) return

    const payloadStart = offset + headerSize
    visitor(type, payloadStart, boxEnd)
    if (CONTAINER_BOXES.has(type)) {
      walkMp4Boxes(buffer, payloadStart, boxEnd, visitor)
    }

    offset = boxEnd
  }
}

function parseMvhdDuration(buffer: Buffer, start: number, end: number): number | null {
  if (start + 4 > end) return null
  const version = buffer.readUInt8(start)
  if (version === 1) {
    if (start + 32 > end) return null
    const timescale = buffer.readUInt32BE(start + 20)
    const duration = buffer.readBigUInt64BE(start + 24)
    if (!timescale || duration > BigInt(Number.MAX_SAFE_INTEGER)) return null
    return Number(duration) / timescale
  }
  if (start + 20 > end) return null
  const timescale = buffer.readUInt32BE(start + 12)
  const duration = buffer.readUInt32BE(start + 16)
  if (!timescale) return null
  return duration / timescale
}

function parseTkhdDimensions(buffer: Buffer, start: number, end: number): Pick<SocialMediaMetadata, 'width' | 'height'> | null {
  if (start + 4 > end) return null
  const version = buffer.readUInt8(start)
  const dimensionOffset = version === 1 ? start + 88 : start + 76
  if (dimensionOffset + 8 > end) return null
  const width = fixed16(buffer.readUInt32BE(dimensionOffset))
  const height = fixed16(buffer.readUInt32BE(dimensionOffset + 4))
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

export function probeMp4Metadata(buffer: Buffer): SocialMediaMetadata {
  let width = 0
  let height = 0
  let duration: number | null = null

  walkMp4Boxes(buffer, 0, buffer.length, (type, payloadStart, payloadEnd) => {
    if (type === 'mvhd' && duration === null) {
      duration = parseMvhdDuration(buffer, payloadStart, payloadEnd)
    }
    if (type === 'tkhd' && (!width || !height)) {
      const dimensions = parseTkhdDimensions(buffer, payloadStart, payloadEnd)
      if (dimensions) {
        width = dimensions.width
        height = dimensions.height
      }
    }
  })

  const roundedDuration = duration === null ? null : Math.round((duration as number) * 1000) / 1000
  return {
    width,
    height,
    duration: roundedDuration,
  }
}

export async function probeSocialMediaMetadata(args: {
  buffer: Buffer
  mimeType: string
}): Promise<SocialMediaMetadata> {
  if (args.mimeType.startsWith('image/')) {
    const metadata = await sharp(args.buffer).metadata()
    return {
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      duration: null,
    }
  }

  if (args.mimeType === 'video/mp4' || args.mimeType === 'video/quicktime') {
    return probeMp4Metadata(args.buffer)
  }

  return { width: 0, height: 0, duration: null }
}
