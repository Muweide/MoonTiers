export const KITS = ['uhc', 'sword', 'mace', 'diapot', 'nethpot', 'smp', 'crystal', 'axe'] as const;
export type Kit = typeof KITS[number];

export const KIT_DISPLAY: Record<Kit, string> = {
  uhc: 'UHC',
  sword: 'Sword',
  mace: 'Mace',
  diapot: 'Diapot',
  nethpot: 'Nethpot',
  smp: 'SMP',
  crystal: 'Crystal',
  axe: 'Axe',
};

export const KIT_EMOJI: Record<Kit, string> = {
  uhc: '⚔️',
  sword: '🗡️',
  mace: '🔨',
  diapot: '💊',
  nethpot: '🧪',
  smp: '🌍',
  crystal: '💎',
  axe: '🪓',
};

export const TIERS = ['lt5', 'ht5', 'lt4', 'ht4', 'lt3', 'ht3', 'lt2', 'ht2', 'lt1', 'ht1'] as const;
export type Tier = typeof TIERS[number];

export const TIER_DISPLAY: Record<Tier, string> = {
  lt5: 'Low Tier 5',
  ht5: 'High Tier 5',
  lt4: 'Low Tier 4',
  ht4: 'High Tier 4',
  lt3: 'Low Tier 3',
  ht3: 'High Tier 3',
  lt2: 'Low Tier 2',
  ht2: 'High Tier 2',
  lt1: 'Low Tier 1',
  ht1: 'High Tier 1',
};

export const WAITLIST_CHANNEL_PATTERN = /^(?:.*\|)?(.+)-waitlist$/;

export function getKitFromChannelName(channelName: string): Kit | null {
  const clean = channelName.replace(/[^\w-]/g, '').toLowerCase();
  const match = clean.match(/^(.+)-waitlist$/);
  if (!match) return null;
  const kitName = match[1] as Kit;
  return KITS.includes(kitName) ? kitName : null;
}

export const MAX_QUEUE = 20;

export const VERIFIED_TESTER_ROLE = 'Verified Tester';

export const RESULTS_CHANNEL_KEY = 'results';
export const HIGH_RESULTS_CHANNEL_KEY = 'high-results';

export interface ChannelDef {
  name: string;
  category: string;
}

export const CHANNELS_TO_CREATE: ChannelDef[] = [
  { name: '🏆｜high-results',       category: 'Results'   },
  { name: '🏆｜results',            category: 'Results'   },
  { name: '📋｜forum-posting',      category: 'Results'   },

  { name: '💬｜general',            category: 'General'   },
  { name: '📺｜media',              category: 'General'   },
  { name: '🐾｜pets',               category: 'General'   },
  { name: '🚩｜your-videos',        category: 'General'   },
  { name: '🔧｜commands-music',     category: 'General'   },

  { name: '🔔｜poll-pings',         category: 'Fun'       },
  { name: '📊｜poll-of-the-day',    category: 'Fun'       },
  { name: '💬｜poll-discuss',       category: 'Fun'       },

  { name: '✉️｜request-test',       category: 'Requests'  },
  { name: '🗺️｜request-support',   category: 'Requests'  },
  { name: '❌｜report-staff',       category: 'Requests'  },

  { name: 'faq',                     category: 'Server'    },
  { name: '📕｜server-rules',       category: 'Server'    },
  { name: '📢｜announcements',      category: 'Server'    },
  { name: '❗｜advertisement',      category: 'Server'    },
  { name: '💗｜kindness',           category: 'Server'    },

  { name: '🎉｜booster-alerts',     category: 'Boosters'  },
  { name: '✨｜booster-perks',      category: 'Boosters'  },
  { name: '🌐｜subtiers-discords',  category: 'Boosters'  },
  { name: '🌐｜mctiers-discords',   category: 'Boosters'  },

  { name: '📖｜ranked-rubric',      category: 'Tierlist'  },
  { name: '📖｜ranked-ruleset',     category: 'Tierlist'  },
  { name: '❌｜punishments',        category: 'Tierlist'  },
  { name: '🏅｜testing-leaderboard', category: 'Tierlist' },
];

export const KIT_WAITLIST_CHANNELS: ChannelDef[] = KITS.map((kit) => ({
  name: `${KIT_EMOJI[kit]}｜${kit}-waitlist`,
  category: 'Waitlists',
}));

export const CATEGORIES = [
  'Results',
  'General',
  'Fun',
  'Requests',
  'Server',
  'Boosters',
  'Tierlist',
  'Waitlists',
  'Tickets',
];
