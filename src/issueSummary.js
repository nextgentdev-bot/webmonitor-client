const errorSummaries = {
  ERR_CONNECTION_REFUSED: 'Connection refused.',
  ERR_CONNECTION_RESET: 'Connection interrupted.',
  ERR_CONNECTION_TIMED_OUT: 'Connection timed out.',
  ERR_TIMED_OUT: 'Connection timed out.',
  ERR_NAME_NOT_RESOLVED: 'Domain name not found.',
  ERR_CERT_AUTHORITY_INVALID: 'SSL certificate is not trusted.',
  ERR_CERT_COMMON_NAME_INVALID: 'SSL certificate does not match the domain.',
  ERR_CERT_DATE_INVALID: 'SSL certificate has expired or is not yet valid.',
  ERR_SSL_PROTOCOL_ERROR: 'SSL connection failed.',
  ERR_TOO_MANY_REDIRECTS: 'Too many redirects.'
}

export function summarizeIssue(issue) {
  const text = String(issue || '')
  const menuLocation = text.match(/^((?:Desktop|Mobile) (?:Contact|News)):\s*/i)
  const location = menuLocation ? menuLocation[1] : /^Main website/i.test(text) ? 'Homepage' : 'Website'
  const errorCode = text.match(/\b(?:net::)?(ERR_[A-Z0-9_]+)\b/i)?.[1]?.toUpperCase()
  let detail = errorSummaries[errorCode]

  if (!detail && /\bHTTP\s+\d{3}\b/i.test(text)) {
    detail = `HTTP ${text.match(/\bHTTP\s+(\d{3})\b/i)[1]} error.`
  }
  if (!detail && /not added|missing/i.test(text)) detail = 'Not found in the menu.'
  if (!detail && /menu could not be opened/i.test(text)) detail = 'Menu could not be opened.'
  if (!detail && /could not be opened|unable to open/i.test(text)) detail = 'Could not be reached.'
  if (!detail && /timed?\s*out|timeout|took longer than/i.test(text)) detail = 'Request timed out.'
  if (!detail && /ssl|certificate/i.test(text)) detail = 'SSL certificate problem.'
  if (!detail && /is slow/i.test(text)) detail = 'Slow response.'

  if (!detail) {
    detail = text
      .split(/\n\s*Call log:/i)[0]
      .replace(/^Main website[^:]*:\s*/i, '')
      .replace(/^Mobile homepage could not be opened:\s*/i, '')
      .replace(/page\.\w+:\s*/i, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!detail || detail.length > 100) detail = 'Check failed.'
    if (!/[.!?]$/.test(detail)) detail += '.'
  }

  return `${location}: ${detail}`
}
