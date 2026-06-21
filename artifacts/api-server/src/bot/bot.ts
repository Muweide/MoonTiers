import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  TextChannel,
  GuildMember,
  EmbedBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { logger } from '../lib/logger.js';
import {
  KITS,
  TIERS,
  KIT_DISPLAY,
  TIER_DISPLAY,
  VERIFIED_TESTER_ROLE,
  RESULTS_CHANNEL_KEY,
  HIGH_RESULTS_CHANNEL_KEY,
  MAX_QUEUE,
  CATEGORIES,
  CHANNELS_TO_CREATE,
  KIT_WAITLIST_CHANNELS,
  getKitFromChannelName,
  type Kit,
  type Tier,
} from './constants.js';
import {
  getQueue,
  setQueue,
  getUserProfile,
  setUserProfile,
  type Player,
  type QueueState,
} from './store.js';
import {
  buildQueueEmbed,
  buildQueueRow,
  buildClosedEmbed,
  buildResultEmbed,
  buildVerifyEmbed,
  buildVerifyRow,
} from './embeds.js';

const TOKEN = process.env['DISCORD_BOT_TOKEN'];
if (!TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function hasVerifiedTester(member: GuildMember): boolean {
  return member.roles.cache.some((r) => r.name === VERIFIED_TESTER_ROLE);
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
      if (msg) {
        await msg.edit({ embeds: [embed], components: [row] });
        return;
      }
    }
    const msg = await channel.send({ embeds: [embed], components: [row] });
    state.messageId = msg.id;
  } catch (e) {
    logger.error({ e }, 'Failed to refresh queue message');
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('open')
    .setDescription('Öffnet die Queue für diesen Kit-Channel (nur Verified Tester)')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Schließt die Queue für diesen Kit-Channel (nur Verified Tester)')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('next')
    .setDescription('Nächsten Spieler aufrufen und Ticket erstellen (nur Verified Tester)')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('result')
    .setDescription('Test-Ergebnis posten (nur Verified Tester)')
    .addStringOption((o) =>
      o
        .setName('tier')
        .setDescription('Das Tier das der Spieler bekommen hat')
        .setRequired(true)
        .addChoices(...TIERS.map((t) => ({ name: TIER_DISPLAY[t], value: t }))),
    )
    .addUserOption((o) =>
      o.setName('tester').setDescription('Der Tester (dich selbst pingen)').setRequired(true),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Zeigt das Waitlist Embed an')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('createchannel')
    .setDescription('Erstellt alle Channels, Kategorien und Rollen (nur Verified Tester)')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('tester')
    .setDescription('Tester Queue Commands')
    .addSubcommand((sub) =>
      sub.setName('join').setDescription('Als Tester der offenen Queue beitreten'),
    )
    .addSubcommand((sub) =>
      sub.setName('leave').setDescription('Als Tester die Queue verlassen'),
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

    // Delete previous closed message
    if (existing?.messageId) {
      const old = await tc.messages.fetch(existing.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }

    const state: QueueState = {
      isOpen: true,
      kit,
      messageId: null,
      channelId: channel.id,
      players: [],
      activeTesters: [interaction.user.id],
      currentlyTesting: null,
      ticketChannelId: null,
      testerUserId: interaction.user.id,
      lastSessionTime: new Date(),
    };
    setQueue(guild.id, kit, state);
    await refreshQueueMessage(tc, state);
    setQueue(guild.id, kit, state);
    await interaction.editReply({ content: `✅ **${KIT_DISPLAY[kit]}** Queue geöffnet!` });
  }

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

    // Delete open queue message
    if (state.messageId) {
      const old = await tc.messages.fetch(state.messageId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }

    const closedEmbed = buildClosedEmbed(kit, state.lastSessionTime);
    const closedMsg = await tc.send({ embeds: [closedEmbed] });
    state.isOpen = false;
    state.messageId = closedMsg.id;
    state.players = [];
    state.activeTesters = [];
    state.currentlyTesting = null;
    setQueue(guild.id, kit, state);
    await interaction.editReply({ content: `✅ **${KIT_DISPLAY[kit]}** Queue geschlossen.` });
  }

  else if (commandName === 'next') {
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
      await interaction.reply({ content: '❌ Die Queue ist nicht offen.', ephemeral: true });
      return;
    }
    if (state.players.length === 0) {
      await interaction.reply({ content: '❌ Die Queue ist leer.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const nextPlayer = state.players.shift()!;
    state.currentlyTesting = nextPlayer;
    state.testerUserId = interaction.user.id;

    const ticketCategory = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === 'Tickets',
    );
    const ticketName = `ticket-${nextPlayer.ign.toLowerCase()}-${kit}`;

    const permOverwrites: import('discord.js').OverwriteResolvable[] = [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      { id: nextPlayer.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ];
    for (const testerId of state.activeTesters) {
      if (testerId !== interaction.user.id) {
        permOverwrites.push({ id: testerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
      }
    }

    const ticketChannel = await guild.channels.create({
      name: ticketName,
      type: ChannelType.GuildText,
      parent: ticketCategory?.id,
      permissionOverwrites: permOverwrites,
    });

    const tierStr = nextPlayer.currentTier ? TIER_DISPLAY[nextPlayer.currentTier] : 'N/A';
    const ticketEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎫 Test Ticket — ${KIT_DISPLAY[kit]}`)
      .addFields(
        { name: 'Player:', value: `<@${nextPlayer.userId}>`, inline: true },
        { name: 'IGN:', value: nextPlayer.ign, inline: true },
        { name: 'Current Tier:', value: tierStr, inline: true },
        { name: 'Tester:', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Kit:', value: KIT_DISPLAY[kit], inline: true },
      )
      .setFooter({ text: 'Benutze /result um das Ergebnis zu posten.' })
      .setTimestamp();

    await (ticketChannel as TextChannel).send({
      content: `<@${nextPlayer.userId}> <@${interaction.user.id}>`,
      embeds: [ticketEmbed],
    });

    state.ticketChannelId = ticketChannel.id;
    const tc = channel as TextChannel;
    await refreshQueueMessage(tc, state);
    setQueue(guild.id, kit, state);
    await interaction.editReply({ content: `✅ <@${nextPlayer.userId}> aufgerufen! Ticket: ${ticketChannel}` });
  }

  else if (commandName === 'result') {
    if (!hasVerifiedTester(guildMember)) {
      await interaction.reply({ content: '❌ Du brauchst die **Verified Tester** Rolle.', ephemeral: true });
      return;
    }
    const tierValue = interaction.options.getString('tier', true) as Tier;
    const testerUser = interaction.options.getUser('tester', true);
    const kit = getKitFromChannelName(channel.name);
    if (!kit) {
      await interaction.reply({ content: '❌ Benutze diesen Command in einem Kit-Waitlist-Channel.', ephemeral: true });
      return;
    }
    const state = getQueue(guild.id, kit);
    if (!state?.currentlyTesting) {
      await interaction.reply({ content: '❌ Kein Spieler wird gerade getestet. Benutze `/next` zuerst.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });

    const player = state.currentlyTesting;
    const profile = getUserProfile(guild.id, player.userId);
    const prevTier = profile?.tierPerKit.get(kit) ?? null;

    if (profile) {
      profile.tierPerKit.set(kit, tierValue);
      setUserProfile(guild.id, player.userId, profile);
    }
    player.currentTier = tierValue;

    const allOldTierRoles = TIERS.map((t) => `${t.toUpperCase()} ${KIT_DISPLAY[kit]}`);
    const newRoleName = `${tierValue.toUpperCase()} ${KIT_DISPLAY[kit]}`;

    let targetMember: GuildMember | null = null;
    try { targetMember = await guild.members.fetch(player.userId); } catch {}

    if (targetMember) {
      for (const roleName of allOldTierRoles) {
        const role = guild.roles.cache.find((r) => r.name === roleName);
        if (role && targetMember!.roles.cache.has(role.id)) {
          await targetMember!.roles.remove(role).catch(() => {});
        }
      }
      let newRole = guild.roles.cache.find((r) => r.name === newRoleName);
      if (!newRole) newRole = await guild.roles.create({ name: newRoleName, reason: 'Tier result' });
      await targetMember.roles.add(newRole).catch(() => {});
    }

    const testerMention = `<@${testerUser.id}>`;
    const resultEmbed = buildResultEmbed(player, testerMention, prevTier, tierValue, kit);

    const isHighTier = ['ht3', 'ht2', 'ht1', 'lt2', 'lt1'].includes(tierValue);
    const resultsChannel = isHighTier
      ? findChannelByKey(guild, HIGH_RESULTS_CHANNEL_KEY)
      : findChannelByKey(guild, RESULTS_CHANNEL_KEY);
    const fallback = findChannelByKey(guild, RESULTS_CHANNEL_KEY);
    const target = resultsChannel ?? fallback;
    if (target) await target.send({ embeds: [resultEmbed] });

    if (state.ticketChannelId) {
      const ticketCh = guild.channels.cache.get(state.ticketChannelId) as TextChannel | undefined;
      if (ticketCh) {
        await ticketCh.send({ embeds: [resultEmbed] });
        setTimeout(() => ticketCh.delete().catch(() => {}), 5000);
      }
    }

    state.currentlyTesting = null;
    state.ticketChannelId = null;
    state.lastSessionTime = new Date();

    const tc = channel as TextChannel;
    await refreshQueueMessage(tc, state);
    setQueue(guild.id, kit, state);
    await interaction.editReply({ content: `✅ Ergebnis gepostet! ${testerMention} — **${TIER_DISPLAY[tierValue]}** für **${player.ign}**` });
  }

  else if (commandName === 'verify') {
    await interaction.reply({ embeds: [buildVerifyEmbed()], components: [buildVerifyRow()] });
  }

  else if (commandName === 'tester') {
    if (!hasVerifiedTester(guildMember)) {
      await interaction.reply({ content: '❌ Du brauchst die **Verified Tester** Rolle.', ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();
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

    if (sub === 'join') {
      if (state.activeTesters.includes(interaction.user.id)) {
        await interaction.reply({ content: '❌ Du bist bereits als Tester in dieser Queue.', ephemeral: true });
        return;
      }
      state.activeTesters.push(interaction.user.id);
      setQueue(guild.id, kit, state);
      const tc = channel as TextChannel;
      await refreshQueueMessage(tc, state);
      setQueue(guild.id, kit, state);
      await interaction.reply({ content: `✅ Du bist jetzt als Tester in der **${KIT_DISPLAY[kit]}** Queue!`, ephemeral: true });
    }

    else if (sub === 'leave') {
      const idx = state.activeTesters.indexOf(interaction.user.id);
      if (idx === -1) {
        await interaction.reply({ content: '❌ Du bist nicht als Tester in dieser Queue.', ephemeral: true });
        return;
      }
      state.activeTesters.splice(idx, 1);
      setQueue(guild.id, kit, state);
      const tc = channel as TextChannel;
      await refreshQueueMessage(tc, state);
      setQueue(guild.id, kit, state);
      await interaction.reply({ content: `✅ Du hast die **${KIT_DISPLAY[kit]}** Queue als Tester verlassen.`, ephemeral: true });
    }
  }

  else if (commandName === 'createchannel') {
    if (!hasVerifiedTester(guildMember)) {
      await interaction.reply({ content: '❌ Du brauchst die **Verified Tester** Rolle.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    await createAllChannelsAndRoles(interaction);
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

  const allChannelDefs = [...CHANNELS_TO_CREATE, ...KIT_WAITLIST_CHANNELS];
  for (const def of allChannelDefs) {
    const cat = categoryMap.get(def.category);
    const exists = guild.channels.cache.find(
      (c) => c.name === def.name && c.type === ChannelType.GuildText,
    );
    if (!exists) {
      await guild.channels.create({ name: def.name, type: ChannelType.GuildText, parent: cat?.id });
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
  for (const kit of KITS) {
    for (const tier of TIERS) {
      await getOrCreateRole(`${tier.toUpperCase()} ${KIT_DISPLAY[kit]}`);
    }
  }

  await interaction.editReply({
    content: [
      `✅ **Setup abgeschlossen!** ${created} neue Elemente erstellt.\n`,
      `**Kategorien:** ${CATEGORIES.join(', ')}`,
      `**Waitlist-Channels:** ${KIT_WAITLIST_CHANNELS.map((c) => c.name).join(', ')}`,
      `**Tier-Rollen:** ${KITS.length * TIERS.length} erstellt`,
      `\nGib jetzt dem ersten Verified Tester die **Verified Tester** Rolle!`,
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
    if (!state?.isOpen) {
      await interaction.reply({ content: '❌ Die Queue ist nicht mehr offen.', ephemeral: true });
      return;
    }
    if (state.players.some((p) => p.userId === interaction.user.id)) {
      await interaction.reply({ content: '❌ Du bist bereits in der Queue.', ephemeral: true });
      return;
    }
    if (state.players.length >= MAX_QUEUE) {
      await interaction.reply({ content: '❌ Die Queue ist voll (20/20).', ephemeral: true });
      return;
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
    const tc = interaction.channel as TextChannel;
    await refreshQueueMessage(tc, state);
    setQueue(guild.id, kit, state);
    await interaction.reply({ content: `✅ Du bist jetzt **#${pos}** in der **${KIT_DISPLAY[kit]}** Queue!`, ephemeral: true });
  }

  else if (customId.startsWith('leave_queue_')) {
    const kit = customId.replace('leave_queue_', '') as Kit;
    const state = getQueue(guild.id, kit);
    if (!state) { await interaction.reply({ content: '❌ Keine Queue gefunden.', ephemeral: true }); return; }
    const idx = state.players.findIndex((p) => p.userId === interaction.user.id);
    if (idx === -1) { await interaction.reply({ content: '❌ Du bist nicht in der Queue.', ephemeral: true }); return; }
    state.players.splice(idx, 1);
    setQueue(guild.id, kit, state);
    const tc = interaction.channel as TextChannel;
    await refreshQueueMessage(tc, state);
    setQueue(guild.id, kit, state);
    await interaction.reply({ content: `✅ Du hast die **${KIT_DISPLAY[kit]}** Queue verlassen.`, ephemeral: true });
  }

  else if (customId === 'enter_waitlist') {
    const modal = new ModalBuilder().setCustomId('modal_enter_waitlist').setTitle('Waitlist beitreten');
    const usernameInput = new TextInputBuilder()
      .setCustomId('mc_username').setLabel('Minecraft Username (IGN)').setStyle(TextInputStyle.Short)
      .setPlaceholder('Dein Minecraft IGN').setRequired(true);
    const kitInput = new TextInputBuilder()
      .setCustomId('kit').setLabel('Kit').setStyle(TextInputStyle.Short)
      .setPlaceholder('uhc, sword, mace, diapot, nethpot, smp, crystal, axe').setRequired(true);
    const tierInput = new TextInputBuilder()
      .setCustomId('current_tier').setLabel('Aktuelles Tier (z.B. ht5, lt3 oder N/A)').setStyle(TextInputStyle.Short)
      .setPlaceholder('lt5, ht5, lt4, ht4, lt3, ht3, lt2, ht2, lt1, ht1 oder N/A').setRequired(true);
    const serverInput = new TextInputBuilder()
      .setCustomId('server').setLabel('Server (z.B. BerryPvP, CatPvP)').setStyle(TextInputStyle.Short)
      .setPlaceholder('BerryPvP, CatPvP, Turtled...').setRequired(true);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(kitInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(tierInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(serverInput),
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
    const tierRaw = interaction.fields.getTextInputValue('current_tier').trim().toLowerCase();
    const server = interaction.fields.getTextInputValue('server').trim();

    if (!KITS.includes(kitRaw)) {
      await interaction.reply({ content: `❌ Ungültiges Kit. Gültige Kits: ${KITS.join(', ')}`, ephemeral: true });
      return;
    }
    const tierValue = tierRaw === 'n/a' || tierRaw === 'na' ? null : (tierRaw as Tier);
    if (tierValue && !TIERS.includes(tierValue)) {
      await interaction.reply({ content: `❌ Ungültiges Tier. Gültige Tiers: ${TIERS.join(', ')} oder N/A`, ephemeral: true });
      return;
    }

    let profile = getUserProfile(guild.id, interaction.user.id);
    if (!profile) profile = { ign, server, tierPerKit: new Map(), discordId: interaction.user.id };
    else { profile.ign = ign; profile.server = server; }
    if (tierValue) profile.tierPerKit.set(kitRaw, tierValue);
    setUserProfile(guild.id, interaction.user.id, profile);

    const roleName = `${KIT_DISPLAY[kitRaw]} Queue`;
    let queueRole = guild.roles.cache.find((r) => r.name === roleName);
    if (!queueRole) queueRole = await guild.roles.create({ name: roleName, reason: 'Waitlist join' });
    await guildMember.roles.add(queueRole).catch(() => {});

    const tierDisplay = tierValue ? TIER_DISPLAY[tierValue] : 'N/A';
    await interaction.reply({
      content: `✅ Du bist der **${KIT_DISPLAY[kitRaw]}** Waitlist beigetreten!\n**IGN:** ${ign}\n**Tier:** ${tierDisplay}\n**Server:** ${server}`,
      ephemeral: true,
    });
  }
}

export async function startBot(): Promise<void> {
  await client.login(TOKEN);
}
