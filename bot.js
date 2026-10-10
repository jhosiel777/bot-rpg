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
  getItemBounds,
  getMarketHistory
} = require('./market');
const {
  Player,
  getPlayer,
  getRequiredExp,
  recordDrop,
  getGlobalStats,
  MAX_LEVEL,
  MAX_STAT,
  MAX_BASE_HP,
  MAX_ENERGY
} = require('./playerModel');

const ADMIN_ID = 835648800;

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Base de datos MongoDB conectada'))
  .catch((err) => console.error('❌ Error conectando a MongoDB:', err));

const bot = new Telegraf(process.env.BOT_TOKEN);

// Inicializar servidor HTTP pasando la instancia del bot
startServer(bot);

const activeExpeditions = new Set();
const lastUserMessages = new Map();
const pendingMarketSales = new Map();
let adminBroadcastWaiting = false;

const MAIN_BOTTOM_KEYBOARD = Markup.keyboard([
  ['⚔️ Estado', '📈 Atributos', '🎒 Inventario'],
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
  return `${m}s`;
}

function rollDungeonDrops(dungeon, player) {
  if (!dungeon.drops) return '';
  const luckVal = player.luck || 0;
  const luckBonus = luckVal * 0.0005;

  const obtained = [];

  if (dungeon.drops.energyChance > 0) {
    const chance = dungeon.drops.energyChance + luckBonus;
    if (Math.random() < chance) {
      player.potionsEnergy = (player.potionsEnergy || 0) + 1;
      recordDrop('energy');
      obtained.push('⚡ Elixir de Energía');
    }
  }

  if (dungeon.drops.mediumHpChance > 0) {
    const chance = dungeon.drops.mediumHpChance + luckBonus;
    if (Math.random() < chance) {
      player.potionsMedium = (player.potionsMedium || 0) + 1;
      recordDrop('medium');
      obtained.push('🧪 Poción Mayor de Vida');
    }
  }

  if (dungeon.drops.smallHpChance > 0) {
    const chance = dungeon.drops.smallHpChance + luckBonus;
    if (Math.random() < chance) {
      player.potionsSmall = (player.potionsSmall || 0) + 1;
      recordDrop('small');
      obtained.push('🧪 Poción Menor de Vida');
    }
  }

  if (obtained.length > 0) {
    return `\n🎁 *¡Botín extra hallado!* Recibiste: ${obtained.join(', ')}`;
  }
  return '';
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

  if (player.onMissionUntil && Date.now() < player.onMissionUntil) {
    const missionSecLeft = Math.ceil((player.onMissionUntil - Date.now()) / 1000);
    text += `🚶 *En expedición:* Regresa en ${missionSecLeft}s\n`;
  }

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
    ],
    [Markup.button.callback('🔄 Actualizar Estado', 'status')]
  ];

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

function getStatsView(player) {
  const str = player.strength || 0;
  const agi = player.agility || 0;
  const luk = player.luck || 0;

  const dmgMitigation = ((str / (str + 60)) * 40).toFixed(1);
  const dodgeChance = (agi * 0.3).toFixed(1);
  const trapDodge = Math.min(60, 15 + (agi * 0.45)).toFixed(1);
  const restCooldownMin = (player.getRestCooldownMs() / 60000).toFixed(1);

  const critChance = Math.min(25, 5 + (luk * 0.20)).toFixed(1);
  const peacefulChance = (10 + (luk * 0.20)).toFixed(1);
  const dropBonus = (luk * 0.05).toFixed(2);

  let text = `📈 *Distribución de Atributos*\n\n` +
             `Puntos Disponibles: *${player.statPoints}*\n\n` +
             `💪 *Fuerza (${str}/${MAX_STAT}):*\n` +
             `• Mitigación de daño físico: *${dmgMitigation}%*.\n` +
             `• +Oro extra en botín (hasta 50% de tope).\n\n` +
             `❤️ *Salud Máxima (${player.maxHp}/${MAX_BASE_HP} HP):*\n` +
             `• Cada mejora suma +5 HP de vida máxima.\n\n` +
             `🏃 *Agilidad (${agi}/${MAX_STAT}):*\n` +
             `• Esquiva de combate: *${dodgeChance}%* por asalto.\n` +
             `• Esquiva de trampas: *${trapDodge}%* de éxito (máx: 60%).\n` +
             `• Cooldown de descanso: *${restCooldownMin} min*.\n\n` +
             `🍀 *Suerte (${luk}/${MAX_STAT}):*\n` +
             `• Golpe Crítico Afortunado: *${critChance}%* (-35% daño recibido, +20% EXP).\n` +
             `• Probabilidad de tesoro pacífico: *${peacefulChance}%*.\n` +
             `• Bono de drop de pociones: *+${dropBonus}%*.\n\n`;

  if (player.statPoints > 0) {
    text += `Elige qué atributo mejorar:`;
  } else {
    text += `_No tienes puntos para asignar. Sube de nivel para ganar más._`;
  }

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

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

// PANEL DE ADMINISTRADOR
function getAdminHomeView() {
  const text = `👑 *Panel de Creador (Admin)*\n\n` +
               `Bienvenido al panel de control del reino. Opciones de gestión:`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Estadísticas de Drops', 'adm_drops')],
    [Markup.button.callback('👥 Lista de Usuarios (Paginada)', 'adm_users_page_1')],
    [Markup.button.callback('📜 Historial P2P', 'adm_mkt_page_1')],
    [Markup.button.callback('📢 Transmitir Mensaje Global', 'adm_prompt_broadcast')],
    [Markup.button.callback('❤️‍🩹 Revivir / Quitar Inconsciente (Propio)', 'adm_revive_self')],
    [Markup.button.callback('🥤 Auto-conceder +1 Bebida Energética', 'adm_give_drink')],
    [Markup.button.callback('🏕️ Volver al Campamento', 'status')]
  ]);

  return { text, keyboard };
}

bot.command('admin', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return;
  adminBroadcastWaiting = false;
  const view = getAdminHomeView();
  await ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('adm_home', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  await safeAnswerCb(ctx);
  adminBroadcastWaiting = false;
  const view = getAdminHomeView();
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('adm_drops', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  await safeAnswerCb(ctx);

  const stats = await getGlobalStats();
  const text = `📊 *Estadísticas Globales de Drops*\n\n` +
               `Cantidad total de ítems caídos en expediciones:\n\n` +
               `• 🧪 *Pociones Menores de Vida:* ${stats.totalDropsSmall}\n` +
               `• 🧪 *Pociones Mayores de Vida:* ${stats.totalDropsMedium}\n` +
               `• ⚡ *Elixires de Energía:* ${stats.totalDropsEnergy}\n\n` +
               `*Total histórico de objetos dropeados:* ${stats.totalDropsSmall + stats.totalDropsMedium + stats.totalDropsEnergy}`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Actualizar', 'adm_drops')],
    [Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]
  ]);

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('adm_prompt_broadcast', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  await safeAnswerCb(ctx);
  adminBroadcastWaiting = true;

  const text = `📢 *Transmisión Global del Creador*\n\n` +
               `Escribe a continuación en el chat el mensaje que deseas enviar a todos los aventureros del reino.\n\n` +
               `_Se les enviará con formato místico anunciando que el Creador les habla._`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⬅️ Cancelar', 'adm_home')]
  ]);

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

// Paginación de Usuarios
bot.action(/adm_users_page_(\d+)/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  await safeAnswerCb(ctx);

  const page = parseInt(ctx.match[1], 10) || 1;
  const limit = 10;
  const skip = (page - 1) * limit;

  const totalUsers = await Player.countDocuments();
  const totalPages = Math.ceil(totalUsers / limit) || 1;

  const users = await Player.find()
    .sort({ level: -1, exp: -1 })
    .skip(skip)
    .limit(limit);

  let text = `👥 *Lista de Usuarios Registrados* (Pág. ${page}/${totalPages})\n` +
             `Total de jugadores: *${totalUsers}*\n\n` +
             `Toca cualquier aventurero para ver sus datos y mochila:`;

  const buttons = [];

  for (const u of users) {
    buttons.push([
      Markup.button.callback(
        `⭐ Lv.${u.level} | ${u.name.substring(0, 18)} (ID: ${u.userId})`,
        `adm_user_${u.userId}_${page}`
      )
    ]);
  }

  const navRow = [];
  if (page > 1) {
    navRow.push(Markup.button.callback('⬅️ Anterior', `adm_users_page_${page - 1}`));
  }
  if (page < totalPages) {
    navRow.push(Markup.button.callback('Siguiente ➡️', `adm_users_page_${page + 1}`));
  }
  if (navRow.length) buttons.push(navRow);

  buttons.push([Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]);

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// Detalle individual de un usuario con opción de revivirlo
bot.action(/adm_user_(\d+)_(\d+)/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  await safeAnswerCb(ctx);

  const targetId = parseInt(ctx.match[1], 10);
  const backPage = parseInt(ctx.match[2], 10) || 1;

  const u = await Player.findOne({ userId: targetId });
  if (!u) {
    return await safeAnswerCb(ctx, 'Usuario no encontrado.', true);
  }

  const hpPoints = Math.max(0, Math.floor(((u.maxHp || 50) - 50) / 5));
  const isKO = (u.knockedOutUntil && Date.now() < u.knockedOutUntil) || u.hp <= 0;

  let text = `👤 *Detalles del Jugador: ${u.name}*\n\n` +
             `🆔 Telegram ID: ` + u.userId + `\n` +
             `⭐ Nivel: ${u.level}/${MAX_LEVEL}\n` +
             `🔮 EXP: ${u.exp}/${getRequiredExp(u.level)}\n` +
             `❤️ Salud: ${u.hp}/${u.maxHp} HP\n` +
             `⚡ Energía: ${u.energy}/${MAX_ENERGY}\n` +
             `💰 Oro: ${u.gold}\n\n`;

  if (isKO) {
    const secKO = Math.max(0, Math.ceil(((u.knockedOutUntil || 0) - Date.now()) / 1000));
    text += `💀 *Estado:* Inconsciente (${formatHoursMinutes(secKO)} restante)\n\n`;
  }

  text += `📊 *Atributos:*\n` +
          `• Fuerza: ${u.strength}\n` +
          `• Salud Invertida: +${hpPoints * 5} HP (${hpPoints} pts asignados)\n` +
          `• Agilidad: ${u.agility || 0}\n` +
          `• Suerte: ${u.luck || 0}\n` +
          `• Puntos sin asignar: ${u.statPoints}\n\n` +
          `🎒 *Inventario de Pociones:*\n` +
          `• Pociones Menores (+10 HP): ${u.potionsSmall || 0}\n` +
          `• Pociones Mayores (+35 HP): ${u.potionsMedium || 0}\n` +
          `• Elixires de Energía (+1 ⚡): ${u.potionsEnergy || 0}\n` +
          `• 🥤 Bebidas Energéticas (+2 ⚡): ${u.potionsEnergyDrink || 0}\n\n` +
          `🛡️ *Equipamiento Actual:*\n` +
          `_Próximamente disponible._`;

  const buttons = [];

  if (isKO) {
    buttons.push([Markup.button.callback('✨ Revivir Aventurero (Admin)', `adm_revive_target_${u.userId}_${backPage}`)]);
  }

  buttons.push([Markup.button.callback(`⬅️ Volver a la Lista (Pág. ${backPage})`, `adm_users_page_${backPage}`)]);

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// Revivir al propio creador
bot.action('adm_revive_self', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  const p = await getPlayer(ADMIN_ID);
  p.knockedOutUntil = 0;
  p.hp = p.maxHp;
  await p.save();
  await safeAnswerCb(ctx, `❤️‍🩹 ¡Has revivido! Salud restaurada a ${p.maxHp} HP.`, true);
  const view = getAdminHomeView();
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

// Revivir a un usuario específico desde el panel de inspección
bot.action(/adm_revive_target_(\d+)_(\d+)/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  const targetId = parseInt(ctx.match[1], 10);
  const backPage = parseInt(ctx.match[2], 10) || 1;

  const u = await Player.findOne({ userId: targetId });
  if (u) {
    u.knockedOutUntil = 0;
    u.hp = u.maxHp;
    await u.save();
    await safeAnswerCb(ctx, `✨ ${u.name} ha sido revivido con éxito.`, true);
  }

  // Refrescar la vista del usuario
  return await safeEditMessage(
    ctx,
    `✅ *El aventurero fue restaurado con vida completa.*`,
    Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Volver a los detalles', `adm_user_${targetId}_${backPage}`)],
      [Markup.button.callback(`👥 Volver a la Lista (Pág. ${backPage})`, `adm_users_page_${backPage}`)]
    ])
  );
});

// Historial P2P paginado
bot.action(/adm_mkt_page_(\d+)/, async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  await safeAnswerCb(ctx);

  const page = parseInt(ctx.match[1], 10) || 1;
  const { logs, total, totalPages } = await getMarketHistory(page, 5);

  let text = `📜 *Historial Global de Mercado P2P* (Pág. ${page}/${totalPages})\n` +
             `Total de transacciones: *${total}*\n\n`;

  if (!logs.length) {
    text += `_Aún no se han realizado transacciones en el mercado._`;
  } else {
    logs.forEach((log, idx) => {
      const dateStr = new Date(log.createdAt).toLocaleString('es-VE', {
        timeZone: 'America/Caracas',
        dateStyle: 'short',
        timeStyle: 'short'
      });
      text += `*#${(page - 1) * 5 + idx + 1} • ${log.itemName}*\n` +
              `• Comprador: ${log.buyerName} (${log.buyerId})\n` +
              `• Vendedor: ${log.sellerName} (${log.sellerId})\n` +
              `• Precio: 💰 ${log.price}g (Comisión: ${log.tax}g | Neto: ${log.sellerProfit}g)\n` +
              `• Fecha: ${dateStr}\n\n`;
    });
  }

  const buttons = [];
  const navRow = [];
  if (page > 1) {
    navRow.push(Markup.button.callback('⬅️ Anterior', `adm_mkt_page_${page - 1}`));
  }
  if (page < totalPages) {
    navRow.push(Markup.button.callback('Siguiente ➡️', `adm_mkt_page_${page + 1}`));
  }
  if (navRow.length) buttons.push(navRow);

  buttons.push([
    Markup.button.callback('🔄 Actualizar', `adm_mkt_page_${page}`),
    Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')
  ]);

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('adm_give_drink', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  const p = await getPlayer(ADMIN_ID);
  p.potionsEnergyDrink = (p.potionsEnergyDrink || 0) + 1;
  await p.save();
  await safeAnswerCb(ctx, `🥤 Te añadiste 1x Bebida Energética (Total: ${p.potionsEnergyDrink})`, true);
});

bot.action('adm_claim_overflow_drink', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  const p = await getPlayer(ADMIN_ID);
  p.potionsEnergyDrink = (p.potionsEnergyDrink || 0) + 1;
  await p.save();
  await safeAnswerCb(ctx, '🥤 Bebida agregada exitosamente a tu mochila de Creador.', true);
  try {
    await ctx.editMessageText(`✅ *Bebida añadida por privilegios de creador.* Tienes ${p.potionsEnergyDrink} en mochila.`, { parse_mode: 'Markdown' });
  } catch (e) {}
});

// Manejo de mensajes de texto: Broadcast global o venta en Mercado P2P
bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;

  if (userId === ADMIN_ID && adminBroadcastWaiting) {
    adminBroadcastWaiting = false;
    const msgContent = ctx.message.text.trim();

    const broadcastMsg = `🌌 *Una voz divina resuena en todo el reino...*\n` +
                         `📜 _El Creador les proclama:_\n\n` +
                         `"${msgContent}"`;

    const statusMsg = await ctx.reply('⏳ Transmitiendo mensaje a todos los aventureros...');

    const allPlayers = await Player.find({}, 'userId');
    let sentCount = 0;

    for (const p of allPlayers) {
      try {
        await ctx.telegram.sendMessage(p.userId, broadcastMsg, { parse_mode: 'Markdown' });
        sentCount++;
      } catch (err) {}
    }

    return await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `✅ *Transmisión completada.*\nEntregado a ${sentCount} de ${allPlayers.length} aventureros.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]])
      }
    );
  }

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

async function handleStartMenu(ctx) {
  try {
    const userId = ctx.from.id;
    pendingMarketSales.delete(userId);
    if (userId === ADMIN_ID) adminBroadcastWaiting = false;

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
    if (ctx.from.id === ADMIN_ID) adminBroadcastWaiting = false;
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const view = getStatusView(player);
    const sent = await ctx.reply(view.text, view.keyboard);
    lastUserMessages.set(ctx.from.id, sent.message_id);
  } catch (err) {
    console.error('Error en botón Estado:', err);
  }
});

bot.hears('📈 Atributos', async (ctx) => {
  try {
    pendingMarketSales.delete(ctx.from.id);
    if (ctx.from.id === ADMIN_ID) adminBroadcastWaiting = false;
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const view = getStatsView(player);
    const sent = await ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    lastUserMessages.set(ctx.from.id, sent.message_id);
  } catch (err) {
    console.error('Error en botón Atributos:', err);
  }
});

bot.hears('🎒 Inventario', async (ctx) => {
  try {
    pendingMarketSales.delete(ctx.from.id);
    if (ctx.from.id === ADMIN_ID) adminBroadcastWaiting = false;
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = `🎒 *Mochila de Aventurero*\n\n` +
               `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
               `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n\n`;

    if (player.onMissionUntil && Date.now() < player.onMissionUntil) {
      text += `🚶 *En expedición:* Pociones de salud usadas: ${player.potionsUsedInMission || 0}/2\n\n`;
    }

    text += `*Objetos:*\n` +
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
    if (ctx.from.id === ADMIN_ID) adminBroadcastWaiting = false;
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
  if (ctx.from.id === ADMIN_ID) adminBroadcastWaiting = false;
  try {
    const userId = ctx.from.id;
    const player = await getPlayer(userId, ctx.from.first_name);
    const view = getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  } catch (err) {
    console.error('Error en status:', err);
  }
});

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

// Tienda NPC
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

// Inventario
bot.action('menu_inv', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = `🎒 *Mochila de Aventurero*\n\n` +
               `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
               `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n\n`;

    if (player.onMissionUntil && Date.now() < player.onMissionUntil) {
      text += `🚶 *En expedición:* Pociones de salud usadas: ${player.potionsUsedInMission || 0}/2\n\n`;
    }

    text += `*Objetos:*\n` +
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
        const inMission = player.onMissionUntil && Date.now() < player.onMissionUntil;

        if (inMission && (player.potionsUsedInMission || 0) >= 2) {
          return await safeAnswerCb(
            ctx,
            '⚠️ Solo puedes usar un máximo de 2 pociones de salud durante una expedición.',
            true
          );
        }

        if (player.hp >= player.maxHp) {
          return await safeAnswerCb(ctx, 'Tu salud ya está al máximo.', true);
        }

        player[item.field] -= 1;
        player.hp = Math.min(player.maxHp, player.hp + item.value);

        if (inMission) {
          player.potionsUsedInMission = (player.potionsUsedInMission || 0) + 1;
          await safeAnswerCb(ctx, `Recuperaste +${item.value} HP. (Pociones en viaje: ${player.potionsUsedInMission}/2)`, true);
        } else {
          await safeAnswerCb(ctx, `Recuperaste +${item.value} HP.`, true);
        }
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
                 `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n\n`;

      if (player.onMissionUntil && Date.now() < player.onMissionUntil) {
        text += `🚶 *En expedición:* Pociones de salud usadas: ${player.potionsUsedInMission || 0}/2\n\n`;
      }

      text += `*Objetos:*\n` +
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

// Atributos
bot.action('menu_stats', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const view = getStatsView(player);
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
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
    await safeAnswerCb(ctx, `+1 Fuerza asignado`);

    const view = getStatsView(player);
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
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
    await safeAnswerCb(ctx, `+5 Salud Máxima asignado`);

    const view = getStatsView(player);
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
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
    await safeAnswerCb(ctx, `+1 Agilidad asignado`);

    const view = getStatsView(player);
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
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
    await safeAnswerCb(ctx, `+1 Suerte asignado`);

    const view = getStatsView(player);
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
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
    player.potionsUsedInMission = 0;
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
          p.potionsUsedInMission = 0;
          const enemy = dungeon.enemies[Math.floor(Math.random() * dungeon.enemies.length)];
          const roll = Math.random();

          const luckVal = p.luck || 0;
          const agiVal = p.agility || 0;
          const strVal = p.strength || 0;

          const peacefulChance = Math.min(0.30, 0.10 + (luckVal * 0.002));
          const maxStrBonus = Math.floor(enemy.maxGold * 0.5);
          const strBonus = Math.min(strVal, maxStrBonus);

          let resultMsg = '';

          if (roll < peacefulChance) {
            const baseGold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
            const bonusGold = baseGold + strBonus;
            const expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;
            p.gold += bonusGold;
            const leveledUp = p.addExp(expGained);
            const levelUpNotice = leveledUp ? `\n\n🎉 *¡SUBISTE DE NIVEL!* Pasaste a Nivel ${p.level}. ¡Salud y Energía restauradas al 100%!` : '';
            const dropMsg = rollDungeonDrops(dungeon, p);

            resultMsg = `📦 ¡Expedición finalizada en ${dungeon.name}!\n\n` +
                        `🍀 ¡Tu suerte te permitió sortear peligros y hallar un tesoro pacíficamente!\n` +
                        `💰 Oro: +${bonusGold} (Bono Fuerza: +${strBonus})\n` +
                        `🔮 EXP: +${expGained}` +
                        dropMsg +
                        levelUpNotice;
          } else {
            let trapMsg = '';
            let trapDmg = 0;

            if (dungeon.hasTraps && Math.random() < 0.20) {
              const dodgeTrapChance = Math.min(0.60, 0.15 + (agiVal * 0.0045));
              if (Math.random() < dodgeTrapChance) {
                trapMsg = `🤸 ¡Tus reflejos de Agilidad te permitieron esquivar una trampa mortal en el camino!\n\n`;
              } else {
                trapDmg = Math.floor(Math.random() * 8) + 5;
                p.hp = Math.max(0, p.hp - trapDmg);
                trapMsg = `⚠️ ¡Pisaste una trampa de pinchos y perdiste ${trapDmg} HP antes del combate!\n\n`;
              }
            }

            if (p.hp > 0) {
              const hitsCount = enemy.hits || 1;
              let rawCombatDmg = 0;
              let dodgedHits = 0;

              for (let i = 0; i < hitsCount; i++) {
                const dodgeChance = Math.min(0.35, agiVal * 0.003);
                if (Math.random() < dodgeChance) {
                  dodgedHits++;
                } else {
                  const singleHit = Math.floor(Math.random() * (enemy.maxDmg - enemy.minDmg + 1)) + enemy.minDmg;
                  rawCombatDmg += singleHit;
                }
              }

              const strMitigationRatio = (strVal / (strVal + 60)) * 0.40;
              let mitigatedCombatDmg = Math.round(rawCombatDmg * (1 - strMitigationRatio));

              const critChance = Math.min(0.25, 0.05 + (luckVal * 0.002));
              let isCrit = false;
              let critMsg = '';

              if (rawCombatDmg > 0 && Math.random() < critChance) {
                isCrit = true;
                mitigatedCombatDmg = Math.round(mitigatedCombatDmg * 0.65);
                critMsg = `✨ ¡Asestaste un *Golpe Crítico Afortunado*! Redujiste el ataque enemigo y ganaste +20% EXP.\n`;
              }

              const totalCombatDmg = Math.max(rawCombatDmg > 0 ? 1 : 0, mitigatedCombatDmg);
              p.hp = Math.max(0, p.hp - totalCombatDmg);

              const baseGold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
              const goldGained = baseGold + strBonus;

              let expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;
              if (isCrit) {
                expGained = Math.round(expGained * 1.20);
              }

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

                const dropMsg = rollDungeonDrops(dungeon, p);

                resultMsg = `${trapMsg}⚔️ Encuentro en ${dungeon.name}:\n\n` +
                            critMsg +
                            `Derrotaste a un ${enemy.name}.\n` +
                            (hitsCount > 1 ? `💥 Daño recibido en ${hitsCount} asaltos: ${totalCombatDmg} (Esquivaste ${dodgedHits})\n` : `💥 Daño recibido: ${totalCombatDmg}\n`) +
                            `❤️ Salud: ${p.hp}/${p.maxHp}\n` +
                            `💰 Oro: +${goldGained} (Bono Fuerza: +${strBonus})\n` +
                            `🔮 EXP: +${expGained}` +
                            dropMsg +
                            levelUpNotice;
              }
            } else {
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

module.exports = { bot, ADMIN_ID };

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
