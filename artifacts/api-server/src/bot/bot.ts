import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events,
  PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, TextChannel, GuildMember, EmbedBuilder,
  ButtonInteraction, ChatInputCommandInteraction, ModalSubmitInteraction, Message,
} from 'discord.js';
import { logger } from '../lib/logger.js';
import {
  KITS, TIERS, KIT_DISPLAY, TIER_DISPLAY, VERIFIED_TESTER_ROLE,
  RESULTS_CHANNEL_KEY, HIGH_RESULTS_CHANNEL_KEY, MAX_QUEUE,
  CATEGORIES, CHANNELS_TO_CREATE, KIT_WAITLIST_CHANNELS,
  getKitFromChannelName, type Kit, type Tier,
} from './constants.js';
import {
  getQueue, setQueue, getUserProfile, setUserProfile,
  incrementTesterStat, getTopTesters, getLeaderboard,
  setLeaderboardEntry, removeLeaderboardEntry,
  type Player, type QueueState,
} from './store.js';
import {
  buildQueueEmbed, buildQueueRow, buildClosedEmbed, buildResultEmbed,
  buildVerifyEmbed, buildVerifyRow, buildTesterLeaderboardEmbed, buildPlayerLeaderboardEmbed,
} from './embeds.js';

const TOKEN = process.env['DISCORD_BOT_TOKEN'];
if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
  ],
});

// Per-guild pinned leaderboard message IDs in testing-leaderboard channel
interface GuildLBMsgs { channelId: string; playerMsgId: string | null; testerMsgId: string | null; }
const guildLeaderboardMsgs = new Map<string, GuildLBMsgs>();

// Track manually-posted leaderboard messages for /leaderboard show & /testerleaderboard
const liveLeaderboards = new Map<string, { msg: Message; type: 'tester' | 'player'; guildId: string }>();

async function getOrPostLeaderboards(guild: import('discord.js').Guild): Promise<void> {
  const lbChannel = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name.toLowerCase().includes('testing-leaderboard'),
  ) as TextChannel | undefined;
  if (!lbChannel) return;

  let entry = guildLeaderboardMsgs.get(guild.id);
  if (!entry) {
    entry = { channelId: lbChannel.id, playerMsgId: null, testerMsgId: null };
    guildLeaderboardMsgs.set(guild.id, entry);
  }

  // Player leaderboard
  const lb = getLeaderboard(guild.id);
  const playerEmbed = buildPlayerLeaderboardEmbed([...lb.values()]);
  if (entry.playerMsgId) {
    const existing = await lbChannel.messages.fetch(entry.playerMsgId).catch(() => null);
    if (existing) { await existing.edit({ embeds: [playerEmbed] }); }
    else { const m = await lbChannel.send({ embeds: [playerEmbed] }); entry.playerMsgId = m.id; }
  } else {
    const m = await lbChannel.send({ embeds: [playerEmbed] });
    entry.playerMsgId = m.id;
  }

  // Tester leaderboard
  const testerEmbed = buildTesterLeaderboardEmbed(getTopTesters(guild.id));
  if (entry.testerMsgId) {
    const existing = await lbChannel.messages.fetch(entry.testerMsgId).catch(() => null);
    if (existing) { await existing.edit({ embeds: [testerEmbed] }); }
    else { const m = await lbChannel.send({ embeds: [testerEmbed] }); entry.testerMsgId = m.id; }
  } else {
    const m = await lbChannel.send({ embeds: [testerEmbed] });
    entry.testerMsgId = m.id;
  }
}

async function refreshGuildLeaderboards(guildId: string): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (guild) await getOrPostLeaderboards(guild).catch(() => {});
}

function hasVerifiedTester(member: GuildMember): boolean {
  return member.roles.cache.some((r) => r.name === VERIFIED_TESTER_ROLE);
}
function hasAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}
function findChannelByKey(guild: import('discord.js').Guild, key: string): TextChannel | undefined {
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name.toLowerCase().includes(key.toLowerCase()),
  ) as TextChannel | undefined;
}

async function refreshQueueMessage(channel: TextChannel, state: QueueState): Promise<void> {
  const embed = buildQueueEmbed(state);
  const row = buildQueueRow(state.kit, state.players.length >= MAX_QUEUE);
  try {
    if (state.messageId) {
      const msg = await channel.messages.fetch(state.messageId).catch(() => null);
      if (msg) { await msg.edit({ embeds: [embed], components: [row] }); return; }
    }
    const msg = await channel.send({ embeds: [embed], components: [row] });
    state.messageId = msg.id;
  } catch (e) { logger.error({ e }, 'Failed to refresh queue message'); }
}

// Auto-refresh every 10 seconds: pinned channel boards + manually-posted boards
setInterval(async () => {
  // Refresh pinned leaderboards in testing-leaderboard channels
  for (const guild of client.guilds.cache.values()) {
    await refreshGuildLeaderboards(guild.id).catch(() => {});
  }
  // Refresh manually-posted /leaderboard show & /testerleaderboard messages
  for (const [msgId, entry] of liveLeaderboards) {
    try {
      let embed: EmbedBuilder;
      if (entry.type === 'tester') {
        embed = buildTesterLeaderboardEmbed(getTopTesters(entry.guildId));
      } else {
        const lb = getLeaderboard(entry.guildId);
        embed = buildPlayerLeaderboardEmbed([...lb.values()]);
      }
      await entry.msg.edit({ embeds: [embed] });
    } catch { liveLeaderboards.delete(msgId); }
  }
}, 10_000);

const commands = [
  new SlashCommandBuilder().setName('open')
    .setDescription('Öffnet die Queue (nur Verified Tester)').toJSON(),

  new SlashCommandBuilder().setName('close')
    .setDescription('Schließt die Queue (nur Verified Tester)').toJSON(),

  new SlashCommandBuilder().setName('next')
    .setDescription('Nächsten Spieler aufrufen (nur Verified Tester)').toJSON(),

  new SlashCommandBuilder().setName('skip')
    .setDescription('Spieler überspringen (nur Verified Tester)')
    .addIntegerOption((o) =>
      o.setName('position').setDescription('Position in der Queue (Standard: 1)').setRequired(false).setMinValue(1).setMaxValue(20),
    ).toJSON(),

  new SlashCommandBuilder().setName('result')
    .setDescription('Test-Ergebnis posten (nur Verified Tester)')
    .addStringOption((o) =>
      o.setName('tier').setDescription('Tier des Spielers').setRequired(true)
        .addChoices(...TIERS.map((t) => ({ name: TIER_DISPLAY[t], value: t }))),
    )
    .addUserOption((o) =>
      o.setName('tester').setDescription('Der Tester (dich selbst pingen)').setRequired(true),
    ).toJSON(),

  new SlashCommandBuilder().setName('verify')
    .setDescription('Zeigt das Waitlist Embed an (nur Admin *)').toJSON(),

  new SlashCommandBuilder().setName('createchannel')
    .setDescription('Erstellt alle Channels und Rollen (nur Admin *)').toJSON(),

  new SlashCommandBuilder().setName('tester')
    .setDescription('Tester Queue Commands')
    .addSubcommand((s) => s.setName('join').setDescription('Als Tester der Queue beitreten'))
    .addSubcommand((s) => s.setName('leave').setDescription('Als Tester die Queue verlassen'))
    .toJSON(),

  new SlashCommandBuilder().setName('testerleaderboard')
    .setDescription('Top 5 Tester Leaderboard mit Auto-Refresh (nur Admin *)').toJSON(),

  new SlashCommandBuilder().setName('leaderboard')
    .setDescription('Player Leaderboard (nur Admin *)')
    .addSubcommand((s) =>
      s.setName('show').setDescription('Leaderboard anzeigen'),
    )
    .addSubcommand((s) =>
      s.setName('add').setDescription('Spieler hinzufügen/aktualisieren')
        .addStringOption((o) => o.setName('ign').setDescription('Minecraft Username').setRequired(true))
        .addStringOption((o) =>
          o.setName('kit').setDescription('Kit').setRequired(true)
            .addChoices(...KITS.map((k) => ({ name: KIT_DISPLAY[k], value: k }))),
        )
        .addStringOption((o) =>
          o.setName('tier').setDescription('Tier').setRequired(true)
            .addChoices(...TIERS.map((t) => ({ name: TIER_DISPLAY[t], value: t }))),
        ),
    )
    .addSubcommand((s) =>
      s.setName('remove').setDescription('Spieler entfernen')
        .addStringOption((o) => o.setName('ign').setDescription('Minecraft Username').setRequired(true)),
    )
    .toJSON(),
];

async function registerCommands(clientId: string): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(TOKEN!);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  logger.info('Slash commands registered globally');
}

client.once(Events.ClientReady, async (c) => {
  logger.info({ tag: c.user.tag }, 'Discord bot ready');
  await registerCommands(c.user.id);
  // Initialize pinned leaderboards in all guilds
  for (const guild of c.guilds.cache.values()) {
    await getOrPostLeaderboards(guild).catch(() => {});
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isButton()) await handleButton(interaction);
    else if (interaction.isModalSubmit()) await handleModal(interaction);
  } catch (err) {
    logger.error({ err }, 'Interaction error');
    const msg = { content: '❌ Ein Fehler ist aufgetreten.', ephemeral: true };
    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
  }
});

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName, guild, member, channel } = interaction;
  if (!guild || !member || !channel) {
    await interaction.reply({ content: '❌ Nur in Servern nutzbar.', ephemeral: true });
    return;
  }
  const guildMember = member as GuildMember;

  // ── /open ──────────────────────────────────────────────────────────────────
  if (commandName === 'open') {
    if (!hasVerifiedTester(guildMember)) {
      await interaction.reply({ content: '❌ Du brauchst die **Verified Tester** Rolle.', ephemeral: true });
      return;
    }
    const kit = getKitFromChannelName(channel.name);
    if (!kit) {
      await interaction.reply({ content: '❌ Benutze diesen Command in einem Kit-Waitlist-Channel.', ephemeral: true });
      return;
    }
    const existing = getQueue(guild.id, kit);
    if (existing?.isOpen) {
      await interaction.reply({ content: `❌ Die **${KIT_DISPLAY[kit]}** Queue ist bereits offen.`, ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const tc = channel as TextChannel;
    if (existing?.messageId) {
      const old = await tc.messages.fetch(existing.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }
    const state: QueueState = {
      isOpen: true, kit, messageId: null, channelId: channel.id,
      players: [], activeTesters: [interaction.user.id],
      currentlyTesting: null, ticketChannelId: null,
      testerUserId: interaction.user.id, lastSessionTime: new Date(),
    };
    setQueue(guild.id, kit, state);
    await tc.send({ content: '@here' });
    await refreshQueueMessage(tc, state);
    setQueue(guild.id, kit, state);
    await interaction.editReply({ content: `✅ **${KIT_DISPLAY[kit]}** Queue geöffnet!` });
  }

  // ── /close ─────────────────────────────────────────────────────────────────
  else if (commandName === 'close') {
    if (!hasVerifiedTester(guildMember)) {
      await interaction.reply({ content: '❌ Du brauchst die **Verified Tester** Rolle.', ephemeral: true });
      return;
    }
    const kit = getKitFromChannelName(channel.name);
    if (!kit) {
      await interaction.reply({ content: '❌ Benutze diesen Command in einem Kit-Waitlist-Channel.', ephemeral: true });
      return;
    }
    const state = getQueue(guild.id, kit);
    if (!state?.isOpen) {
      await interaction.reply({ content: `❌ Die **${KIT_DISPLAY[kit]}** Queue ist nicht offen.`, ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const tc = channel as TextChannel;
    if (state.messageId) {
      const old = await tc.messages.fetch(state.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }
    const closedMsg = await tc.send({ embeds: [buildClosedEmbed(kit, state.lastSessionTime)] });
    state.isOpen = false; state.messageId = closedMsg.id;
    state.players = []; state.activeTesters = []; state.currentlyTesting = null;
    setQueue(guild.id, kit, state);
    await interaction.editReply({ content: `✅ **${KIT_DISPLAY[kit]}** Queue geschlossen.` });
  }

  // ── /next ──────────────────────────────────────────────────────────────────
  else if (commandName === 'next') {
    if (!hasVerifiedTester(guildMember)) {
      await interaction.reply({ content: '❌ Du brauchst die **Verified Tester** Rolle.', ephemeral: true });
      return;
    }
    const kit = getKitFromChannelName(channel.name);
    if (!kit) { await interaction.reply({ content: '❌ Nur in Kit-Waitlist-Channels.', ephemeral: true }); return; }
    const state = getQueue(guild.id, kit);
    if (!state?.isOpen) { await interaction.reply({ content: '❌ Queue nicht offen.', ephemeral: true }); return; }
    if (state.players.length === 0) { await interaction.reply({ content: '❌ Queue ist leer.', ephemeral: true }); return; }

    await interaction.deferReply({ ephemeral: true });
    const nextPlayer = state.players.shift()!;
    state.currentlyTesting = nextPlayer;
    state.testerUserId = interaction.user.id;

    const ticketCategory = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === 'Tickets',
    );
    const perms: import('discord.js').OverwriteResolvable[] = [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: nextPlayer.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ];
    for (const id of state.activeTesters) {
      if (id !== interaction.user.id)
        perms.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }
    const ticketChannel = await guild.channels.create({
      name: `ticket-${nextPlayer.ign.toLowerCase()}-${kit}`,
      type: ChannelType.GuildText,
      parent: ticketCategory?.id,
      permissionOverwrites: perms,
    }) as TextChannel;

    const tierStr = nextPlayer.currentTier ? TIER_DISPLAY[nextPlayer.currentTier] : 'N/A';
    await ticketChannel.send({
      content: `<@${nextPlayer.userId}> <@${interaction.user.id}>`,
      embeds: [
        new EmbedBuilder().setColor(0x5865f2).setTitle(`🎫 Test Ticket — ${KIT_DISPLAY[kit]}`)
          .addFields(
            { name: 'Player:', value: `<@${nextPlayer.userId}>`, inline: true },
            { name: 'IGN:', value: nextPlayer.ign, inline: true },
            { name: 'Current Tier:', value: tierStr, inline: true },
            { name: 'Tester:', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Kit:', value: KIT_DISPLAY[kit], inline: true },
          )
          .setFooter({ text: 'Benutze /result um das Ergebnis zu posten.' }).setTimestamp(),
      ],
    });

    state.ticketChannelId = ticketChannel.id;
    const tc = channel as TextChannel;
    await refreshQueueMessage(tc, state);
    setQueue(guild.id, kit, state);
    await interaction.editReply({ content: `✅ <@${nextPlayer.userId}> aufgerufen! Ticket: ${ticketChannel}` });
  }

  // ── /skip ──────────────────────────────────────────────────────────────────
  else if (commandName === 'skip') {
    if (!hasVerifiedTester(guildMember)) {
      await interaction.reply({ content: '❌ Du brauchst die **Verified Tester** Rolle.', ephemeral: true });
      return;
    }
    const kit = getKitFromChannelName(channel.name);
    if (!kit) { await interaction.reply({ content: '❌ Nur in Kit-Waitlist-Channels.', ephemeral: true }); return; }
    const state = getQueue(guild.id, kit);
    if (!state?.isOpen) { await interaction.reply({ content: '❌ Queue nicht offen.', ephemeral: true }); return; }

    let skipped: Player | undefined;

    if (state.currentlyTesting) {
      // Skip the player currently being tested
      skipped = state.currentlyTesting;
      state.currentlyTesting = null;
      if (state.ticketChannelId) {
        const ticketCh = guild.channels.cache.get(state.ticketChannelId) as TextChannel | undefined;
        if (ticketCh) {
          await ticketCh.send({ content: `⏭️ **${skipped.ign}** wurde übersprungen.` });
          setTimeout(() => ticketCh.delete().catch(() => {}), 5000);
        }
        state.ticketChannelId = null;
      }
    } else {
      const pos = (interaction.options.getInteger('position') ?? 1) - 1;
      if (pos >= state.players.length) {
        await interaction.reply({ content: `❌ Position ${pos + 1} existiert nicht in der Queue.`, ephemeral: true });
        return;
      }
      skipped = state.players.splice(pos, 1)[0];
    }

    setQueue(guild.id, kit, state);
    const tc = channel as TextChannel;
    await refreshQueueMessage(tc, state);
    setQueue(guild.id, kit, state);
    await interaction.reply({ content: `⏭️ **${skipped!.ign}** wurde übersprungen. Queue wurde aktualisiert.`, ephemeral: true });
  }

  // ── /result ────────────────────────────────────────────────────────────────
  else if (commandName === 'result') {
    if (!hasVerifiedTester(guildMember)) {
      await interaction.reply({ content: '❌ Du brauchst die **Verified Tester** Rolle.', ephemeral: true });
      return;
    }
    const tierValue = interaction.options.getString('tier', true) as Tier;
    const testerUser = interaction.options.getUser('tester', true);
    const kit = getKitFromChannelName(channel.name);
    if (!kit) { await interaction.reply({ content: '❌ Nur in Kit-Waitlist-Channels.', ephemeral: true }); return; }
    const state = getQueue(guild.id, kit);
    if (!state?.currentlyTesting) {
      await interaction.reply({ content: '❌ Kein Spieler wird gerade getestet. Benutze `/next` zuerst.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });

    const player = state.currentlyTesting;
    const profile = getUserProfile(guild.id, player.userId);
    const prevTier = profile?.tierPerKit.get(kit) ?? null;

    if (profile) { profile.tierPerKit.set(kit, tierValue); setUserProfile(guild.id, player.userId, profile); }

    // Update player leaderboard
    setLeaderboardEntry(guild.id, player.ign, kit, tierValue);

    // Update tester stats
    incrementTesterStat(guild.id, testerUser.id, testerUser.username);

    // Update roles
    const allOldRoles = TIERS.map((t) => `${t.toUpperCase()} ${KIT_DISPLAY[kit]}`);
    const newRoleName = `${tierValue.toUpperCase()} ${KIT_DISPLAY[kit]}`;
    let targetMember: GuildMember | null = null;
    try { targetMember = await guild.members.fetch(player.userId); } catch {}
    if (targetMember) {
      for (const rn of allOldRoles) {
        const role = guild.roles.cache.find((r) => r.name === rn);
        if (role && targetMember!.roles.cache.has(role.id)) await targetMember!.roles.remove(role).catch(() => {});
      }
      let newRole = guild.roles.cache.find((r) => r.name === newRoleName);
      if (!newRole) newRole = await guild.roles.create({ name: newRoleName, reason: 'Tier result' });
      await targetMember.roles.add(newRole).catch(() => {});
    }

    const testerMention = `<@${testerUser.id}>`;
    const resultEmbed = buildResultEmbed(player, testerMention, prevTier, tierValue, kit);

    // Post to results channel
    const isHigh = ['ht3', 'ht2', 'ht1', 'lt2', 'lt1'].includes(tierValue);
    const resultsCh = (isHigh ? findChannelByKey(guild, HIGH_RESULTS_CHANNEL_KEY) : null)
      ?? findChannelByKey(guild, RESULTS_CHANNEL_KEY);
    if (resultsCh) await resultsCh.send({ embeds: [resultEmbed] });

    // Post in ticket and close it
    if (state.ticketChannelId) {
      const ticketCh = guild.channels.cache.get(state.ticketChannelId) as TextChannel | undefined;
      if (ticketCh) {
        await ticketCh.send({ content: `✅ Test abgeschlossen!`, embeds: [resultEmbed] });
        setTimeout(() => ticketCh.delete().catch(() => {}), 5000);
      }
    }

    state.currentlyTesting = null; state.ticketChannelId = null; state.lastSessionTime = new Date();
    const tc = channel as TextChannel;
    await refreshQueueMessage(tc, state);
    setQueue(guild.id, kit, state);
    // Immediately update pinned leaderboards
    await refreshGuildLeaderboards(guild.id);
    await interaction.editReply({ content: `✅ Ergebnis gepostet! **${TIER_DISPLAY[tierValue]}** für **${player.ign}**` });
  }

  // ── /verify ────────────────────────────────────────────────────────────────
  else if (commandName === 'verify') {
    if (!hasAdmin(guildMember)) {
      await interaction.reply({ content: '❌ Nur Admins (*) können diesen Command nutzen.', ephemeral: true });
      return;
    }
    await interaction.reply({ embeds: [buildVerifyEmbed()], components: [buildVerifyRow()] });
  }

  // ── /createchannel ─────────────────────────────────────────────────────────
  else if (commandName === 'createchannel') {
    if (!hasAdmin(guildMember)) {
      await interaction.reply({ content: '❌ Nur Admins (*) können diesen Command nutzen.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    await createAllChannelsAndRoles(interaction);
  }

  // ── /tester ────────────────────────────────────────────────────────────────
  else if (commandName === 'tester') {
    if (!hasVerifiedTester(guildMember)) {
      await interaction.reply({ content: '❌ Du brauchst die **Verified Tester** Rolle.', ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();
    const kit = getKitFromChannelName(channel.name);
    if (!kit) { await interaction.reply({ content: '❌ Nur in Kit-Waitlist-Channels.', ephemeral: true }); return; }
    const state = getQueue(guild.id, kit);
    if (!state?.isOpen) {
      await interaction.reply({ content: `❌ Die **${KIT_DISPLAY[kit]}** Queue ist nicht offen.`, ephemeral: true });
      return;
    }
    if (sub === 'join') {
      if (state.activeTesters.includes(interaction.user.id)) {
        await interaction.reply({ content: '❌ Du bist bereits als Tester in dieser Queue.', ephemeral: true });
        return;
      }
      state.activeTesters.push(interaction.user.id);
      setQueue(guild.id, kit, state);
      await refreshQueueMessage(channel as TextChannel, state);
      setQueue(guild.id, kit, state);
      await interaction.reply({ content: `✅ Du bist jetzt als Tester in der **${KIT_DISPLAY[kit]}** Queue!`, ephemeral: true });
    } else if (sub === 'leave') {
      const idx = state.activeTesters.indexOf(interaction.user.id);
      if (idx === -1) { await interaction.reply({ content: '❌ Du bist nicht als Tester in dieser Queue.', ephemeral: true }); return; }
      state.activeTesters.splice(idx, 1);
      setQueue(guild.id, kit, state);
      await refreshQueueMessage(channel as TextChannel, state);
      setQueue(guild.id, kit, state);
      await interaction.reply({ content: `✅ Du hast die **${KIT_DISPLAY[kit]}** Queue als Tester verlassen.`, ephemeral: true });
    }
  }

  // ── /testerleaderboard ────────────────────────────────────────────────────
  else if (commandName === 'testerleaderboard') {
    if (!hasAdmin(guildMember)) {
      await interaction.reply({ content: '❌ Nur Admins (*) können diesen Command nutzen.', ephemeral: true });
      return;
    }
    const embed = buildTesterLeaderboardEmbed(getTopTesters(guild.id));
    const reply = await interaction.reply({ embeds: [embed], fetchReply: true });
    liveLeaderboards.set(reply.id, { msg: reply as Message, type: 'tester', guildId: guild.id });
  }

  // ── /leaderboard ──────────────────────────────────────────────────────────
  else if (commandName === 'leaderboard') {
    if (!hasAdmin(guildMember)) {
      await interaction.reply({ content: '❌ Nur Admins (*) können diesen Command nutzen.', ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'show') {
      const lb = getLeaderboard(guild.id);
      const embed = buildPlayerLeaderboardEmbed([...lb.values()]);
      const reply = await interaction.reply({ embeds: [embed], fetchReply: true });
      liveLeaderboards.set(reply.id, { msg: reply as Message, type: 'player', guildId: guild.id });
    }

    else if (sub === 'add') {
      const ign = interaction.options.getString('ign', true);
      const kit = interaction.options.getString('kit', true) as Kit;
      const tier = interaction.options.getString('tier', true) as Tier;
      setLeaderboardEntry(guild.id, ign, kit, tier);
      await interaction.reply({
        content: `✅ **${ign}** im Leaderboard aktualisiert: ${KIT_DISPLAY[kit]} → **${TIER_DISPLAY[tier]}**`,
        ephemeral: true,
      });
    }

    else if (sub === 'remove') {
      const ign = interaction.options.getString('ign', true);
      const removed = removeLeaderboardEntry(guild.id, ign);
      await interaction.reply({
        content: removed ? `✅ **${ign}** aus dem Leaderboard entfernt.` : `❌ **${ign}** nicht gefunden.`,
        ephemeral: true,
      });
    }
  }
}

async function createAllChannelsAndRoles(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild!;
  let created = 0;

  const categoryMap = new Map<string, import('discord.js').CategoryChannel>();
  for (const catName of CATEGORIES) {
    let cat = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === catName,
    ) as import('discord.js').CategoryChannel | undefined;
    if (!cat) {
      cat = await guild.channels.create({ name: catName, type: ChannelType.GuildCategory }) as import('discord.js').CategoryChannel;
      created++;
    }
    categoryMap.set(catName, cat);
  }

  for (const def of [...CHANNELS_TO_CREATE, ...KIT_WAITLIST_CHANNELS]) {
    const exists = guild.channels.cache.find((c) => c.name === def.name && c.type === ChannelType.GuildText);
    if (!exists) {
      await guild.channels.create({ name: def.name, type: ChannelType.GuildText, parent: categoryMap.get(def.category)?.id });
      created++;
    }
  }

  const getOrCreateRole = async (name: string, color?: number) => {
    if (!guild.roles.cache.find((r) => r.name === name)) {
      await guild.roles.create({ name, color, reason: 'createchannel setup' });
      created++;
    }
  };
  await getOrCreateRole(VERIFIED_TESTER_ROLE, 0x3498db);
  for (const kit of KITS) await getOrCreateRole(`${KIT_DISPLAY[kit]} Queue`, 0x2ecc71);
  for (const kit of KITS) for (const tier of TIERS) await getOrCreateRole(`${tier.toUpperCase()} ${KIT_DISPLAY[kit]}`);

  await interaction.editReply({
    content: [
      `✅ **Setup abgeschlossen!** ${created} neue Elemente erstellt.`,
      `**Waitlists:** ${KIT_WAITLIST_CHANNELS.map((c) => c.name).join(', ')}`,
      `**Rollen:** Verified Tester + ${KITS.length} Queue-Rollen + ${KITS.length * TIERS.length} Tier-Rollen`,
      `\nGib jetzt Testern die **Verified Tester** Rolle!`,
    ].join('\n'),
  });
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId, guild, member } = interaction;
  if (!guild || !member) return;
  const guildMember = member as GuildMember;

  if (customId.startsWith('join_queue_')) {
    const kit = customId.replace('join_queue_', '') as Kit;
    const state = getQueue(guild.id, kit);
    if (!state?.isOpen) { await interaction.reply({ content: '❌ Queue nicht mehr offen.', ephemeral: true }); return; }
    if (state.players.some((p) => p.userId === interaction.user.id)) {
      await interaction.reply({ content: '❌ Du bist bereits in der Queue.', ephemeral: true }); return;
    }
    if (state.players.length >= MAX_QUEUE) {
      await interaction.reply({ content: '❌ Queue voll (20/20).', ephemeral: true }); return;
    }
    const profile = getUserProfile(guild.id, interaction.user.id);
    const player: Player = {
      userId: interaction.user.id,
      ign: profile?.ign ?? interaction.user.username,
      currentTier: profile?.tierPerKit.get(kit) ?? null,
      server: profile?.server ?? 'Unknown',
      joinedAt: new Date(),
    };
    state.players.push(player);
    const pos = state.players.length;
    setQueue(guild.id, kit, state);
    await refreshQueueMessage(interaction.channel as TextChannel, state);
    setQueue(guild.id, kit, state);
    await interaction.reply({ content: `✅ Du bist **#${pos}** in der **${KIT_DISPLAY[kit]}** Queue!`, ephemeral: true });
  }

  else if (customId.startsWith('leave_queue_')) {
    const kit = customId.replace('leave_queue_', '') as Kit;
    const state = getQueue(guild.id, kit);
    if (!state) { await interaction.reply({ content: '❌ Keine Queue gefunden.', ephemeral: true }); return; }
    const idx = state.players.findIndex((p) => p.userId === interaction.user.id);
    if (idx === -1) { await interaction.reply({ content: '❌ Du bist nicht in der Queue.', ephemeral: true }); return; }
    state.players.splice(idx, 1);
    setQueue(guild.id, kit, state);
    await refreshQueueMessage(interaction.channel as TextChannel, state);
    setQueue(guild.id, kit, state);
    await interaction.reply({ content: `✅ Du hast die **${KIT_DISPLAY[kit]}** Queue verlassen.`, ephemeral: true });
  }

  else if (customId === 'enter_waitlist') {
    const modal = new ModalBuilder().setCustomId('modal_enter_waitlist').setTitle('Waitlist beitreten');
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('mc_username').setLabel('Minecraft Username (IGN)')
          .setStyle(TextInputStyle.Short).setPlaceholder('Dein Minecraft IGN').setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('kit').setLabel('Kit')
          .setStyle(TextInputStyle.Short).setPlaceholder('uhc, sword, mace, diapot, nethpot, smp, crystal, axe').setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('server').setLabel('Server (z.B. BerryPvP, CatPvP)')
          .setStyle(TextInputStyle.Short).setPlaceholder('BerryPvP, CatPvP, Turtled...').setRequired(true),
      ),
    );
    await interaction.showModal(modal);
  }
}

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  const { customId, guild, member } = interaction;
  if (!guild || !member) return;
  const guildMember = member as GuildMember;

  if (customId === 'modal_enter_waitlist') {
    const ign = interaction.fields.getTextInputValue('mc_username').trim();
    const kitRaw = interaction.fields.getTextInputValue('kit').trim().toLowerCase() as Kit;
    const server = interaction.fields.getTextInputValue('server').trim();

    if (!KITS.includes(kitRaw)) {
      await interaction.reply({ content: `❌ Ungültiges Kit. Gültige Kits: ${KITS.join(', ')}`, ephemeral: true });
      return;
    }

    let profile = getUserProfile(guild.id, interaction.user.id);
    if (!profile) profile = { ign, server, tierPerKit: new Map(), discordId: interaction.user.id };
    else { profile.ign = ign; profile.server = server; }
    setUserProfile(guild.id, interaction.user.id, profile);

    const roleName = `${KIT_DISPLAY[kitRaw]} Queue`;
    let queueRole = guild.roles.cache.find((r) => r.name === roleName);
    if (!queueRole) queueRole = await guild.roles.create({ name: roleName, reason: 'Waitlist join' });
    await guildMember.roles.add(queueRole).catch(() => {});

    // Show stored tier if available
    const storedTier = profile.tierPerKit.get(kitRaw);
    const tierDisplay = storedTier ? TIER_DISPLAY[storedTier] : 'N/A (wird beim Test vergeben)';

    await interaction.reply({
      content: [
        `✅ Du bist der **${KIT_DISPLAY[kitRaw]}** Waitlist beigetreten!`,
        `**IGN:** ${ign}`,
        `**Aktuelles Tier:** ${tierDisplay}`,
        `**Server:** ${server}`,
      ].join('\n'),
      ephemeral: true,
    });
  }
}

export async function startBot(): Promise<void> {
  await client.login(TOKEN);
}
