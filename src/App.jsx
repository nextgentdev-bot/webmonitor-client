import { useEffect, useEffectEvent, useRef, useState } from 'react'
import './App.css'

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const apiUrl = (path) => `${API_BASE_URL}/api${path}`

function resultLabel(status) {
  if (status === 'working') return 'OK'
  if (status === 'missing') return 'Missing'
  if (status === 'skipped') return 'Skipped'
  if (status === 'error') return 'Error'
  return 'Not checked'
}

function CheckResult({ label, result }) {
  const status = result?.status || 'pending'

  return <div className="check-result">
    <div className="check-result-heading">
      <strong>{label}</strong>
      <span className={`result-status ${status}`}>{resultLabel(status)}</span>
    </div>
    {result?.statusCode != null && <small>HTTP {result.statusCode}</small>}
    {result?.error && <small className="result-error">{result.error}</small>}
    {result?.url && <a href={result.url} target="_blank" rel="noreferrer">Open checked link</a>}
  </div>
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('monitor_token'))
  const [credentials, setCredentials] = useState({ username: 'admin', password: '' })
  const [dashboard, setDashboard] = useState({ websites: [], stats: { total: 0, active: 0, latestRun: null, runProgress: { status: 'idle', total: 0, completed: 0, processing: 0, pending: 0, queued: 0, cancelled: 0, percent: 0 }, worker: { status: 'offline' } } })
  const [query, setQuery] = useState('')
  const [form, setForm] = useState({ name: '', url: '' })
  const [bulk, setBulk] = useState('')
  const [sheetUrl, setSheetUrl] = useState('')
  const [sheetImportStatus, setSheetImportStatus] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedWebsiteIds, setSelectedWebsiteIds] = useState([])
  const [deletingWebsites, setDeletingWebsites] = useState(false)
  const [expandedWebsiteId, setExpandedWebsiteId] = useState(null)
  const progressRequestActive = useRef(false)
  const [cancelingRun, setCancelingRun] = useState(false)

  async function request(path, options = {}) {
    const response = await fetch(apiUrl(path), { cache: 'no-store', ...options, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } })
    const data = await response.json().catch(() => ({}))
    if (response.status === 401) {
      localStorage.removeItem('monitor_token')
      setToken(null)
      throw new Error('Your session has expired. Please sign in again.')
    }
    if (!response.ok) throw new Error(data.error || 'Request failed.')
    return data
  }

  async function loadDashboard(search = query, { quiet = false } = {}) {
    if (!token) return
    if (!quiet) setLoading(true)
    try { setDashboard(await request(`/dashboard?search=${encodeURIComponent(search)}`)); return true } catch (error) { setNotice(error.message); return false } finally { if (!quiet) setLoading(false) }
  }

  // The token is the external session boundary for this dashboard.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { loadDashboard() }, [token])

  const pollRunProgress = useEffectEvent(async () => {
    const runProgress = dashboard.stats.runProgress
    try {
      const worker = await request('/worker/status')
      setDashboard((current) => ({ ...current, stats: { ...current.stats, worker } }))
    } catch (error) { setNotice(error.message) }
    if (runProgress?.status !== 'running' || !runProgress.runId || progressRequestActive.current) return
    progressRequestActive.current = true
    try {
      const result = await request(`/runs/${runProgress.runId}/progress`)
      const checksByWebsite = new Map(result.checks.map((check) => [check.websiteId, check]))
      setDashboard((current) => ({
        ...current,
        websites: current.websites.map((website) => ({ ...website, currentCheck: checksByWebsite.get(website._id) || website.currentCheck })),
        stats: { ...current.stats, runProgress: result }
      }))
      if (result.status !== 'running') await loadDashboard(query, { quiet: true })
    } catch (error) { setNotice(error.message) } finally { progressRequestActive.current = false }
  })

  useEffect(() => {
    if (!token) return undefined
    const intervalId = window.setInterval(pollRunProgress, 3000)
    return () => window.clearInterval(intervalId)
  }, [token])

  async function login(event) {
    event.preventDefault()
    const response = await fetch(apiUrl('/auth/login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) })
    const data = await response.json()
    if (!response.ok) return setNotice(data.error || 'Login failed.')
    localStorage.setItem('monitor_token', data.token)
    setToken(data.token)
  }

  async function addWebsite(event) {
    event.preventDefault()
    try {
      await request('/websites', { method: 'POST', body: JSON.stringify(form) })
      setForm({ name: '', url: '' })
      setNotice('Website added.')
      loadDashboard()
    } catch (error) { setNotice(error.message) }
  }

  async function toggleWebsite(website) {
    try {
      await request(`/websites/${website._id}`, { method: 'PATCH', body: JSON.stringify({ active: !website.active }) })
      loadDashboard()
    } catch (error) { setNotice(error.message) }
  }

  function toggleWebsiteSelection(id) {
    setSelectedWebsiteIds((current) => current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id])
  }

  async function deleteSelectedWebsites() {
    if (!selectedWebsiteIds.length || !window.confirm(`Delete ${selectedWebsiteIds.length} selected websites and their check history?`)) return
    setDeletingWebsites(true)
    try {
      const result = await request('/websites/bulk-action', { method: 'POST', body: JSON.stringify({ action: 'delete', ids: selectedWebsiteIds }) })
      setSelectedWebsiteIds([])
      setNotice(`${result.deleted} selected websites deleted.`)
      await loadDashboard()
    } catch (error) { setNotice(error.message) } finally { setDeletingWebsites(false) }
  }

  async function deleteAllWebsites() {
    if (!window.confirm('Delete ALL websites and their check history? This cannot be undone.')) return
    setDeletingWebsites(true)
    try {
      const result = await request('/websites', { method: 'DELETE' })
      setSelectedWebsiteIds([])
      setQuery('')
      setNotice(`${result.deleted} websites deleted.`)
      await loadDashboard('')
    } catch (error) { setNotice(error.message) } finally { setDeletingWebsites(false) }
  }

  async function runAll() {
    try {
      const selectedIds = [...selectedWebsiteIds]
      const selectedCount = selectedIds.length
      const result = await request('/runs', { method: 'POST', body: JSON.stringify({ type: 'manual', ...(selectedCount ? { websiteIds: selectedIds } : {}) }) })
      setNotice(result.created ? `Run queued for ${result.total} ${selectedCount ? 'selected ' : ''}websites.` : result.reason)
      await loadDashboard()
    } catch (error) { setNotice(error.message) }
  }

  async function cancelCurrentRun() {
    const runId = dashboard.stats.runProgress?.runId
    if (!runId || !window.confirm('Cancel this run? Queued websites will not be checked.')) return
    setCancelingRun(true)
    try {
      await request(`/runs/${runId}/cancel`, { method: 'POST' })
      setNotice('Run cancelled. In-progress browser checks may take a moment to stop.')
      await loadDashboard(query, { quiet: true })
    } catch (error) { setNotice(error.message) } finally { setCancelingRun(false) }
  }

  async function importUrls(event) {
    event.preventDefault()
    try {
      const preview = await request('/import/preview', { method: 'POST', body: JSON.stringify({ urls: bulk }) })
      const rows = preview.rows.filter((row) => row.valid)
      if (!rows.length) throw new Error('No new valid URLs found.')
      await request('/import/commit', { method: 'POST', body: JSON.stringify({ rows }) })
      setBulk('')
      setNotice(`${rows.length} websites imported.`)
      loadDashboard()
    } catch (error) { setNotice(error.message) }
  }

  async function importSheet(event) {
    event.preventDefault()
    setSheetImportStatus('fetching')
    try {
      const preview = await request('/import/google-sheet/preview', { method: 'POST', body: JSON.stringify({ url: sheetUrl }) })
      const rows = preview.rows.filter((row) => row.valid)
      if (!rows.length) throw new Error(`No valid website URLs found in Google Sheets tab gid=${preview.gid} (${preview.sourceCount} rows read). Add a URL column or use the tab's gid in the Sheet URL.`)
      setSheetImportStatus('saving')
      const result = await request('/import/google-sheet/commit', { method: 'POST', body: JSON.stringify({ rows }) })
      setSheetUrl('')
      const refreshed = await loadDashboard()
      if (refreshed) setNotice(`Read ${preview.sourceCount} rows from tab gid=${preview.gid}. Added ${result.added} new websites and synced ${result.updated} existing websites.`)
    } catch (error) { setNotice(error.message) } finally { setSheetImportStatus('') }
  }

  if (!token) return <main className="login-shell">
    <div className="login-panel">
      <p className="eyebrow">WEBSITE MONITOR / ADMIN</p>
      <h1>Keep every homepage honest.</h1>
      <p className="muted">Monitor availability, navigation and mobile menus from one quiet control room.</p>
      <form onSubmit={login}>
        <label>Username<input value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} /></label>
        <label>Password<input type="password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} /></label>
        <button className="primary" type="submit">Sign in</button>
      </form>
      {notice && <p className="error">{notice}</p>}
    </div>
  </main>

  return <main className="app-shell">
    <header className="topbar">
      <div><p className="eyebrow">WEBSITE MONITOR / CONTROL ROOM</p><h1>Signal desk</h1></div>
      <div className="top-actions"><span className={`live-dot ${dashboard.stats.worker?.status === 'online' ? '' : 'worker-offline'}`}>● Worker {dashboard.stats.worker?.status || 'offline'}</span><button className="ghost" onClick={() => { localStorage.removeItem('monitor_token'); setToken(null) }}>Sign out</button></div>
    </header>
    <section className="stats">
      <div><span>Tracked sites</span><strong>{dashboard.stats.total}</strong></div>
      <div><span>Active now</span><strong>{dashboard.stats.active}</strong></div>
      <div><span>Last run</span><strong>{dashboard.stats.latestRun ? `${dashboard.stats.latestRun.healthy || 0} healthy` : 'No runs'}</strong></div>
      <button className="primary run-button" onClick={runAll} disabled={dashboard.stats.runProgress?.status === 'running' || dashboard.stats.worker?.status !== 'online'}>{dashboard.stats.runProgress?.status === 'running' ? dashboard.stats.worker?.status === 'online' ? 'Checks running...' : 'Waiting for worker...' : dashboard.stats.worker?.status !== 'online' ? 'Worker offline' : selectedWebsiteIds.length ? `Run selected (${selectedWebsiteIds.length}) checks` : 'Run all checks'}</button>
      {dashboard.stats.runProgress?.status === 'running' && <button className="cancel-button" onClick={cancelCurrentRun} disabled={cancelingRun}>{cancelingRun ? 'Cancelling...' : 'Cancel run'}</button>}
    </section>
    {notice && <div className="notice">{notice}</div>}
    <section className="run-progress" aria-label="Website check progress">
      <div className="progress-heading">
        <strong>{dashboard.stats.runProgress.status === 'running' ? 'Checking websites' : dashboard.stats.runProgress.status === 'cancelled' ? 'Last run cancelled' : dashboard.stats.runProgress.status === 'completed' ? 'All websites checked' : 'Website check progress'}</strong>
        <span>{dashboard.stats.runProgress.completed} of {dashboard.stats.runProgress.total} websites checked</span>
        <b>{dashboard.stats.runProgress.percent}%</b>
      </div>
      <div className="progress-track" role="progressbar" aria-label="Check completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow={dashboard.stats.runProgress.percent}>
        <span style={{ width: `${dashboard.stats.runProgress.percent}%` }}></span>
      </div>
      <p>{dashboard.stats.runProgress.processing} checking · {dashboard.stats.runProgress.queued} queued · {Math.max(0, dashboard.stats.runProgress.pending - dashboard.stats.runProgress.queued)} waiting</p>
      {dashboard.stats.worker?.status !== 'online' && <p className="worker-help">Worker is offline. Start it with <code>npm run worker</code> in the web-monitor-client folder.</p>}
    </section>
    <section className="workspace">
      <div className="main-column">
        <div className="section-heading">
          <div><p className="eyebrow">INVENTORY</p><h2>Websites</h2></div>
          <input className="search" value={query} onChange={(event) => { setQuery(event.target.value); loadDashboard(event.target.value) }} placeholder="Search sites..." />
        </div>
        <div className="website-actions">
          <button className="delete-button" onClick={deleteSelectedWebsites} disabled={!selectedWebsiteIds.length || deletingWebsites}>{deletingWebsites ? 'Deleting...' : `Delete selected (${selectedWebsiteIds.length})`}</button>
          <button className="delete-button" onClick={deleteAllWebsites} disabled={deletingWebsites}>{deletingWebsites ? 'Deleting...' : 'Delete all'}</button>
        </div>
        <div className="site-list">
          {loading ? <p className="muted">Loading sites...</p> : dashboard.websites.map((website, index) => {
            const check = website.lastCheck
            const currentCheck = website.currentCheck
            const issues = check?.issues || []
            const homepageIssue = issues.some((issue) => issue.startsWith('Main website'))
            const homepageCritical = !check?.homepage?.statusCode || check.homepage.statusCode >= 500 || check.homepage.sslValid === false
            const homepageStatus = homepageIssue ? (homepageCritical ? 'error' : 'warning') : 'working'
            const isExpanded = expandedWebsiteId === website._id
            const rowStatus = currentCheck?.status || check?.status || 'not-checked'
            const rowStatusLabel = rowStatus === 'processing' ? 'Checking' : rowStatus === 'pending' ? 'Queued' : rowStatus === 'cancelled' ? 'Cancelled' : rowStatus === 'not-checked' ? 'Not checked' : rowStatus
            const rowStatusClass = rowStatus === 'processing' ? 'checking' : rowStatus === 'pending' ? 'queued' : rowStatus
            const rowPercent = ['healthy', 'warning', 'critical'].includes(rowStatus) ? 100 : ['processing', 'cancelled'].includes(rowStatus) ? currentCheck.progressPercent : 0
            const rowStage = currentCheck?.progressStage || (rowPercent === 100 ? 'Complete' : rowStatus === 'not-checked' ? 'Not started' : rowStatusLabel)
            return <article className={`site-entry ${check?.status === 'warning' || check?.status === 'critical' ? 'has-issues' : ''}`} key={website._id}>
              <div className="site-row">
                <input className="site-select" type="checkbox" aria-label={`Select ${website.name}`} checked={selectedWebsiteIds.includes(website._id)} onChange={() => toggleWebsiteSelection(website._id)} disabled={deletingWebsites} />
                <span className="site-number" aria-label={`Website ${index + 1}`}>{index + 1}</span>
                <span className={`status ${website.active ? 'active' : 'paused'}`}></span>
                <div className="site-info"><strong>{website.name}</strong><a href={website.url} target="_blank" rel="noreferrer">{website.url}</a></div>
                <span className={`badge ${rowStatusClass}`}>{rowStatusLabel}</span>
                {issues.length > 0 && <span className="issue-count">{issues.length} {issues.length === 1 ? 'issue' : 'issues'}</span>}
                <button className="details-button" aria-expanded={isExpanded} onClick={() => setExpandedWebsiteId(isExpanded ? null : website._id)}>{isExpanded ? 'Hide results' : 'View results'}</button>
                <button className="icon-button" title={website.active ? 'Pause website' : 'Activate website'} onClick={() => toggleWebsite(website)}>{website.active ? 'Ⅱ' : '▶'}</button>
              </div>
              <div className="site-progress">
                <div><span>{rowStage}</span><span>{rowPercent}%</span></div>
                <div className="site-progress-track" role="progressbar" aria-label={`${website.name} check progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={rowPercent}>
                  <span className={rowStatus === 'processing' ? 'in-progress' : ''} style={{ width: `${rowPercent}%` }}></span>
                </div>
              </div>
              {isExpanded && <section className="check-details" aria-label={`${website.name} latest check results`}>
                {!check ? <p className="muted">No check has been run for this website yet.</p> : <>
                  <div className="check-meta">{check.finishedAt ? `Checked ${new Date(check.finishedAt).toLocaleString()}` : 'Check is still running'}</div>
                  <div className="check-grid">
                    <div className="check-result">
                      <div className="check-result-heading"><strong>Homepage</strong><span className={`result-status ${homepageStatus}`}>{check.homepage?.statusCode ? `HTTP ${check.homepage.statusCode}` : 'Unavailable'}</span></div>
                      <small>Load: {check.homepage?.loadTimeMs != null ? `${check.homepage.loadTimeMs} ms` : 'Not measured'}</small>
                      <small>SSL: {check.homepage?.sslValid === true ? 'Valid' : check.homepage?.sslValid === false ? 'Invalid' : 'Unknown'}</small>
                      <small>Content: {check.homepage?.blank === true ? 'Possibly blank' : check.homepage?.blank === false ? 'Present' : 'Unknown'}</small>
                    </div>
                    <CheckResult label="Desktop Contact" result={check.desktop?.contact} />
                    <CheckResult label="Desktop News" result={check.desktop?.news} />
                    <CheckResult label="Mobile Contact" result={check.mobile?.contact} />
                    <CheckResult label="Mobile News" result={check.mobile?.news} />
                  </div>
                  <div className="issue-list">
                    <strong>{issues.length ? 'Issues found' : 'No issues found'}</strong>
                    {issues.length > 0 && <ul>{issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>}
                  </div>
                  {check.screenshots?.length > 0 && <div className="screenshot-links">{check.screenshots.map((image) => <a href={image} target="_blank" rel="noreferrer" key={image}>Open issue screenshot</a>)}</div>}
                </>}
              </section>}
            </article>
          })}
          {!loading && !dashboard.websites.length && <p className="muted empty">No websites yet. Add your first monitored site.</p>}
        </div>
      </div>
      <aside className="side-column">
        <section className="tool-panel"><p className="eyebrow">ADD SITE</p><h2>New watch</h2><form onSubmit={addWebsite}><input placeholder="Display name (optional)" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input required placeholder="https://example.com" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} /><button className="primary" type="submit">Add website</button></form></section>
        <section className="tool-panel"><p className="eyebrow">BULK IMPORT</p><h2>Paste URLs</h2><form onSubmit={importUrls}><textarea rows="5" placeholder={'One URL per line\nName | https://example.com'} value={bulk} onChange={(event) => setBulk(event.target.value)} /><button className="secondary" type="submit">Import valid URLs</button></form></section>
        <section className="tool-panel"><p className="eyebrow">GOOGLE SHEETS</p><h2>Import a sheet</h2><form onSubmit={importSheet} aria-busy={Boolean(sheetImportStatus)}><input required type="url" placeholder="Paste Google Sheet URL" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} disabled={Boolean(sheetImportStatus)} /><small className="muted">Set sharing to Anyone with the link, Viewer. The URL must include gid for the tab you want; missing gid imports tab 0.</small><button className="secondary" type="submit" disabled={Boolean(sheetImportStatus)} aria-busy={Boolean(sheetImportStatus)}>{sheetImportStatus && <span className="button-spinner" aria-hidden="true" />}{sheetImportStatus === 'fetching' ? 'Reading Google Sheet...' : sheetImportStatus === 'saving' ? 'Adding websites...' : 'Import from Google Sheet'}</button></form></section>
      </aside>
    </section>
  </main>
}

export default App