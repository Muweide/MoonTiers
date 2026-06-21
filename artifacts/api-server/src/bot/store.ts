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

const queues = new Map<string, Map<Kit, QueueState>>();
const userProfiles = new Map<string, Map<string, UserProfile>>();

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
