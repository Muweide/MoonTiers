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

export const WAITLIST_CHANNEL_PATTERN = /^(.+)-waitlist$/;

export function getKitFromChannelName(channelName: string): Kit | null {
  const match = channelName.match(WAITLIST_CHANNEL_PATTERN);
  if (!match) return null;
  const kitName = match[1] as Kit;
  return KITS.includes(kitName) ? kitName : null;
}

export const MAX_QUEUE = 20;

export const VERIFIED_TESTER_ROLE = 'Verified Tester';
export const RESULTS_CHANNEL = 'results';
export const HIGH_RESULTS_CHANNEL = 'high-results';

export const CATEGORY_NAMES = {
  tierlist: 'Tierlist',
  waitlists: 'Waitlists',
  tickets: 'Tickets',
  results: 'Results',
  general: 'General',
  server: 'Server',
};

export const STANDARD_CHANNELS = [
  { name: 'results', category: 'Results' },
  { name: 'high-results', category: 'Results' },
  { name: 'ranked-rubric', category: 'Tierlist' },
  { name: 'ranked-ruleset', category: 'Tierlist' },
  { name: 'testing-leaderboard', category: 'Tierlist' },
  { name: 'request-test', category: 'Waitlists' },
  { name: 'general', category: 'General' },
  { name: 'announcements', category: 'General' },
];
