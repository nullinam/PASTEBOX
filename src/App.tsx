import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'

type SharedFile = {
  originalName: string
  size: number
  uploadedAt: string
  expiresAt: string
  checksum?: string
}

type ApiResponse = {
  error?: string
  token?: string
  revokeToken?: string
  file?: SharedFile
  ok?: boolean
  stats?: { downloads: number; status: string }
  downloadUrl?: string
}

type CreatedShare = { token: string; revokeToken: string; file: SharedFile }

const API = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, '') ?? ''
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
const MAX_FILE_BYTES = 50 * 1024 * 1024
const HOUR_MS = 60 * 60 * 1000

function parseShareToken() {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const token = hash.get('share') ?? ''
  return token.length <= 128 ? token : token.slice(0, 128)
}

function prettySize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function remaining(expiresAt: string, now: number) {
  const milliseconds = Math.max(0, new Date(expiresAt).getTime() - now)
  if (!milliseconds) return 'Expired'
  const hours = Math.floor(milliseconds / HOUR_MS)
  const minutes = Math.floor((milliseconds % HOUR_MS) / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1000)
  return hours > 0
    ? `${hours}h ${minutes.toString().padStart(2, '0')}m left`
    : `${minutes}m ${seconds.toString().padStart(2, '0')}s left`
}

function formattedDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function readableError(cause: unknown, fallback: string) {
  if (cause instanceof TypeError || (cause instanceof Error && /failed to fetch|networkerror|load failed/i.test(cause.message))) {
    return 'PasteBox could not reach its file service. Check your connection or network restrictions, then retry.'
  }
  return cause instanceof Error ? cause.message : fallback
}

async function fileChecksum(file: Blob) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function postJson(payload: Record<string, string>, signal?: AbortSignal, extraHeaders: Record<string, string> = {}): Promise<ApiResponse> {
  const response = await fetch(API, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
    signal,
  })
  const result = await response.json().catch(() => ({})) as ApiResponse
  if (!response.ok) throw new Error(result.error || 'PasteBox could not complete that request.')
  return result
}

function App() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<File[]>([])
  const [createdShares, setCreatedShares] = useState<CreatedShare[]>([])
  const [revoking, setRevoking] = useState('')
  const [shareStats, setShareStats] = useState<Record<string, number>>({})
  const [shareToken, setShareToken] = useState(parseShareToken)
  const [sharedFile, setSharedFile] = useState<SharedFile | null>(null)
  const [shareAttempt, setShareAttempt] = useState(0)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadStage, setUploadStage] = useState('')
  const [loadingShare, setLoadingShare] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedValue, setCopiedValue] = useState('')
  const [online, setOnline] = useState(() => navigator.onLine)

  const storageReady = Boolean(API && PUBLISHABLE_KEY)
  const shareUrl = shareToken
    ? `${window.location.origin}${import.meta.env.BASE_URL}#share=${encodeURIComponent(shareToken)}`
    : ''
  const expired = Boolean(sharedFile && new Date(sharedFile.expiresAt).getTime() <= now)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const setConnectionState = () => setOnline(navigator.onLine)
    window.addEventListener('online', setConnectionState)
    window.addEventListener('offline', setConnectionState)
    return () => {
      window.removeEventListener('online', setConnectionState)
      window.removeEventListener('offline', setConnectionState)
    }
  }, [])

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (parseShareToken() || !(event.clipboardData?.files.length)) return
      chooseFile(event.clipboardData.files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('receive')) return
    const open = indexedDB.open('pastebox-inbox', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('files', { keyPath: 'id' })
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('files', 'readwrite')
      const store = tx.objectStore('files')
      const request = store.getAll()
      request.onsuccess = () => {
        const entries = request.result as Array<{ id: string; file: File }>
        if (entries.length) {
          chooseFile(entries.map(entry => entry.file))
          entries.forEach(entry => store.delete(entry.id))
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
        }
      }
      tx.oncomplete = () => db.close()
    }
  }, [])

  useEffect(() => {
    if (!shareToken || sharedFile) return
    const controller = new AbortController()
    setLoadingShare(true)
    setError('')
    postJson({ action: 'resolve', token: shareToken }, controller.signal)
      .then(result => setSharedFile(result.file ?? null))
      .catch(cause => {
        if (!controller.signal.aborted) setError(readableError(cause, 'This share link is invalid or has expired.'))
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingShare(false) })
    return () => controller.abort()
  }, [shareToken, sharedFile, shareAttempt])

  function chooseFile(files?: FileList | File[]) {
    setError('')
    setCopied(false)
    if (!files || files.length === 0) {
      setSelected([])
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    const picked = Array.from(files)
    if (fileInput.current) fileInput.current.value = ''
    const invalid = picked.find(file => file.size < 1 || file.size > MAX_FILE_BYTES)
    if (invalid) {
      setError(invalid.size < 1 ? `${invalid.name} is empty. Choose a file with content.` : `${invalid.name} is over the 50 MB limit.`)
      return
    }
    setSelected(current => [...current, ...picked])
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setDragging(false)
    chooseFile(event.dataTransfer.files)
  }

  function leaveSharePage() {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    setShareToken('')
    setSharedFile(null)
    setError('')
    setCopied(false)
  }

  function uploadWithProgress(file: File, checksum: string, fileLabel: string) {
    return new Promise<ApiResponse>((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open('POST', API)
      request.setRequestHeader('apikey', PUBLISHABLE_KEY)
      request.upload.onprogress = event => {
        if (!event.lengthComputable) return
        const progress = Math.min(95, Math.round((event.loaded / event.total) * 95))
        setUploadProgress(progress)
        setUploadStage(progress >= 95 ? `${fileLabel} · Finishing the secure handoff…` : `${fileLabel} · Sending your file…`)
      }
      request.onload = () => {
        let result: ApiResponse = {}
        try { result = JSON.parse(request.responseText) as ApiResponse } catch { /* handled below */ }
        if (request.status >= 200 && request.status < 300) resolve(result)
        else reject(new Error(result.error || 'Upload did not complete. You can retry in a moment.'))
      }
      request.onerror = () => reject(new Error('The connection dropped during upload. Check your network and retry.'))
      request.onabort = () => reject(new Error('Upload was cancelled.'))
      const body = new FormData()
      body.append('file', file)
      body.append('checksum', checksum)
      setUploadStage(`${fileLabel} · Preparing your private share link…`)
      request.send(body)
    })
  }

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setCopied(false)

    if (!online) return setError('You appear to be offline. Reconnect to the internet, then retry without selecting the files again.')
    if (!selected.length) return setError('Choose at least one file before uploading.')
    if (!storageReady) return setError('File storage is not configured yet. See the setup guide in the repository.')

    setUploading(true)
    const pending = [...selected]
    try {
      for (let index = 0; index < pending.length; index += 1) {
        setUploadProgress(0)
        const fileLabel = `${index + 1} of ${pending.length} · ${pending[index].name}`
        setUploadStage(`Checking ${fileLabel}…`)
        const result = await uploadWithProgress(pending[index], await fileChecksum(pending[index]), fileLabel)
        if (!result.token || !result.revokeToken || !result.file) throw new Error('The upload finished, but PasteBox could not create a secure share link. Please retry.')
        setCreatedShares(current => [...current, { token: result.token!, revokeToken: result.revokeToken!, file: result.file! }])
        setSelected(pending.slice(index + 1))
      }
      setSelected([])
      if (fileInput.current) fileInput.current.value = ''
      setUploadProgress(100)
      setUploadStage('Your links are ready')
    } catch (cause) {
      setUploadProgress(0)
      setUploadStage('')
      setError(`${readableError(cause, 'Upload failed.')} Your remaining files are ready to retry without selecting them again.`)
    } finally {
      setUploading(false)
    }
  }

  async function copyLink() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setError('Copy was blocked by this browser. Select and copy the link manually from the address bar.')
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setCopiedValue(value)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setError('Copy was blocked by this browser. Select and copy the value manually.')
    }
  }

  async function revokeShare(revokeToken: string) {
    if (revoking) return
    if (!window.confirm('Revoke this file now? Anyone with its share link will lose access.')) return
    setRevoking(revokeToken)
    setError('')
    try {
      await postJson({ action: 'revoke', revokeToken })
      setCreatedShares(current => current.filter(item => item.revokeToken !== revokeToken))
    } catch (cause) {
      setError(readableError(cause, 'PasteBox could not revoke this share. Please retry.'))
    } finally {
      setRevoking('')
    }
  }

  async function loadShareStats(revokeToken: string) {
    try {
      const result = await postJson({ action: 'owner-stats', revokeToken })
      setShareStats(current => ({ ...current, [revokeToken]: result.stats?.downloads ?? 0 }))
    } catch (cause) {
      setError(readableError(cause, 'Download count is temporarily unavailable.'))
    }
  }

  async function shareNative(url: string) {
    if (navigator.share) {
      try { await navigator.share({ title: 'PasteBox file', url }) }
      catch (cause) { if (cause instanceof Error && cause.name !== 'AbortError') setError('Share was unavailable. Copy the link instead.') }
    } else await copyText(url)
  }

  async function downloadFile() {
    if (!shareToken || downloading || expired) return
    setDownloading(true)
    setError('')
    try {
      const result = await postJson({ action: 'download', token: shareToken })
      if (!result.downloadUrl) throw new Error('PasteBox could not prepare this download. Please retry.')
      const target = new URL(result.downloadUrl)
      const apiOrigin = new URL(API).origin
      if (target.origin !== apiOrigin) throw new Error('PasteBox returned an unexpected download location.')
      const response = await fetch(target.href, { cache: 'no-store', referrerPolicy: 'no-referrer' })
      if (!response.ok) throw new Error('The download could not be completed. Please retry while the link is active.')
      const blob = await response.blob()
      if (sharedFile?.checksum) {
        const receivedChecksum = await fileChecksum(blob)
        if (receivedChecksum !== sharedFile.checksum) throw new Error('This download did not match the uploaded file. Please retry on a stable connection.')
      }
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = sharedFile?.originalName || 'download'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
    } catch (cause) {
      setError(readableError(cause, 'Download failed. Please retry.'))
    } finally {
      setDownloading(false)
    }
  }

  const isSharePage = Boolean(shareToken)

  return (
    <main className="page-shell" id="top">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} onClick={event => { if (isSharePage) { event.preventDefault(); leaveSharePage() } }} aria-label="PasteBox home">
          <img className="brand-mark" src={import.meta.env.BASE_URL + 'pastebox-icon.svg'} alt="" />
          <span>PasteBox</span>
        </a>
        <span className="top-note"><span className="status-dot" /> LINK-ONLY FILE SHARING</span>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <div className="intro-copy">
          <p className="eyebrow"><span className="eyebrow-line" /> SIMPLE FILE HANDOFF</p>
          <h1 id="page-title">Files find<br /><span>their people.</span></h1>
          <p className="intro-description">
            {isSharePage
              ? 'A shared file, ready when you are.'
              : 'Send a file across devices with a link that lasts six hours.'}
          </p>
        </div>
        <aside className="expiry-card" aria-label="Share links expire after six hours">
          <span className="expiry-kicker">LINK WINDOW</span>
          <strong>06 <span>hours</span></strong>
          <span className="expiry-line"><i /></span>
          <span className="expiry-caption">Then access is removed automatically.</span>
        </aside>
      </section>

      {!online && <p className="service-note offline-note" role="status">You’re offline. Selected files stay in this page; reconnect to continue.</p>}

      {!isSharePage ? (
        <section className="workspace" aria-label="Upload a file">
          <div className="workspace-heading">
            <div>
              <p className="step-label">01 <span>/</span> NEW SHARE</p>
              <h2>Drop it here.</h2>
            </div>
            <span className="file-limit">UP TO 50 MB EACH</span>
          </div>

          {createdShares.length > 0 && <section className="created-shares" aria-live="polite" aria-label="Created share links">
            <div className="created-heading"><div><p className="step-label">READY <span>/</span> SHARE LINKS</p><h2>{createdShares.length} {createdShares.length === 1 ? 'file is' : 'files are'} ready.</h2></div></div>
            {createdShares.map(share => {
              const url = `${window.location.origin}${import.meta.env.BASE_URL}#share=${encodeURIComponent(share.token)}`
              return <article className="created-share" key={share.revokeToken}>
                <div className="created-share-file"><span className="file-glyph" aria-hidden="true">{share.file.originalName.split('.').pop()?.slice(0, 5).toUpperCase() || 'FILE'}</span><div><strong>{share.file.originalName}</strong><small>{prettySize(share.file.size)} · Expires {formattedDate(share.file.expiresAt)}</small></div></div>
                <div className="created-share-url" title={url}>{url}</div>
                <div className="created-share-actions">
                  <button type="button" className={`copy-button${copiedValue === url ? ' is-copied' : ''}`} onClick={() => copyText(url)}>{copiedValue === url ? 'Copied' : 'Copy link'}</button>
                  <button type="button" className="text-button" onClick={() => shareNative(url)}>Share</button>
                  <button type="button" className="text-button" onClick={() => copyText(share.revokeToken)}>{copiedValue === share.revokeToken ? 'Revoke key copied' : 'Copy private revoke key'}</button>
                  <button type="button" className="text-button" onClick={() => loadShareStats(share.revokeToken)}>{shareStats[share.revokeToken] === undefined ? 'Show downloads' : `${shareStats[share.revokeToken]} downloads`}</button>
                  <button type="button" className="text-button" onClick={() => revokeShare(share.revokeToken)} disabled={Boolean(revoking)}>{revoking === share.revokeToken ? 'Revoking…' : 'Revoke'}</button>
                </div>
                <small className="revoke-warning">Keep the private revoke key separate from the share link. Anyone with that key can revoke this file.</small>
              </article>
            })}
          </section>}

          <form onSubmit={submitUpload}>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              onChange={event => chooseFile(event.target.files ?? undefined)}
              multiple
              tabIndex={-1}
              aria-hidden="true"
            />
            <button
              className={`dropzone${dragging ? ' is-dragging' : ''}${selected.length ? ' has-file' : ''}`}
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragEnter={event => { event.preventDefault(); setDragging(true) }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={event => {
                event.preventDefault()
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
              }}
              onDrop={onDrop}
              aria-label={selected.length ? `${selected.length} files selected. Choose more files or drop files here.` : 'Choose files or drop files here'}
              disabled={uploading}
            >
              <span className="drop-icon" aria-hidden="true">{selected.length ? '✓' : dragging ? '↓' : '↑'}</span>
              <span className="drop-title">{selected.length ? `${selected.length} ${selected.length === 1 ? 'file' : 'files'} selected` : dragging ? 'Release to add your files' : 'Drop files here'}</span>
              <span className="drop-subtitle">Any format · Up to 50 MB each</span>
              <span className="browse-button">{selected.length ? 'Choose more files' : 'Browse files'} <span aria-hidden="true">↗</span></span>
            </button>

            {selected.map((file, index) => (
              <div className="selected-file" role="status" key={`${file.name}-${file.lastModified}-${index}`}>
                <span className="selected-file-mark" aria-hidden="true">{file.name.split('.').pop()?.slice(0, 5).toUpperCase() || 'FILE'}</span>
                <span className="selected-file-details"><strong>{file.name}</strong><small>{prettySize(file.size)} · Ready to upload</small></span>
                <button type="button" className="text-button" onClick={() => setSelected(current => current.filter((_, fileIndex) => fileIndex !== index))} disabled={uploading}>Remove</button>
              </div>
            ))}

            <div className="privacy-notice">
              <strong>Before you share</strong>
                <p>Anyone with a share link can download its file. Links can be forwarded. PasteBox does not scan files, and downloaded copies stay with recipients after the PasteBox copy expires.</p>
            </div>

            {!storageReady && <p className="service-note" role="status">Storage setup is not finished. The upload will be available when the public function URL and publishable key are configured.</p>}
            {error && <div className="error-group"><p className="message error" role="alert">{error}</p>{selected.length > 0 && !uploading && <p className="retry-hint">{selected.length} {selected.length === 1 ? 'file is' : 'files are'} still selected. Retry when ready.</p>}</div>}

            {uploading && (
              <div className="progress-block" role="status" aria-live="polite">
                <div className="progress-copy"><span>{uploadStage}</span><strong>{uploadProgress}%</strong></div>
                <div className="progress-track" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadProgress}>
                  <span style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            <div className="form-footer">
              <p className="link-warning"><span aria-hidden="true">↗</span> Anyone with the link can download it until it expires.</p>
              <button className="submit-button" type="submit" disabled={uploading || !storageReady}>
                {uploading ? 'Uploading…' : error && selected.length ? `Retry ${selected.length === 1 ? 'upload' : 'remaining uploads'}` : 'Create share link'} <span aria-hidden="true">↗</span>
              </button>
            </div>
          </form>
        </section>
      ) : (
        <section className="workspace share-workspace" aria-label="Shared file">
          {loadingShare && !sharedFile ? (
            <div className="share-loading" role="status"><span className="loading-orbit" /> Checking this share link…</div>
          ) : sharedFile && !expired ? (
            <div className="share-content" key="share-ready">
              <div className="share-heading">
                <p className="step-label">02 <span>/</span> LINK-ONLY SHARE</p>
                <h2>Your file is ready.</h2>
                <p>Anyone with this link can download the file while it’s active. Keep the link within your circle.</p>
              </div>

              <div className="share-link-box">
                <div className="share-link-copy">
                  <span className="share-link-label">YOUR SHARE LINK</span>
                  <span className="share-link-value">{shareUrl}</span>
                </div>
                <button className={`copy-button${copied ? ' is-copied' : ''}`} type="button" onClick={copyLink}>
                  <span aria-hidden="true">{copied ? '✓' : '▢'}</span>{copied ? 'Copied' : 'Copy link'}
                </button>
              </div>

              <article className="shared-file-card">
                <div className="shared-file-top">
                  <span className="file-glyph" aria-hidden="true">{sharedFile.originalName.split('.').pop()?.slice(0, 5).toUpperCase() || 'FILE'}</span>
                  <div className="shared-file-name"><span>SHARED FILE</span><h3 title={sharedFile.originalName}>{sharedFile.originalName}</h3></div>
                  <span className="size-pill">{prettySize(sharedFile.size)}</span>
                </div>
                <div className="details-grid">
                  <div><span>UPLOADED</span><strong>{formattedDate(sharedFile.uploadedAt)}</strong></div>
                  <div className="countdown-detail"><span>LINK EXPIRES IN</span><strong><i className="status-dot" />{remaining(sharedFile.expiresAt, now)}</strong></div>
                  <div><span>EXPIRES AT</span><strong>{formattedDate(sharedFile.expiresAt)}</strong></div>
                </div>
              </article>

              {error && <p className="message error" role="alert">{error}</p>}
              <div className="share-actions">
                <button className="download-button" type="button" onClick={downloadFile} disabled={downloading || expired}>
                  {downloading ? 'Verifying download…' : 'Download file'} <span aria-hidden="true">↓</span>
                </button>
                <button className="text-button upload-another" type="button" onClick={leaveSharePage}>Upload another file <span aria-hidden="true">↗</span></button>
              </div>
              <p className="download-note">Downloads are delivered as files. PasteBox doesn’t preview or scan uploads.</p>
            </div>
          ) : (
            <div className="expired-state" key="share-expired">
              <span className="expired-icon" aria-hidden="true">↗</span>
              <p className="step-label">SHARE LINK UNAVAILABLE</p>
              <h2>{error ? 'This link can’t be opened.' : 'This share has expired.'}</h2>
              <p>{error || 'Files are available for six hours after upload. Ask the sender to create a new link.'}</p>
              {error && <button className="text-button retry-share" type="button" disabled={loadingShare || !online} onClick={() => { setError(''); setShareAttempt(attempt => attempt + 1) }}>{loadingShare ? 'Checking link…' : 'Try checking the link again'}</button>}
              <button className="submit-button" type="button" onClick={leaveSharePage}>Back to PasteBox <span aria-hidden="true">↗</span></button>
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        <span>50 MB max per file · Any file format</span>
        <span>Share links expire after 6 hours</span>
      </footer>
    </main>
  )
}

export default App

