import { withSupabase } from 'npm:@supabase/server@^1'

const BUCKET = 'pastebox-files'
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024
const SHARE_LIFETIME_MS = 6 * 60 * 60 * 1000
const SHARE_SITE_ORIGINS = new Set([
  'https://nullinam.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

const PLACEHOLDER_NAME = /^(?:anonymous|anon|test|name|n\/a|na|none|unknown|guest|admin|user)(?:\s*\d*)?$|^x{2,}$|^\d{2,}$/i

function corsHeaders(request: Request): Record<string, string> {
  const requestOrigin = request.headers.get('origin')
  const origin = requestOrigin && SHARE_SITE_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : 'https://nullinam.github.io'

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin',
  }
}

function json(request: Request, body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || SHARE_SITE_ORIGINS.has(origin)
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function createShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

async function rateLimitHash(request: Request): Promise<string | null> {
  // Prefer gateway-provided IP headers; never trust a caller-controlled X-Forwarded-For value.
  const clientIp = request.headers.get('cf-connecting-ip')?.trim()
    || request.headers.get('x-real-ip')?.trim()
  const secret = Deno.env.get('PASTEBOX_RATE_LIMIT_SECRET')
  if (!clientIp || !secret) return null

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(clientIp))
  return bytesToHex(new Uint8Array(signature))
}

function cleanFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? ''
  const clean = basename.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
  return clean || 'download'
}

function cleanUploaderName(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 80 || PLACEHOLDER_NAME.test(name)) return null
  return name
}

function cleanPurpose(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const purpose = value.trim().replace(/\s+/g, ' ')
  if (purpose.length < 10 || purpose.length > 240) return null
  return purpose
}

function toPublicFile(row: Record<string, unknown>) {
  return {
    originalName: row.original_name,
    size: row.file_size,
    uploaderName: row.uploader_name,
    purpose: row.purpose,
    uploadedAt: row.uploaded_at,
    expiresAt: row.expires_at,
  }
}

const handler = withSupabase({ auth: 'publishable' }, async (request, context) => {
  if (!isAllowedOrigin(request)) return json(request, { error: 'Origin is not allowed.' }, 403)
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405)

  const contentType = request.headers.get('content-type') ?? ''
  const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data;')

  if (isMultipart) {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return json(request, { error: 'Files must be 50 MB or smaller.' }, 413)
    }

    const ipHash = await rateLimitHash(request)
    if (!ipHash) return json(request, { error: 'Upload protection is not configured.' }, 503)

    const { data: allowed, error: limitError } = await context.supabaseAdmin.rpc(
      'consume_pastebox_upload_slot',
      { p_ip_hash: ipHash },
    )
    if (limitError || allowed !== true) {
      return json(request, { error: 'Upload limit reached. Try again later.' }, limitError ? 503 : 429)
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return json(request, { error: 'The upload form could not be read.' }, 400)
    }

    const files = form.getAll('file')
    const file = files[0]
    if (form.getAll('name').length !== 1 || form.getAll('purpose').length !== 1) {
      return json(request, { error: 'Enter exactly one name and one purpose.' }, 400)
    }
    for (const key of form.keys()) {
      if (!['file', 'name', 'purpose'].includes(key)) {
        return json(request, { error: 'Unsupported upload field.' }, 400)
      }
    }
    const uploaderName = cleanUploaderName(form.get('name'))
    const purpose = cleanPurpose(form.get('purpose'))

    if (files.length !== 1 || !(file instanceof File)) {
      return json(request, { error: 'Choose exactly one file.' }, 400)
    }
    if (file.size < 1) return json(request, { error: 'Empty files cannot be uploaded.' }, 400)
    if (file.size > MAX_FILE_BYTES) return json(request, { error: 'Files must be 50 MB or smaller.' }, 413)
    if (!uploaderName) return json(request, { error: 'Enter a real name with at least 2 characters.' }, 400)
    if (!purpose) return json(request, { error: 'Explain why you are sharing this file in at least 10 characters.' }, 400)

    const id = crypto.randomUUID()
    const storagePath = id
    const originalName = cleanFilename(file.name)
    const { error: pendingError } = await context.supabaseAdmin.from('pastebox_shares').insert({
      id,
      storage_path: storagePath,
      original_name: originalName,
      file_size: file.size,
      uploader_name: uploaderName,
      purpose,
      status: 'pending',
    })

    if (pendingError) return json(request, { error: 'Pastebox could not start the upload. Please retry.' }, 503)

    const { error: storageError } = await context.supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, file, {
        contentType: 'application/octet-stream',
        cacheControl: '0',
        upsert: false,
      })

    if (storageError) {
      const { error: objectCleanupError } = await context.supabaseAdmin.storage.from(BUCKET).remove([storagePath])
      if (!objectCleanupError) await context.supabaseAdmin.from('pastebox_shares').delete().eq('id', id)
      return json(request, { error: 'Pastebox could not store this file. Please retry.' }, 503)
    }

    const token = createShareToken()
    const tokenHash = await sha256(token)
    const uploadedAt = new Date()
    const expiresAt = new Date(uploadedAt.getTime() + SHARE_LIFETIME_MS)
    const { data: activated, error: activationError } = await context.supabaseAdmin
      .from('pastebox_shares')
      .update({
        token_hash: tokenHash,
        status: 'active',
        uploaded_at: uploadedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('original_name, file_size, uploader_name, purpose, uploaded_at, expires_at')
      .maybeSingle()

    if (activationError || !activated) {
      const { error: objectCleanupError } = await context.supabaseAdmin.storage.from(BUCKET).remove([storagePath])
      if (!objectCleanupError) await context.supabaseAdmin.from('pastebox_shares').delete().eq('id', id)
      return json(request, { error: 'Pastebox could not finish the upload. Please retry.' }, 503)
    }

    return json(request, { token, file: toPublicFile(activated) }, 201)
  }

  if (!contentType.toLowerCase().startsWith('application/json')) {
    return json(request, { error: 'Unsupported request format.' }, 415)
  }

  let payload: { action?: unknown; token?: unknown }
  try {
    payload = await request.json()
  } catch {
    return json(request, { error: 'Invalid request body.' }, 400)
  }

  if (typeof payload.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.token)) {
    return json(request, { error: 'This share link is invalid or has expired.' }, 404)
  }

  const tokenHash = await sha256(payload.token)
  const { data: share, error: lookupError } = await context.supabaseAdmin
    .from('pastebox_shares')
    .select('id, token_hash, storage_path, original_name, file_size, uploader_name, purpose, uploaded_at, expires_at, status')
    .eq('token_hash', tokenHash)
    .eq('status', 'active')
    .maybeSingle()

  if (lookupError || !share || new Date(share.expires_at).getTime() <= Date.now()) {
    return json(request, { error: 'This share link is invalid or has expired.' }, 404)
  }

  if (payload.action === 'resolve') return json(request, { file: toPublicFile(share) })
  if (payload.action !== 'download') return json(request, { error: 'Unknown action.' }, 400)

  const expiresIn = Math.min(60, Math.floor((new Date(share.expires_at).getTime() - Date.now()) / 1000))
  if (expiresIn < 1) return json(request, { error: 'This share link has expired.' }, 404)

  const { data: signed, error: signError } = await context.supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(share.storage_path, expiresIn, { download: share.original_name })

  if (signError || !signed?.signedUrl) {
    return json(request, { error: 'Pastebox could not prepare this download. Please retry.' }, 503)
  }

  return json(request, { downloadUrl: signed.signedUrl })
})

export default {
  fetch(request: Request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })
    return handler(request)
  },
}

