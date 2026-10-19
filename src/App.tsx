import { useCallback, useEffect, useMemo, useState } from 'react'

type PasteFile = {
  id: string
  name: string
  purpose: string
  originalName: string
  size: number
  uploadedAt: string
  expiresAt: string
}

const API = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, '') ?? ''
const MAX_BYTES = 25 * 1024 * 1024

function prettySize(bytes: number) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function remaining(expiresAt: string, now: number) {
  const milliseconds = Math.max(0, new Date(expiresAt).getTime() - now)
  if (milliseconds === 0) return 'Expired'
  const totalMinutes = Math.ceil(milliseconds / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours ? hours + 'h ' + minutes + 'm left' : totalMinutes + 'm left'
}

function App() {
  const [tab, setTab] = useState<'upload' | 'view'>('upload')
  const [files, setFiles] = useState<PasteFile[]>([])
  const [selected, setSelected] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!API) {
      setFiles([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const response = await fetch(API + '/api/files')
      if (!response.ok) throw new Error('Could not load the shared files.')
      const data = await response.json() as { files: PasteFile[] }
      setFiles(Array.isArray(data.files) ? data.files : [])
      setError('')
    } catch {
      setError('Pastebox could not reach its file service. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (tab !== 'view') return
    const timer = window.setInterval(() => { void refresh() }, 60_000)
    return () => window.clearInterval(timer)
  }, [tab, refresh])

  const activeFiles = useMemo(
    () => files.filter(file => new Date(file.expiresAt).getTime() > now),
    [files, now],
  )

  function selectTab(nextTab: 'upload' | 'view') {
    setTab(nextTab)
    setError('')
    setSuccess('')
  }

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')

    const cleanName = name.trim()
    const cleanPurpose = purpose.trim()

    if (!selected) return setError('Choose a file to upload.')
    if (selected.size === 0) return setError('Empty files can’t be uploaded.')
    if (selected.size > MAX_BYTES) return setError('Files must be 25 MB or smaller.')
    if (cleanName.length < 2 || /^(anonymous|anon|test|name|n\/a|none)$/i.test(cleanName)) {
      return setError('Enter your name (at least 2 characters).')
    }
    if (cleanPurpose.length < 10) return setError('Please explain the purpose in at least 10 characters.')
    if (!API) return setError('File storage is not connected yet.')

    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', selected)
      body.append('name', cleanName)
      body.append('purpose', cleanPurpose)
      const response = await fetch(API + '/api/files', { method: 'POST', body })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Upload failed. Please try again.')

      setSuccess('Your file is ready to share for the next 6 hours.')
      setSelected(null)
      setName('')
      setPurpose('')
      const input = document.getElementById('file-input') as HTMLInputElement | null
      if (input) input.value = ''
      await refresh()
      setTab('view')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page-shell" id="top">
      <header className="topbar">
        <a className="brand" href="#top" onClick={() => selectTab('upload')} aria-label="Pastebox home">
          <img className="brand-mark" src={import.meta.env.BASE_URL + 'pastebox-icon.svg?v=3'} alt="" />
          <span>pastebox</span>
        </a>
        <button className="top-view-button" type="button" onClick={() => { selectTab('view'); void refresh() }}>
          Browse files <span aria-hidden="true">↗</span>
        </button>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <div className="intro-copy">
          <p className="eyebrow"><span className="eyebrow-dot" /> PASTEBOX <span className="eyebrow-divider">/</span> GROUP FILES</p>
          <h1 id="page-title">Drop files in.<br /><span>Pick them up anywhere.</span></h1>
        </div>
        <aside className="expiry-card" aria-label="Files expire automatically after six hours">
          <span className="expiry-icon" aria-hidden="true">◷</span>
          <span className="expiry-label">AUTOMATIC CLEANUP</span>
          <strong>6 hours</strong>
          <span className="expiry-caption">Available to download until expiry.</span>
        </aside>
      </section>

      <section className="workspace" aria-label="Pastebox file sharing">
        <div className="tabs" role="tablist" aria-label="Choose an action">
          <button
            className={tab === 'upload' ? 'tab active' : 'tab'}
            id="upload-tab"
            type="button"
            role="tab"
            aria-selected={tab === 'upload'}
            aria-controls="upload-panel"
            onClick={() => selectTab('upload')}
          >
            <span className="tab-icon" aria-hidden="true">↑</span> Upload
          </button>
          <button
            className={tab === 'view' ? 'tab active' : 'tab'}
            id="view-tab"
            type="button"
            role="tab"
            aria-selected={tab === 'view'}
            aria-controls="view-panel"
            onClick={() => { selectTab('view'); void refresh() }}
          >
            <span className="tab-icon" aria-hidden="true">▤</span> View files
            <span className="count-pill">{activeFiles.length}</span>
          </button>
        </div>

        {tab === 'upload' ? (
          <div className="panel" id="upload-panel" role="tabpanel" aria-labelledby="upload-tab">
            <div className="panel-heading">
              <div>
                <span className="step-label">01 <span>/</span> ADD A FILE</span>
                <h2>Share something</h2>
              </div>
              <span className="file-limit">MAX 25 MB</span>
            </div>

            <form onSubmit={upload}>
              <label className="dropzone" htmlFor="file-input">
                <input
                  id="file-input"
                  type="file"
                  onChange={event => {
                    setSelected(event.target.files?.[0] ?? null)
                    setError('')
                    setSuccess('')
                  }}
                />
                <span className="upload-symbol" aria-hidden="true">↑</span>
                <span className="drop-title">{selected ? selected.name : 'Choose a file to upload'}</span>
                <span className="drop-subtitle">Any format <span aria-hidden="true">·</span> Up to 25 MB</span>
                {selected && <span className="selected-size">{prettySize(selected.size)}</span>}
              </label>

              <div className="form-grid">
                <label className="field">
                  <span>Your name</span>
                  <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    placeholder="Enter your name"
                    maxLength={60}
                    autoComplete="name"
                    required
                  />
                  <small>Shown with the file in the shared list.</small>
                </label>
                <label className="field">
                  <span>Purpose</span>
                  <textarea
                    value={purpose}
                    onChange={event => setPurpose(event.target.value)}
                    placeholder="What is this file for?"
                    maxLength={240}
                    rows={3}
                    required
                  />
                  <small>Give the group a little context (10–240 characters).</small>
                </label>
              </div>

              {!API && (
                <p className="service-note" role="status">
                  <span aria-hidden="true">i</span>
                  File storage is not connected yet. Uploads will be available after setup.
                </p>
              )}
              {error && <p className="message error" role="alert">{error}</p>}
              {success && <p className="message success" role="status">{success}</p>}

              <div className="form-footer">
                <span className="privacy-note"><span className="lock-icon" aria-hidden="true">▣</span> Stored privately · Shared on this page</span>
                <button className="submit-button" type="submit" disabled={busy || !API}>
                  {busy ? 'Uploading…' : API ? 'Upload file' : 'Storage not connected'} <span aria-hidden="true">↗</span>
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="panel" id="view-panel" role="tabpanel" aria-labelledby="view-tab">
            <div className="panel-heading view-heading">
              <div>
                <span className="step-label">02 <span>/</span> SHARED FILES</span>
                <h2>Files from your group</h2>
              </div>
              <button className="refresh-button" type="button" onClick={() => void refresh()} disabled={loading || !API} aria-label="Refresh file list">
                ↻
              </button>
            </div>

            {error && <p className="message error" role="alert">{error}</p>}
            {!API ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">▤</span>
                <strong>Storage isn’t connected yet</strong>
                <span>Once setup is complete, shared files will appear here.</span>
                <button type="button" onClick={() => selectTab('upload')}>Back to upload <span aria-hidden="true">↗</span></button>
              </div>
            ) : activeFiles.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">▤</span>
                <strong>{loading ? 'Checking for files…' : 'Nothing here yet'}</strong>
                <span>{loading ? 'Your group’s latest uploads will show here.' : 'Upload the first file for your group.'}</span>
                <button type="button" onClick={() => selectTab('upload')}>Upload a file <span aria-hidden="true">↗</span></button>
              </div>
            ) : (
              <div className="file-list">
                {activeFiles.map(file => (
                  <article className="file-card" key={file.id}>
                    <div className="file-type" aria-hidden="true">
                      {file.originalName.split('.').pop()?.slice(0, 5).toUpperCase() || 'FILE'}
                    </div>
                    <div className="file-info">
                      <h3 title={file.originalName}>{file.originalName}</h3>
                      <p>{file.purpose}</p>
                      <div className="file-meta">
                        <span>Uploaded by <strong>{file.name}</strong></span>
                        <time dateTime={file.uploadedAt}>{new Date(file.uploadedAt).toLocaleString()}</time>
                      </div>
                    </div>
                    <div className="file-actions">
                      <span className="expiry">{remaining(file.expiresAt, now)}</span>
                      <a className="download-button" href={API + '/api/files/' + encodeURIComponent(file.id) + '/download'}>
                        Download <span aria-hidden="true">↓</span>
                      </a>
                      <span className="file-size">{prettySize(file.size)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="list-footnote">
              <span className="live-dot" aria-hidden="true" />
              <span>Refreshes every minute</span><span className="footnote-divider">·</span><span>Files expire 6 hours after upload</span>
            </div>
          </div>
        )}
      </section>

      <footer className="footer">
        <span>Maximum file size: 25 MB</span>
        <span>Files are removed 6 hours after upload</span>
      </footer>
    </main>
  )
}

export default App
