import { withSupabase } from 'npm:@supabase/server@^1'

const BUCKET = 'pastebox-files'
const BATCH_SIZE = 100

const handler = withSupabase({ auth: 'secret' }, async (request, context) => {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 })

  const now = new Date().toISOString()

  const [expiredResult, pendingResult] = await Promise.all([
    context.supabaseAdmin.from('pastebox_shares')
      .select('id, storage_path')
      .eq('status', 'active')
      .lte('expires_at', now)
      .limit(BATCH_SIZE),
    context.supabaseAdmin.from('pastebox_shares')
      .select('id, storage_path')
      .eq('status', 'pending')
      .lte('pending_expires_at', now)
      .limit(BATCH_SIZE),
  ])

  if (expiredResult.error || pendingResult.error) {
    return Response.json({ error: 'Cleanup could not read expired records.' }, { status: 503 })
  }

  const rows = [...(expiredResult.data ?? []), ...(pendingResult.data ?? [])]
  let removed = 0

  for (const row of rows) {
    const { error: storageError } = await context.supabaseAdmin.storage
      .from(BUCKET)
      .remove([row.storage_path])
    const storageStatus = (storageError as { statusCode?: string } | null)?.statusCode
    if (storageError && storageStatus !== '404') continue

    const { error: rowError } = await context.supabaseAdmin
      .from('pastebox_shares')
      .delete()
      .eq('id', row.id)
    if (!rowError) removed += 1
  }

  await context.supabaseAdmin.from('pastebox_upload_limits')
    .delete()
    .lt('window_started_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  return Response.json({ ok: true, removed })
})

export default { fetch: handler }

