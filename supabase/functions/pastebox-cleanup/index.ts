import { withSupabase } from 'npm:@supabase/server@^1'

const BUCKET = 'pastebox-files'
const BATCH_SIZE = 100

function logCleanupFailure(stage: string, failed: number) {
  // Keep logs useful for operations without recording file names, paths, IDs, or credentials.
  console.error(JSON.stringify({ event: 'pastebox_cleanup_failure', stage, failed }))
}

const handler = withSupabase({ auth: 'secret' }, async (request, context) => {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 })

  const now = new Date().toISOString()

  const [expiredResult, pendingResult] = await Promise.all([
    context.supabaseAdmin.from('pastebox_shares')
      .select('id, storage_path')
      .or(`status.eq.revoked,and(status.eq.downloaded,expires_at.lte.${now}),and(status.eq.active,expires_at.lte.${now})`)
      .limit(BATCH_SIZE),
    context.supabaseAdmin.from('pastebox_shares')
      .select('id, storage_path')
      .eq('status', 'pending')
      .lte('pending_expires_at', now)
      .limit(BATCH_SIZE),
  ])

  if (expiredResult.error || pendingResult.error) {
    logCleanupFailure('read_expired_records', 1)
    return Response.json({ error: 'Cleanup could not read expired records.' }, { status: 503 })
  }

  const rows = [...(expiredResult.data ?? []), ...(pendingResult.data ?? [])]
  let removed = 0
  let failed = 0

  for (const row of rows) {
    const { error: storageError } = await context.supabaseAdmin.storage
      .from(BUCKET)
      .remove([row.storage_path])
    const storageStatus = (storageError as { statusCode?: string } | null)?.statusCode
    if (storageError && storageStatus !== '404') {
      failed += 1
      continue
    }

    const { error: rowError } = await context.supabaseAdmin
      .from('pastebox_shares')
      .delete()
      .eq('id', row.id)
    if (rowError) failed += 1
    else removed += 1
  }

  const { error: limitCleanupError } = await context.supabaseAdmin.from('pastebox_upload_limits')
    .delete()
    .lt('window_started_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  const { error: reservationCleanupError } = await context.supabaseAdmin.from('pastebox_upload_reservations')
    .delete()
    .lt('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())

  if (limitCleanupError) failed += 1
  if (reservationCleanupError) failed += 1
  if (failed > 0) {
    logCleanupFailure('partial_cleanup', failed)
    return Response.json({ ok: false, removed, failed }, { status: 503 })
  }

  return Response.json({ ok: true, removed, failed: 0 })
})

export default { fetch: handler }

