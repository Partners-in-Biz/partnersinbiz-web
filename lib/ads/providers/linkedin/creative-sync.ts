// lib/ads/providers/linkedin/creative-sync.ts
// LinkedIn two-step asset upload (register + PUT). Phase 2 baseline ships
// single-image only — video + carousel deferred. Sub-3b Phase 2 Batch 2D.

import { LINKEDIN_ADS_API_BASE, LINKEDIN_ADS_VERSION } from './constants'

export interface LinkedinAssetCallArgs {
  accessToken: string
  version?: string
}

export interface RegisterUploadResult {
  /** urn:li:digitalmediaAsset:{id} — ready to reference in /creatives content.reference (via a Share) */
  assetUrn: string
  /** Presigned URL to PUT the asset bytes to (LinkedIn dms-uploads host) */
  uploadUrl: string
  /** Optional headers the upload server requires — usually empty */
  uploadHeaders: Record<string, string>
}

function buildHeaders(args: LinkedinAssetCallArgs, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${args.accessToken}`,
    'LinkedIn-Version': args.version ?? LINKEDIN_ADS_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  }
}

/** Step 1: register an image upload. Returns the asset URN + presigned upload URL. */
export async function registerImageUpload(
  args: LinkedinAssetCallArgs & {
    /** urn:li:organization:{id} — the page or person who owns the asset */
    ownerUrn: string
    /** Recipe identifier. Phase 2 default: feedshare-image. */
    recipe?: string
  },
): Promise<RegisterUploadResult> {
  const url = `${LINKEDIN_ADS_API_BASE}/assets?action=registerUpload`

  const body = {
    registerUploadRequest: {
      owner: args.ownerUrn,
      recipes: [args.recipe ?? 'urn:li:digitalmediaRecipe:feedshare-image'],
      serviceRelationships: [
        { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
      ],
      supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'],
    },
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(args),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LinkedIn registerUpload failed: HTTP ${res.status} — ${text}`)
  }

  const data = (await res.json()) as {
    value?: {
      asset?: string
      uploadMechanism?: Record<string, { uploadUrl?: string; headers?: Record<string, string> }>
    }
  }

  const asset = data.value?.asset
  if (!asset) throw new Error('LinkedIn registerUpload response missing asset URN')

  // Find the upload mechanism — LinkedIn nests it under a fully-qualified Java class name key
  const mechanism = Object.values(data.value?.uploadMechanism ?? {})[0]
  const uploadUrl = mechanism?.uploadUrl
  if (!uploadUrl) throw new Error('LinkedIn registerUpload response missing uploadUrl')

  return {
    assetUrn: asset,
    uploadUrl,
    uploadHeaders: mechanism?.headers ?? {},
  }
}

/** Step 2: PUT the image bytes to the presigned upload URL. */
export async function uploadImageBytes(
  args: {
    uploadUrl: string
    /** Image bytes — typically a Buffer in Node or a Uint8Array in browser */
    bytes: ArrayBuffer | Uint8Array | Buffer
    /** MIME type of the image (image/jpeg, image/png, etc) */
    contentType: string
    /** Optional headers returned from registerImageUpload */
    extraHeaders?: Record<string, string>
    /** Bearer token — some LinkedIn upload URLs require it even though they're presigned */
    accessToken?: string
  },
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': args.contentType,
    ...(args.extraHeaders ?? {}),
  }
  if (args.accessToken) {
    headers.Authorization = `Bearer ${args.accessToken}`
  }

  // Normalise the body type to BodyInit
  const body: BodyInit = args.bytes instanceof Uint8Array || args.bytes instanceof ArrayBuffer
    ? args.bytes
    : (args.bytes as unknown as BodyInit)

  const res = await fetch(args.uploadUrl, {
    method: 'PUT',
    headers,
    body,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LinkedIn asset upload PUT failed: HTTP ${res.status} — ${text}`)
  }
}

/** Convenience: register + upload in one call. Returns the asset URN. */
export async function registerAndUploadImage(
  args: LinkedinAssetCallArgs & {
    ownerUrn: string
    bytes: ArrayBuffer | Uint8Array | Buffer
    contentType: string
    recipe?: string
  },
): Promise<{ assetUrn: string }> {
  const registered = await registerImageUpload({
    accessToken: args.accessToken,
    version: args.version,
    ownerUrn: args.ownerUrn,
    recipe: args.recipe,
  })
  await uploadImageBytes({
    uploadUrl: registered.uploadUrl,
    bytes: args.bytes,
    contentType: args.contentType,
    extraHeaders: registered.uploadHeaders,
    accessToken: args.accessToken,
  })
  return { assetUrn: registered.assetUrn }
}
