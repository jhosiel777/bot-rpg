const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');

function getSpentPoints(player) {
  const hpPts = Math.max(0, Math.floor(((player.maxHp || 50) - 50) / 5));
  return (player.strength || 0) + (player.agility || 0) + (player.luck || 0) + hpPts;
}

async function syncPlayerTitles(player, bot = null) {
  let changed = false;
  const newlyUnlocked = [];

  if (!player.unlockedTitles || !Array.isArray(player.unlockedTitles) || player.unlockedTitles.length === 0) {
    player.unlockedTitles = ['Aventurero Novato'];
    changed = true;
  } else if (!player.unlockedTitles.includes('Aventurero Novato')) {
    player.unlockedTitles.unshift('Aventurero Novato');
    changed = true;
  }

  const helperCheck = (title, condition) => {
    if (condition && !player.unlockedTitles.includes(title)) {
      player.unlockedTitles.push(title);
      newlyUnlocked.push(title);
      changed = true;
    }
  };

  // 1. Puntos de atributo (3 o más)
  helperCheck('Caminante de Senderos', getSpentPoints(player) >= 3);

  // 2. Compras con dinero real / Gema Ancestral
  helperCheck('Mecenas de Abyss', player.hasAncestralGem === true);

  // 3. Racha Diaria Continua (Bono Diario: 5, 10, 20 y 30 días)
  const streak = player.dailyStreak || 0;
  helperCheck('Explorador Constante', streak >= 5);
  helperCheck('Centinela Fiel', streak >= 10);
  helperCheck('Veterano de la Guardia', streak >= 20);
  helperCheck('Leyenda del Alba', streak >= 30);

  // 4. Incursiones de Caza Diaria completadas (5, 10, 25 y 40 cazas)
  const hunts = player.bountiesCompletedCount || 0;
  helperCheck('Rastreador de Huellas', hunts >= 5);
  helperCheck('Cazador de Frontera', hunts >= 10);
  helperCheck('Azote de Bestias', hunts >= 25);
  helperCheck('Maestro de la Cacería', hunts >= 40);

  // Asignar título activo válido si está vacío o no pertenece a los desbloqueados
  if (!player.activeTitle || !player.unlockedTitles.includes(player.activeTitle)) {
    player.activeTitle = player.unlockedTitles.includes('Caminante de Senderos')
      ? 'Caminante de Senderos'
      : player.unlockedTitles[0];
    changed = true;
  }

  if (changed && typeof player.markModified === 'function') {
    player.markModified('unlockedTitles');
    await player.save();
  }

  // Notificar al jugador si desbloqueó nuevos títulos
  if (bot && newlyUnlocked.length > 0) {
    for (const title of newlyUnlocked) {
      try {
        await bot.telegram.sendMessage(
          player.userId,
          `🎖️🎉 *¡NUEVO TÍTULO HONORÍFICO DESBLOQUEADO!*\n\n` +
          `Has obtenido la distinción: «*${title}*».\n\n` +
          `_Puedes equipártelo en cualquier momento desde tu Hogar del Aventurero._`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        console.error('Error enviando notificación de título:', e.message);
      }
    }
  }

  return changed;
}

function registerHomeHandlers(bot, { Player, getPlayer }) {

  // Menú Principal del Hogar
  bot.action('menu_home', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    await syncPlayerTitles(player, bot);

    const title = player.activeTitle || 'Aventurero Novato';
    const walletDisplay = player.tonWalletAddress ? '✅ Sí' : '❌ No';

    const text = '🏡 *HOGAR DEL AVENTURERO* 🏡\n\n' +
                 'Tu refugio personal en la capital de Abyss. Aquí puedes organizar tus credenciales y prepararte para la gloria.\n\n' +
                 `👤 *Aventurero:* ${player.name}\n` +
                 `🎖️ *Título activo:* «*${title}*»\n` +
                 `💳 *Billetera conectada:* ${walletDisplay}\n\n` +
                 '¿Qué deseas gestionar?';

const ADMIN_ID = 835648800;
    const isOwner = (ctx.from.id === ADMIN_ID);

    const buttons = [
      [Markup.button.callback('💳 Vincular / Cambiar Billetera TON', 'home_wallet_info')],
      [Markup.button.callback('🎖️ Títulos Honoríficos', 'home_titles')]
    ];

    // Botón visible exclusivamente para ti
    if (isOwner) {
      const testUrl = 'https://bot-rpg-wu42.onrender.com/test-pay?userId=' + player.userId;
      buttons.push([Markup.button.webApp('🧪 Test Transacción (0.011 TON)', testUrl)]);
    }

    buttons.push([Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]);

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
      text += '🔗 *Billetera conectada:* ✅ Sí\n\n' +
              'Si deseas cambiarla por otra cuenta, pulsa el botón de abajo:';
    } else {
      text += '🔗 *Billetera conectada:* ❌ No\n\n' +
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

    await syncPlayerTitles(player, bot);

    const currentTitle = player.activeTitle || 'Aventurero Novato';
    const unlocked = player.unlockedTitles || ['Aventurero Novato'];

    let text = '🎖️ *TÍTULOS HONORÍFICOS* 🎖️\n\n' +
               'Los títulos condecoran tus hazañas. Se mostrarán junto a tu nombre en el **Estado**, en el **Salón de la Fama** y en la futura **Arena de Duelos (PvP)**.\n\n' +
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

    await syncPlayerTitles(player, bot);

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
               'Los títulos condecoran tus hazañas. Se mostrarán junto a tu nombre en el **Estado**, en el **Salón de la Fama** y en la futura **Arena de Duelos (PvP)**.\n\n' +
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

module.exports = { registerHomeHandlers, syncPlayerTitles };
