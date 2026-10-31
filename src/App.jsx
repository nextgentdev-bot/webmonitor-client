import { Fragment, memo, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { summarizeIssue } from './issueSummary.js'
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
    {result?.error && <small className="result-error">{summarizeIssue(result.error).replace(/^Website:\s*/, '')}</small>}
    {result?.url && <a href={result.url} target="_blank" rel="noreferrer">Open checked link</a>}
  </div>
}

const stripLabels = { ok: 'OK', bad: 'Failed', warn: 'Warning', skip: 'Skipped', none: 'Not checked' }

function stripState(status) {
  if (status === 'working') return 'ok'
  if (status === 'missing' || status === 'error') return 'bad'
  if (status === 'warning') return 'warn'
  if (status === 'skipped') return 'skip'
  return 'none'
}

function CheckStrip({ check, homepageStatus }) {
  const segments = [
    ['Homepage', check ? homepageStatus : undefined],
    ['Desktop contact', check?.desktop?.contact?.status],
    ['Desktop news', check?.desktop?.news?.status],
    ['Mobile contact', check?.mobile?.contact?.status],
    ['Mobile news', check?.mobile?.news?.status]
  ].map(([label, status]) => ({ label, state: stripState(status) }))

  return <span className="check-strip" role="img" aria-label={`Checks: ${segments.map(({ label, state }) => `${label} ${stripLabels[state]}`).join(', ')}`}>
    {segments.map(({ label, state }) => <span className={`strip-segment ${state}`} title={`${label}: ${stripLabels[state]}`} key={label} />)}
  </span>
}

const websiteResultStatus = (website) => !website.active ? 'paused' : website.currentCheck?.status || website.lastCheck?.status || 'not-checked'

function summarizeResults(websites) {
  let healthy = 0, issues = 0, unchecked = 0, cancelled = 0
  for (const website of websites) {
    const status = websiteResultStatus(website)
    const check = website.active ? website.lastCheck : null
    if (status === 'healthy') healthy += 1
    if (['warning', 'critical'].includes(status) || (check?.issues?.length || 0) > 0) issues += 1
    if (status === 'not-checked') unchecked += 1
    if (status === 'cancelled') cancelled += 1
  }
  return { healthy, issues, unchecked, cancelled }
}

function ThemeIcon({ theme }) {
  return theme === 'dark'
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 15.3A9 9 0 0 1 8.7 3.6 9 9 0 1 0 20.4 15.3Z" /></svg>
}

function matchesProgressFilter(website, filter, count) {
  if (!filter) return true
  if (filter === 'paused') return !website.active
  if (!count || !website.active) return false
  const status = website.currentCheck?.status
  if (filter === 'checking') return status === 'processing'
  if (filter === 'queued') return status === 'pending'
  return !status
}

const issueCategories = ['Homepage load time', 'Homepage availability', 'News', 'Contact']

function issueCategory(issue) {
  if (issue.startsWith('Main website is slow') || issue.startsWith('Main website took longer')) return 'Homepage load time'
  if (issue.startsWith('Main website')) return 'Homepage availability'
  if (/^(Desktop|Mobile) News:/.test(issue)) return 'News'
  if (/^(Desktop|Mobile) Contact:/.test(issue)) return 'Contact'
  return null
}

const CheckReport = memo(function CheckReport({ websites, loading, onOpenActions, openSiteMenuId, closeWebsiteActions, summaryFilter, setSummaryFilter, issueFilter, setIssueFilter, progressFilter, progressFilterCount, selectedIds, onToggleMark, onOpenPaused }) {
  const markedIds = new Set(selectedIds)
  const rows = websites.map((website, index) => {
    const check = website.active ? website.lastCheck : null
    const currentCheck = website.active ? website.currentCheck : null
    const issues = check?.issues || []
    const status = websiteResultStatus(website)
    const issueTypes = [...new Set(issues.map(issueCategory).filter(Boolean))]
    return { website, check, currentCheck, issues, issueTypes, status, index }
  })
  const issueRows = rows.filter(({ status, issues }) => ['warning', 'critical'].includes(status) || issues.length > 0)
  const categoryCounts = new Map(issueCategories.map((category) => [
    category,
    rows.filter(({ issueTypes }) => issueTypes.includes(category)).length
  ]))
  const filteredRows = issueFilter
    ? rows.filter(({ issueTypes }) => issueTypes.includes(issueFilter))
    : summaryFilter === 'healthy'
      ? rows.filter(({ status }) => status === 'healthy')
      : summaryFilter === 'issues'
        ? issueRows
        : summaryFilter === 'not-checked'
          ? rows.filter(({ status }) => status === 'not-checked')
          : summaryFilter === 'cancelled'
            ? rows.filter(({ status }) => status === 'cancelled')
            : rows
  const visibleRows = progressFilter ? filteredRows.filter(({ website }) => matchesProgressFilter(website, progressFilter, progressFilterCount)) : filteredRows
  const healthyCount = rows.filter(({ status }) => status === 'healthy').length
  const issueCount = issueRows.length
  const uncheckedCount = rows.filter(({ status }) => status === 'not-checked').length
  const cancelledCount = rows.filter(({ status }) => status === 'cancelled').length
  // Not checked / Cancelled buttons only appear while such websites exist (or while their filter is on, so it can be switched off).
  const summaryButtons = [
    { key: 'healthy', label: 'Healthy', count: healthyCount, className: '' },
    { key: 'issues', label: 'Needs attention', count: issueCount, className: issueCount ? 'has-issues' : '' },
    { key: 'not-checked', label: 'Not checked', count: uncheckedCount, className: '', optional: true },
    { key: 'cancelled', label: 'Cancelled', count: cancelledCount, className: '', optional: true }
  ].filter((button) => !button.optional || button.count > 0 || summaryFilter === button.key)

  return <section className="results-report" id="check-results" aria-labelledby="results-title">
    <div className="results-heading">
      <div>
        <h2 id="results-title">Website results</h2>
        <p className="muted">Latest result per website, including run all, selected runs, and individual checks.</p>
      </div>
      <span className="results-total">{rows.length} {rows.length === 1 ? 'website' : 'websites'}</span>
    </div>
    <div className="results-summary" aria-label="Result summary filters">
      {summaryButtons.map((button) => <button type="button" key={button.key} className={`${button.className ? `${button.className} ` : ''}${summaryFilter === button.key ? 'active' : ''}`} aria-pressed={summaryFilter === button.key} onClick={() => { setSummaryFilter((current) => current === button.key ? '' : button.key); setIssueFilter('') }}>
        <span>{button.label}</span><strong>{button.count}</strong>
      </button>)}
    </div>
    <div className="fleet-bar" role="img" aria-label={`${healthyCount} healthy, ${issueCount} need attention, ${Math.max(0, rows.length - healthyCount - issueCount)} other`}>
      <span className="ok" style={{ flexGrow: healthyCount }} />
      <span className="bad" style={{ flexGrow: issueCount }} />
      <span className="none" style={{ flexGrow: Math.max(0, rows.length - healthyCount - issueCount) }} />
    </div>
    <div className="results-toolbar">
      <label className="issue-filter-control">
        <span>Filter by issue</span>
        <select value={issueFilter} onChange={(event) => { setIssueFilter(event.target.value); setSummaryFilter('') }} aria-label="Filter websites by issue type">
          <option value="">All results ({rows.length})</option>
          {issueCategories.map((category) => <option value={category} key={category}>{category} ({categoryCounts.get(category)})</option>)}
        </select>
      </label>
      <span className="results-updated">Live from latest checks</span>
    </div>
    <div className="results-list">
      {loading ? <p className="results-empty-state">Loading latest website results...</p> : visibleRows.map(({ website, check, currentCheck, issues, status, index }) => {
        const statusLabel = status === 'not-checked' ? 'Not checked' : status === 'processing' ? 'Checking' : status === 'pending' ? 'Queued' : status.charAt(0).toUpperCase() + status.slice(1)
        const statusClass = status === 'processing' ? 'checking' : status === 'pending' ? 'queued' : ['healthy', 'warning', 'critical', 'paused', 'cancelled'].includes(status) ? status : 'pending'
        const homepageIssue = issues.some((issue) => issue.startsWith('Main website'))
        const homepageStatus = homepageIssue ? (!check?.homepage?.statusCode || check.homepage.statusCode >= 500 || check.homepage.sslValid === false ? 'error' : 'warning') : 'working'
        const checkPercent = status === 'processing' ? currentCheck?.progressPercent || 0 : status === 'pending' ? 0 : 100
        const mobilePercent = status === 'processing' ? currentCheck?.mobileProgressPercent || 0 : status === 'pending' ? 0 : 100
        const checkStage = status === 'processing' ? currentCheck?.progressStage || 'Checking website' : status === 'pending' ? 'Queued' : 'Complete'
        const mobileStage = status === 'processing'
          ? mobilePercent >= 100 ? 'Mobile checks complete' : currentCheck?.progressStage?.startsWith('Mobile') ? currentCheck.progressStage : 'Waiting for mobile checks'
          : status === 'pending' ? 'Queued' : 'Complete'

        const marked = markedIds.has(website._id)
        return <article className={`results-row ${status === 'critical' || status === 'warning' ? 'has-issues' : ''}${marked ? ' is-marked' : ''}`} key={website._id}>
          <div className="results-site">
            {marked && <button type="button" className="mark-tick" aria-label={`Unmark ${website.name}`} title="Marked. Tap to unmark" onClick={() => onToggleMark(website._id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
            </button>}
            <span className="results-index">{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{website.name}</strong><a href={website.url} target="_blank" rel="noreferrer">{website.url}</a></div>
            <button className="site-menu-trigger results-menu-trigger" type="button" data-site-menu-trigger={website._id} aria-label={`Actions for ${website.name}`} aria-haspopup="dialog" aria-expanded={openSiteMenuId === website._id} onClick={(event) => openSiteMenuId === website._id ? closeWebsiteActions() : onOpenActions(event, website._id)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
            </button>
          </div>
          <div className="results-data">
            <div className="results-status-line">
              {status === 'paused'
                ? <button type="button" className="badge paused paused-badge-button" title={website.pauseReason || 'Monitoring paused'} onClick={() => onOpenPaused(website)}>{statusLabel}</button>
                : <span className={`badge ${statusClass}`}>{statusLabel}</span>}
              <CheckStrip check={check} homepageStatus={homepageStatus} />
              {['processing', 'pending'].includes(status) && <div className="results-progress">
                <span>{checkStage}</span>
                <div className="results-progress-track" role="progressbar" aria-label={`${website.name} check progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={checkPercent}>
                  <span style={{ width: `${checkPercent}%` }} />
                </div>
                <b>{checkPercent}%</b>
              </div>}
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
              {['processing', 'pending'].includes(status) && <div className="mobile-device-progress">
                <div><strong>Mobile device</strong><span>{mobileStage}</span><b>{mobilePercent}%</b></div>
                <div className="results-progress-track" role="progressbar" aria-label={`${website.name} mobile device check progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={mobilePercent}>
                  <span style={{ width: `${mobilePercent}%` }} />
                </div>
              </div>}
              <div className={`results-issues ${issues.length ? 'has-issues' : ''}`}>
                <strong>{issues.length ? `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'} found` : 'No issues found'}</strong>
                {issues.length > 0 && <ul>{issues.map((issue, issueIndex) => <li key={`${issueIndex}-${issue}`}>{summarizeIssue(issue)}</li>)}</ul>}
              </div>
              {check.screenshots?.length > 0 && <div className="screenshot-links">{check.screenshots.map((image) => <a href={image} target="_blank" rel="noreferrer" key={image}>Open issue screenshot</a>)}</div>}
            </> : <p className="results-empty">{website.active ? currentCheck?.status === 'processing' ? 'The latest check is running; detailed results will appear when it finishes.' : 'No check has been run for this website yet.' : `Monitoring is paused.${website.pauseReason ? ` Reason: ${website.pauseReason}` : ''}`}</p>}
          </div>
        </article>
      })}
      {!loading && visibleRows.length === 0 && <p className="results-empty-state">{progressFilter ? `No websites are currently ${progressFilter}.` : issueFilter ? `No websites currently have this issue: ${issueFilter}.` : summaryFilter === 'healthy' ? 'No healthy websites found.' : summaryFilter === 'issues' ? 'No websites currently need attention.' : summaryFilter === 'not-checked' ? 'No unchecked websites found.' : summaryFilter === 'cancelled' ? 'No cancelled websites found.' : 'No websites to show.'}</p>}
    </div>
  </section>
})

// Keep the same object for websites whose data did not change, so memoized rows skip re-rendering.
function reuseWebsites(previous, next) {
  const previousById = new Map(previous.map((website) => [website._id, website]))
  let changed = previous.length !== next.length
  const merged = next.map((website, position) => {
    const old = previousById.get(website._id)
    if (old && JSON.stringify(old) === JSON.stringify(website)) {
      if (previous[position] !== old) changed = true
      return old
    }
    changed = true
    return website
  })
  return changed ? merged : previous
}

const SiteRow = memo(function SiteRow({ website, index, selected, expanded: isExpanded, menuOpen, deleting, busy, onToggleSelect, onToggleExpand, onOpenActions, onCloseActions, onOpenPaused }) {
  const check = website.active ? website.lastCheck : null
  const currentCheck = website.active ? website.currentCheck : null
  const issues = website.active ? check?.issues || [] : []
  const homepageIssue = issues.some((issue) => issue.startsWith('Main website'))
  const homepageCritical = !check?.homepage?.statusCode || check.homepage.statusCode >= 500 || check.homepage.sslValid === false
  const homepageStatus = homepageIssue ? (homepageCritical ? 'error' : 'warning') : 'working'
  const rowStatus = !website.active ? 'paused' : currentCheck?.status || check?.status || 'not-checked'
  const rowStatusLabel = rowStatus === 'processing' ? 'Checking' : rowStatus === 'pending' ? 'Queued' : rowStatus === 'cancelled' ? 'Cancelled' : rowStatus === 'not-checked' ? 'Not checked' : rowStatus === 'paused' ? 'Paused' : rowStatus.charAt(0).toUpperCase() + rowStatus.slice(1)
  const rowStatusClass = rowStatus === 'processing' ? 'checking' : rowStatus === 'pending' ? 'queued' : rowStatus
  const rowPercent = website.active ? ['healthy', 'warning', 'critical'].includes(rowStatus) ? 100 : ['processing', 'cancelled'].includes(rowStatus) ? currentCheck?.progressPercent || 0 : 0 : 0
  const rowStage = !website.active ? 'Paused' : currentCheck?.progressStage || (rowPercent === 100 ? 'Complete' : rowStatus === 'not-checked' ? 'Not started' : rowStatusLabel)
  return <article className={`site-entry ${website.active && (check?.status === 'warning' || check?.status === 'critical') ? 'has-issues' : ''}${busy ? ' is-busy' : ''}`} key={website._id} aria-busy={busy ? true : undefined}>
    <div className="site-row">
      <input className="site-select" type="checkbox" aria-label={`Select ${website.name}`} checked={selected} onChange={() => onToggleSelect(website._id)} disabled={deleting || Boolean(busy)} />
      <span className="site-number" aria-label={`Website ${index + 1}`}>{index + 1}</span>
      <span className={`status ${website.active ? 'active' : 'paused'}`}></span>
      <div className="site-info"><strong>{website.name}</strong><a href={website.url} target="_blank" rel="noreferrer">{website.url}</a></div>
      {busy ? <span className="badge busy" role="status"><span className="button-spinner" aria-hidden="true" />{busy}...</span> : rowStatus === 'paused' ? <button type="button" className="badge paused paused-badge-button" title={website.pauseReason || 'Monitoring paused'} onClick={() => onOpenPaused(website)}>{rowStatusLabel}</button> : <span className={`badge ${rowStatusClass}`}>{rowStatusLabel}</span>}
      <CheckStrip check={check} homepageStatus={homepageStatus} />
      {!website.active ? <span className="issue-count neutral">0 issues</span> : issues.length > 0 ? <span className="issue-count">{issues.length} {issues.length === 1 ? 'issue' : 'issues'}</span> : <span className="issue-count" aria-hidden="true" />}
      <button className="details-button" type="button" aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Hide' : 'View'} results for ${website.name}`} onClick={() => onToggleExpand(website._id)}>{isExpanded ? 'Hide results' : 'View results'}</button>
      <div className="site-actions-menu">
        <button className="site-menu-trigger" type="button" data-site-menu-trigger={website._id} aria-label={`Actions for ${website.name}`} aria-haspopup="dialog" aria-expanded={menuOpen} disabled={Boolean(busy)} onClick={(event) => menuOpen ? onCloseActions() : onOpenActions(event, website._id)}>
          {busy ? <span className="button-spinner" aria-hidden="true" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>}
        </button>
      </div>
    </div>
    <div className={`site-progress ${['processing', 'pending'].includes(rowStatus) ? 'is-active' : ''}`}>
      <div><span>{rowStage}</span><span>{rowPercent}%</span></div>
      <div className="site-progress-track" role="progressbar" aria-label={`${website.name} check progress`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={rowPercent}>
        <span className={rowStatus === 'processing' ? 'in-progress' : ''} style={{ width: `${rowPercent}%` }}></span>
      </div>
    </div>
    {isExpanded && <section className="check-details" aria-label={`${website.name} latest check results`}>
      {!website.active ? <div className="pause-reason-card"><span>Pause reason</span><strong>{website.pauseReason || 'No reason recorded'}</strong>{website.pausedAt && <small>Paused {new Date(website.pausedAt).toLocaleString()}</small>}</div> : !check ? <p className="muted">No check has been run for this website yet.</p> : <>
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
          {issues.length > 0 && <ul>{issues.map((issue, index) => <li key={`${index}-${issue}`}>{summarizeIssue(issue)}</li>)}</ul>}
        </div>
        {check.screenshots?.length > 0 && <div className="screenshot-links">{check.screenshots.map((image) => <a href={image} target="_blank" rel="noreferrer" key={image}>Open issue screenshot</a>)}</div>}
      </>}
    </section>}
  </article>
})

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
    tick: <path d="m5 12.5 4.5 4.5L19 7.5" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    delete: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="m6 7 1 13h10l1-13M9 7V4h6v3" /></>
  }

  return <svg className="site-action-icon" viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>
}

function ConfirmationDialog({ confirmation, onConfirm, onCancel }) {
  const cancelButtonRef = useRef(null)
  const confirmButtonRef = useRef(null)
  const cancel = useEffectEvent(() => onCancel())

  useEffect(() => {
    if (!confirmation) return undefined
    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    cancelButtonRef.current?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
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
      document.documentElement.style.overflow = previousHtmlOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [confirmation])

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

function PauseWebsiteDialog({ website, onCancel, onSubmit }) {
  const [reason, setReason] = useState('')
  const formRef = useRef(null)
  const textareaRef = useRef(null)
  // Effect events keep this effect from re-running (and stealing focus / closing the mobile keyboard) every time the dashboard polls.
  const cancel = useEffectEvent(() => onCancel())

  useEffect(() => {
    if (!website) return undefined
    const previouslyFocused = document.activeElement
    const previousOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    textareaRef.current?.focus({ preventScroll: true })
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
      if (event.key === 'Tab') {
        const focusable = formRef.current?.querySelectorAll('textarea:not(:disabled), button:not(:disabled)')
        if (!focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
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
      document.documentElement.style.overflow = previousHtmlOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true })
    }
  }, [website])

  if (!website) return null
  const trimmedReason = reason.trim()

  function submit(event) {
    event.preventDefault()
    if (!trimmedReason) return
    onSubmit(trimmedReason)
  }

  return <div className="confirmation-backdrop pause-dialog-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onCancel()
  }}>
    <form ref={formRef} className="confirmation-dialog pause-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title" aria-describedby="pause-description" onSubmit={submit}>
      <button className="pause-detail-close" type="button" aria-label="Close pause dialog" onClick={onCancel}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
      <div className="pause-dialog-icon" aria-hidden="true"><SiteActionIcon name="pause" /></div>
      <div className="pause-dialog-heading">
        <span>Pause monitoring</span>
        <h2 id="pause-title">{website.name}</h2>
      </div>
      <p id="pause-description">{website.url}</p>
      <p className="pause-dialog-note">Scheduled and manual checks stop for this website, and any queued or running check is removed. Its last result is kept until you resume it.</p>
      <label className="pause-reason-field" htmlFor="pause-reason">
        <span>Pause reason <b>Required</b></span>
        <textarea id="pause-reason" ref={textareaRef} value={reason} onChange={(event) => setReason(event.target.value)} onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit(event)
        }} rows="4" placeholder="Example: Temporarily unavailable while the redesign is being deployed" maxLength="300" />
        <small><span>{trimmedReason ? `${reason.length}/300` : 'Please write a reason'}</span></small>
      </label>
      <div className="confirmation-actions">
        <button className="confirmation-cancel" type="button" onClick={onCancel}>Cancel</button>
        <button className="confirmation-accept" type="submit" disabled={!trimmedReason}>Pause website</button>
      </div>
    </form>
  </div>
}

function PauseReasonDialog({ website, onClose, onResume }) {
  const closeButtonRef = useRef(null)
  const close = useEffectEvent(() => onClose())

  useEffect(() => {
    if (!website) return undefined
    const previouslyFocused = document.activeElement
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    closeButtonRef.current?.focus({ preventScroll: true })
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    function preventBackgroundScroll(event) {
      if (event.target instanceof Element && event.target.closest('.pause-detail-dialog')) return
      event.preventDefault()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('wheel', preventBackgroundScroll, { passive: false })
    document.addEventListener('touchmove', preventBackgroundScroll, { passive: false })
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('wheel', preventBackgroundScroll)
      document.removeEventListener('touchmove', preventBackgroundScroll)
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus({ preventScroll: true })
    }
  }, [website])

  if (!website) return null

  return <div className="confirmation-backdrop pause-detail-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="confirmation-dialog pause-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="pause-detail-title" aria-describedby="pause-detail-description">
      <button className="pause-detail-close" type="button" aria-label="Close pause reason" onClick={onClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
      <div className="pause-detail-icon" aria-hidden="true"><SiteActionIcon name="pause" /></div>
      <span className="pause-detail-label">Monitoring paused</span>
      <h2 id="pause-detail-title">{website.name}</h2>
      <p id="pause-detail-description">{website.url}</p>
      <div className="pause-detail-reason">
        <span>Why this site is paused</span>
        <strong>{website.pauseReason || 'No pause reason recorded'}</strong>
      </div>
      {website.pausedAt && <small className="pause-detail-time">Paused on {new Date(website.pausedAt).toLocaleString()}</small>}
      <div className="confirmation-actions">
        <button className="confirmation-cancel" type="button" onClick={() => onResume(website)}>Resume monitoring</button>
        <button ref={closeButtonRef} className="confirmation-accept" type="button" onClick={onClose}>Close</button>
      </div>
    </section>
  </div>
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('monitor_token'))
  const [theme, setTheme] = useState(() => localStorage.getItem('monitor_theme') || 'light')
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
  const [googleSheetStatus, setGoogleSheetStatus] = useState(null)
  const [googleSheetBusy, setGoogleSheetBusy] = useState(false)
  const [googleSheetMode, setGoogleSheetMode] = useState('new')
  const [googleSheetUrl, setGoogleSheetUrl] = useState('')
  const [googleSheetSetupOpen, setGoogleSheetSetupOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedWebsiteIds, setSelectedWebsiteIds] = useState([])
  const [deletingWebsites, setDeletingWebsites] = useState(false)
  const [expandedWebsiteId, setExpandedWebsiteId] = useState(null)
  const [resultsView, setResultsView] = useState(() => window.location.hash === '#check-results')
  const progressRequestActive = useRef(false)
  const progressSignatureRef = useRef('')
  const [cancelingRun, setCancelingRun] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const topbarWrapRef = useRef(null)
  const floatBarRef = useRef(null)
  const [openSiteMenuId, setOpenSiteMenuId] = useState(null)
  const [siteMenuClosing, setSiteMenuClosing] = useState(false)
  const [siteMenuPosition, setSiteMenuPosition] = useState(null)
  const [runningWebsiteId, setRunningWebsiteId] = useState(null)
  const [confirmation, setConfirmation] = useState(null)
  const confirmationResolver = useRef(null)
  const [pauseWebsite, setPauseWebsite] = useState(null)
  const [pauseReasonWebsite, setPauseReasonWebsite] = useState(null)
  const [summaryFilter, setSummaryFilter] = useState('')
  const [issueFilter, setIssueFilter] = useState('')
  const [navMenuOpen, setNavMenuOpen] = useState(false)
  const [progressFilter, setProgressFilter] = useState('')
  const [siteBusy, setSiteBusy] = useState({})
  const [bulkDeleteKind, setBulkDeleteKind] = useState('')
  const markSiteBusy = useCallback((ids, label) => setSiteBusy((current) => { const next = { ...current }; for (const id of ids) next[id] = label; return next }), [])
  const clearSiteBusy = useCallback((ids) => setSiteBusy((current) => { const next = { ...current }; for (const id of ids) delete next[id]; return next }), [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('monitor_theme', theme)
  }, [theme])

  // Show the floating navbar only while the normal navbar is scrolled out of view.
  // IntersectionObserver + direct DOM updates: no scroll listener and no React re-render.
  useEffect(() => {
    const wrap = topbarWrapRef.current
    const bar = floatBarRef.current
    if (!token || !wrap || !bar) return undefined
    bar.inert = true
    const observer = new IntersectionObserver(([entry]) => {
      const show = !entry.isIntersecting && entry.boundingClientRect.top < 0
      bar.classList.toggle('is-visible', show)
      bar.inert = !show
      if (!show) setNavMenuOpen(false)
      bar.setAttribute('aria-hidden', String(!show))
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [token])
  useEffect(() => {
    if (!navMenuOpen) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') setNavMenuOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navMenuOpen])
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
    const previousBodyOverflow = document.body.style.overflow
    const previousDocumentOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    siteMenuCloseButtonRef.current?.focus({ preventScroll: true })

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
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousDocumentOverflow
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
  const closePauseDialog = useCallback(() => setPauseWebsite(null), [])
  const closePauseReason = useCallback(() => setPauseReasonWebsite(null), [])

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
    try { const data = await request(`/dashboard?search=${encodeURIComponent(search)}`); setDashboard((current) => ({ ...data, websites: reuseWebsites(current.websites, data.websites) })); return true } catch (error) { notifyError(error.message); return false } finally { setLoading(false) }
  }

  function navigateResultsView(showResults) {
    setResultsView(showResults)
    window.history.replaceState(null, '', showResults ? '#check-results' : '#websites')
    if (showResults && query) {
      setQuery('')
      loadDashboard('')
    }
  }

  function scrollToSection(id) {
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  function openResultsFilter(filter) {
    const alreadyActive = resultsView && summaryFilter === filter
    setSummaryFilter(alreadyActive ? '' : filter)
    setProgressFilter('')
    setIssueFilter('')
    navigateResultsView(true)
    setNavMenuOpen(false)
    scrollToSection('check-results')
  }

  function openProgressFilter(key) {
    setProgressFilter((current) => current === key ? '' : key)
    setSummaryFilter('')
    setIssueFilter('')
    setNavMenuOpen(false)
    if (key === 'paused') {
      navigateResultsView(false)
      scrollToSection('websites-list')
    } else {
      scrollToSection(resultsView ? 'check-results' : 'websites-list')
    }
  }

  function openWebsitesView() {
    navigateResultsView(false)
    setNavMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function jumpToProgress() {
    setNavMenuOpen(false)
    scrollToSection('run-progress')
  }

  // The token is the external session boundary for this dashboard.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { loadDashboard() }, [token])

  useEffect(() => {
    if (!token) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    request('/google-sheets/status')
      .then((status) => {
        setGoogleSheetStatus(status)
        if (status.spreadsheetUrl) {
          setGoogleSheetUrl(status.spreadsheetUrl)
          setGoogleSheetMode('existing')
          setGoogleSheetSetupOpen(true)
        }
      })
      .catch((error) => notifyError(error.message))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('googleSheets')
    if (!result) return
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
    if (result === 'connected') notifySuccess('Google account connected.')
    else notifyError(result === 'denied' ? 'Google account connection was cancelled.' : 'Could not connect the Google account.')
  }, [])

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
      const progressSignature = `${result.status}|${result.checks.map((check) => `${check.websiteId}:${check.status}:${check.progressStage}`).join('|')}`
      const progressChanged = progressSignatureRef.current !== progressSignature
      setDashboard((current) => ({
        ...current,
        websites: reuseWebsites(current.websites, current.websites.map((website) => website.active
          ? { ...website, currentCheck: checksByWebsite.get(website._id) || website.currentCheck }
          : { ...website, currentCheck: null })),
        stats: { ...current.stats, runProgress: result }
      }))
      if (progressChanged || result.status !== 'running') {
        progressSignatureRef.current = progressSignature
        await loadDashboard(query)
      }
    } catch (error) { notifyError(error.message) } finally { progressRequestActive.current = false }
  })

  useEffect(() => {
    if (!token) return undefined
    const isRunning = dashboard.stats.runProgress?.status === 'running'
    const initialTimeoutId = isRunning ? window.setTimeout(() => { void pollRunProgress() }, 0) : null
    const intervalId = window.setInterval(() => { void pollRunProgress() }, isRunning ? 1500 : 3000)
    return () => {
      if (initialTimeoutId !== null) window.clearTimeout(initialTimeoutId)
      window.clearInterval(intervalId)
    }
  }, [token, dashboard.stats.runProgress?.status, dashboard.stats.runProgress?.runId])

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
    setPauseReasonWebsite(null)
    if (website.active) {
      // Pausing always asks for a reason first.
      setPauseWebsite(website)
      return
    }
    setDashboard((current) => ({
      ...current,
      websites: current.websites.map((item) => item._id === website._id ? { ...item, active: true, pauseReason: '', pausedAt: null } : item),
      stats: { ...current.stats, active: current.stats.active + 1 }
    }))
    markSiteBusy([website._id], 'Resuming')
    try {
      await request(`/websites/${website._id}`, { method: 'PATCH', body: JSON.stringify({ active: true }) })
      notifySuccess(`${website.name} resumed.`)
      await loadDashboard(query)
    } catch (error) {
      setDashboard((current) => ({
        ...current,
        websites: current.websites.map((item) => item._id === website._id ? website : item),
        stats: { ...current.stats, active: Math.max(0, current.stats.active - 1) }
      }))
      notifyError(error.message)
    } finally { clearSiteBusy([website._id]) }
  }

  async function submitPauseReason(reason) {
    if (!pauseWebsite) return
    const website = pauseWebsite
    setPauseWebsite(null)
    const active = false
    setDashboard((current) => ({
      ...current,
      websites: current.websites.map((item) => item._id === website._id
        ? { ...item, active, pauseReason: reason, pausedAt: new Date().toISOString(), currentCheck: null }
        : item),
      stats: { ...current.stats, active: Math.max(0, current.stats.active - 1) }
    }))
    setSelectedWebsiteIds((current) => current.filter((id) => id !== website._id))
    markSiteBusy([website._id], 'Pausing')
    try {
      await request(`/websites/${website._id}`, { method: 'PATCH', body: JSON.stringify({ active, pauseReason: reason }) })
      notifySuccess(`${website.name} paused.`)
      await loadDashboard(query)
    } catch (error) {
      setDashboard((current) => ({
        ...current,
        websites: current.websites.map((item) => item._id === website._id ? website : item),
        stats: { ...current.stats, active: current.stats.active + 1 }
      }))
      notifyError(error.message)
    } finally { clearSiteBusy([website._id]) }
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
    markSiteBusy([website._id], 'Deleting')
    try {
      await request(`/websites/${website._id}`, { method: 'DELETE' })
      setSelectedWebsiteIds((current) => current.filter((id) => id !== website._id))
      setExpandedWebsiteId((current) => current === website._id ? null : current)
      notifySuccess(`${website.name} deleted.`)
      await loadDashboard()
    } catch (error) { notifyError(error.message) } finally { setDeletingWebsites(false); clearSiteBusy([website._id]) }
  }

  async function runWebsiteCheck(website) {
    setOpenSiteMenuId(null)
    setRunningWebsiteId(website._id)
    markSiteBusy([website._id], 'Queueing')
    progressSignatureRef.current = ''
    setDashboard((current) => ({
      ...current,
      websites: current.websites.map((item) => item._id === website._id
        ? { ...item, currentCheck: { status: 'pending', progressPercent: 0, progressStage: 'Queued', mobileProgressPercent: 0 } }
        : item),
      stats: { ...current.stats, runProgress: { status: 'running', total: 1, completed: 0, processing: 0, pending: 1, queued: 1, cancelled: 0, percent: 0 } }
    }))
    if (googleSheetStatus?.spreadsheetUrl) {
      setGoogleSheetUrl(googleSheetStatus.spreadsheetUrl)
      setGoogleSheetMode('existing')
      setGoogleSheetSetupOpen(true)
    }
    try {
      const result = await request('/runs', { method: 'POST', body: JSON.stringify({ type: 'manual', websiteIds: [website._id] }) })
      if (result.created) {
        notifySuccess(`Check queued for ${website.name}.`)
        setDashboard((current) => ({ ...current, stats: { ...current.stats, runProgress: { ...current.stats.runProgress, runId: result.runId } } }))
      } else notifyError(result.reason)
      await loadDashboard()
    } catch (error) { notifyError(error.message) } finally { setRunningWebsiteId(null); clearSiteBusy([website._id]) }
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

  const openWebsiteActions = useCallback((event, websiteId) => {
    const triggerRect = event.currentTarget.getBoundingClientRect()
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = window.visualViewport?.height || window.innerHeight
    const mobile = viewportWidth <= 760
    const gutter = 16
    const dialogWidth = Math.min(mobile ? 440 : 320, viewportWidth - gutter * 2)
    const mobileHeight = Math.min(viewportHeight * 0.8, 600)
    const preferredRight = triggerRect.right + gutter
    const preferredLeft = triggerRect.left - dialogWidth - gutter
    const left = mobile
      ? (viewportWidth - dialogWidth) / 2
      : preferredRight + dialogWidth <= viewportWidth - gutter
        ? preferredRight
        : preferredLeft >= gutter
          ? preferredLeft
          : Math.max(gutter, Math.min(preferredRight, viewportWidth - dialogWidth - gutter))
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
  }, [])

  const closeWebsiteActions = useCallback(() => {
    setSiteMenuClosing(true)
  }, [])

  const activeMenuWebsite = dashboard.websites.find((website) => website._id === openSiteMenuId)
  const activeMenuWebsiteNumber = dashboard.websites.findIndex((website) => website._id === openSiteMenuId) + 1

  const toggleWebsiteSelection = useCallback((id) => {
    setSelectedWebsiteIds((current) => current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id])
  }, [])

  const toggleWebsiteExpanded = useCallback((id) => {
    setExpandedWebsiteId((current) => current === id ? null : id)
  }, [])

  const selectedIdSet = new Set(selectedWebsiteIds)

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
    setBulkDeleteKind('selected')
    const busyIds = [...selectedWebsiteIds]
    markSiteBusy(busyIds, 'Deleting')
    try {
      const result = await request('/websites/bulk-action', { method: 'POST', body: JSON.stringify({ action: 'delete', ids: selectedWebsiteIds }) })
      setSelectedWebsiteIds([])
      notifySuccess(`${result.deleted} selected websites deleted.`)
      await loadDashboard()
    } catch (error) { notifyError(error.message) } finally { setDeletingWebsites(false); setBulkDeleteKind(''); clearSiteBusy(busyIds) }
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
    setBulkDeleteKind('all')
    const busyIds = dashboard.websites.map((website) => website._id)
    markSiteBusy(busyIds, 'Deleting')
    try {
      const result = await request('/websites', { method: 'DELETE' })
      setSelectedWebsiteIds([])
      setQuery('')
      notifySuccess(`${result.deleted} websites deleted.`)
      await loadDashboard('')
    } catch (error) { notifyError(error.message) } finally { setDeletingWebsites(false); setBulkDeleteKind(''); clearSiteBusy(busyIds) }
  }

  async function runAll() {
    const pausedIds = new Set(dashboard.websites.filter((website) => !website.active).map((website) => website._id))
    const selectedIds = selectedWebsiteIds.filter((id) => !pausedIds.has(id))
    if (selectedWebsiteIds.length && !selectedIds.length) {
      notifyError('The marked websites are paused. Resume them or mark other websites.')
      return
    }
    progressSignatureRef.current = ''
    const selectedSet = new Set(selectedIds)
    const total = selectedIds.length || dashboard.websites.filter((website) => website.active).length
    setDashboard((current) => ({
      ...current,
      websites: current.websites.map((website) => selectedIds.length
        ? selectedSet.has(website._id)
          ? { ...website, currentCheck: { status: 'pending', progressPercent: 0, progressStage: 'Queued', mobileProgressPercent: 0 } }
          : website
        : website.active
          ? { ...website, currentCheck: { status: 'pending', progressPercent: 0, progressStage: 'Queued', mobileProgressPercent: 0 } }
          : website),
      stats: { ...current.stats, runProgress: { status: 'running', total, completed: 0, processing: 0, pending: total, queued: total, cancelled: 0, percent: 0 } }
    }))
    if (googleSheetStatus?.spreadsheetUrl) {
      setGoogleSheetUrl(googleSheetStatus.spreadsheetUrl)
      setGoogleSheetMode('existing')
      setGoogleSheetSetupOpen(true)
    }
    try {
      const selectedCount = selectedIds.length
      const result = await request('/runs', { method: 'POST', body: JSON.stringify({ type: 'manual', ...(selectedCount ? { websiteIds: selectedIds } : {}) }) })
      if (result.created) {
        notifySuccess(`Run queued for ${result.total} ${selectedCount ? 'selected ' : ''}websites.`)
        setDashboard((current) => ({ ...current, stats: { ...current.stats, runProgress: { ...current.stats.runProgress, total: result.total, pending: result.total, queued: result.total, runId: result.runId } } }))
      } else notifyError(result.reason)
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

  async function connectGoogleAccount() {
    setGoogleSheetBusy(true)
    try {
      const result = await request('/google-sheets/oauth/url')
      window.location.assign(result.url)
    } catch (error) {
      notifyError(error.message)
      setGoogleSheetBusy(false)
    }
  }

  async function createGoogleResultsSheet(event) {
    event.preventDefault()
    setGoogleSheetBusy(true)
    try {
      const result = await request('/google-sheets/create', {
        method: 'POST',
        body: JSON.stringify({
          mode: googleSheetMode,
          ...(googleSheetMode === 'existing' ? { spreadsheetUrl: googleSheetUrl } : {})
        })
      })
      setGoogleSheetStatus((current) => ({ ...current, spreadsheetUrl: result.spreadsheetUrl }))
      setGoogleSheetUrl(result.spreadsheetUrl)
      setGoogleSheetMode('existing')
      setGoogleSheetSetupOpen(true)
      notifySuccess(result.created ? 'New results sheet created. New checks will sync automatically.' : 'Results sheet updated. New checks will sync automatically.')
    } catch (error) {
      notifyError(error.message)
    } finally {
      setGoogleSheetBusy(false)
    }
  }

  async function copyGoogleSheetUrl() {
    try {
      await navigator.clipboard.writeText(googleSheetStatus.spreadsheetUrl)
      notifySuccess('Google Sheet URL copied.')
    } catch (error) {
      notifyError(error.message || 'Could not copy the Google Sheet URL.')
    }
  }

  async function stopGoogleSheetSync() {
    setGoogleSheetBusy(true)
    try {
      await request('/google-sheets/sync', { method: 'DELETE' })
      setGoogleSheetStatus((current) => ({ ...current, spreadsheetUrl: null }))
      setGoogleSheetMode('new')
      setGoogleSheetSetupOpen(false)
      notifySuccess('Sheet sync stopped. Your Google Sheet was not deleted.')
    } catch (error) {
      notifyError(error.message)
    } finally {
      setGoogleSheetBusy(false)
    }
  }

  const nbCounts = summarizeResults(dashboard.websites)
  const nbProgress = dashboard.stats.runProgress || {}
  const nbWorkerOnline = dashboard.stats.worker?.status === 'online'
  const nbRunning = nbProgress.status === 'running'
  const nbRunDisabled = nbRunning || !nbWorkerOnline
  const nbRunLabel = nbRunning ? nbWorkerOnline ? 'Checks running...' : 'Waiting for worker...' : !nbWorkerOnline ? 'Worker offline' : selectedWebsiteIds.length ? `Run selected (${selectedWebsiteIds.length}) checks` : 'Run all checks'
    const nbProgressDetail = `${nbProgress.processing || 0} checking · ${nbProgress.queued || 0} queued · ${Math.max(0, (nbProgress.pending || 0) - (nbProgress.queued || 0))} waiting`
  const nbProgressTitle = nbProgress.status === 'running' ? 'Checking websites' : nbProgress.status === 'cancelled' ? 'Last run cancelled' : nbProgress.status === 'completed' ? 'All websites checked' : 'Website check progress'
  const pausedCount = dashboard.websites.filter((website) => !website.active).length
  const progressCounts = { checking: nbProgress.processing || 0, queued: nbProgress.queued || 0, waiting: Math.max(0, (nbProgress.pending || 0) - (nbProgress.queued || 0)), paused: pausedCount }
  const progressFilterCount = progressFilter ? progressCounts[progressFilter] : 0
  const progressChips = [
    { key: 'checking', label: 'checking', title: 'Show websites being checked right now' },
    { key: 'queued', label: 'queued', title: 'Show websites queued for checking' },
    { key: 'waiting', label: 'waiting', title: 'Show websites waiting for their turn' },
    { key: 'paused', label: 'paused', title: 'Show paused websites and their pause reasons' }
  ].map((chip) => ({ ...chip, count: progressCounts[chip.key] }))
  const listedWebsites = progressFilter ? dashboard.websites.filter((website) => matchesProgressFilter(website, progressFilter, progressFilterCount)) : dashboard.websites
  const navStats = [
    { key: 'tracked', label: 'Tracked', value: dashboard.stats.total, minor: true, title: 'Show all tracked websites', onClick: openWebsitesView },
    { key: 'active', label: 'Active', value: dashboard.stats.active, minor: true, title: 'Show active websites', onClick: openWebsitesView },
    { key: 'paused', label: 'Paused', value: pausedCount, minor: true, title: 'Show paused websites', onClick: () => openProgressFilter('paused') },
    { key: 'healthy', label: 'Healthy', value: nbCounts.healthy, tone: 'ok', title: 'Show healthy websites in Check results', pressed: resultsView && summaryFilter === 'healthy', onClick: () => openResultsFilter('healthy') },
    { key: 'issues', label: 'Attention', value: nbCounts.issues, tone: 'bad', title: 'Show websites that need attention', pressed: resultsView && summaryFilter === 'issues', onClick: () => openResultsFilter('issues') },
    { key: 'not-checked', label: 'Not checked', value: nbCounts.unchecked, minor: true, optional: true, title: 'Show websites not checked yet', pressed: resultsView && summaryFilter === 'not-checked', onClick: () => openResultsFilter('not-checked') },
    { key: 'cancelled', label: 'Cancelled', value: nbCounts.cancelled, minor: true, optional: true, title: 'Show websites whose check was cancelled', pressed: resultsView && summaryFilter === 'cancelled', onClick: () => openResultsFilter('cancelled') }
  ].filter((stat) => !stat.optional || stat.value > 0 || stat.pressed)
  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark')
  const signOut = () => { localStorage.removeItem('monitor_token'); setToken(null) }

  if (!token) return <main className="login-shell">
    <div className="login-panel">
      <button className="theme-toggle login-theme-toggle" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>
        {theme === 'dark' ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 15.3A9 9 0 0 1 8.7 3.6 9 9 0 1 0 20.4 15.3Z" /></svg>}
      </button>
      <span className="brand-mark login-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></svg></span>
      <h1>Sign in to Web Monitor</h1>
      <p className="muted">Track homepage uptime, SSL, and contact and news links on desktop and mobile.</p>
      <form onSubmit={login}>
        <label>Username<input value={credentials.username} onChange={(event) => setCredentials({ ...credentials, username: event.target.value })} /></label>
        <label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} disabled={loginLoading} /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)} disabled={loginLoading}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />{!showPassword && <path d="m4 4 16 16" />}</svg></button></div></label>
        <button className="primary" type="submit" disabled={loginLoading} aria-busy={loginLoading}>{loginLoading && <span className="button-spinner" aria-hidden="true" />}{loginLoading ? 'Signing in...' : 'Sign in'}</button>
      </form>
    </div>
  </main>

  return <main className="app-shell">
    <div className="topbar-wrap" ref={topbarWrapRef}>
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></svg></span>
        <div><h1>Web Monitor</h1><p>{resultsView ? 'Latest result for every website' : 'Daily health checks for your websites'}</p></div>
      </div>
      <nav className="top-nav" aria-label="Sections">
        <a href="#websites" className={!resultsView ? 'active' : ''} aria-current={!resultsView ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigateResultsView(false) }}>Websites</a>
        <a href="#check-results" className={resultsView ? 'active' : ''} aria-current={resultsView ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigateResultsView(true) }}>Check results</a>
      </nav>
      <div className="top-actions">
        <span className={`live-dot ${dashboard.stats.worker?.status === 'online' ? '' : 'worker-offline'}`}><span className="live-pulse" aria-hidden="true" /><span><span className="live-label">Worker </span>{dashboard.stats.worker?.status || 'offline'}</span></span>
        <button className="theme-toggle" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 15.3A9 9 0 0 1 8.7 3.6 9 9 0 1 0 20.4 15.3Z" /></svg>}
        </button>
        <button className="ghost sign-out" onClick={() => { localStorage.removeItem('monitor_token'); setToken(null) }}>Sign out</button>
      </div>
    </header>
    </div>
    <header className="topbar-float" ref={floatBarRef} aria-hidden="true">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></svg></span>
        <span className="float-title">Web Monitor</span>
      </div>
      <div className="nb-summary" role="group" aria-label="Monitoring summary">
        {navStats.map((stat) => <button type="button" key={stat.key} className={`nb-stat${stat.tone ? ` ${stat.tone}` : ''}${stat.minor ? ' nb-minor' : ''}`} aria-pressed={stat.pressed === undefined ? undefined : stat.pressed} title={stat.title} onClick={stat.onClick}>
          {stat.tone && <i aria-hidden="true" />}<strong>{stat.value}</strong><span>{stat.label}</span>
        </button>)}
        <button type="button" className="nb-progress" title={`${nbProgressDetail} (click to view progress)`} aria-label={`Check progress ${nbProgress.percent || 0}%. ${nbProgressDetail}`} onClick={jumpToProgress}>
          <b>{nbProgress.percent || 0}%</b><span className="nb-bar"><i style={{ width: `${nbProgress.percent || 0}%` }} /></span>
        </button>
      </div>
      <nav className="top-nav" aria-label="Sections">
        <a href="#websites" className={!resultsView ? 'active' : ''} aria-current={!resultsView ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigateResultsView(false) }}>Websites</a>
        <a href="#check-results" className={resultsView ? 'active' : ''} aria-current={resultsView ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigateResultsView(true) }}>Check results</a>
      </nav>
      <div className="nb-chips" aria-label="Quick status">
        {navStats.filter((stat) => stat.tone).map((stat) => <button type="button" key={stat.key} className={`nb-chip ${stat.tone}`} aria-label={`${stat.value} ${stat.label}`} onClick={stat.onClick}><i aria-hidden="true" />{stat.value}</button>)}
      </div>
      <button type="button" className="nb-burger" aria-label={navMenuOpen ? 'Close menu' : 'Open menu'} aria-expanded={navMenuOpen} aria-controls="nav-menu" onClick={() => setNavMenuOpen((open) => !open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{navMenuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}</svg>
      </button>
    </header>
    {navMenuOpen && <>
      <div className="nb-backdrop" onClick={() => setNavMenuOpen(false)} />
      <div className="nb-menu" id="nav-menu" role="dialog" aria-label="Navigation menu">
        <nav className="top-nav" aria-label="Sections">
          <a href="#websites" className={!resultsView ? 'active' : ''} aria-current={!resultsView ? 'page' : undefined} onClick={(event) => { event.preventDefault(); openWebsitesView() }}>Websites</a>
          <a href="#check-results" className={resultsView ? 'active' : ''} aria-current={resultsView ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigateResultsView(true); setNavMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Check results</a>
        </nav>
        <div className="nb-menu-head">
          <span>Overview</span>
          <span className={`live-dot ${nbWorkerOnline ? '' : 'worker-offline'}`}><span className="live-pulse" aria-hidden="true" /><span>Worker {dashboard.stats.worker?.status || 'offline'}</span></span>
        </div>
        <div className="nb-menu-grid">
          {navStats.map((stat) => <button type="button" key={stat.key} className={`nb-tile${stat.tone ? ` ${stat.tone}` : ''}`} aria-pressed={stat.pressed === undefined ? undefined : stat.pressed} onClick={stat.onClick}>
            <span>{stat.tone && <i aria-hidden="true" />}{stat.label}</span><strong>{stat.value}</strong>
          </button>)}
        </div>
        <div className="nb-menu-progress">
          <button type="button" className="nb-menu-progress-link" onClick={jumpToProgress}>
            <span className="nb-menu-progress-top"><span>{nbProgressTitle}</span><b>{nbProgress.percent || 0}%</b></span>
            <span className="nb-bar"><i style={{ width: `${nbProgress.percent || 0}%` }} /></span>
            <small>{nbProgress.completed || 0} of {nbProgress.total || 0} websites checked</small>
          </button>
          <div className="nb-menu-chips">{progressChips.map((chip) => <button type="button" key={chip.key} className={`progress-chip${progressFilter === chip.key ? ' active' : ''}`} aria-pressed={progressFilter === chip.key} disabled={chip.count === 0 && progressFilter !== chip.key} onClick={() => openProgressFilter(chip.key)}>{chip.count} {chip.label}</button>)}</div>
        </div>
        <button type="button" className="primary nb-menu-run" onClick={() => { setNavMenuOpen(false); runAll() }} disabled={nbRunDisabled} aria-busy={nbRunning}>{nbRunning && <span className="button-spinner" aria-hidden="true" />}{nbRunLabel}</button>
        {nbRunning && <button type="button" className="cancel-button" onClick={cancelCurrentRun} disabled={cancelingRun} aria-busy={cancelingRun}>{cancelingRun && <span className="button-spinner" aria-hidden="true" />}{cancelingRun ? 'Cancelling...' : 'Cancel run'}</button>}
        <div className="nb-menu-footer">
          <button type="button" className="nb-menu-btn" onClick={toggleTheme}><ThemeIcon theme={theme} />{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
          <button type="button" className="nb-menu-btn" onClick={signOut}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9" /></svg>Sign out</button>
        </div>
      </div>
    </>}
    {!resultsView && <section className="stats">
        <div><span>Tracked sites</span><strong>{dashboard.stats.total}</strong></div>
        <div><span>Active now</span><strong>{dashboard.stats.active}</strong></div>
        <button type="button" className="paused-stat" title="Show paused websites" aria-pressed={progressFilter === 'paused'} onClick={() => openProgressFilter('paused')}><span>Paused sites</span><strong>{pausedCount}</strong></button>
        <div><span>Healthy sites</span><strong>{dashboard.stats.healthy || 0}</strong></div>
        <div className="run-controls">
        <button className="primary run-button" onClick={runAll} disabled={dashboard.stats.runProgress?.status === 'running' || dashboard.stats.worker?.status !== 'online'} aria-busy={dashboard.stats.runProgress?.status === 'running'}>{dashboard.stats.runProgress?.status === 'running' && <span className="button-spinner" aria-hidden="true" />}{dashboard.stats.runProgress?.status === 'running' ? dashboard.stats.worker?.status === 'online' ? 'Checks running...' : 'Waiting for worker...' : dashboard.stats.worker?.status !== 'online' ? 'Worker offline' : selectedWebsiteIds.length ? `Run selected (${selectedWebsiteIds.length}) checks` : 'Run all checks'}</button>
        {dashboard.stats.runProgress?.status === 'running' && <button className="cancel-button" onClick={cancelCurrentRun} disabled={cancelingRun} aria-busy={cancelingRun}>{cancelingRun && <span className="button-spinner" aria-hidden="true" />}{cancelingRun ? 'Cancelling...' : 'Cancel run'}</button>}
        </div>
      </section>}
      <section className="run-progress" id="run-progress" aria-label="Website check progress">
      <div className="progress-heading">
        <strong>{dashboard.stats.runProgress.status === 'running' ? 'Checking websites' : dashboard.stats.runProgress.status === 'cancelled' ? 'Last run cancelled' : dashboard.stats.runProgress.status === 'completed' ? 'All websites checked' : 'Website check progress'}</strong>
        <span>{dashboard.stats.runProgress.completed} of {dashboard.stats.runProgress.total} websites checked</span>
        <b>{dashboard.stats.runProgress.percent}%</b>
      </div>
      <div className="progress-track" role="progressbar" aria-label="Check completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow={dashboard.stats.runProgress.percent}>
        <span style={{ width: `${dashboard.stats.runProgress.percent}%` }}></span>
      </div>
      <p className="progress-breakdown">{progressChips.map((chip, index) => <Fragment key={chip.key}>{index > 0 && <span aria-hidden="true"> · </span>}<button type="button" className={`progress-chip${progressFilter === chip.key ? ' active' : ''}`} aria-pressed={progressFilter === chip.key} disabled={chip.count === 0 && progressFilter !== chip.key} title={chip.title} onClick={() => openProgressFilter(chip.key)}>{chip.count} {chip.label}</button></Fragment>)}</p>
      {dashboard.stats.worker?.status !== 'online' && <p className="worker-help">Worker is offline.</p>}
    </section>
    <section className="workspace">
      <div className="main-column">
        {progressFilter && <div className="progress-filter-banner" role="status">
          <span>Showing only <strong>{progressFilter}</strong> websites{resultsView ? '' : ` (${listedWebsites.length})`}</span>
          <button type="button" onClick={() => setProgressFilter('')}>Show all</button>
        </div>}
        {!resultsView && <>
        <div className="section-heading" id="websites-list">
          <div><h2>Websites</h2><p className="muted">{dashboard.websites.length} {dashboard.websites.length === 1 ? 'site' : 'sites'}{query ? ' match your search' : ' in your inventory'}</p></div>
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
              checked={listedWebsites.length > 0 && listedWebsites.every((website) => selectedWebsiteIds.includes(website._id))}
              onChange={(event) => setSelectedWebsiteIds((current) => event.target.checked
                ? [...new Set([...current, ...listedWebsites.map((website) => website._id)])]
                : current.filter((id) => !listedWebsites.some((website) => website._id === id)))}
              disabled={loading || deletingWebsites || listedWebsites.length === 0}
            />
            <span>Select all sites</span>
          </label>
          <button className="delete-button" onClick={deleteSelectedWebsites} disabled={!selectedWebsiteIds.length || deletingWebsites} aria-busy={bulkDeleteKind === 'selected'}>{bulkDeleteKind === 'selected' && <span className="button-spinner" aria-hidden="true" />}{bulkDeleteKind === 'selected' ? 'Deleting...' : `Delete selected (${selectedWebsiteIds.length})`}</button>
          <button className="delete-button" onClick={deleteAllWebsites} disabled={deletingWebsites} aria-busy={bulkDeleteKind === 'all'}>{bulkDeleteKind === 'all' && <span className="button-spinner" aria-hidden="true" />}{bulkDeleteKind === 'all' ? 'Deleting...' : 'Delete all'}</button>
        </div>
        <div className="site-list">
          {loading ? <SiteListSkeleton /> : dashboard.websites.map((website, index) => !matchesProgressFilter(website, progressFilter, progressFilterCount) ? null : <SiteRow
            key={website._id}
            website={website}
            index={index}
            selected={selectedIdSet.has(website._id)}
            expanded={expandedWebsiteId === website._id}
            menuOpen={openSiteMenuId === website._id}
            deleting={deletingWebsites}
            busy={siteBusy[website._id] || ''}
            onToggleSelect={toggleWebsiteSelection}
            onToggleExpand={toggleWebsiteExpanded}
            onOpenActions={openWebsiteActions}
            onCloseActions={closeWebsiteActions}
            onOpenPaused={setPauseReasonWebsite}
          />)}
          {!loading && !dashboard.websites.length && <p className="muted empty">No websites yet. Add your first monitored site.</p>}
          {!loading && dashboard.websites.length > 0 && progressFilter && !listedWebsites.length && <p className="muted empty">No websites are currently {progressFilter}.</p>}
        </div>
        </>}
        {resultsView && selectedWebsiteIds.length > 0 && <div className="marked-bar" role="status">
          <span className="marked-bar-count"><i aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></i>{selectedWebsiteIds.length} marked</span>
          <div className="marked-bar-actions">
            <button type="button" className="primary" onClick={runAll} disabled={nbRunDisabled} aria-busy={nbRunning}>{nbRunning && <span className="button-spinner" aria-hidden="true" />}{nbRunning ? nbWorkerOnline ? 'Checks running...' : 'Waiting for worker...' : !nbWorkerOnline ? 'Worker offline' : `Run marked (${selectedWebsiteIds.length})`}</button>
            <button type="button" className="ghost" onClick={() => setSelectedWebsiteIds([])}>Clear marks</button>
          </div>
        </div>}
        {resultsView && <CheckReport selectedIds={selectedWebsiteIds} onToggleMark={toggleWebsiteSelection} onOpenPaused={setPauseReasonWebsite} progressFilter={progressFilter} progressFilterCount={progressFilterCount} summaryFilter={summaryFilter} setSummaryFilter={setSummaryFilter} issueFilter={issueFilter} setIssueFilter={setIssueFilter} websites={dashboard.websites} loading={loading} onOpenActions={openWebsiteActions} openSiteMenuId={openSiteMenuId} closeWebsiteActions={closeWebsiteActions} />}
        {activeMenuWebsite && siteMenuPosition && <div className={`site-actions-backdrop ${siteMenuClosing ? 'is-closing' : ''}`} onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeWebsiteActions()
        }} onWheelCapture={(event) => {
          if (!event.target.closest('.site-actions-list')) event.preventDefault()
        }} onTouchMoveCapture={(event) => {
          if (!event.target.closest('.site-actions-list')) event.preventDefault()
        }}>
          <section className="site-actions-dialog" role="dialog" aria-modal="true" aria-labelledby="site-actions-title" aria-describedby="site-actions-url">
            <header className="site-actions-heading">
              <div className="site-actions-title-group">
                <span className="site-actions-number" aria-label={`Website ${activeMenuWebsiteNumber}`}>#{String(activeMenuWebsiteNumber).padStart(2, '0')}</span>
                <div><h2 id="site-actions-title">{activeMenuWebsite.name}</h2><p id="site-actions-url">{activeMenuWebsite.url}</p></div>
              </div>
              <button className="site-actions-close" type="button" ref={siteMenuCloseButtonRef} aria-label="Close website actions" onClick={closeWebsiteActions}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            </header>
            <nav className="site-actions-list" aria-label="Website actions">
              <a href={activeMenuWebsite.url} target="_blank" rel="noreferrer" onClick={() => setOpenSiteMenuId(null)}><SiteActionIcon name="open" />Open website</a>
              <button type="button" onClick={() => runWebsiteCheck(activeMenuWebsite)} disabled={!activeMenuWebsite.active || dashboard.stats.worker?.status !== 'online' || runningWebsiteId === activeMenuWebsite._id}><SiteActionIcon name="check" />{runningWebsiteId === activeMenuWebsite._id ? 'Queueing check...' : 'Run check now'}</button>
              <button type="button" onClick={() => { toggleWebsiteSelection(activeMenuWebsite._id); closeWebsiteActions() }}><SiteActionIcon name="tick" />{selectedWebsiteIds.includes(activeMenuWebsite._id) ? 'Unmark website' : 'Mark website'}</button>
              <button type="button" onClick={() => copyWebsiteUrl(activeMenuWebsite)}><SiteActionIcon name="copy" />Copy URL</button>
              {!activeMenuWebsite.active && <button type="button" onClick={() => {
                setSiteMenuClosing(false)
                setOpenSiteMenuId(null)
                setPauseReasonWebsite(activeMenuWebsite)
              }}><SiteActionIcon name="info" />Why paused?</button>}
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
          <section className="tool-panel results-sheet-panel">
            <div className="results-sheet-header">
              <span className="results-sheet-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></svg>
              </span>
              <div><h2>Results sheet</h2><p className="panel-sub">Save every check to Google Sheets</p></div>
              {googleSheetStatus?.spreadsheetUrl && <span className="results-sheet-badge"><span />Syncing</span>}
            </div>
            {!googleSheetStatus ? <p className="muted results-sheet-copy">Checking Google Sheets connection…</p>
              : !googleSheetStatus.configured ? <p className="muted results-sheet-copy">Google Sheets is not configured on the server.</p>
                : !googleSheetStatus.connected ? <>
                  <p className="muted results-sheet-copy">Connect Google to save your website results to a sheet.</p>
                  <button className="secondary" type="button" onClick={connectGoogleAccount} disabled={googleSheetBusy}>{googleSheetBusy && <span className="button-spinner" aria-hidden="true" />}Connect Google account</button>
                </> : <>
                  <p className="results-sheet-account">Connected as <strong>{googleSheetStatus.email}</strong></p>
                  {googleSheetStatus.spreadsheetUrl && <>
                    <a className="results-sheet-open" href={googleSheetStatus.spreadsheetUrl} target="_blank" rel="noreferrer">
                      <span>Open results sheet</span><span aria-hidden="true">↗</span>
                    </a>
                    <div className="google-sheet-actions">
                      <button className="google-sheet-link-button" type="button" onClick={copyGoogleSheetUrl}>Copy link</button>
                      <button className="google-sheet-link-button" type="button" onClick={() => {
                        setGoogleSheetMode('new')
                        setGoogleSheetSetupOpen(true)
                      }}>Change destination</button>
                    </div>
                  </>}
                  {(!googleSheetStatus.spreadsheetUrl || googleSheetSetupOpen) && <>
                    <p className="results-sheet-copy">{googleSheetStatus.spreadsheetUrl ? 'Choose a new destination' : 'Choose where to save results'}</p>
                    <div className="google-sheet-choices">
                      <button className={googleSheetMode === 'new' ? 'selected' : ''} type="button" onClick={() => setGoogleSheetMode('new')} disabled={googleSheetBusy}>New sheet</button>
                      <button className={googleSheetMode === 'existing' ? 'selected' : ''} type="button" onClick={() => {
                        setGoogleSheetMode('existing')
                        if (googleSheetStatus.spreadsheetUrl) setGoogleSheetUrl(googleSheetStatus.spreadsheetUrl)
                      }} disabled={googleSheetBusy}>Existing sheet</button>
                    </div>
                    <form onSubmit={createGoogleResultsSheet} aria-busy={googleSheetBusy}>
                      {googleSheetMode === 'existing' && <>
                        <div className="google-sheet-url-input">
                          <input required type="url" aria-label="Existing Google Sheets URL" placeholder="Paste Google Sheets link" value={googleSheetUrl} onChange={(event) => setGoogleSheetUrl(event.target.value)} disabled={googleSheetBusy} />
                          {googleSheetUrl && <button className="google-sheet-url-clear" type="button" aria-label="Clear Google Sheets URL" title="Clear URL" onClick={() => setGoogleSheetUrl('')} disabled={googleSheetBusy}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg></button>}
                        </div>
                        <small className="muted">Paste a spreadsheet link with edit access. Results go to a separate date-named tab each day; only that day’s results are replaced. Older tabs stay unchanged.</small>
                      </>}
                      <button className="secondary" type="submit" disabled={googleSheetBusy || loading || dashboard.websites.length === 0} title={!dashboard.websites.length ? 'Add at least one website first' : undefined} aria-busy={googleSheetBusy}>{googleSheetBusy && <span className="button-spinner" aria-hidden="true" />}{googleSheetBusy ? 'Saving…' : googleSheetMode === 'new' ? 'Create new sheet' : 'Use this sheet'}</button>
                      {!loading && dashboard.websites.length === 0 && <small className="muted">Add at least one website before saving results to a sheet.</small>}
                      {googleSheetStatus.spreadsheetUrl && <button className="google-sheet-cancel" type="button" onClick={() => setGoogleSheetSetupOpen(false)} disabled={googleSheetBusy}>Cancel</button>}
                    </form>
                  </>}
                  {googleSheetStatus.spreadsheetUrl && <button className="google-sheet-stop" type="button" onClick={stopGoogleSheetSync} disabled={googleSheetBusy} aria-busy={googleSheetBusy}>{googleSheetBusy && <span className="button-spinner" aria-hidden="true" />}{googleSheetBusy ? 'Please wait...' : 'Stop syncing'}</button>}
                </>}
          </section>
          <section className="tool-panel"><h2>Add a website</h2><form onSubmit={addWebsite} aria-busy={addingWebsite}><input placeholder="Display name (optional)" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={addingWebsite} /><input required placeholder="https://example.com" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} disabled={addingWebsite} /><button className="secondary" type="submit" disabled={addingWebsite} aria-busy={addingWebsite}>{addingWebsite && <span className="button-spinner" aria-hidden="true" />}{addingWebsite ? 'Adding website...' : 'Add website'}</button></form></section>
          <section className="tool-panel"><h2>Paste a list of URLs</h2><form onSubmit={importUrls} aria-busy={importingUrls}><textarea rows="5" placeholder={'One URL per line\nName | https://example.com'} value={bulk} onChange={(event) => setBulk(event.target.value)} disabled={importingUrls} /><button className="secondary" type="submit" disabled={importingUrls} aria-busy={importingUrls}>{importingUrls && <span className="button-spinner" aria-hidden="true" />}{importingUrls ? 'Importing websites...' : 'Import valid URLs'}</button></form></section>
          <section className="tool-panel"><h2>Import from Google Sheets</h2><form onSubmit={importSheet} aria-busy={Boolean(sheetImportStatus)}><input required type="url" placeholder="Paste Google Sheet URL" value={sheetUrl} onChange={(event) => setSheetUrl(event.target.value)} disabled={Boolean(sheetImportStatus)} /><small className="muted">Set sharing to Anyone with the link, Viewer. Add a gid to choose a tab. Without a gid, the “All site(s)” tab is preferred; otherwise the first tab is used.</small><button className="secondary" type="submit" disabled={Boolean(sheetImportStatus)} aria-busy={Boolean(sheetImportStatus)}>{sheetImportStatus && <span className="button-spinner" aria-hidden="true" />}{sheetImportStatus === 'fetching' ? 'Reading Google Sheet...' : sheetImportStatus === 'saving' ? 'Adding websites...' : 'Import from Google Sheet'}</button></form></section>
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
    <PauseWebsiteDialog
      key={pauseWebsite?._id || 'pause-closed'}
      website={pauseWebsite}
      onCancel={closePauseDialog}
      onSubmit={submitPauseReason}
    />
    <PauseReasonDialog
      website={pauseReasonWebsite}
      onClose={closePauseReason}
      onResume={toggleWebsite}
    />
  </main>
}

export default App