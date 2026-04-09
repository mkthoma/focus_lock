/**
 * PolicyEngine — resolves whether a hostname is ALLOW or DRIFT_WARN
 * for a given session mode. O(1) Set-based lookups.
 */

/**
 * Strip subdomains from a hostname, returning the root eTLD+1.
 * e.g. "www.reddit.com" → "reddit.com", "mail.google.com" → "google.com"
 * Handles special two-part TLDs like co.uk, com.au by checking known patterns.
 */
export function extractRootDomain(hostname) {
  if (!hostname) return '';

  // Remove port if present
  hostname = hostname.split(':')[0].toLowerCase();

  // Skip non-web schemes
  if (!hostname || hostname === 'localhost') return hostname;

  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;

  // Two-part TLD patterns: co.uk, com.au, org.uk, net.au, gov.uk etc.
  const knownTwoPart = new Set([
    'co.uk', 'co.nz', 'co.za', 'co.jp', 'co.in', 'co.kr',
    'com.au', 'com.br', 'com.mx', 'com.sg', 'com.hk',
    'org.uk', 'org.au', 'net.au', 'gov.uk', 'ac.uk'
  ]);

  const lastTwo = parts.slice(-2).join('.');
  if (knownTwoPart.has(lastTwo) && parts.length > 2) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

/**
 * Build Set instances from the stored arrays for fast lookup.
 * @param {Object} modeConfig - settings.modes[modeKey]
 */
export function buildPolicySets(modeConfig) {
  return {
    allowlist: new Set((modeConfig.allowlist ?? []).map(d => d.toLowerCase())),
    blocklist: new Set((modeConfig.blocklist ?? []).map(d => d.toLowerCase()))
  };
}

/**
 * Resolve policy for a hostname given the active mode config.
 * @param {string} hostname - raw hostname from a URL
 * @param {Object} modeConfig - settings.modes[activeMode] with allowlist/blocklist arrays
 * @param {string[]} globalBlocklist - seed blocklist array
 * @param {string[]} sessionExceptions - domains allowed just for this session
 * @returns {'ALLOW' | 'DRIFT_WARN'}
 */
export function resolvePolicy(hostname, modeConfig, globalBlocklist = [], sessionExceptions = []) {
  const domain = extractRootDomain(hostname);
  if (!domain) return 'ALLOW';

  const exceptionsSet = new Set(sessionExceptions.map(d => d.toLowerCase()));
  if (exceptionsSet.has(domain)) return 'ALLOW';

  const { allowlist, blocklist } = buildPolicySets(modeConfig);

  // Deep Work / allowlist-first logic
  if (allowlist.size > 0) {
    return allowlist.has(domain) ? 'ALLOW' : 'DRIFT_WARN';
  }

  // Shallow Work / blocklist logic — also check seed blocklist
  const seedSet = new Set(globalBlocklist.map(d => d.toLowerCase()));
  if (blocklist.has(domain) || seedSet.has(domain)) return 'DRIFT_WARN';

  return 'ALLOW';
}

/**
 * Returns true if the URL is an internal Chrome / extension URL that
 * should never be intercepted.
 */
export function isInternalUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://') ||
    url.startsWith('devtools://') ||
    url.startsWith('file://')
  );
}
