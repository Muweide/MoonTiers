import type { Kit, Tier } from './constants.js';

export interface Player {
  userId: string;
  ign: string;
  currentTier: Tier | null;
  server: string;
  joinedAt: Date;
}

export interface QueueState {
  isOpen: boolean;
  kit: Kit;
  messageId: string | null;
  channelId: string;
  players: Player[];
  activeTesters: string[];
  currentlyTesting: Player | null;
  ticketChannelId: string | null;
  testerUserId: string | null;
  lastSessionTime: Date | null;
}

export interface UserProfile {
  ign: string;
  server: string;
  tierPerKit: Map<Kit, Tier>;
  discordId: string;
}

export interface TesterStat {
  userId: string;
  username: string;
  testCount: number;
}

export interface LeaderboardEntry {
  ign: string;
  tierPerKit: Map<Kit, Tier>;
  updatedAt: Date;
}

const queues = new Map<string, Map<Kit, QueueState>>();
const userProfiles = new Map<string, Map<string, UserProfile>>();
const testerStats = new Map<string, Map<string, TesterStat>>();
const leaderboard = new Map<string, Map<string, LeaderboardEntry>>();

export function getGuildQueues(guildId: string): Map<Kit, QueueState> {
  if (!queues.has(guildId)) queues.set(guildId, new Map());
  return queues.get(guildId)!;
}
export function getQueue(guildId: string, kit: Kit): QueueState | undefined {
  return getGuildQueues(guildId).get(kit);
}
export function setQueue(guildId: string, kit: Kit, state: QueueState): void {
  getGuildQueues(guildId).set(kit, state);
}

export function getUserProfile(guildId: string, userId: string): UserProfile | undefined {
  return userProfiles.get(guildId)?.get(userId);
}
export function setUserProfile(guildId: string, userId: string, profile: UserProfile): void {
  if (!userProfiles.has(guildId)) userProfiles.set(guildId, new Map());
  userProfiles.get(guildId)!.set(userId, profile);
}

export function incrementTesterStat(guildId: string, userId: string, username: string): void {
  if (!testerStats.has(guildId)) testerStats.set(guildId, new Map());
  const guildStats = testerStats.get(guildId)!;
  const existing = guildStats.get(userId);
  if (existing) { existing.testCount++; existing.username = username; }
  else guildStats.set(userId, { userId, username, testCount: 1 });
}
export function getTopTesters(guildId: string, limit = 5): TesterStat[] {
  const guildStats = testerStats.get(guildId);
  if (!guildStats) return [];
  return [...guildStats.values()].sort((a, b) => b.testCount - a.testCount).slice(0, limit);
}

export function getLeaderboard(guildId: string): Map<string, LeaderboardEntry> {
  if (!leaderboard.has(guildId)) leaderboard.set(guildId, new Map());
  return leaderboard.get(guildId)!;
}
export function setLeaderboardEntry(guildId: string, ign: string, kit: Kit, tier: Tier): void {
  const lb = getLeaderboard(guildId);
  const existing = lb.get(ign.toLowerCase());
  if (existing) {
    existing.tierPerKit.set(kit, tier);
    existing.updatedAt = new Date();
  } else {
    lb.set(ign.toLowerCase(), { ign, tierPerKit: new Map([[kit, tier]]), updatedAt: new Date() });
  }
}
export function removeLeaderboardEntry(guildId: string, ign: string): boolean {
  return getLeaderboard(guildId).delete(ign.toLowerCase());
}
