import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { QueueState, Player } from './store.js';
import { KIT_DISPLAY, KIT_EMOJI, TIER_DISPLAY, MAX_QUEUE, type Kit, type Tier } from './constants.js';

export function buildQueueEmbed(state: QueueState): EmbedBuilder {
  const kit = state.kit;
  const display = KIT_DISPLAY[kit];
  const emoji = KIT_EMOJI[kit];

  const lines: string[] = [];
  for (let i = 0; i < MAX_QUEUE; i++) {
    const player = state.players[i];
    if (player) {
      const tier = player.currentTier ? `[${player.currentTier.toUpperCase()}]` : '[N/A]';
      lines.push(`**${i + 1}.** ${player.ign} ${tier}`);
    } else {
      lines.push(`**${i + 1}.** *(empty)*`);
    }
  }

  const desc = lines.join('\n');

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${emoji} ${display} Queue — Open`)
    .setDescription(desc)
    .setFooter({ text: `Queue: ${state.players.length}/${MAX_QUEUE} players` })
    .setTimestamp();
}

export function buildQueueRow(kit: Kit, isFull: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`join_queue_${kit}`)
      .setLabel(isFull ? 'Queue Full' : 'Join Queue')
      .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(isFull),
    new ButtonBuilder()
      .setCustomId(`leave_queue_${kit}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger),
  );
}

export function buildClosedEmbed(kit: Kit, lastSession: Date | null): EmbedBuilder {
  const display = KIT_DISPLAY[kit];
  const emoji = KIT_EMOJI[kit];
  const lastStr = lastSession
    ? `<t:${Math.floor(lastSession.getTime() / 1000)}:f>`
    : 'Never';

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`${emoji} ${display} Queue — Closed`)
    .setDescription(
      `No testers are currently available.\nYou will be pinged when a tester is available.\nCheck back later!\n\n**Last testing session:** ${lastStr}`,
    )
    .setTimestamp();
}

export function buildResultEmbed(
  player: Player,
  testerMention: string,
  prevTier: Tier | null,
  newTier: Tier,
  kit: Kit,
): EmbedBuilder {
  const display = KIT_DISPLAY[kit];
  const prevDisplay = prevTier ? TIER_DISPLAY[prevTier] : 'N/A';
  const newDisplay = TIER_DISPLAY[newTier];

  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(`🏆 ${player.ign}'s test result`)
    .addFields(
      { name: 'Tester:', value: testerMention, inline: false },
      { name: 'Username:', value: player.ign, inline: false },
      { name: 'Region:', value: player.server || 'Unknown', inline: false },
      { name: 'Previous Rank:', value: prevDisplay, inline: false },
      { name: 'Rank Earned:', value: newDisplay, inline: false },
      { name: 'Gamemode:', value: display, inline: false },
    )
    .setTimestamp();
}

export function buildVerifyEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Evaluation Testing Waitlist')
    .setDescription(
      'Upon applying, you will be added to a waitlist channel.\n' +
        'Here you will be pinged when a tester of your region is available.\n' +
        'If you are HT3 or higher, a high ticket will be created.\n\n' +
        '• Region should be the region of the server you wish to test on\n\n' +
        '• Username should be the name of the account you will be testing on\n\n' +
        '🔴 **Failure to provide authentic information will result in a denied test.**',
    );
}

export function buildVerifyRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('verify_account')
      .setLabel('Verify Account')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('enter_waitlist')
      .setLabel('Enter Waitlist')
      .setStyle(ButtonStyle.Primary),
  );
}
