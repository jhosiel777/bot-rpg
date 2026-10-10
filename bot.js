const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const startServer = require('./server');
const DUNGEONS = require('./dungeons');
const ITEMS = require('./shop');
const { getRankingText } = require('./ranking');
const {
  getMarketView,
  createListing,
  buyListing,
  cancelListing,
  getItemBounds
} = require('./market');
const {
  Player,
  getPlayer,
  getRequiredExp,
  MAX_LEVEL,
  MAX_STAT,
  MAX_BASE_HP,
  MAX_ENERGY
} = require('./playerModel');

startServer();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Base de datos MongoDB conectada'))
  .catch((err) => console.error('❌ Error conectando a MongoDB:', err));

const bot = new Telegraf(process.env.BOT_TOKEN);

const activeExpeditions = new Set();
const lastUserMessages = new Map();
const pendingMarketSales = new Map();

// Menú persistente inferior
const MAIN_BOTTOM_KEYBOARD = Markup.keyboard([
  ['⚔️ Estado', '🎒 Inventario'],
  ['🏪 Mercado P2P', '🏆 Salón de la Fama']
]).resize();

bot.catch((err, ctx) => {
  console.error(`Error controlado en actualización (${ctx?.updateType}):`, err.message);
});

async function safeAnswerCb(ctx, text, showAlert = false) {
  try {
    if (text) {
      await ctx.answerCbQuery(text, { show_alert: showAlert });
    } else {
      await ctx.answerCbQuery();
    }
  } catch (err) {}
}

async function safeEditMessage(ctx, text, extra = {}) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch (err) {
    if (!err.description?.includes('message is not modified')) {
      console.error('Error al editar mensaje:', err.message);
    }
  }
}

function getRestTimeRemaining(player) {
  const now = Date.now();
  const cooldownMs = player.getRestCooldownMs();
  const diff = (player.lastRestTime + cooldownMs) - now;
  return diff > 0 ? Math.ceil(diff / 1000) : 0;
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function formatHoursMinutes(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function getStatusView(player) {
  const reqExp = getRequiredExp(player.level);
  const restSecLeft = getRestTimeRemaining(player);

  let text = `⚔️ Aventurero: ${player.name}\n` +
             `⭐ Nivel: ${player.level}/${MAX_LEVEL}\n` +
             `🔮 EXP: ${player.exp}/${reqExp}\n` +
             `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
             `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n` +
             `💰 Oro: ${player.gold}\n\n`;

  // Comprobar si está en expedición
  if (player.onMissionUntil && Date.now() < player.onMissionUntil) {
    const missionSecLeft = Math.ceil((player.onMissionUntil - Date.now()) / 1000);
    text += `🚶 *En expedición:* Regresa en ${missionSecLeft}s\n`;
  }

  // Comprobar penalización de noqueo
  if (player.knockedOutUntil && Date.now() < player.knockedOutUntil) {
    const koSecLeft = Math.ceil((player.knockedOutUntil - Date.now()) / 1000);
    text += `💀 *Estado:* Inconsciente (Recuperación en: ${formatHoursMinutes(koSecLeft)})\n`;
  }

  if (restSecLeft > 0) {
    text += `⏳ Próximo descanso en: ${formatSeconds(restSecLeft)}\n`;
  } else {
    text += `🏕️ Descanso disponible (+30% Salud)\n`;
  }

  if (player.statPoints > 0) {
    text += `✨ ¡Tienes ${player.statPoints} punto(s) de atributo sin asignar!\n`;
  }

  text += `\n¿Qué decides hacer?`;

  const buttons = [
    [Markup.button.callback('🗺️ Elegir Expedición', 'menu_dungeons')],
    [
      Markup.button.callback(
        restSecLeft > 0 ? `🏕️ Descanso (${formatSeconds(restSecLeft)})` : '🏕️ Descansar (+30% Salud)',
        'rest'
      )
    ],
    [
      Markup.button.callback('🛒 Tienda', 'menu_shop'),
      Markup.button.callback('🎒 Inventario', 'menu_inv')
    ],
    [
      Markup.button.callback('🏪 Mercado P2P', 'menu_market'),
      Markup.button.callback('🏆 Salón de la Fama', 'menu_ranking')
    ]
  ];

  if (player.statPoints > 0) {
    buttons.push([Markup.button.callback(`📈 Distribuir Puntos (${player.statPoints})`, 'menu_stats')]);
  }

  buttons.push([Markup.button.callback('🔄 Actualizar Estado', 'status')]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

// Handler general para iniciar o abrir menú (/start, /menu)
async function handleStartMenu(ctx) {
  try {
    const userId = ctx.from.id;
    pendingMarketSales.delete(userId);

    const oldMsgId = lastUserMessages.get(userId);
    if (oldMsgId) {
      try {
        await ctx.telegram.deleteMessage(userId, oldMsgId);
      } catch (e) {}
    }

    const player = await getPlayer(userId, ctx.from.first_name);
    const view = getStatusView(player);

    await ctx.reply('⚔️ ¡Campamento listo!', MAIN_BOTTOM_KEYBOARD);

    const sent = await ctx.reply(view.text, view.keyboard);
    lastUserMessages.set(userId, sent.message_id);
  } catch (err) {
    console.error('Error en start/menu:', err);
  }
}

bot.hears(/^\/(start|menu)\$/i, handleStartMenu);
bot.start(handleStartMenu);

bot.hears('⚔️ Estado', async (ctx) => {
  try {
    pendingMarketSales.delete(ctx.from.id);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const view = getStatusView(player);
    const sent = await ctx.reply(view.text, view.keyboard);
    lastUserMessages.set(ctx.from.id, sent.message_id);
  } catch (err) {
    console.error('Error en botón Estado:', err);
  }
});

bot.hears('🎒 Inventario', async (ctx) => {
  try {
    pendingMarketSales.delete(ctx.from.id);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = `🎒 *Mochila de Aventurero*\n\n` +
               `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
               `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n\n` +
               `*Objetos:*\n` +
               `• Poción Menor de Vida (+10 HP): ${player.potionsSmall || 0}\n` +
               `• Poción Mayor de Vida (+35 HP): ${player.potionsMedium || 0}\n` +
               `• Elixir de Energía (+1 ⚡): ${player.potionsEnergy || 0}\n` +
               `• 🥤 Bebida Energética (+2 ⚡): ${player.potionsEnergyDrink || 0}/5\n\n` +
               `Toca un botón para consumir un objeto:`;

    const buttons = [];
    if (player.potionsSmall > 0) buttons.push([Markup.button.callback('🧪 Usar Menor', 'use_potion_small')]);
    if (player.potionsMedium > 0) buttons.push([Markup.button.callback('🧪 Usar Mayor', 'use_potion_medium')]);
    if (player.potionsEnergy > 0) buttons.push([Markup.button.callback('⚡ Usar Elixir', 'use_potion_energy')]);
    if (player.potionsEnergyDrink > 0) buttons.push([Markup.button.callback('🥤 Beber Energética (+2 ⚡)', 'use_energy_drink')]);
    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en botón Inventario:', err);
  }
});

bot.hears('🏪 Mercado P2P', async (ctx) => {
  try {
    pendingMarketSales.delete(ctx.from.id);
    const { text, listings } = await getMarketView(ctx.from.id);
    const buttons = [];

    listings.forEach((item, idx) => {
      const idStr = String(item._id);
      const isMine = String(item.sellerId) === String(ctx.from.id);
      if (isMine) {
        buttons.push([Markup.button.callback(`❌ Cancelar #${idx + 1} (${item.itemName})`, `mkt_del_${idStr}`)]);
      } else {
        buttons.push([Markup.button.callback(`🛒 Comprar #${idx + 1} (${item.price}g)`, `mkt_buy_${idStr}`)]);
      }
    });

    buttons.push([Markup.button.callback('📦 Publicar un Objeto', 'mkt_sell_menu')]);
    buttons.push([
      Markup.button.callback('🔄 Actualizar', 'menu_market'),
      Markup.button.callback('⬅️ Volver', 'status')
    ]);

    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en botón Mercado P2P:', err);
  }
});

bot.hears('🏆 Salón de la Fama', async (ctx) => {
  try {
    const text = await getRankingText(ctx.from.id);
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Actualizar Ranking', 'menu_ranking')],
      [Markup.button.callback('⬅️ Volver', 'status')]
    ]);
    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  } catch (err) {
    console.error('Error en botón Salón de la Fama:', err);
  }
});

bot.command(['top', 'ranking'], async (ctx) => {
  try {
    const text = await getRankingText(ctx.from.id);
    return await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Ir al Menú', 'status')]])
    });
  } catch (err) {
    console.error('Error en comando /top:', err);
  }
});

bot.action('menu_ranking', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const text = await getRankingText(ctx.from.id);
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Actualizar Ranking', 'menu_ranking')],
      [Markup.button.callback('⬅️ Volver', 'status')]
    ]);
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  } catch (err) {
    console.error('Error en menu_ranking:', err);
  }
});

bot.action('status', async (ctx) => {
  await safeAnswerCb(ctx);
  pendingMarketSales.delete(ctx.from.id);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const view = getStatusView(player);
    lastUserMessages.set(ctx.from.id, ctx.callbackQuery.message.message_id);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  } catch (err) {
    console.error('Error en status:', err);
  }
});

// Mercado
async function renderMarket(ctx) {
  const { text, listings } = await getMarketView(ctx.from.id);
  const buttons = [];

  listings.forEach((item, idx) => {
    const idStr = String(item._id);
    const isMine = String(item.sellerId) === String(ctx.from.id);

    if (isMine) {
      buttons.push([Markup.button.callback(`❌ Cancelar #${idx + 1} (${item.itemName})`, `mkt_del_${idStr}`)]);
    } else {
      buttons.push([Markup.button.callback(`🛒 Comprar #${idx + 1} (${item.price}g)`, `mkt_buy_${idStr}`)]);
    }
  });

  buttons.push([Markup.button.callback('📦 Publicar un Objeto', 'mkt_sell_menu')]);
  buttons.push([
    Markup.button.callback('🔄 Actualizar', 'menu_market'),
    Markup.button.callback('⬅️ Volver', 'status')
  ]);

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

bot.action('menu_market', async (ctx) => {
  await safeAnswerCb(ctx);
  pendingMarketSales.delete(ctx.from.id);
  await renderMarket(ctx);
});

bot.action('mkt_sell_menu', async (ctx) => {
  await safeAnswerCb(ctx);
  pendingMarketSales.delete(ctx.from.id);

  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const buttons = [];

    for (const key in ITEMS) {
      const it = ITEMS[key];
      const count = player[it.field] || 0;
      if (count > 0) {
        buttons.push([Markup.button.callback(`${it.name} (x${count})`, `mkt_prep_${it.id}`)]);
      }
    }

    if (!buttons.length) {
      return await safeEditMessage(
        ctx,
        '📦 *Publicar en el Mercado*\n\nNo tienes ningún objeto disponible en tu inventario para vender.',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Mercado', 'menu_market')]])
        }
      );
    }

    buttons.push([Markup.button.callback('⬅️ Cancelar', 'menu_market')]);

    const text = '📦 *Publicar en el Mercado*\n\nSelecciona el objeto que deseas poner a la venta:';
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en mkt_sell_menu:', err);
  }
});

Object.keys(ITEMS).forEach((key) => {
  const item = ITEMS[key];
  bot.action(`mkt_prep_${item.id}`, async (ctx) => {
    await safeAnswerCb(ctx);

    const bounds = getItemBounds(item.id);
    pendingMarketSales.set(ctx.from.id, item.id);

    const text = `📦 *Vender: ${item.name}*\n\n` +
                 `• Precio base en tienda: ${item.cost}g\n` +
                 `• Rango permitido: *${bounds.minPrice}g* a *${bounds.maxPrice}g*\n` +
                 `• Comisión de mercado: 8%\n\n` +
                 `💬 *Escribe en el chat el precio en oro* que deseas asignarle:`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Cancelar', 'mkt_sell_menu')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });
});

bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;
  const itemId = pendingMarketSales.get(userId);

  if (!itemId) {
    return next();
  }

  const price = parseInt(ctx.message.text.trim(), 10);

  if (isNaN(price) || price <= 0) {
    return await ctx.reply('⚠️ Por favor escribe solo un número entero positivo para el precio.');
  }

  const res = await createListing(userId, ctx.from.first_name, itemId, price);

  if (!res.success) {
    return await ctx.reply(res.msg, { parse_mode: 'Markdown' });
  }

  pendingMarketSales.delete(userId);

  return await ctx.reply(res.msg, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🏪 Ver Mercado', 'menu_market')],
      [Markup.button.callback('🏕️ Volver al Campamento', 'status')]
    ])
  });
});

bot.action(/mkt_buy_(.+)/, async (ctx) => {
  try {
    const listingId = ctx.match[1];
    const res = await buyListing(listingId, ctx.from.id);

    await safeAnswerCb(ctx, res.msg, true);

    if (res.success) {
      try {
        await ctx.telegram.sendMessage(
          res.sellerId,
          `💰 ¡Tu oferta de *${res.itemName}* fue vendida en el mercado!\nRecibiste *+${res.sellerProfit}g* (8% comisión aplicada).`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {}
    }

    return await renderMarket(ctx);
  } catch (err) {
    console.error('Error en mkt_buy:', err);
    await safeAnswerCb(ctx, 'Error al procesar la compra.', true);
  }
});

bot.action(/mkt_del_(.+)/, async (ctx) => {
  try {
    const listingId = ctx.match[1];
    const res = await cancelListing(listingId, ctx.from.id);
    await safeAnswerCb(ctx, res.msg, true);
    return await renderMarket(ctx);
  } catch (err) {
    console.error('Error en mkt_del:', err);
    await safeAnswerCb(ctx, 'Error al cancelar la oferta.', true);
  }
});

function getShopView(player) {
  let text = `🛒 *Tienda del Aventurero*\n` +
             `💰 Tu Oro: ${player.gold}\n\n` +
             `Objetos disponibles:\n\n`;

  const buttons = [];

  for (const key in ITEMS) {
    const item = ITEMS[key];
    if (item.npcSell === false) continue;
    text += `• ${item.name} — 💰 ${item.cost} oro\n  _${item.desc}_\n\n`;
    buttons.push([Markup.button.callback(`Comprar ${item.name} (${item.cost}g)`, `buy_${item.id}`)]);
  }

  text += `• 🥤 Bebida Energética — 📺 Gratis (Patrocinio)\n  _Recupera +2 ⚡. Límite: 3/día. Máx: 5 en mochila._\n\n`;
  buttons.push([
    Markup.button.webApp('📺 Ver Anuncio (+1 🥤 Bebida)', 'https://bot-rpg-wu42.onrender.com/ad-reward')
  ]);

  buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

bot.action('menu_shop', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const view = getShopView(player);
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
  } catch (err) {
    console.error('Error en menu_shop:', err);
  }
});

Object.keys(ITEMS).forEach((key) => {
  const item = ITEMS[key];
  bot.action(`buy_${item.id}`, async (ctx) => {
    try {
      if (item.npcSell === false) {
        return await safeAnswerCb(ctx, '❌ Este objeto se obtiene viendo un anuncio patrocinado.', true);
      }

      const player = await getPlayer(ctx.from.id, ctx.from.first_name);

      if (player.gold < item.cost) {
        return await safeAnswerCb(ctx, `❌ Oro insuficiente (${item.cost}g necesario).`, true);
      }

      player.gold -= item.cost;
      player[item.field] = (player[item.field] || 0) + 1;
      await player.save();

      await safeAnswerCb(ctx, `✅ Compraste 1x ${item.name}`, true);

      const view = getShopView(player);
      return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
    } catch (err) {
      console.error('Error procesando compra:', err);
      await safeAnswerCb(ctx, 'Error al procesar compra.', true);
    }
  });
});

bot.action('menu_inv', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = `🎒 *Mochila de Aventurero*\n\n` +
               `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
               `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n\n` +
               `*Objetos:*\n` +
               `• Poción Menor de Vida (+10 HP): ${player.potionsSmall || 0}\n` +
               `• Poción Mayor de Vida (+35 HP): ${player.potionsMedium || 0}\n` +
               `• Elixir de Energía (+1 ⚡): ${player.potionsEnergy || 0}\n` +
               `• 🥤 Bebida Energética (+2 ⚡): ${player.potionsEnergyDrink || 0}/5\n\n` +
               `Toca un botón para consumir un objeto:`;

    const buttons = [];
    if (player.potionsSmall > 0) buttons.push([Markup.button.callback('🧪 Usar Menor', 'use_potion_small')]);
    if (player.potionsMedium > 0) buttons.push([Markup.button.callback('🧪 Usar Mayor', 'use_potion_medium')]);
    if (player.potionsEnergy > 0) buttons.push([Markup.button.callback('⚡ Usar Elixir', 'use_potion_energy')]);
    if (player.potionsEnergyDrink > 0) buttons.push([Markup.button.callback('🥤 Beber Energética (+2 ⚡)', 'use_energy_drink')]);
    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en menu_inv:', err);
  }
});

Object.keys(ITEMS).forEach((key) => {
  const item = ITEMS[key];
  bot.action(`use_${item.id}`, async (ctx) => {
    try {
      const player = await getPlayer(ctx.from.id, ctx.from.first_name);

      if (!player[item.field] || player[item.field] <= 0) {
        return await safeAnswerCb(ctx, 'No te quedan más pociones de este tipo.', true);
      }

      if (item.type === 'hp') {
        if (player.hp >= player.maxHp) {
          return await safeAnswerCb(ctx, 'Tu salud ya está al máximo.', true);
        }
        player[item.field] -= 1;
        player.hp = Math.min(player.maxHp, player.hp + item.value);
        await safeAnswerCb(ctx, `Recuperaste +${item.value} HP.`, true);
      } else if (item.type === 'energy') {
        if (player.energy >= MAX_ENERGY) {
          return await safeAnswerCb(ctx, 'Tu energía ya está al máximo.', true);
        }
        player[item.field] -= 1;
        player.energy = Math.min(MAX_ENERGY, player.energy + item.value);
        await safeAnswerCb(ctx, `Recuperaste +${item.value} Energía.`, true);
      }

      await player.save();

      let text = `🎒 *Mochila de Aventurero*\n\n` +
                 `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
                 `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n\n` +
                 `*Objetos:*\n` +
                 `• Poción Menor de Vida (+10 HP): ${player.potionsSmall || 0}\n` +
                 `• Poción Mayor de Vida (+35 HP): ${player.potionsMedium || 0}\n` +
                 `• Elixir de Energía (+1 ⚡): ${player.potionsEnergy || 0}\n` +
                 `• 🥤 Bebida Energética (+2 ⚡): ${player.potionsEnergyDrink || 0}/5\n\n` +
                 `Toca un botón para consumir un objeto:`;

      const buttons = [];
      if (player.potionsSmall > 0) buttons.push([Markup.button.callback('🧪 Usar Menor', 'use_potion_small')]);
      if (player.potionsMedium > 0) buttons.push([Markup.button.callback('🧪 Usar Mayor', 'use_potion_medium')]);
      if (player.potionsEnergy > 0) buttons.push([Markup.button.callback('⚡ Usar Elixir', 'use_potion_energy')]);
      if (player.potionsEnergyDrink > 0) buttons.push([Markup.button.callback('🥤 Beber Energética (+2 ⚡)', 'use_energy_drink')]);
      buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

      return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (err) {
      console.error('Error al usar objeto:', err);
    }
  });
});

// Descanso dinámico
bot.action('rest', async (ctx) => {
  const userId = ctx.from.id;
  if (activeExpeditions.has(userId)) {
    return await safeAnswerCb(ctx, 'Estás de viaje en una expedición.', true);
  }

  try {
    const player = await getPlayer(userId, ctx.from.first_name);

    if (Date.now() < player.onMissionUntil) {
      return await safeAnswerCb(ctx, 'Estás de viaje en una expedición.', true);
    }

    if (player.hp >= player.maxHp) {
      return await safeAnswerCb(ctx, `Tu salud ya está al máximo (${player.maxHp} HP).`, true);
    }

    const secLeft = getRestTimeRemaining(player);
    if (secLeft > 0) {
      return await safeAnswerCb(ctx, `⏳ Debes esperar ${formatSeconds(secLeft)} para volver a descansar.`, true);
    }

    const healAmount = Math.ceil(player.maxHp * 0.30);
    player.hp = Math.min(player.maxHp, player.hp + healAmount);
    player.lastRestTime = Date.now();
    await player.save();

    await safeAnswerCb(ctx, `Descansaste y recuperaste ${healAmount} HP (+30%).`, true);

    const view = getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  } catch (err) {
    console.error('Error en rest:', err);
  }
});

// Menú de Atributos (4 Stats)
bot.action('menu_stats', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const agi = player.agility || 0;
    const luk = player.luck || 0;
    const peacefulChance = (10 + (luk * 0.20)).toFixed(1);
    const dodgeChance = (agi * 0.3).toFixed(1);
    const trapDodge = (15 + (agi * 0.5)).toFixed(1);
    const restCooldownMin = (player.getRestCooldownMs() / 60000).toFixed(1);

    const text = `📈 *Distribución de Atributos*\n\n` +
                 `Puntos Disponibles: *${player.statPoints}*\n\n` +
                 `💪 *Fuerza (${player.strength}/100):*\n` +
                 `• +Oro extra en botín (hasta un 50% de tope).\n` +
                 `• Reduce el daño físico que recibes de los enemigos.\n\n` +
                 `❤️ *Salud Máxima (${player.maxHp}/300 HP):*\n` +
                 `• Cada punto añade +5 de vida máxima para resistir mazmorras.\n\n` +
                 `🏃 *Agilidad (${agi}/100):*\n` +
                 `• Esquiva de combate: *${dodgeChance}%* por golpe.\n` +
                 `• Esquiva de trampas: *${trapDodge}%* de éxito.\n` +
                 `• Cooldown de descanso: reducido a *${restCooldownMin} min*.\n\n` +
                 `🍀 *Suerte (${luk}/100):*\n` +
                 `• Probabilidad de hallar tesoros pacíficos sin pelear: *${peacefulChance}%*.\n\n` +
                 `Elige qué atributo mejorar:`;

    const buttons = [];
    if (player.statPoints > 0) {
      const row1 = [];
      if (player.strength < MAX_STAT) row1.push(Markup.button.callback('💪 +1 Fuerza', 'add_str'));
      if (player.maxHp < MAX_BASE_HP) row1.push(Markup.button.callback('❤️ +5 HP', 'add_hp'));
      if (row1.length) buttons.push(row1);

      const row2 = [];
      if (agi < MAX_STAT) row2.push(Markup.button.callback('🏃 +1 Agilidad', 'add_agi'));
      if (luk < MAX_STAT) row2.push(Markup.button.callback('🍀 +1 Suerte', 'add_luk'));
      if (row2.length) buttons.push(row2);
    }

    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en menu_stats:', err);
  }
});

bot.action('add_str', async (ctx) => {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (player.statPoints <= 0) return await safeAnswerCb(ctx, 'No tienes puntos disponibles.', true);
    if (player.strength >= MAX_STAT) return await safeAnswerCb(ctx, 'Fuerza ya está al máximo.', true);

    player.statPoints -= 1;
    player.strength += 1;
    await player.save();
    await safeAnswerCb(ctx, `+1 Fuerza asignado (${player.strength}/${MAX_STAT})`);

    const view = getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  } catch (err) {
    console.error('Error en add_str:', err);
  }
});

bot.action('add_hp', async (ctx) => {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (player.statPoints <= 0) return await safeAnswerCb(ctx, 'No tienes puntos disponibles.', true);
    if (player.maxHp >= MAX_BASE_HP) return await safeAnswerCb(ctx, `Ya alcanzaste el tope de ${MAX_BASE_HP} HP.`, true);

    player.statPoints -= 1;
    player.maxHp = Math.min(MAX_BASE_HP, player.maxHp + 5);
    player.hp = Math.min(player.maxHp, player.hp + 5);
    await player.save();
    await safeAnswerCb(ctx, `+5 Salud Máxima asignado (${player.maxHp}/${MAX_BASE_HP})`);

    const view = getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  } catch (err) {
    console.error('Error en add_hp:', err);
  }
});

bot.action('add_agi', async (ctx) => {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (player.statPoints <= 0) return await safeAnswerCb(ctx, 'No tienes puntos disponibles.', true);
    if ((player.agility || 0) >= MAX_STAT) return await safeAnswerCb(ctx, 'Agilidad ya está al máximo.', true);

    player.statPoints -= 1;
    player.agility = (player.agility || 0) + 1;
    await player.save();
    await safeAnswerCb(ctx, `+1 Agilidad asignado (${player.agility}/${MAX_STAT})`);

    const view = getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  } catch (err) {
    console.error('Error en add_agi:', err);
  }
});

bot.action('add_luk', async (ctx) => {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (player.statPoints <= 0) return await safeAnswerCb(ctx, 'No tienes puntos disponibles.', true);
    if ((player.luck || 0) >= MAX_STAT) return await safeAnswerCb(ctx, 'Suerte ya está al máximo.', true);

    player.statPoints -= 1;
    player.luck = (player.luck || 0) + 1;
    await player.save();
    await safeAnswerCb(ctx, `+1 Suerte asignado (${player.luck}/${MAX_STAT})`);

    const view = getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  } catch (err) {
    console.error('Error en add_luk:', err);
  }
});

// Expediciones
bot.action('menu_dungeons', async (ctx) => {
  const userId = ctx.from.id;
  if (activeExpeditions.has(userId)) {
    return await safeAnswerCb(ctx, 'Ya estás en una expedición.', true);
  }

  await safeAnswerCb(ctx);
  const text = `🗺️ Elige tu destino de exploración:\n\n` +
               `💀 Si tu vida cae a 0 quedas noqueado por 2 horas:\n\n` +
               `🌲 Bosque Umbrío (Fácil) — Cuesta 1 ⚡ — Viaje: 10s\n` +
               `🪦 Cripta Abandonada (Medio) — Cuesta 2 ⚡ — Viaje: 20s (Trampas activas)\n` +
               `🌋 Guarida del Dragón (Difícil) — Cuesta 3 ⚡ — Viaje: 35s (Ataques triples + Trampas)`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🌲 Explorar Bosque (10s)', 'go_bosque')],
    [Markup.button.callback('🪦 Explorar Cripta (20s)', 'go_cripta')],
    [Markup.button.callback('🌋 Explorar Dragón (35s)', 'go_dragon')],
    [Markup.button.callback('⬅️ Volver', 'status')]
  ]);

  return await safeEditMessage(ctx, text, keyboard);
});

async function startExpedition(ctx, dungeonKey) {
  const userId = ctx.from.id;

  if (activeExpeditions.has(userId)) {
    return await safeAnswerCb(ctx, 'Ya tienes una expedición en curso.', true);
  }

  try {
    const player = await getPlayer(userId, ctx.from.first_name);
    const dungeon = DUNGEONS[dungeonKey];

    if (player.knockedOutUntil && Date.now() < player.knockedOutUntil) {
      const remainingSec = Math.ceil((player.knockedOutUntil - Date.now()) / 1000);
      return await safeAnswerCb(
        ctx,
        `💀 Sigues inconsciente. Espera ${formatHoursMinutes(remainingSec)} para volver a explorar.`,
        true
      );
    }

    if (Date.now() < player.onMissionUntil) {
      const remaining = Math.ceil((player.onMissionUntil - Date.now()) / 1000);
      return await safeAnswerCb(ctx, `Ya estás en camino. Faltan ${remaining}s.`, true);
    }

    if (player.hp <= 0) {
      return await safeAnswerCb(ctx, '💀 Estás sin salud. Descansa o usa una poción.', true);
    }

    if (player.energy < dungeon.cost) {
      return await safeAnswerCb(ctx, `⚡ Necesitas ${dungeon.cost} de energía.`, true);
    }

    activeExpeditions.add(userId);

    player.energy -= dungeon.cost;
    player.onMissionUntil = Date.now() + (dungeon.travelSec * 1000);
    await player.save();
    await safeAnswerCb(ctx);

    const departText = `🚶 Marchando hacia: ${dungeon.name}\n\n` +
                       `⏳ Llegarás en ${dungeon.travelSec} segundos. El bot te avisará cuando ocurra el encuentro.`;

    await safeEditMessage(ctx, departText, Markup.inlineKeyboard([[Markup.button.callback('🔄 Ver Estado', 'status')]]));

    setTimeout(async () => {
      try {
        const p = await Player.findOne({ userId });
        if (p) {
          p.onMissionUntil = 0;
          const enemy = dungeon.enemies[Math.floor(Math.random() * dungeon.enemies.length)];
          const roll = Math.random();

          const luckVal = p.luck || 0;
          const agiVal = p.agility || 0;

          // Probabilidad de tesoro pacífico: 10% base + (Suerte * 0.20%), tope 30%
          const peacefulChance = Math.min(0.30, 0.10 + (luckVal * 0.002));

          const maxStrBonus = Math.floor(enemy.maxGold * 0.5);
          const strBonus = Math.min(p.strength, maxStrBonus);

          let resultMsg = '';

          if (roll < peacefulChance) {
            // Evento pacífico (Tesoro)
            const baseGold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
            const bonusGold = baseGold + strBonus;
            const expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;
            p.gold += bonusGold;
            p.addExp(expGained);

            resultMsg = `📦 ¡Expedición finalizada en ${dungeon.name}!\n\n` +
                        `🍀 ¡Tu suerte te permitió sortear peligros y hallar un tesoro pacíficamente!\n` +
                        `💰 Oro: +${bonusGold} (Bono Fuerza: +${strBonus})\n` +
                        `🔮 EXP: +${expGained}`;
          } else {
            let trapMsg = '';
            let trapDmg = 0;

            // Evento de Trampas en Cripta y Dragón (20% de probabilidad)
            if (dungeon.hasTraps && Math.random() < 0.20) {
              const dodgeTrapChance = Math.min(0.65, 0.15 + (agiVal * 0.005));
              if (Math.random() < dodgeTrapChance) {
                trapMsg = `🤸 ¡Tus reflejos de Agilidad te permitieron esquivar una trampa mortal en el camino!\n\n`;
              } else {
                trapDmg = Math.floor(Math.random() * 8) + 5; // 5 a 12 de daño de trampa
                p.hp = Math.max(0, p.hp - trapDmg);
                trapMsg = `⚠️ ¡Pisaste una trampa de pinchos y perdiste ${trapDmg} HP antes del combate!\n\n`;
              }
            }

            // Si sobrevivió a la trampa, combate contra el enemigo
            if (p.hp > 0) {
              const hitsCount = enemy.hits || 1;
              let totalCombatDmg = 0;
              let dodgedHits = 0;

              for (let i = 0; i < hitsCount; i++) {
                // Esquiva por Agilidad: 0.3% por punto
                const dodgeChance = Math.min(0.35, agiVal * 0.003);
                if (Math.random() < dodgeChance) {
                  dodgedHits++;
                } else {
                  const rawDmg = Math.floor(Math.random() * (enemy.maxDmg - enemy.minDmg + 1)) + enemy.minDmg;
                  // Reducción por Fuerza (mínimo 1 por golpe conectado)
                  const netDmg = Math.max(1, rawDmg - Math.floor(p.strength / (hitsCount > 1 ? 4 : 2)));
                  totalCombatDmg += netDmg;
                }
              }

              p.hp = Math.max(0, p.hp - totalCombatDmg);

              const baseGold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
              const goldGained = baseGold + strBonus;
              const expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;

              if (p.hp === 0) {
                const lostExp = p.applyDeathPenalty();
                const KNOCKOUT_MS = 2 * 60 * 60 * 1000;
                p.knockedOutUntil = Date.now() + KNOCKOUT_MS;

                resultMsg = `${trapMsg}⚔️ Encuentro en ${dungeon.name}:\n\n` +
                            `Fuiste derrotado por un ${enemy.name}.\n` +
                            `💥 Daño de combate: ${totalCombatDmg}${dodgedHits > 0 ? ` (Esquivaste \${dodgedHits} golpe/s)` : ''}\n` +
                            `💀 ¡Has quedado inconsciente!\n` +
                            `⏳ No podrás explorar durante las próximas 2 horas.\n` +
                            `⚠️ Perdiste ${lostExp} de EXP acumulada.\n` +
                            `Descansa en el campamento o usa pociones para reponerte.`;
          } else {
  p.gold += goldGained;
  const leveledUp = p.addExp(expGained);
  let levelUpNotice = '';

  if (leveledUp) {
    levelUpNotice = `\n\n🎉 *¡SUBISTE DE NIVEL!* Pasaste a Nivel ${p.level}. ¡Salud y Energía restauradas al 100%!`;
  }

  resultMsg = `${trapMsg}⚔️ Encuentro en ${dungeon.name}:\n\n` +
              `Derrotaste a un ${enemy.name}.\n` +
              (hitsCount > 1 ? `💥 Daño recibido en ${hitsCount} asaltos: ${totalCombatDmg} (Esquivaste ${dodgedHits})\n` : `💥 Daño recibido: ${totalCombatDmg}\n`) +
              `❤️ Salud: ${p.hp}/${p.maxHp}\n` +
              `💰 Oro: +${goldGained} (Bono Fuerza: +${strBonus})\n` +
              `🔮 EXP: +${expGained}` +
              levelUpNotice;
}
            } else {
              // Murió por la trampa
              const lostExp = p.applyDeathPenalty();
              const KNOCKOUT_MS = 2 * 60 * 60 * 1000;
              p.knockedOutUntil = Date.now() + KNOCKOUT_MS;

              resultMsg = `${trapMsg}💀 La trampa fue mortal y caíste inconsciente antes de combatir.\n` +
                          `⏳ Espera 2 horas para recuperarte o usa pociones.\n` +
                          `⚠️ Perdiste ${lostExp} de EXP acumulada.`;
            }
          }

          await p.save();

          const sent = await ctx.telegram.sendMessage(
            userId,
            resultMsg,
            Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Campamento', 'status')]])
          );
          lastUserMessages.set(userId, sent.message_id);
        }
      } catch (err) {
        console.error('Error al resolver expedición:', err);
      } finally {
        activeExpeditions.delete(userId);
      }
    }, dungeon.travelSec * 1000);

  } catch (err) {
    activeExpeditions.delete(userId);
    console.error('Error al iniciar expedición:', err);
  }
}

bot.action('go_bosque', (ctx) => startExpedition(ctx, 'bosque'));
bot.action('go_cripta', (ctx) => startExpedition(ctx, 'cripta'));
bot.action('go_dragon', (ctx) => startExpedition(ctx, 'dragon'));

async function startBotWithRetry(retries = 5, delayMs = 4000) {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch({ dropPendingUpdates: true });
    console.log('✅ Bot conectado con éxito a Telegram');
  } catch (err) {
    if (err.response?.error_code === 409 && retries > 0) {
      console.log(`⚠️ Conflicto 409 temporal durante el deploy. Reintentando en ${delayMs / 1000}s... (Intentos restantes: ${retries})`);
      setTimeout(() => startBotWithRetry(retries - 1, delayMs), delayMs);
    } else {
      console.error('Error al lanzar Telegraf:', err.message);
    }
  }
}

startBotWithRetry();

const safeStop = (signal) => {
  try {
    bot.stop(signal);
  } catch (e) {}
};

process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));
