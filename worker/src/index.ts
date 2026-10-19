interface Env {
  DB: D1Database
  FILES: R2Bucket
  ALLOWED_ORIGIN: string
  MAX_FILE_BYTES: string
}

const SIX_HOURS = 6 * 60 * 60 * 1000
const MAX_BYTES = 25 * 1024 * 1024
const PLACEHOLDERS = new Set(['anonymous', 'anon', 'test', 'name', 'n/a', 'none', 'unknown'])

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } })
}

function responseHeaders(request: Request, env: Env) {
  const origin = request.headers.get('Origin') ?? ''
  const local = /^http:\/\/localhost(?::\d+)?$/.test(origin)
  const allowed = origin === env.ALLOWED_ORIGIN || local
  return new Headers({
    'Access-Control-Allow-Origin': allowed ? origin : env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
}

function cleanFileName(value: string) {
  const name = value.replace(/[\\/\u0000-\u001f\u007f]/g, '_').trim().slice(0, 180)
  return name || 'download'
}

function validate(name: string, purpose: string) {
  if (name.length < 2 || name.length > 60 || PLACEHOLDERS.has(name.toLowerCase())) return 'Enter a name between 2 and 60 characters.'
  if (purpose.length < 10 || purpose.length > 240) return 'Explain the purpose in 10 to 240 characters.'
  return null
}

async function removeExpired(env: Env) {
  const expired = await env.DB.prepare('SELECT id, object_key FROM files WHERE expires_at <= ? LIMIT 100').bind(new Date().toISOString()).all<{ id: string; object_key: string }>()
  if (!expired.results.length) return
  await Promise.all(expired.results.map(file => env.FILES.delete(file.object_key)))
  const placeholders = expired.results.map(() => '?').join(',')
  await env.DB.prepare(`DELETE FROM files WHERE id IN (${placeholders})`).bind(...expired.results.map(file => file.id)).run()
}

async function handle(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const cors = responseHeaders(request, env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'GET' && path === '/api/health') return json({ ok: true }, 200, cors)

  if (request.method === 'GET' && path === '/api/files') {
    const result = await env.DB.prepare('SELECT id, original_name AS originalName, uploader_name AS name, purpose, size_bytes AS size, uploaded_at AS uploadedAt, expires_at AS expiresAt FROM files WHERE expires_at > ? ORDER BY uploaded_at DESC LIMIT 200').bind(new Date().toISOString()).all()
    ctx?.waitUntil(removeExpired(env))
    return json({ files: result.results }, 200, cors)
  }

  if (request.method === 'POST' && path === '/api/files') {
    let form: FormData
    try { form = await request.formData() } catch { return json({ error: 'Could not read the upload. Please try again.' }, 400, cors) }
    const file = form.get('file')
    if (!(file instanceof File)) return json({ error: 'Choose a file to upload.' }, 400, cors)
    const name = String(form.get('name') ?? '').trim()
    const purpose = String(form.get('purpose') ?? '').trim()
    const invalid = validate(name, purpose)
    if (invalid) return json({ error: invalid }, 400, cors)
    const configuredLimit = Number(env.MAX_FILE_BYTES) || MAX_BYTES
    const maxBytes = Math.min(configuredLimit, MAX_BYTES)
    if (file.size < 1) return json({ error: 'The selected file is empty.' }, 400, cors)
    if (file.size > maxBytes) return json({ error: 'Files must be 25 MB or smaller.' }, 413, cors)

    const id = crypto.randomUUID()
    const objectKey = `${id}/${crypto.randomUUID()}`
    const uploadedAt = new Date()
    const expiresAt = new Date(uploadedAt.getTime() + SIX_HOURS)
    try {
      await env.FILES.put(objectKey, file.stream(), { httpMetadata: { contentType: 'application/octet-stream' } })
      await env.DB.prepare('INSERT INTO files (id, object_key, original_name, uploader_name, purpose, size_bytes, uploaded_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, objectKey, cleanFileName(file.name), name, purpose, file.size, uploadedAt.toISOString(), expiresAt.toISOString()).run()
    } catch {
      await env.FILES.delete(objectKey).catch(() => undefined)
      return json({ error: 'Upload could not be saved. Please try again.' }, 503, cors)
    }
    return json({ id, uploadedAt: uploadedAt.toISOString(), expiresAt: expiresAt.toISOString() }, 201, cors)
  }

  const downloadMatch = path.match(/^\/api\/files\/([0-9a-f-]{36})\/download$/i)
  if (request.method === 'GET' && downloadMatch) {
    const row = await env.DB.prepare('SELECT object_key, original_name, expires_at FROM files WHERE id = ? AND expires_at > ?').bind(downloadMatch[1], new Date().toISOString()).first<{ object_key: string; original_name: string; expires_at: string }>()
    if (!row) return json({ error: 'This file has expired or no longer exists.' }, 404, cors)
    const object = await env.FILES.get(row.object_key)
    if (!object) return json({ error: 'This file is no longer available.' }, 404, cors)
    const filename = cleanFileName(row.original_name)
    const headers = new Headers(cors)
    headers.set('Content-Type', 'application/octet-stream')
    headers.set('Content-Length', String(object.size))
    headers.set('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    headers.set('Cache-Control', 'private, no-store, max-age=0')
    return new Response(object.body, { headers })
  }

  return json({ error: 'Not found.' }, 404, cors)
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) { return handle(request, env, ctx) },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(removeExpired(env)) },
}
