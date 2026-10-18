import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import './App.css'

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const apiUrl = (path) => `${API_BASE_URL}/api${path}`
const notifyError = (message) => toast.error(message, { id: 'app-error', duration: 5000 })
const notifySuccess = (message) => {
  toast.dismiss('app-error')
  toast.success(message)
}

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

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

function issueCategory(issue) {
  if (issue.startsWith('Main website returned HTTP')) return 'Homepage returned an HTTP error'
  if (issue.startsWith('Main website appears blank')) return 'Homepage appears blank'
  if (issue.startsWith('Main website is slow')) return 'Homepage is slow'
  if (issue.startsWith('Main website could not be opened')) return 'Homepage could not be opened'
  const menuIssue = issue.match(/^(Desktop|Mobile) (Contact|News):/)
  if (menuIssue) {
    const device = menuIssue[1]
    const section = menuIssue[2].toLowerCase()
    return issue.includes('Not added.')
      ? `${device} ${section} link is missing`
      : `${device} ${section} link has an error`
  }
  return issue
}

function CheckReport({ websites, loading, onOpenActions, openSiteMenuId, closeWebsiteActions }) {
  const [issueFilter, setIssueFilter] = useState('')
  const rows = websites.map((website, index) => {
    const check = website.active ? website.lastCheck : null
    const currentCheck = website.active ? website.currentCheck : null
    const issues = check?.issues || []
    const status = !website.active ? 'paused' : currentCheck?.status || check?.status || 'not-checked'
    const issueCategories = [...new Set(issues.map(issueCategory))]
    return { website, check, currentCheck, issues, issueCategories, status, index }
  })
  const issueRows = rows.filter(({ status, issues }) => !['healthy', 'paused', 'not-checked', 'processing', 'pending', 'cancelled'].includes(status) || issues.length > 0)
  const issueCategories = [...new Set(rows.flatMap(({ issueCategories: categories }) => categories))].sort((first, second) => first.localeCompare(second))
  const categoryCounts = new Map(issueCategories.map((category) => [
    category,
    rows.filter(({ issueCategories: categories }) => categories.includes(category)).length
  ]))
  const visibleRows = issueFilter
    ? rows.filter(({ issueCategories: categories }) => categories.includes(issueFilter))
    : rows
  const healthyCount = rows.filter(({ status }) => status === 'healthy').length
  const issueCount = issueRows.length
  const uncheckedCount = rows.filter(({ status }) => status === 'not-checked').length

  return <section className="results-report" id="check-results" aria-labelledby="results-title">
    <div className="results-heading">
      <div>
        <p className="eyebrow">LATEST CHECKS / ALL RUN TYPES</p>
        <h2 id="results-title">Website results</h2>
        <p className="muted">Latest result per website, including run all, selected runs, and individual checks.</p>
      </div>
      <span className="results-total">{rows.length} {rows.length === 1 ? 'website' : 'websites'}</span>
    </div>
    <div className="results-summary" aria-label="Result summary">
      <div><span>Healthy</span><strong>{healthyCount}</strong></div>
      <div className={issueCount ? 'has-issues' : ''}><span>Needs attention</span><strong>{issueCount}</strong></div>
      <div><span>Not checked</span><strong>{uncheckedCount}</strong></div>
    </div>
    <div className="results-toolbar">
      <label className="issue-filter-control">
        <span>Filter by issue</span>
        <select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)} aria-label="Filter websites by issue type">
          <option value="">All results ({rows.length})</option>
          {issueCategories.map((category) => <option value={category} key={category}>{category} ({categoryCounts.get(category)})</option>)}
        </select>
      </label>
      <span className="results-updated">Live from latest checks</span>
    </div>
    <div className="results-list">
      {loading ? <p className="results-empty-state">Loading latest website results...</p> : visibleRows.map(({ website, check, currentCheck, issues, status, index }) => {
        const statusLabel = status === 'not-checked' ? 'Not checked' : status === 'processing' ? 'Checking' : status === 'pending' ? 'Queued' : status
        const statusClass = status === 'processing' ? 'checking' : status === 'pending' ? 'queued' : ['healthy', 'warning', 'critical', 'paused', 'cancelled'].includes(status) ? status : 'pending'
        const homepageIssue = issues.some((issue) => issue.startsWith('Main website'))
        const homepageStatus = homepageIssue ? (!check?.homepage?.statusCode || check.homepage.statusCode >= 500 || check.homepage.sslValid === false ? 'error' : 'warning') : 'working'

        return <article className={`results-row ${status === 'critical' || status === 'warning' ? 'has-issues' : ''}`} key={website._id}>
          <div className="results-site">
            <span className="results-index">{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{website.name}</strong><a href={website.url} target="_blank" rel="noreferrer">{website.url}</a></div>
            <button className="site-menu-trigger results-menu-trigger" type="button" data-site-menu-trigger={website._id} aria-label={`Actions for ${website.name}`} aria-haspopup="dialog" aria-expanded={openSiteMenuId === website._id} onClick={(event) => openSiteMenuId === website._id ? closeWebsiteActions() : onOpenActions(event, website._id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
            </button>
          </div>
          <div className="results-data">
            <div className="results-status-line">
              <span className={`badge ${statusClass}`}>{statusLabel}</span>
              <span className="results-checked">{check?.finishedAt ? `Checked ${new Date(check.finishedAt).toLocaleString()}` : currentCheck?.status === 'processing' ? 'Check in progress' : 'No completed check yet'}</span>
            </div>
            {check ? <>
              <div className="check-grid results-check-grid">
                <div className="check-result">
                  <div className="check-result-heading"><strong>Homepage</strong><span className={`result-status ${homepageStatus}`}>{check.homepage?.statusCode ? `HTTP ${check.homepage.statusCode}` : 'Unavailable'}</span></div>
                  <small>Load: {check.homepage?.loadTimeMs != null ? `${check.homepage.loadTimeMs} ms` : 'Not measured'}</small>
                  <small>SSL: {check.homepage?.sslValid === true ? 'Valid' : check.homepage?.sslValid === false ? 'Invalid' : 'Unknown'}</small>
                  <small>Content: {check.homepage?.blank === true ? 'Possibly blank' : check.homepage?.blank === false ? 'Present' : 'Unknown'}</small>
                </div>
                <CheckResult label="Desktop contact" result={check.desktop?.contact} />
                <CheckResult label="Desktop news" result={check.desktop?.news} />
                <CheckResult label="Mobile contact" result={check.mobile?.contact} />
                <CheckResult label="Mobile news" result={check.mobile?.news} />
              </div>
              <div className={`results-issues ${issues.length ? 'has-issues' : ''}`}>
                <strong>{issues.length ? `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} found` : 'No issues found'}</strong>
                {issues.length > 0 && <ul>{issues.map((issue, issueIndex) => <li key={`${issueIndex}-${issue}`}>{issue}</li>)}</ul>}
              </div>
              {check.screenshots?.length > 0 && <div className="screenshot-links">{check.screenshots.map((image) => <a href={image} target="_blank" rel="noreferrer" key={image}>Open issue screenshot</a>)}</div>}
            </> : <p className="results-empty">{website.active ? currentCheck?.status === 'processing' ? 'The latest check is running; detailed results will appear when it finishes.' : 'No check has been run for this website yet.' : 'Monitoring is paused.'}</p>}
          </div>
        </article>
      })}
      {!loading && visibleRows.length === 0 && <p className="results-empty-state">{issueFilter ? `No websites currently have this issue: ${issueFilter}.` : 'No websites to show.'}</p>}
    </div>
  </section>
}

function SiteListSkeleton() {
  return <div className="site-list-skeleton" role="status" aria-label="Loading websites">
    {Array.from({ length: 4 }, (_, index) => <div className="site-skeleton" key={index} aria-hidden="true">
      <span className="skeleton-block skeleton-dot" />
      <span className="skeleton-block skeleton-name" />
      <span className="skeleton-block skeleton-badge" />
      <span className="skeleton-block skeleton-line" />
    </div>)}
  </div>
}

function SiteActionIcon({ name }) {
  const icons = {
    open: <><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></>,
    check: <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 1-2-5" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" />,
    delete: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="m6 7 1 13h10l1-13M9 7V4h6v3" /></>
  }

  return <svg className="site-action-icon" viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>
}

function ConfirmationDialog({ confirmation, onConfirm, onCancel }) {
  const cancelButtonRef = useRef(null)
  const confirmButtonRef = useRef(null)

  useEffect(() => {
    if (!confirmation) return undefined
    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelButtonRef.current?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
      if (event.key === 'Tab') {
        const first = cancelButtonRef.current
        const last = confirmButtonRef.current
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [confirmation, onCancel])

  if (!confirmation) return null

  return <div className="confirmation-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onCancel()
  }}>
    <section className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description">
      <div className={`confirmation-icon ${confirmation.danger ? 'danger' : ''}`} aria-hidden="true">{confirmation.danger ? '!' : '?'}</div>
      <h2 id="confirmation-title">{confirmation.title}</h2>
      <p id="confirmation-description">{confirmation.description}</p>
      <div className="confirmation-actions">
        <button className="confirmation-cancel" type="button" ref={cancelButtonRef} onClick={onCancel}>Keep it</button>
        <button className={`confirmation-accept ${confirmation.danger ? 'danger' : ''}`} type="button" ref={confirmButtonRef} onClick={onConfirm}>{confirmation.confirmLabel}</button>
      </div>
    </section>
  </div>
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('monitor_token'))
  const [credentials, setCredentials] = useState({ username: 'admin', password: '' })
  const [loginLoading, setLoginLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [dashboard, setDashboard] = useState({ websites: [], stats: { total: 0, active: 0, latestRun: null, runProgress: { status: 'idle', total: 0, completed: 0, processing: 0, pending: 0, queued: 0, cancelled: 0, percent: 0 }, worker: { status: 'offline' } } })
  const [query, setQuery] = useState('')
  const searchInputRef = useRef(null)
  const [form, setForm] = useState({ name: '', url: '' })
  const [addingWebsite, setAddingWebsite] = useState(false)
  const [bulk, setBulk] = useState('')
  const [importingUrls, setImportingUrls] = useState(false)
  const [sheetUrl, setSheetUrl] = useState('')
  const [sheetImportStatus, setSheetImportStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedWebsiteIds, setSelectedWebsiteIds] = useState([])
  const [deletingWebsites, setDeletingWebsites] = useState(false)
  const [expandedWebsiteId, setExpandedWebsiteId] = useState(null)
  const [resultsView, setResultsView] = useState(() => window.location.hash === '#check-results')
  const progressRequestActive = useRef(false)
  const [cancelingRun, setCancelingRun] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [openSiteMenuId, setOpenSiteMenuId] = useState(null)
  const [siteMenuClosing, setSiteMenuClosing] = useState(false)
  const [siteMenuPosition, setSiteMenuPosition] = useState(null)
  const [runningWebsiteId, setRunningWebsiteId] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const confirmationResolver = useRef(null)
  const toolsCloseButtonRef = useRef(null)
  const siteMenuCloseButtonRef = useRef(null)

  useEffect(() => {
    if (!siteMenuClosing || !openSiteMenuId) return undefined
    const timeoutId = window.setTimeout(() => {
      setOpenSiteMenuId(null)
      setSiteMenuClosing(false)
    }, 160)
    return () => window.clearTimeout(timeoutId)
  }, [siteMenuClosing, openSiteMenuId])

  useEffect(() => {
    if (!openSiteMenuId) return undefined
    const previouslyFocused = document.activeElement
    siteMenuCloseButtonRef.current?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSiteMenuClosing(true)
      }
      if (event.key === 'Tab') {
        const dialog = siteMenuCloseButtonRef.current?.closest('.site-actions-dialog')
        const focusableElements = dialog?.querySelectorAll('button:not(:disabled), a[href]')
        if (!focusableElements?.length) return
        const first = focusableElements[0]
        const last = focusableElements[focusableElements.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    function preventBackgroundScroll(event) {
      if (document.documentElement.clientWidth > 760) return
      if (event.target instanceof Element && event.target.closest('.site-actions-list')) return
      event.preventDefault()
    }

    function closeOnOutsidePointer(event) {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('.site-actions-dialog, [data-site-menu-trigger]')) return
      setSiteMenuClosing(true)
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('wheel', preventBackgroundScroll, { capture: true, passive: false })
    document.addEventListener('touchmove', preventBackgroundScroll, { capture: true, passive: false })
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('wheel', preventBackgroundScroll, true)
      document.removeEventListener('touchmove', preventBackgroundScroll, true)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [openSiteMenuId])

  useEffect(() => {
    if (!toolsOpen) return undefined
    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    toolsCloseButtonRef.current?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') setToolsOpen(false)
      if (event.key === 'Tab') {
        const dialog = toolsCloseButtonRef.current?.closest('.side-column')
        const focusableElements = dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')
        if (!focusableElements?.length) return
        const first = focusableElements[0]
        const last = focusableElements[focusableElements.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [toolsOpen])

  function askForConfirmation(details) {
    return new Promise((resolve) => {
      confirmationResolver.current = resolve
      setConfirmation(details)
    })
  }

  const resolveConfirmation = useCallback((confirmed) => {
    confirmationResolver.current?.(confirmed)
    confirmationResolver.current = null
    setConfirmation(null)
  }, [])

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

  async function loadDashboard(search = query) {
    if (!token) return
    try { setDashboard(await request(`/dashboard?search=${encodeURIComponent(search)}`)); return true } catch (error) { notifyError(error.message); return false } finally { setLoading(false) }
  }

  function navigateResultsView(showResults) {
    setResultsView(showResults)
    window.history.replaceState(null, '', showResults ? '#check-results' : '#websites')
    if (showResults && query) {
      setQuery('')
      loadDashboard('')
    }
  }

  // The token is the external session boundary for this dashboard.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { loadDashboard() }, [token])

  useEffect(() => {
    if (!token) return undefined
    const expiresAt = tokenExpiry(token)
    if (expiresAt === null) return undefined
    const expireSession = () => {
      localStorage.removeItem('monitor_token')
      setToken(null)
      notifyError('Your session has expired. Please sign in again.')
    }
    const timeoutId = window.setTimeout(expireSession, Math.max(0, expiresAt - Date.now()))
    return () => window.clearTimeout(timeoutId)
  }, [token])

  const pollRunProgress = useEffectEvent(async () => {
    const runProgress = dashboard.stats.runProgress
    try {
      const worker = await request('/worker/status')
      setDashboard((current) => ({ ...current, stats: { ...current.stats, worker } }))
    } catch (error) { notifyError(error.message) }
    if (runProgress?.status !== 'running' || !runProgress.runId || progressRequestActive.current) return
    progressRequestActive.current = true
    try {
      const result = await request(`/runs/${runProgress.runId}/progress`)
      const checksByWebsite = new Map(result.checks.map((check) => [check.websiteId, check]))
      setDashboard((current) => ({
        ...current,
        websites: current.websites.map((website) => website.active
          ? { ...website, currentCheck: checksByWebsite.get(website._id) || website.currentCheck }
          : { ...website, currentCheck: null }),
        stats: { ...current.stats, runProgress: result }
      }))
      if (result.status !== 'running') await loadDashboard(query)
    } catch (error) { notifyError(error.message) } finally { progressRequestActive.current = false }
  })

  useEffect(() => {
    if (!token) return undefined
    const intervalId = window.setInterval(pollRunProgress, 3000)
    return () => window.clearInterval(intervalId)
  }, [token])

  async function login(event) {
    event.preventDefault()
    setLoginLoading(true)
    toast.dismiss('app-error')
    try {
      const response = await fetch(apiUrl('/auth/login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        notifyError(data.error || 'Login failed.')
        return
      }
      localStorage.setItem('monitor_token', data.token)
      setLoading(true)
      setToken(data.token)
    } catch (error) {
      notifyError(error.message || 'Login failed.')
    } finally {
      setLoginLoading(false)
    }
  }

  async function addWebsite(event) {
    event.preventDefault()
    const submittedForm = { ...form }
    setForm({ name: '', url: '' })
    setAddingWebsite(true)
    try {
      await request('/websites', { method: 'POST', body: JSON.stringify(submittedForm) })
      setToolsOpen(false)
      notifySuccess('Website added.')
      await loadDashboard()
    } catch (error) { notifyError(error.message) } finally { setAddingWebsite(false) }
  }

  async function toggleWebsite(website) {
    setOpenSiteMenuId(null)
    const active = !website.active
    setDashboard((current) => ({
      ...current,
      websites: current.websites.map((item) => item._id === website._id
        ? { ...item, active, ...(active ? {} : { lastCheck: null, currentCheck: null }) }
        : item),
      stats: { ...current.stats, active: Math.max(0, current.stats.active + (active ? 1 : -1)) }
    }))
    try {
      await request(`/websites/${website._id}`, { method: 'PATCH', body: JSON.stringify({ active }) })
    } catch (error) {
      setDashboard((current) => ({
        ...current,
        websites: current.websites.map((item) => item._id === website._id ? website : item),
        stats: { ...current.stats, active: Math.max(0, current.stats.active + (active ? -1 : 1)) }
      }))
      notifyError(error.message)
    }
  }

  async function deleteWebsite(website) {
    setOpenSiteMenuId(null)
    const confirmed = await askForConfirmation({
      title: `Delete ${website.name}?`,
      description: 'This website and its check history will be permanently deleted. This action cannot be undone.',
      confirmLabel: 'Delete website',
      danger: true
    })
    if (!confirmed) return
    setDeletingWebsites(true)
    try {
      await request(`/websites/${website._id}`, { method: 'DELETE' })
      setSelectedWebsiteIds((current) => current.filter((id) => id !== website._id))
      setExpandedWebsiteId((current) => current === website._id ? null : current)
      notifySuccess(`${website.name} deleted.`)
      await loadDashboard()
    } catch (error) { notifyError(error.message) } finally { setDeletingWebsites(false) }
  }

  async function runWebsiteCheck(website) {
    setOpenSiteMenuId(null)
    setRunningWebsiteId(website._id)
    try {
      const result = await request('/runs', { method: 'POST', body: JSON.stringify({ type: 'manual', websiteIds: [website._id] }) })
      if (result.created) notifySuccess(`Check queued for ${website.name}.`)
      else notifyError(result.reason)
      await loadDashboard()
    } catch (error) { notifyError(error.message) } finally { setRunningWebsiteId(null) }
  }

  async function copyWebsiteUrl(website) {
    setOpenSiteMenuId(null)
    try {
      await navigator.clipboard.writeText(website.url)
      notifySuccess('Website URL copied.')
    } catch (error) {
      notifyError(error.message || 'Could not copy website URL.')
    }
  }

  function openWebsiteActions(event, websiteId) {
    const triggerRect = event.currentTarget.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = window.visualViewport?.height || window.innerHeight
    const mobile = viewportWidth <= 760
    const gutter = 16
    const dialogWidth = Math.min(mobile ? 440 : 320, viewportWidth - gutter * 2)
    const mobileHeight = Math.min(viewportHeight * 0.8, 600)
    const left = mobile
      ? (viewportWidth - dialogWidth) / 2
      : Math.max(gutter, Math.min(triggerRect.right - dialogWidth, viewportWidth - dialogWidth - gutter))
    const availableBelow = Math.max(0, viewportHeight - triggerRect.bottom - gutter)
    const availableAbove = Math.max(0, triggerRect.top - gutter)
    const preferredHeight = Math.min(390, viewportHeight - gutter * 2)
    const mobileDialogHeight = Math.min(mobileHeight, 270)
    const openAbove = availableBelow < Math.min(preferredHeight, 340) && availableAbove > availableBelow
    const top = mobile
      ? (viewportHeight - mobileDialogHeight) / 2
      : openAbove
        ? Math.max(gutter, triggerRect.top - Math.min(preferredHeight, availableAbove))
        : triggerRect.bottom
    const maxHeight = mobile
      ? mobileHeight
      : Math.max(0, Math.min(640, openAbove ? availableAbove : availableBelow))

    setSiteMenuPosition({ top, left, width: dialogWidth, maxHeight })
    setSiteMenuClosing(false)
    setOpenSiteMenuId(websiteId)
  }

  function closeWebsiteActions() {
    setSiteMenuClosing(true)
  }

  const activeMenuWebsite = dashboard.websites.find((website) => website._id === openSiteMenuId)
  const activeMenuWebsiteNumber = dashboard.websites.findIndex((website) => website._id === openSiteMenuId) + 1

  function toggleWebsiteSelection(id) {
    setSelectedWebsiteIds((current) => current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id])
  }

  async function deleteSelectedWebsites() {
    if (!selectedWebsiteIds.length) return
    const confirmed = await askForConfirmation({
      title: `Delete ${selectedWebsiteIds.length} selected websites?`,
      description: 'Their check history will also be permanently deleted. This action cannot be undone.',
      confirmLabel: 'Delete websites',
      danger: true
    })
    if (!confirmed) return
    setDeletingWebsites(true)
    try {
      const result = await request('/websites/bulk-action', { method: 'POST', body: JSON.stringify({ action: 'delete', ids: selectedWebsiteIds }) })
      setSelectedWebsiteIds([])
      notifySuccess(`${result.deleted} selected websites deleted.`)
      await loadDashboard()
    } catch (error) { notifyError(error.message) } finally { setDeletingWebsites(false) }
  }

  async function deleteAllWebsites() {
    const confirmed = await askForConfirmation({
      title: 'Delete all websites?',
      description: 'All websites and their check history will be permanently deleted. This action cannot be undone.',
      confirmLabel: 'Delete all',
      danger: true
    })
    if (!confirmed) return
    setDeletingWebsites(true)
    try {
      const result = await request('/websites', { method: 'DELETE' })
      setSelectedWebsiteIds([])
      setQuery('')
      notifySuccess(`${result.deleted} websites deleted.`)
      await loadDashboard('')
    } catch (error) { notifyError(error.message) } finally { setDeletingWebsites(false) }
  }

  async function runAll() {
    try {
      const selectedIds = [...selectedWebsiteIds]
      const selectedCount = selectedIds.length
      const result = await request('/runs', { method: 'POST', body: JSON.stringify({ type: 'manual', ...(selectedCount ? { websiteIds: selectedIds } : {}) }) })
      if (result.created) notifySuccess(`Run queued for ${result.total} ${selectedCount ? 'selected ' : ''}websites.`)
      else notifyError(result.reason)
      await loadDashboard()
    } catch (error) { notifyError(error.message) }
  }

  async function cancelCurrentRun() {
    const runId = dashboard.stats.runProgress?.runId
    if (!runId) return
    const confirmed = await askForConfirmation({
      title: 'Cancel this run?',
      description: 'Queued websites will not be checked. Active browser checks will stop shortly.',
      confirmLabel: 'Cancel run',
      danger: true
    })
    if (!confirmed) return
    setCancelingRun(true)
    try {
      await request(`/runs/${runId}/cancel`, { method: 'POST' })
      notifySuccess('Run cancelled. Active browser checks are stopping.')
      await loadDashboard(query)
    } catch (error) { notifyError(error.message) } finally { setCancelingRun(false) }
  }

  async function importUrls(event) {
    event.preventDefault()
    const submittedUrls = bulk
    setBulk('')
    setImportingUrls(true)
    try {
      const preview = await request('/import/preview', { method: 'POST', body: JSON.stringify({ urls: submittedUrls }) })
      const rows = preview.rows.filter((row) => row.valid)
      if (!rows.length) throw new Error('No new valid URLs found.')
      await request('/import/commit', { method: 'POST', body: JSON.stringify({ rows }) })
      setToolsOpen(false)
      const refreshed = await loadDashboard()
      if (refreshed) notifySuccess(`${rows.length} websites imported.`)
    } catch (error) { notifyError(error.message) } finally { setImportingUrls(false) }
  }

  async function importSheet(event) {
    event.preventDefault()
    const submittedSheetUrl = sheetUrl
    setSheetUrl('')
    setSheetImportStatus('fetching')
    try {
      const preview = await request('/import/google-sheet/preview', { method: 'POST', body: JSON.stringify({ url: submittedSheetUrl }) })
      const rows = preview.rows.filter((row) => row.valid)
      if (!rows.length) throw new Error(`No valid website URLs found in Google Sheets tab "${preview.tab}" (${preview.sourceCount} rows read). Add a URL column or check the selected tab.`)
      setSheetImportStatus('saving')
      const result = await request('/import/google-sheet/commit', { method: 'POST', body: JSON.stringify({ rows }) })
      setToolsOpen(false)
      const refreshed = await loadDashboard()
      if (refreshed) notifySuccess(`Read ${preview.sourceCount} rows from tab "${preview.tab}". Added ${result.added} new websites and synced ${result.updated} existing websites.`)
    } catch (error) { notifyError(error.message) } finally { setSheetImportStatus('') }
  }

  if (!token) return <main className="login-shell">
    <div className="login-panel">
      <p className="eyebrow">WEBSITE MONITOR / ADMIN</p>
      <h1>Keep every homepage honest.</h1>
      <p className="muted">Monitor availability, navigation and mobile menus from one quiet control room.</p>
      <form onSubmit={login}>
        <label>Username<input value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} /></label>
        <label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} disabled={loginLoading} /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)} disabled={loginLoading}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!showPassword && <path d="m4 4 16 16" />}</svg></button></div></label>
        <button className="primary" type="submit" disabled={loginLoading} aria-busy={loginLoading}>{loginLoading && <span className="button-spinner" aria-hidden="true" />}{loginLoading ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </div>
  </main>

  return <main className="app-shell">
    <header className="topbar">
      <div><p className="eyebrow">{resultsView ? 'WEBSITE MONITOR / RESULTS REPORT' : 'WEBSITE MONITOR / CONTROL ROOM'}</p><h1>{resultsView ? 'Check results' : 'Signal desk'}</h1></div>
      <div className="top-actions">
        <span className={`live-dot ${dashboard.stats.worker?.status === 'online' ? '' : 'worker-offline'}`}>● Worker {dashboard.stats.worker?.status || 'offline'}</span>
        <a className="results-nav-link" href={resultsView ? '#websites' : '#check-results'} onClick={(event) => { event.preventDefault(); navigateResultsView(!resultsView) }}>{resultsView ? 'Websites' : 'Check results'}</a>
        <button className="ghost" onClick={() => { localStorage.removeItem('monitor_token'); setToken(null) }}>Sign out</button>
      </div>
    </header>
    {!resultsView && <section className="stats">
      <div><span>Tracked sites</span><strong>{dashboard.stats.total}</strong></div>
      <div><span>Active now</span><strong>{dashboard.stats.active}</strong></div>
      <div><span>Healthy sites</span><strong>{dashboard.stats.healthy || 0}</strong></div>
      <button className="primary run-button" onClick={runAll} disabled={dashboard.stats.runProgress?.status === 'running' || dashboard.stats.worker?.status !== 'online'}>{dashboard.stats.runProgress?.status === 'running' ? dashboard.stats.worker?.status === 'online' ? 'Checks running...' : 'Waiting for worker...' : dashboard.stats.worker?.status !== 'online' ? 'Worker offline' : selectedWebsiteIds.length ? `Run selected (${selectedWebsiteIds.length}) checks` : 'Run all checks'}</button>
      {dashboard.stats.runProgress?.status === 'running' && <button className="cancel-button" onClick={cancelCurrentRun} disabled={cancelingRun}>{cancelingRun ? 'Cancelling...' : 'Cancel run'}</button>}
    </section>}
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
      {dashboard.stats.worker?.status !== 'online' && <p className="worker-help">Worker is offline.</p>}
    </section>
    <section className="workspace">
      <div className="main-column">
        {!resultsView && <>
        <div className="section-heading">
          <div><p className="eyebrow">INVENTORY</p><h2>Websites</h2></div>
          <div className="search-field">
            <input ref={searchInputRef} className="search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); loadDashboard(event.target.value) }} placeholder="Search sites..." aria-label="Search sites" />
            {query && <button className="search-clear" type="button" aria-label="Clear search" onClick={() => { setQuery(''); loadDashboard(''); searchInputRef.current?.focus() }}>×</button>}
          </div>
        </div>
        <div className="website-actions">
          <label className="select-all-control">
            <input
              className="site-select"
              type="checkbox"
              aria-label="Select all visible websites"
              checked={dashboard.websites.length > 0 && dashboard.websites.every((website) => selectedWebsiteIds.includes(website._id))}
              onChange={(event) => setSelectedWebsiteIds((current) => event.target.checked
                ? [...new Set([...current, ...dashboard.websites.map((website) => website._id)])]
                : current.filter((id) => !dashboard.websites.some((website) => website._id === id)))}
              disabled={loading || deletingWebsites || dashboard.websites.length === 0}
            />
            <span>Select all sites</span>
          </label>
          <button className="delete-button" onClick={deleteSelectedWebsites} disabled={!selectedWebsiteIds.length || deletingWebsites}>{deletingWebsites ? 'Deleting...' : `Delete selected (${selectedWebsiteIds.length})`}</button>
          <button className="delete-button" onClick={deleteAllWebsites} disabled={deletingWebsites}>{deletingWebsites ? 'Deleting...' : 'Delete all'}</button>
        </div>
        <div className="site-list">
          {loading ? <SiteListSkeleton /> : dashboard.websites.map((website, index) => {
            const check = website.active ? website.lastCheck : null
            const currentCheck = website.active ? website.currentCheck : null
            const issues = website.active ? check?.issues || [] : []
            const homepageIssue = issues.some((issue) => issue.startsWith('Main website'))
            const homepageCritical = !check?.homepage?.statusCode || check.homepage.statusCode >= 500 || check.homepage.sslValid === false
            const homepageStatus = homepageIssue ? (homepageCritical ? 'error' : 'warning') : 'working'
            const isExpanded = expandedWebsiteId === website._id
            const rowStatus = !website.active ? 'paused' : currentCheck?.status || check?.status || 'not-checked'
            const rowStatusLabel = rowStatus === 'processing' ? 'Checking' : rowStatus === 'pending' ? 'Queued' : rowStatus === 'cancelled' ? 'Cancelled' : rowStatus === 'not-checked' ? 'Not checked' : rowStatus === 'paused' ? 'Paused' : rowStatus
            const rowStatusClass = rowStatus === 'processing' ? 'checking' : rowStatus === 'pending' ? 'queued' : rowStatus
            const rowPercent = website.active ? ['healthy', 'warning', 'critical'].includes(rowStatus) ? 100 : ['processing', 'cancelled'].includes(rowStatus) ? currentCheck.progressPercent : 0 : 0
            const rowStage = !website.active ? 'Paused' : currentCheck?.progressStage || (rowPercent === 100 ? 'Complete' : rowStatus === 'not-checked' ? 'Not started' : rowStatusLabel)
            return <article className={`site-entry ${website.active && (check?.status === 'warning' || check?.status === 'critical') ? 'has-issues' : ''}`} key={website._id}>
              <div className="site-row">
                <input className="site-select" type="checkbox" aria-label={`Select ${website.name}`} checked={selectedWebsiteIds.includes(website._id)} onChange={() => toggleWebsiteSelection(website._id)} disabled={deletingWebsites} />
                <span className="site-number" aria-label={`Website ${index + 1}`}>{index + 1}</span>
                <span className={`status ${website.active ? 'active' : 'paused'}`}></span>
                <div className="site-info"><strong>{website.name}</strong><a href={website.url} target="_blank" rel="noreferrer">{website.url}</a></div>
                <span className={`badge ${rowStatusClass}`}>{rowStatusLabel}</span>
                {!website.active ? <span className="issue-count neutral">0 issues</span> : issues.length > 0 && <span className="issue-count">{issues.length} {issues.length === 1 ? 'issue' : 'issues'}</span>}
                <button className="details-button" type="button" aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Hide' : 'View'} results for ${website.name}`} onClick={() => setExpandedWebsiteId(isExpanded ? null : website._id)}>{isExpanded ? 'Hide results' : 'View results'}</button>
                <div className="site-actions-menu">
                  <button className="site-menu-trigger" type="button" data-site-menu-trigger={website._id} aria-label={`Actions for ${website.name}`} aria-haspopup="dialog" aria-expanded={openSiteMenuId === website._id} onClick={(event) => openSiteMenuId === website._id ? closeWebsiteActions() : openWebsiteActions(event, website._id)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
                  </button>
                </div>
              </div>
              <div className="site-progress">
                <div><span>{rowStage}</span><span>{rowPercent}%</span></div>
                <div className="site-progress-track" role="progressbar" aria-label={`${website.name} check progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={rowPercent}>
                  <span className={rowStatus === 'processing' ? 'in-progress' : ''} style={{ width: `${rowPercent}%` }}></span>
                </div>
              </div>
              {isExpanded && <section className="check-details" aria-label={`${website.name} latest check results`}>
                {!website.active ? <p className="muted">Monitoring is paused. Previous results are cleared from this site summary.</p> : !check ? <p className="muted">No check has been run for this website yet.</p> : <>
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
        </>}
        {resultsView && <CheckReport websites={dashboard.websites} loading={loading} onOpenActions={openWebsiteActions} openSiteMenuId={openSiteMenuId} closeWebsiteActions={closeWebsiteActions} />}
        {activeMenuWebsite && siteMenuPosition && <div className={`site-actions-backdrop ${siteMenuClosing ? 'is-closing' : ''}`} onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeWebsiteActions()
        }} onWheelCapture={(event) => {
          if (!event.target.closest('.site-actions-list')) event.preventDefault()
        }} onTouchMoveCapture={(event) => {
          if (!event.target.closest('.site-actions-list')) event.preventDefault()
        }}>
          <section className="site-actions-dialog" style={siteMenuPosition} role="dialog" aria-labelledby="site-actions-title" aria-describedby="site-actions-url">
            <header className="site-actions-heading">
              <div className="site-actions-title-group">
                <span className="site-actions-number" aria-label={`Website ${activeMenuWebsiteNumber}`}>#{String(activeMenuWebsiteNumber).padStart(2, '0')}</span>
                <div><h2 id="site-actions-title">{activeMenuWebsite.name}</h2><p id="site-actions-url">{activeMenuWebsite.url}</p></div>
              </div>
              <button className="site-actions-close" type="button" ref={siteMenuCloseButtonRef} aria-label="Close website actions" onClick={closeWebsiteActions}>×</button>
            </header>
            <nav className="site-actions-list" aria-label="Website actions">
              <a href={activeMenuWebsite.url} target="_blank" rel="noreferrer" onClick={() => setOpenSiteMenuId(null)}><SiteActionIcon name="open" />Open website</a>
              <button type="button" onClick={() => runWebsiteCheck(activeMenuWebsite)} disabled={!activeMenuWebsite.active || dashboard.stats.worker?.status !== 'online' || runningWebsiteId === activeMenuWebsite._id}><SiteActionIcon name="check" />{runningWebsiteId === activeMenuWebsite._id ? 'Queueing check...' : 'Run check now'}</button>
              <button type="button" onClick={() => copyWebsiteUrl(activeMenuWebsite)}><SiteActionIcon name="copy" />Copy URL</button>
              <button type="button" onClick={() => toggleWebsite(activeMenuWebsite)}><SiteActionIcon name={activeMenuWebsite.active ? 'pause' : 'play'} />{activeMenuWebsite.active ? 'Pause monitoring' : 'Resume monitoring'}</button>
              <button className="danger" type="button" onClick={() => deleteWebsite(activeMenuWebsite)} disabled={deletingWebsites}><SiteActionIcon name="delete" />Delete website</button>
            </nav>
          </section>
        </div>}
      </div>
      <div className={`tools-modal-backdrop ${toolsOpen ? 'tools-open' : ''}`} onMouseDown={(event) => {
        if (event.target === event.currentTarget) setToolsOpen(false)
      }}>
        <aside className="side-column" id="site-tools" role={toolsOpen ? 'dialog' : 'complementary'} aria-label={toolsOpen ? undefined : 'Site tools'} aria-modal={toolsOpen || undefined} aria-labelledby={toolsOpen ? 'tools-modal-title' : undefined} onMouseDown={(event) => event.stopPropagation()}>
          <span className="tools-modal-handle" aria-hidden="true" />
          <div className="tools-modal-heading">
            <h2 id="tools-modal-title">Add / import sites</h2>
            <button className="tools-modal-close" type="button" ref={toolsCloseButtonRef} aria-label="Close add and import sites" onClick={() => setToolsOpen(false)}>×</button>
          </div>
          <section className="tool-panel"><p className="eyebrow">ADD SITE</p><h2>New watch</h2><form onSubmit={addWebsite} aria-busy={addingWebsite}><input placeholder="Display name (optional)" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={addingWebsite} /><input required placeholder="https://example.com" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} disabled={addingWebsite} /><button className="primary" type="submit" disabled={addingWebsite} aria-busy={addingWebsite}>{addingWebsite && <span className="button-spinner" aria-hidden="true" />}{addingWebsite ? 'Adding website...' : 'Add website'}</button></form></section>
          <section className="tool-panel"><p className="eyebrow">BULK IMPORT</p><h2>Paste URLs</h2><form onSubmit={importUrls} aria-busy={importingUrls}><textarea rows="5" placeholder={'One URL per line\nName | https://example.com'} value={bulk} onChange={(event) => setBulk(event.target.value)} disabled={importingUrls} /><button className="secondary" type="submit" disabled={importingUrls} aria-busy={importingUrls}>{importingUrls && <span className="button-spinner" aria-hidden="true" />}{importingUrls ? 'Importing websites...' : 'Import valid URLs'}</button></form></section>
          <section className="tool-panel"><p className="eyebrow">GOOGLE SHEETS</p><h2>Import a sheet</h2><form onSubmit={importSheet} aria-busy={Boolean(sheetImportStatus)}><input required type="url" placeholder="Paste Google Sheet URL" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} disabled={Boolean(sheetImportStatus)} /><small className="muted">Set sharing to Anyone with the link, Viewer. Add a gid to choose a tab. Without a gid, the “All site(s)” tab is preferred; otherwise the first tab is used.</small><button className="secondary" type="submit" disabled={Boolean(sheetImportStatus)} aria-busy={Boolean(sheetImportStatus)}>{sheetImportStatus && <span className="button-spinner" aria-hidden="true" />}{sheetImportStatus === 'fetching' ? 'Reading Google Sheet...' : sheetImportStatus === 'saving' ? 'Adding websites...' : 'Import from Google Sheet'}</button></form></section>
        </aside>
      </div>
    </section>
    <button className="tools-fab" type="button" aria-label={toolsOpen ? 'Close add and import sites' : 'Add or import sites'} aria-haspopup="dialog" aria-expanded={toolsOpen} aria-controls="site-tools" onClick={() => setToolsOpen((open) => !open)}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    </button>
    <ConfirmationDialog
      confirmation={confirmation}
      onConfirm={() => resolveConfirmation(true)}
      onCancel={() => resolveConfirmation(false)}
    />
  </main>
}

export default App