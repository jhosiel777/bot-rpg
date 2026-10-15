const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');

function getSpentPoints(player) {
  const hpPts = Math.max(0, Math.floor(((player.maxHp || 50) - 50) / 5));
  return (player.strength || 0) + (player.agility || 0) + (player.luck || 0) + hpPts;
}

function syncPlayerTitles(player) {
  let changed = false;

  if (!player.unlockedTitles || !Array.isArray(player.unlockedTitles) || player.unlockedTitles.length === 0) {
    player.unlockedTitles = ['Aventurero Novato'];
    changed = true;
  }

  // Desbloqueo inicial por invertir 3 o más puntos
  if (getSpentPoints(player) >= 3 && !player.unlockedTitles.includes('Caminante de Senderos')) {
    player.unlockedTitles.push('Caminante de Senderos');
    changed = true;
  }

  // Desbloqueo de Mecenas por Gema Ancestral
  if (player.hasAncestralGem && !player.unlockedTitles.includes('Mecenas de Abyss')) {
    player.unlockedTitles.push('Mecenas de Abyss');
    changed = true;
  }

  // Asignar por defecto solo si no tiene ninguno o si su título activo no existe en su lista
  if (!player.activeTitle || !player.unlockedTitles.includes(player.activeTitle)) {
    player.activeTitle = player.unlockedTitles.includes('Caminante de Senderos')
      ? 'Caminante de Senderos'
      : player.unlockedTitles[0];
    changed = true;
  }

  if (changed && typeof player.markModified === 'function') {
    player.markModified('unlockedTitles');
  }

  return changed;
}

function registerHomeHandlers(bot, { Player, getPlayer }) {

  // Menú Principal del Hogar
  bot.action('menu_home', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (syncPlayerTitles(player)) {
      await player.save();
    }

    const title = player.activeTitle || 'Aventurero Novato';
    let walletDisplay = '❌ _No vinculada_';

    if (player.tonWalletAddress) {
      const addr = player.tonWalletAddress;
      walletDisplay = `\`${addr.slice(0, 4)}...${addr.slice(-4)}\``;
    }

    const text = '🏡 *HOGAR DEL AVENTURERO* 🏡\n\n' +
                 'Tu refugio personal en la capital de Abyss. Aquí puedes organizar tus credenciales y prepararte para la gloria.\n\n' +
                 `👤 *Aventurero:* ${player.name}\n` +
                 `🎖️ *Título activo:* «*${title}*»\n` +
                 `💳 *Billetera TON:* ${walletDisplay}\n\n` +
                 '¿Qué deseas gestionar?';

    const buttons = [
      [Markup.button.callback('💳 Vincular / Cambiar Billetera TON', 'home_wallet_info')],
      [Markup.button.callback('🎖️ Títulos Honoríficos', 'home_titles')],
      [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
    ];

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // Información y vinculación de Wallet TON
  bot.action('home_wallet_info', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = '💳 *BILLETERA TON DE LA RED* 💳\n\n' +
               'Conectar tu billetera te permitirá comerciar en el futuro mercado P2P y adquirir artefactos ancestrales.\n\n';

    if (player.tonWalletAddress) {
      text += `🔗 *Billetera actual:* \`\${player.tonWalletAddress}\`\n\n` +
              'Si deseas cambiarla, pulsa el botón de abajo para reconectar:';
    } else {
      text += '⚠️ _Actualmente no tienes ninguna billetera vinculada._\n\n' +
              'Pulsa el botón de abajo para abrir la Mini App y conectar tu billetera:';
    }

    const miniAppUrl = 'https://bot-rpg-wu42.onrender.com/connect-wallet?userId=' + player.userId;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.webApp('🔗 Conectar con TON Connect', miniAppUrl)],
      [Markup.button.callback('⬅️ Volver al Hogar', 'menu_home')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  // Vista y lista de Títulos Honoríficos
  bot.action('home_titles', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (syncPlayerTitles(player)) {
      await player.save();
    }

    const currentTitle = player.activeTitle || 'Aventurero Novato';
    const unlocked = player.unlockedTitles || ['Aventurero Novato'];

    let text = '🎖️ *TÍTULOS HONORÍFICOS* 🎖️\n\n' +
               'Los títulos condecoran tus hazañas. Se mostrarán junto a tu nombre en el **Salón de la Fama** y en la futura **Arena de Duelos (PvP)**.\n\n' +
               `🎖️ *Equipado actualmente:* «*${currentTitle}*»\n\n` +
               'Toca un título para equipártelo:\n\n';

    const buttons = [];
    unlocked.forEach((title, idx) => {
      const isEquipped = title === currentTitle;
      const label = `${isEquipped ? '✅ ' : ''}${title}`;
      buttons.push([Markup.button.callback(label, `equip_title_${idx}`)]);
    });

    buttons.push([Markup.button.callback('⬅️ Volver al Hogar', 'menu_home')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  // Equipar título seleccionado
  bot.action(/equip_title_(\d+)/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    syncPlayerTitles(player);

    const unlocked = player.unlockedTitles || ['Aventurero Novato'];
    if (idx < 0 || idx >= unlocked.length) {
      return await safeAnswerCb(ctx, 'Título no válido.', true);
    }

    const selectedTitle = unlocked[idx];
    if (player.activeTitle === selectedTitle) {
      return await safeAnswerCb(ctx, 'Ya tienes equipado este título.', true);
    }

    player.activeTitle = selectedTitle;
    if (typeof player.markModified === 'function') {
      player.markModified('unlockedTitles');
    }
    await player.save();

    await safeAnswerCb(ctx, `🎖️ Equipaste: «${selectedTitle}»`, true);

    const currentTitle = player.activeTitle;
    let text = '🎖️ *TÍTULOS HONORÍFICOS* 🎖️\n\n' +
               'Los títulos condecoran tus hazañas. Se mostrarán junto a tu nombre en el **Salón de la Fama** y en la futura **Arena de Duelos (PvP)**.\n\n' +
               `🎖️ *Equipado actualmente:* «*${currentTitle}*»\n\n` +
               'Toca un título para equipártelo:\n\n';

    const buttons = [];
    unlocked.forEach((title, i) => {
      const isEquipped = title === currentTitle;
      const label = `${isEquipped ? '✅ ' : ''}${title}`;
      buttons.push([Markup.button.callback(label, `equip_title_${i}`)]);
    });

    buttons.push([Markup.button.callback('⬅️ Volver al Hogar', 'menu_home')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });
}

module.exports = { registerHomeHandlers };
