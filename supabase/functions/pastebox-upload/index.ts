import { withSupabase } from 'npm:@supabase/server@^1'

const BUCKET = 'pastebox-files'
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 128 * 1024
const SHARE_LIFETIME_MS = 6 * 60 * 60 * 1000
const SHARE_SITE_ORIGINS = new Set([
  'https://nullinam.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

function corsHeaders(request: Request): Record<string, string> {
  const requestOrigin = request.headers.get('origin')
  const origin = requestOrigin && SHARE_SITE_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : 'https://nullinam.github.io'

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-owner-key',
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

function logUploadFailure(stage: string) {
  // Never log request bodies, share/revoke tokens, filenames, storage paths, or client IPs.
  console.error(JSON.stringify({ event: 'pastebox_upload_failure', stage }))
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

async function sha256Bytes(value: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value)
  return bytesToHex(new Uint8Array(digest))
}

function secureEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
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

async function readBoundedForm(request: Request, contentType: string): Promise<FormData | null> {
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData()
}

function toPublicFile(row: Record<string, unknown>) {
  return {
    originalName: row.original_name,
    size: row.file_size,
    uploadedAt: row.uploaded_at,
    expiresAt: row.expires_at,
    checksum: row.checksum_sha256,
  }
}

async function sendUsageAlerts(admin: { rpc: (...args: any[]) => any }) {
  const webhook = Deno.env.get('PASTEBOX_ALERT_WEBHOOK_URL')
  if (!webhook) return
  let target: URL
  try { target = new URL(webhook) } catch { return }
  if (target.protocol !== 'https:' || target.username || target.password) return

  const { data, error } = await admin.rpc('get_pastebox_owner_usage')
  if (error || !Array.isArray(data) || !data[0]) return
  const usage = data[0] as Record<string, number>
  const checks = [
    ['storage', Number(Deno.env.get('PASTEBOX_STORAGE_ALERT_BYTES') || 0), usage.active_bytes],
    ['egress', Number(Deno.env.get('PASTEBOX_EGRESS_ALERT_BYTES') || 0), usage.estimated_egress_bytes],
  ] as const
  for (const [kind, threshold, value] of checks) {
    if (!threshold || value < threshold) continue
    const { data: claimed } = await admin.rpc('claim_pastebox_alert', { p_alert_key: kind })
    if (claimed !== true) continue
    try {
      await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `PasteBox ${kind} usage has reached ${value} bytes (configured alert threshold: ${threshold} bytes).` }),
        signal: AbortSignal.timeout(3000),
      })
    } catch { /* Alerts must never interrupt a successful file upload. */ }
  }
}

const handler = withSupabase({ auth: 'publishable' }, async (request, context) => {
  if (!isAllowedOrigin(request)) return json(request, { error: 'Origin is not allowed.' }, 403)
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed.' }, 405)

  const contentType = request.headers.get('content-type') ?? ''
  const isMultipart = contentType.toLowerCase().startsWith('multipart/form-data;')

  if (isMultipart) {
    if (Deno.env.get('PASTEBOX_MAINTENANCE_MODE')?.toLowerCase() === 'true') {
      return json(request, { error: 'Uploads are paused briefly for maintenance. Please try again later.' }, 503)
    }
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return json(request, { error: 'Files must be 50 MB or smaller.' }, 413)
    }

    let form: FormData | null
    try {
      form = await readBoundedForm(request, contentType)
    } catch {
      return json(request, { error: 'The upload form could not be read.' }, 400)
    }
    if (!form) return json(request, { error: 'This request is larger than PasteBox accepts. Files must be 50 MB or smaller.' }, 413)

    const files = form.getAll('file')
    const file = files[0]
    for (const key of form.keys()) {
      if (!['file', 'checksum'].includes(key)) {
        return json(request, { error: 'Unsupported upload field.' }, 400)
      }
    }
    const checksum = form.get('checksum')

    if (files.length !== 1 || !(file instanceof File)) {
      return json(request, { error: 'Choose exactly one file.' }, 400)
    }
    if (file.size < 1) return json(request, { error: 'Empty files cannot be uploaded.' }, 400)
    if (file.size > MAX_FILE_BYTES) return json(request, { error: 'Files must be 50 MB or smaller.' }, 413)

    if (files.length !== 1 || form.getAll('checksum').length !== 1
      || typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum)) {
      return json(request, { error: 'Choose one file and retry the upload.' }, 400)
    }

    const ipHash = await rateLimitHash(request)
    if (!ipHash) return json(request, { error: 'Upload protection is not configured.' }, 503)
    const maxUploads = Number(Deno.env.get('PASTEBOX_MAX_UPLOADS_PER_HOUR') || '10')
    const maxBytes = Number(Deno.env.get('PASTEBOX_MAX_BYTES_PER_HOUR') || String(200 * 1024 * 1024))
    const id = crypto.randomUUID()
    const maxStorage = Number(Deno.env.get('PASTEBOX_MAX_STORAGE_BYTES') || String(1024 * 1024 * 1024))
    const { data: reservation, error: limitError } = await context.supabaseAdmin.rpc(
      'reserve_pastebox_upload',
      { p_ip_hash: ipHash, p_file_size: file.size, p_max_uploads: maxUploads, p_max_bytes: maxBytes, p_max_storage: maxStorage, p_reservation_id: id },
    )
    if (limitError || reservation !== 'ok') {
      if (limitError) {
        logUploadFailure('rate_limit_reservation')
        return json(request, { error: 'PasteBox upload protection is temporarily unavailable. Please retry.' }, 503)
      }
      if (typeof reservation === 'string' && reservation.startsWith('rate:')) return json(request, { error: `Upload limit reached. Retry in about ${Math.max(1, Math.ceil(Number(reservation.slice(5)) / 60))} minute(s).` }, 429)
      if (typeof reservation === 'string' && reservation.startsWith('hourly-volume:')) return json(request, { error: `Hourly upload volume reached. Retry in about ${Math.max(1, Math.ceil(Number(reservation.slice(14)) / 60))} minute(s).` }, 429)
      if (reservation === 'storage') return json(request, { error: 'PasteBox has reached its configured storage limit. Try again later.' }, 429)
      return json(request, { error: 'Upload could not be accepted. Please retry.' }, 400)
    }

    const actualChecksum = await sha256Bytes(await file.arrayBuffer())
    if (!secureEqual(actualChecksum, checksum)) {
      await context.supabaseAdmin.from('pastebox_upload_reservations').delete().eq('id', id)
      return json(request, { error: 'The selected file changed before upload. Select it again and retry.' }, 400)
    }

    const storagePath = id
    const originalName = cleanFilename(file.name)
    const revokeToken = createShareToken()
    const revokeTokenHash = await sha256(revokeToken)
    const { error: pendingError } = await context.supabaseAdmin.from('pastebox_shares').insert({
      id,
      storage_path: storagePath,
      original_name: originalName,
      file_size: file.size,
      revoke_token_hash: revokeTokenHash,
      checksum_sha256: actualChecksum,
      status: 'pending',
    })

    if (pendingError) {
      logUploadFailure('create_pending_record')
      await context.supabaseAdmin.from('pastebox_upload_reservations').delete().eq('id', id)
      return json(request, { error: 'PasteBox could not start the upload. Please retry.' }, 503)
    }

    const { error: storageError } = await context.supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, file, {
        contentType: 'application/octet-stream',
        cacheControl: '0',
        upsert: false,
      })

    if (storageError) {
      logUploadFailure('store_object')
      const { error: objectCleanupError } = await context.supabaseAdmin.storage.from(BUCKET).remove([storagePath])
      if (!objectCleanupError) await context.supabaseAdmin.from('pastebox_shares').delete().eq('id', id)
      await context.supabaseAdmin.from('pastebox_upload_reservations').delete().eq('id', id)
      return json(request, { error: 'PasteBox could not store this file. Please retry.' }, 503)
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
      .select('original_name, file_size, uploaded_at, expires_at, checksum_sha256')
      .maybeSingle()

    if (activationError || !activated) {
      logUploadFailure('activate_share')
      const { error: objectCleanupError } = await context.supabaseAdmin.storage.from(BUCKET).remove([storagePath])
      if (!objectCleanupError) await context.supabaseAdmin.from('pastebox_shares').delete().eq('id', id)
      await context.supabaseAdmin.from('pastebox_upload_reservations').delete().eq('id', id)
      return json(request, { error: 'PasteBox could not finish the upload. Please retry.' }, 503)
    }

    await context.supabaseAdmin.from('pastebox_upload_reservations').delete().eq('id', id)
    await sendUsageAlerts(context.supabaseAdmin)
    return json(request, { token, revokeToken, file: toPublicFile(activated) }, 201)
  }

  if (!contentType.toLowerCase().startsWith('application/json')) {
    return json(request, { error: 'Unsupported request format.' }, 415)
  }

  let payload: { action?: unknown; token?: unknown; revokeToken?: unknown }
  try {
    payload = await request.json()
  } catch {
    return json(request, { error: 'Invalid request body.' }, 400)
  }

  if (payload.action === 'owner-usage') {
    const provided = request.headers.get('x-owner-key') ?? ''
    const ownerKey = Deno.env.get('PASTEBOX_OWNER_ACCESS_KEY') ?? ''
    if (!ownerKey || !secureEqual(provided, ownerKey)) return json(request, { error: 'This owner view is unavailable.' }, 404)
    const { data, error } = await context.supabaseAdmin.rpc('get_pastebox_owner_usage')
    if (error) return json(request, { error: 'PasteBox usage is temporarily unavailable.' }, 503)
    return json(request, { usage: data?.[0] ?? null })
  }

  if (payload.action === 'revoke' || payload.action === 'owner-stats') {
    if (typeof payload.revokeToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.revokeToken)) {
      return json(request, { error: 'This management key is invalid.' }, 404)
    }
    const revokeHash = await sha256(payload.revokeToken)
    const { data: managed, error: managementError } = await context.supabaseAdmin
      .from('pastebox_shares')
      .select('id, status, download_count, original_name, file_size, uploaded_at, expires_at')
      .eq('revoke_token_hash', revokeHash)
      .maybeSingle()
    if (managementError || !managed) return json(request, { error: 'This management key is invalid.' }, 404)
    if (payload.action === 'owner-stats') return json(request, { stats: {
      downloads: managed.download_count,
      status: managed.status,
      file: { originalName: managed.original_name, size: managed.file_size, uploadedAt: managed.uploaded_at, expiresAt: managed.expires_at },
    } })
    if (managed.status !== 'active') return json(request, { error: 'This upload is already unavailable.' }, 409)
    const { error } = await context.supabaseAdmin.from('pastebox_shares').update({ status: 'revoked' }).eq('id', managed.id).eq('status', 'active')
    if (error) return json(request, { error: 'PasteBox could not revoke this upload. Please retry.' }, 503)
    return json(request, { ok: true })
  }

  if (typeof payload.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(payload.token)) {
    return json(request, { error: 'This share link is invalid or has expired.' }, 404)
  }

  const tokenHash = await sha256(payload.token)
  const { data: share, error: lookupError } = await context.supabaseAdmin
    .from('pastebox_shares')
    .select('id, token_hash, storage_path, original_name, file_size, uploaded_at, expires_at, status, checksum_sha256, download_count')
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
    return json(request, { error: 'PasteBox could not prepare this download. Please retry.' }, 503)
  }

  const { data: canDownload, error: downloadError } = await context.supabaseAdmin.rpc(
    'record_pastebox_download',
    { p_share_id: share.id },
  )
  if (downloadError || canDownload !== true) return json(request, { error: 'This file is no longer available.' }, 404)

  return json(request, { downloadUrl: signed.signedUrl })
})

export default {
  fetch(request: Request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) })
    return handler(request)
  },
}

