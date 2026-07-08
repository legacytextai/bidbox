/**
 * Platform Detection for One Link
 * Detects which procurement portal a URL belongs to
 */

export type PortalType =
  | 'caltrans'
  | 'planetbids'
  | 'epro'
  | 'ersp'
  | 'bonfirehub'
  | 'ramp'
  | 'lacounty_dpw'
  | 'lacmta'
  | 'caleprocure'
  | 'opengov'
  | 'unknown';

interface PortalPattern {
  type: PortalType;
  patterns: RegExp[];
}

const PORTAL_PATTERNS: PortalPattern[] = [
  {
    type: 'caltrans',
    patterns: [
      /ppmoe\.dot\.ca\.gov/i,
      /dot\.ca\.gov.*(?:bid|project|advertisement)/i,
      /caltrans/i,
    ],
  },
  {
    type: 'planetbids',
    patterns: [
      /planetbids\.com/i,
      /vendors\.planetbids\.com/i,
    ],
  },
  {
    type: 'epro',
    patterns: [
      /epro\.[a-z]+\.gov/i,
      /epro.*sbcounty/i,
    ],
  },
  {
    type: 'ersp',
    patterns: [
      /ersp\.ladwp\.com/i,
      /ladwp.*ersp/i,
    ],
  },
  {
    type: 'bonfirehub',
    patterns: [
      /bonfirehub\.com/i,
      /\.bonfirehub\./i,
    ],
  },
  {
    type: 'ramp',
    patterns: [
      /rampla\.org/i,
      /ramp.*la/i,
    ],
  },
  {
    type: 'lacounty_dpw',
    patterns: [
      /dpw\.lacounty\.gov/i,
    ],
  },
  {
    type: 'lacmta',
    patterns: [
      /business\.metro\.net/i,
    ],
  },
  {
    type: 'caleprocure',
    patterns: [
      /caleprocure\.ca\.gov/i,
    ],
  },
  {
    type: 'opengov',
    patterns: [
      /procurement\.opengov\.com/i,
      /\.opengov\.com.*(?:procurement|project|portal)/i,
    ],
  },
];

/**
 * Detect portal type from URL
 */
export function detectPortalType(url: string): PortalType {
  const normalizedUrl = url.toLowerCase();
  
  for (const portal of PORTAL_PATTERNS) {
    for (const pattern of portal.patterns) {
      if (pattern.test(normalizedUrl)) {
        return portal.type;
      }
    }
  }
  
  return 'unknown';
}

/**
 * Get display name for portal type
 */
export function getPortalDisplayName(type: PortalType): string {
  const names: Record<PortalType, string> = {
    caltrans: 'Caltrans',
    planetbids: 'PlanetBids',
    epro: 'EPRO',
    ersp: 'ERSP (LADWP)',
    bonfirehub: 'BonfireHub',
    ramp: 'RAMP LA',
    lacounty_dpw: 'LA County DPW',
    lacmta: 'LA Metro',
    caleprocure: 'Cal eProcure',
    opengov: 'OpenGov',
    unknown: 'External Source',
  };
  return names[type];
}

/**
 * Check if URL is a valid project URL (basic validation)
 */
export function isValidProjectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
