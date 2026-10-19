import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'

type SharedFile = {
  originalName: string
  size: number
  uploaderName: string
  purpose: string
  uploadedAt: string
  expiresAt: string
}

type ApiResponse = {
  error?: string
  token?: string
  file?: SharedFile
  downloadUrl?: string
}

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

async function postJson(payload: Record<string, string>, signal?: AbortSignal): Promise<ApiResponse> {
  const response = await fetch(API, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  })
  const result = await response.json().catch(() => ({})) as ApiResponse
  if (!response.ok) throw new Error(result.error || 'Pastebox could not complete that request.')
  return result
}

function App() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<File | null>(null)
  const [uploaderName, setUploaderName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [shareToken, setShareToken] = useState(parseShareToken)
  const [sharedFile, setSharedFile] = useState<SharedFile | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadStage, setUploadStage] = useState('')
  const [loadingShare, setLoadingShare] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

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
    if (!shareToken || sharedFile) return
    const controller = new AbortController()
    setLoadingShare(true)
    setError('')
    postJson({ action: 'resolve', token: shareToken }, controller.signal)
      .then(result => setSharedFile(result.file ?? null))
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'This share link is invalid or has expired.')
      })
      .finally(() => { if (!controller.signal.aborted) setLoadingShare(false) })
    return () => controller.abort()
  }, [shareToken, sharedFile])

  function chooseFile(file?: File) {
    setError('')
    setCopied(false)
    if (!file) {
      setSelected(null)
      if (fileInput.current) fileInput.current.value = ''
      return
    }
    if (file.size < 1) {
      setSelected(null)
      setError('Empty files can’t be shared. Choose a file with content.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setSelected(null)
      setError('This file is over the 50 MB limit. Choose a smaller file.')
      return
    }
    setSelected(file)
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setDragging(false)
    chooseFile(event.dataTransfer.files.item(0) ?? undefined)
  }

  function leaveSharePage() {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    setShareToken('')
    setSharedFile(null)
    setError('')
    setCopied(false)
  }

  function uploadWithProgress(file: File, name: string, reason: string) {
    return new Promise<ApiResponse>((resolve, reject) => {
      const request = new XMLHttpRequest()
      request.open('POST', API)
      request.setRequestHeader('apikey', PUBLISHABLE_KEY)
      request.upload.onprogress = event => {
        if (!event.lengthComputable) return
        const progress = Math.min(95, Math.round((event.loaded / event.total) * 95))
        setUploadProgress(progress)
        setUploadStage(progress >= 95 ? 'Finishing the secure handoff…' : 'Sending your file…')
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
      body.append('name', name)
      body.append('purpose', reason)
      setUploadStage('Preparing your private share link…')
      request.send(body)
    })
  }

  async function submitUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setCopied(false)

    const cleanName = uploaderName.trim().replace(/\s+/g, ' ')
    const cleanPurpose = purpose.trim().replace(/\s+/g, ' ')
    if (!selected) return setError('Choose a file before uploading.')
    if (selected.size < 1) return setError('Empty files can’t be shared.')
    if (selected.size > MAX_FILE_BYTES) return setError('Files must be 50 MB or smaller.')
    if (cleanName.length < 2 || /^(anonymous|anon|test|name|n\/a|na|none|unknown|guest|admin|user)(\s*\d*)?$|^x{2,}$|^\d{2,}$/i.test(cleanName)) {
      return setError('Enter your name (at least 2 characters; placeholder names aren’t accepted).')
    }
    if (cleanPurpose.length < 10) return setError('Add a little context in the purpose field (at least 10 characters).')
    if (cleanPurpose.length > 240) return setError('Keep the purpose under 240 characters.')
    if (!storageReady) return setError('File storage is not configured yet. See the setup guide in the repository.')

    setUploading(true)
    setUploadProgress(0)
    try {
      const result = await uploadWithProgress(selected, cleanName, cleanPurpose)
      if (!result.token || !result.file) throw new Error('The upload finished, but Pastebox could not create the share link. Please contact the project owner.')

      setSharedFile(result.file)
      setShareToken(result.token)
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#share=${encodeURIComponent(result.token)}`)
      setSelected(null)
      setUploaderName('')
      setPurpose('')
      if (fileInput.current) fileInput.current.value = ''
      setUploadProgress(100)
      setUploadStage('Your link is ready')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed. Keep your details and retry.')
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

  async function downloadFile() {
    if (!shareToken || downloading || expired) return
    setDownloading(true)
    setError('')
    try {
      const result = await postJson({ action: 'download', token: shareToken })
      if (!result.downloadUrl) throw new Error('Pastebox could not prepare this download. Please retry.')
      const target = new URL(result.downloadUrl)
      const apiOrigin = new URL(API).origin
      if (target.origin !== apiOrigin) throw new Error('Pastebox returned an unexpected download location.')
      window.location.assign(target.href)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Download failed. Please retry.')
    } finally {
      setDownloading(false)
    }
  }

  const isSharePage = Boolean(shareToken)

  return (
    <main className="page-shell" id="top">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} onClick={event => { if (isSharePage) { event.preventDefault(); leaveSharePage() } }} aria-label="Pastebox home">
          <img className="brand-mark" src={import.meta.env.BASE_URL + 'pastebox-icon.svg'} alt="" />
          <span>pastebox</span>
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

      {!isSharePage ? (
        <section className="workspace" aria-label="Upload a file">
          <div className="workspace-heading">
            <div>
              <p className="step-label">01 <span>/</span> NEW SHARE</p>
              <h2>Drop it here.</h2>
            </div>
            <span className="file-limit">UP TO 50 MB</span>
          </div>

          <form onSubmit={submitUpload}>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              onChange={event => chooseFile(event.target.files?.[0])}
              tabIndex={-1}
              aria-hidden="true"
            />
            <button
              className={`dropzone${dragging ? ' is-dragging' : ''}${selected ? ' has-file' : ''}`}
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragEnter={event => { event.preventDefault(); setDragging(true) }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
              onDragLeave={event => {
                event.preventDefault()
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
              }}
              onDrop={onDrop}
              aria-label={selected ? `Selected file ${selected.name}. Choose another file or drop to replace.` : 'Choose a file or drop a file here'}
              disabled={uploading}
            >
              <span className="drop-icon" aria-hidden="true">{selected ? '✓' : dragging ? '↓' : '↑'}</span>
              <span className="drop-title">{selected ? selected.name : dragging ? 'Release to add your file' : 'Drop a file here'}</span>
              <span className="drop-subtitle">{selected ? `${prettySize(selected.size)} · Any format` : 'Any format · Up to 50 MB'}</span>
              <span className="browse-button">{selected ? 'Choose another' : 'Browse files'} <span aria-hidden="true">↗</span></span>
            </button>

            {selected && (
              <div className="selected-file" role="status">
                <span className="selected-file-mark" aria-hidden="true">FILE</span>
                <span className="selected-file-details"><strong>{selected.name}</strong><small>{prettySize(selected.size)} · Ready to upload</small></span>
                <button type="button" className="text-button" onClick={() => chooseFile()} disabled={uploading}>Remove</button>
              </div>
            )}

            <div className="form-grid">
              <label className="field">
                <span>Your name</span>
                <input
                  value={uploaderName}
                  onChange={event => setUploaderName(event.target.value)}
                  placeholder="How should we credit you?"
                  autoComplete="name"
                  maxLength={80}
                  required
                  disabled={uploading}
                />
                <small>Shown with the file. Names aren’t verified.</small>
              </label>
              <label className="field">
                <span>Why are you sharing it?</span>
                <textarea
                  value={purpose}
                  onChange={event => setPurpose(event.target.value)}
                  placeholder="Give the recipient a little context…"
                  maxLength={240}
                  rows={3}
                  required
                  disabled={uploading}
                />
                <small>At least 10 characters.</small>
              </label>
            </div>

            {!storageReady && <p className="service-note" role="status">Storage setup is not finished. The upload will be available when the public function URL and publishable key are configured.</p>}
            {error && <p className="message error" role="alert">{error}</p>}

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
                {uploading ? 'Uploading…' : 'Create share link'} <span aria-hidden="true">↗</span>
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
                  <span className="file-glyph" aria-hidden="true">FILE</span>
                  <div className="shared-file-name"><span>SHARED FILE</span><h3 title={sharedFile.originalName}>{sharedFile.originalName}</h3></div>
                  <span className="size-pill">{prettySize(sharedFile.size)}</span>
                </div>
                <div className="shared-file-purpose"><span>PURPOSE</span><p>{sharedFile.purpose}</p></div>
                <div className="details-grid">
                  <div><span>UPLOADED BY</span><strong>{sharedFile.uploaderName}</strong></div>
                  <div><span>UPLOADED</span><strong>{formattedDate(sharedFile.uploadedAt)}</strong></div>
                  <div className="countdown-detail"><span>LINK EXPIRES IN</span><strong><i className="status-dot" />{remaining(sharedFile.expiresAt, now)}</strong></div>
                </div>
              </article>

              {error && <p className="message error" role="alert">{error}</p>}
              <div className="share-actions">
                <button className="download-button" type="button" onClick={downloadFile} disabled={downloading || expired}>
                  {downloading ? 'Preparing download…' : 'Download file'} <span aria-hidden="true">↓</span>
                </button>
                <button className="text-button upload-another" type="button" onClick={leaveSharePage}>Upload another file <span aria-hidden="true">↗</span></button>
              </div>
              <p className="download-note">Downloads are delivered as files. Pastebox doesn’t preview or scan uploads.</p>
            </div>
          ) : (
            <div className="expired-state" key="share-expired">
              <span className="expired-icon" aria-hidden="true">↗</span>
              <p className="step-label">SHARE LINK UNAVAILABLE</p>
              <h2>{error ? 'This link can’t be opened.' : 'This share has expired.'}</h2>
              <p>{error || 'Files are available for six hours after upload. Ask the sender to create a new link.'}</p>
              <button className="submit-button" type="button" onClick={leaveSharePage}>Back to Pastebox <span aria-hidden="true">↗</span></button>
            </div>
          )}
        </section>
      )}

      <footer className="footer">
        <span>50 MB max · Any file format</span>
        <span>Share links expire after 6 hours</span>
      </footer>
    </main>
  )
}

export default App

