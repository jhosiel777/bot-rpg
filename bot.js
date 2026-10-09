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
const { Player, getPlayer, getRequiredExp, MAX_BASE_HP, MAX_ENERGY, REST_COOLDOWN_MS } = require('./playerModel');

startServer();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Base de datos MongoDB conectada'))
  .catch((err) => console.error('❌ Error conectando a MongoDB:', err));

const bot = new Telegraf(process.env.BOT_TOKEN);

const activeExpeditions = new Set();
const lastUserMessages = new Map();
const pendingMarketSales = new Map();

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
  const diff = (player.lastRestTime + REST_COOLDOWN_MS) - now;
  return diff > 0 ? Math.ceil(diff / 1000) : 0;
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function getStatusView(player) {
  const reqExp = getRequiredExp(player.level);
  const restSecLeft = getRestTimeRemaining(player);

  let text = `⚔️ Aventurero: ${player.name}\n` +
             `⭐ Nivel: ${player.level}\n` +
             `🔮 EXP: ${player.exp}/${reqExp}\n` +
             `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
             `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n` +
             `💰 Oro: ${player.gold}\n\n`;

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

bot.start(async (ctx) => {
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
    const sent = await ctx.reply(view.text, view.keyboard);
    lastUserMessages.set(userId, sent.message_id);
  } catch (err) {
    console.error('Error en /start:', err);
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

// Comprar (captura segura de callback_data)
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

// Cancelar (captura segura de callback_data)
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

// Ranking
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

// Tienda NPC
bot.action('menu_shop', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = `🛒 *Tienda del Aventurero*\n` +
               `💰 Tu Oro: ${player.gold}\n\n` +
               `Objetos disponibles para compra:\n\n`;

    const buttons = [];
    for (const key in ITEMS) {
      const item = ITEMS[key];
      text += `• ${item.name} — 💰 ${item.cost} oro\n  _${item.desc}_\n\n`;
      buttons.push([Markup.button.callback(`Comprar ${item.name} (${item.cost}g)`, `buy_${item.id}`)]);
    }
    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en menu_shop:', err);
  }
});

Object.keys(ITEMS).forEach((key) => {
  const item = ITEMS[key];
  bot.action(`buy_${item.id}`, async (ctx) => {
    try {
      const player = await getPlayer(ctx.from.id, ctx.from.first_name);

      if (player.gold < item.cost) {
        return await safeAnswerCb(ctx, `❌ Oro insuficiente (${item.cost}g necesario).`, true);
      }

      player.gold -= item.cost;
      player[item.field] = (player[item.field] || 0) + 1;
      await player.save();

      await safeAnswerCb(ctx, `✅ Compraste 1x ${item.name}`, true);

      let text = `🛒 *Tienda del Aventurero*\n` +
                 `💰 Tu Oro: ${player.gold}\n\n` +
                 `Objetos disponibles para compra:\n\n`;

      const buttons = [];
      for (const k in ITEMS) {
        const it = ITEMS[k];
        text += `• ${it.name} — 💰 ${it.cost} oro\n  _${it.desc}_\n\n`;
        buttons.push([Markup.button.callback(`Comprar ${it.name} (${it.cost}g)`, `buy_${it.id}`)]);
      }
      buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

      return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (err) {
      console.error('Error procesando compra:', err);
      await safeAnswerCb(ctx, 'Error al procesar compra.', true);
    }
  });
});

// Inventario
bot.action('menu_inv', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = `🎒 *Mochila de Aventurero*\n\n` +
               `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
               `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n\n` +
               `*Objetos:*\n` +
               `• Poción Menor de Vida (+15 HP): ${player.potionsSmall || 0}\n` +
               `• Poción Mayor de Vida (+30 HP): ${player.potionsMedium || 0}\n` +
               `• Elixir de Energía (+1 ⚡): ${player.potionsEnergy || 0}\n\n` +
               `Toca un botón para consumir un objeto:`;

    const buttons = [];
    if (player.potionsSmall > 0) {
      buttons.push([Markup.button.callback('🧪 Usar Menor', 'use_potion_small')]);
    }
    if (player.potionsMedium > 0) {
      buttons.push([Markup.button.callback('🧪 Usar Mayor', 'use_potion_medium')]);
    }
    if (player.potionsEnergy > 0) {
      buttons.push([Markup.button.callback('⚡ Usar Elixir', 'use_potion_energy')]);
    }
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
                 `• Poción Menor de Vida (+15 HP): ${player.potionsSmall || 0}\n` +
                 `• Poción Mayor de Vida (+30 HP): ${player.potionsMedium || 0}\n` +
                 `• Elixir de Energía (+1 ⚡): ${player.potionsEnergy || 0}\n\n` +
                 `Toca un botón para consumir un objeto:`;

      const buttons = [];
      if (player.potionsSmall > 0) {
        buttons.push([Markup.button.callback('🧪 Usar Menor', 'use_potion_small')]);
      }
      if (player.potionsMedium > 0) {
        buttons.push([Markup.button.callback('🧪 Usar Mayor', 'use_potion_medium')]);
      }
      if (player.potionsEnergy > 0) {
        buttons.push([Markup.button.callback('⚡ Usar Elixir', 'use_potion_energy')]);
      }
      buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

      return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    } catch (err) {
      console.error('Error al usar objeto:', err);
    }
  });
});

// Descanso
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

// Atributos
bot.action('menu_stats', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    const text = `📈 Distribución de Atributos:\n\n` +
                 `Puntos Disponibles: ${player.statPoints}\n` +
                 `💪 Fuerza: ${player.strength} (Aumenta el botín y reduce daño recibido)\n` +
                 `❤️ Salud Máxima: ${player.maxHp}/${MAX_BASE_HP}\n\n` +
                 `Elige dónde asignar tus puntos:`;

    const buttons = [];
    if (player.statPoints > 0) {
      buttons.push([Markup.button.callback('💪 +1 Fuerza', 'add_str')]);
      if (player.maxHp < MAX_BASE_HP) {
        buttons.push([Markup.button.callback('❤️ +5 Salud Máxima', 'add_hp')]);
      }
    }
    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await safeEditMessage(ctx, text, Markup.inlineKeyboard(buttons));
  } catch (err) {
    console.error('Error en menu_stats:', err);
  }
});

bot.action('add_str', async (ctx) => {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (player.statPoints <= 0) {
      return await safeAnswerCb(ctx, 'No tienes puntos disponibles.', true);
    }

    player.statPoints -= 1;
    player.strength += 1;
    await player.save();
    await safeAnswerCb(ctx, '+1 Fuerza asignado');

    const view = getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  } catch (err) {
    console.error('Error en add_str:', err);
  }
});

bot.action('add_hp', async (ctx) => {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (player.statPoints <= 0) {
      return await safeAnswerCb(ctx, 'No tienes puntos disponibles.', true);
    }
    if (player.maxHp >= MAX_BASE_HP) {
      return await safeAnswerCb(ctx, 'Ya alcanzaste el tope de 100 HP base.', true);
    }

    player.statPoints -= 1;
    player.maxHp = Math.min(MAX_BASE_HP, player.maxHp + 5);
    player.hp = Math.min(player.maxHp, player.hp + 5);
    await player.save();
    await safeAnswerCb(ctx, '+5 Salud Máxima asignado');

    const view = getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  } catch (err) {
    console.error('Error en add_hp:', err);
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
               `🌲 Bosque Umbrío (Fácil) — Cuesta 1 ⚡ — Viaje: 10s\n` +
               `🪦 Cripta Abandonada (Medio) — Cuesta 2 ⚡ — Viaje: 20s\n` +
               `🌋 Guarida del Dragón (Difícil) — Cuesta 3 ⚡ — Viaje: 35s`;

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

          let resultMsg = '';

          if (roll < 0.30) {
            const bonusGold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold + p.strength;
            const expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;
            p.gold += bonusGold;
            p.addExp(expGained);

            resultMsg = `📦 ¡Expedición finalizada en ${dungeon.name}!\n\n` +
                        `Evitaste peligros y hallaste un tesoro.\n` +
                        `💰 Oro: +${bonusGold}\n` +
                        `🔮 EXP: +${expGained}`;
          } else {
            const dmg = Math.max(1, Math.floor(Math.random() * (enemy.maxDmg - enemy.minDmg + 1)) + enemy.minDmg - Math.floor(p.strength / 2));
            const goldGained = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold + p.strength;
            const expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;

            p.hp = Math.max(0, p.hp - dmg);

            if (p.hp === 0) {
              const lostExp = p.applyDeathPenalty();
              resultMsg = `⚔️ Encuentro en ${dungeon.name}:\n\n` +
                          `Fuiste abatido por un ${enemy.name} (recibiste ${dmg} de daño).\n` +
                          `💀 Caíste inconsciente.\n` +
                          `⚠️ Penalización: Perdiste ${lostExp} de EXP (Nivel actual: ${p.level}).\n` +
                          `Vuelve al campamento para descansar o usa una poción desde tu inventario.`;
            } else {
              p.gold += goldGained;
              p.addExp(expGained);
              resultMsg = `⚔️ Encuentro en ${dungeon.name}:\n\n` +
                          `Derrotaste a un ${enemy.name}.\n` +
                          `💥 Daño recibido: ${dmg} (Salud: ${p.hp}/${p.maxHp})\n` +
                          `💰 Oro: +${goldGained}\n` +
                          `🔮 EXP: +${expGained}`;
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

// Evitar doble instancia local / reinicio
bot.launch({ dropPendingUpdates: true })
  .then(() => console.log('✅ Bot conectado con éxito a Telegram'))
  .catch((err) => console.error('Error al lanzar Telegraf:', err.message));

const safeStop = (signal) => {
  try {
    bot.stop(signal);
  } catch (e) {}
};

process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));
