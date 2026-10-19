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

const API = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? ''
const MAX_BYTES = 25 * 1024 * 1024

function prettySize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function remaining(expiresAt: string, now: number) {
  const ms = Math.max(0, new Date(expiresAt).getTime() - now)
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  return hours ? `${hours}h ${minutes}m left` : `${minutes}m left`
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
    setLoading(true)
    try {
      const response = await fetch(`${API}/api/files`)
      if (!response.ok) throw new Error('Could not load the shared files.')
      const data = await response.json() as { files: PasteFile[] }
      setFiles(data.files)
      setError('')
    } catch {
      setError(API ? 'Pastebox could not reach its file service. Try again in a moment.' : 'The file service has not been connected yet. See the setup guide in the repository.')
    } finally { setLoading(false) }
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

  const activeFiles = useMemo(() => files.filter(file => new Date(file.expiresAt).getTime() > now), [files, now])

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(''); setSuccess('')
    const cleanName = name.trim()
    const cleanPurpose = purpose.trim()
    if (!selected) return setError('Choose a file to upload.')
    if (selected.size > MAX_BYTES) return setError('Files must be 25 MB or smaller.')
    if (cleanName.length < 2 || /^(anonymous|anon|test|name|n\/a|none)$/i.test(cleanName)) return setError('Enter your name (at least 2 characters).')
    if (cleanPurpose.length < 10) return setError('Please explain the purpose in at least 10 characters.')
    if (!API) return setError('The file service has not been connected yet. See the setup guide in the repository.')
    setBusy(true)
    try {
      const body = new FormData()
      body.append('file', selected)
      body.append('name', cleanName)
      body.append('purpose', cleanPurpose)
      const response = await fetch(`${API}/api/files`, { method: 'POST', body })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Upload failed. Please try again.')
      setSuccess('Your file is ready to share for the next 6 hours.')
      setSelected(null); setName(''); setPurpose('')
      const input = document.getElementById('file-input') as HTMLInputElement | null
      if (input) input.value = ''
      await refresh()
      setTab('view')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed. Please try again.')
    } finally { setBusy(false) }
  }

  return <main className="page-shell">
    <header className="topbar">
      <a className="brand" href="#top" onClick={() => setTab('upload')} aria-label="Pastebox home"><img className="brand-mark" src={`${import.meta.env.BASE_URL}pastebox-icon.svg`} alt="" /><span>pastebox</span></a>
      <div className="top-note"><span className="live-dot" /> Just for your circle</div>
    </header>

    <section className="intro" id="top">
      <div className="eyebrow"><span>THE GROUP FILE BOX</span><span className="eyebrow-line" /></div>
      <h1>Pass it around.<br /><span>It won’t stay forever.</span></h1>
      <p className="intro-copy">A simple shared spot for the files your friends need right now.</p>
      <div className="promise"><span className="clock-icon">◷</span><span>Files disappear automatically after <strong>6 hours</strong></span></div>
    </section>

    <section className="workspace" aria-label="Pastebox file sharing">
      <div className="tabs" role="tablist" aria-label="Choose an action">
        <button className={tab === 'upload' ? 'tab active' : 'tab'} role="tab" aria-selected={tab === 'upload'} onClick={() => { setTab('upload'); setError(''); setSuccess('') }}><span className="tab-icon">↑</span> Upload a file</button>
        <button className={tab === 'view' ? 'tab active' : 'tab'} role="tab" aria-selected={tab === 'view'} onClick={() => { setTab('view'); setError(''); setSuccess(''); void refresh() }}><span className="tab-icon">▤</span> View files <span className="count-pill">{activeFiles.length}</span></button>
      </div>

      {tab === 'upload' ? <div className="panel">
        <div className="panel-heading"><div><span className="step-label">01 / SHARE SOMETHING</span><h2>Drop it in the box.</h2></div><span className="file-limit">UP TO 25 MB</span></div>
        <form onSubmit={upload}>
          <label className="dropzone" htmlFor="file-input">
            <input id="file-input" type="file" onChange={event => { setSelected(event.target.files?.[0] ?? null); setError(''); setSuccess('') }} />
            <span className="upload-symbol">↑</span>
            <span className="drop-title">{selected ? selected.name : 'Choose a file to share'}</span>
            <span className="drop-subtitle">Any file type · Maximum 25 MB</span>
            {selected && <span className="selected-size">{prettySize(selected.size)}</span>}
          </label>
          <div className="form-grid">
            <label className="field"><span>Your name</span><input value={name} onChange={event => setName(event.target.value)} placeholder="What should we call you?" maxLength={60} autoComplete="name" required /><small>Self-entered, just for your group to see.</small></label>
            <label className="field"><span>What’s it for?</span><textarea value={purpose} onChange={event => setPurpose(event.target.value)} placeholder="Give your friends a little context…" maxLength={240} rows={3} required /><small>A short explanation (10–240 characters).</small></label>
          </div>
          {error && <p className="message error" role="alert">{error}</p>}
          {success && <p className="message success" role="status">{success}</p>}
          <div className="form-footer"><span className="privacy-note"><span className="lock-icon">▣</span> Private storage · Shared with this page</span><button className="submit-button" type="submit" disabled={busy}>{busy ? 'Uploading…' : 'Upload file'} <span>↗</span></button></div>
        </form>
      </div> : <div className="panel">
        <div className="panel-heading view-heading"><div><span className="step-label">02 / FROM THE GROUP</span><h2>What’s in the box?</h2></div><button className="refresh-button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh file list">↻</button></div>
        {error && <p className="message error" role="alert">{error}</p>}
        {activeFiles.length === 0 ? <div className="empty-state"><span className="empty-icon">□</span><strong>It’s quiet in here.</strong><span>{loading ? 'Checking for files…' : 'Nothing shared just yet. Add the first file?'}</span><button onClick={() => setTab('upload')}>Upload a file <span>↗</span></button></div> : <div className="file-list">{activeFiles.map(file => <article className="file-card" key={file.id}>
          <div className="file-type">{file.originalName.split('.').pop()?.slice(0, 5).toUpperCase() || 'FILE'}</div>
          <div className="file-info"><h3 title={file.originalName}>{file.originalName}</h3><p>{file.purpose}</p><div className="file-meta"><span>by <strong>{file.name}</strong></span><span>{new Date(file.uploadedAt).toLocaleString()}</span></div></div>
          <div className="file-actions"><span className="expiry">◷ {remaining(file.expiresAt, now)}</span><a className="download-button" href={`${API}/api/files/${encodeURIComponent(file.id)}/download`}>Download <span>↓</span></a><span className="file-size">{prettySize(file.size)}</span></div>
        </article>)}</div>}
        <div className="list-footnote"><span className="live-dot" /> Updates every minute <span>·</span> Files expire 6 hours after upload</div>
      </div>}
    </section>

    <footer className="footer"><span>Made to share with your people.</span><span>Temporary by design <span className="footer-star">✳</span></span></footer>
  </main>
}

export default App
