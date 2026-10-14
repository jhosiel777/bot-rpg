// bot.js
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const startServer = require('./server');
const DUNGEONS = require('./dungeons');
const ITEMS = require('./shop');
const { PlayerBounty, getTodayUtcString } = require('./bountyModel');
const Maintenance = require('./maintenanceModel');

const {
  getUniversalTimeData,
  getBountyBoardView,
  getAutoSelectionView,
  startBountyTravel,
  renderBountyView,
  executeManualBountyAttack,
  promptBountyRetreat,
  handleBountyRetreat,
  getMerchantView,
  buyFromMerchant,
  getCombatView,
  resetBountyForAdmin
} = require('./bountyService');

const {
  initMarketPrices,
  evaluateDynamicPrice,
  getMarketView,
  createListing,
  buyListing,
  cancelListing,
  getItemBounds,
  getMarketHistory,
  getMarketTrendsView
} = require('./market');

const {
  Player,
  getPlayer,
  getRequiredExp,
  recordDrop,
  getGlobalStats,
  creditReferralBonus,
  MAX_LEVEL,
  MAX_STAT,
  MAX_BASE_HP,
  MAX_ENERGY
} = require('./playerModel');

const {
  safeAnswerCb,
  safeEditMessage,
  formatSeconds,
  formatHoursMinutes,
  broadcastToAll
} = require('./utils/telegramUtils');

const { registerDungeonHandlers } = require('./handlers/dungeonHandler');
const { registerAdminHandlers } = require('./handlers/adminHandler');
const { registerBossHandlers } = require('./handlers/bossHandler');
const { startBackgroundSchedulers } = require('./utils/schedulers');

const ADMIN_ID = 835648800;

let maintenanceState = {
  enabled: false,
  whitelist: []
};

const adminFlags = {
  broadcastWaiting: false,
  bossCustomHpWaiting: false,
  bossCustomMsgWaiting: false,
  targetLevelChangeId: null,
  whitelistAddWaiting: false,
  maintenanceEndWaiting: false
};

const lastUserMessages = new Map();
const pendingMarketSales = new Map();

async function initMaintenance() {
  try {
    let cfg = await Maintenance.findOne({ key: 'global_config' });
    if (!cfg) {
      cfg = await Maintenance.create({ key: 'global_config', enabled: false, whitelist: [] });
    }
    maintenanceState.enabled = cfg.enabled;
    maintenanceState.whitelist = cfg.whitelist || [];
    console.log(`🛠️ Estado de mantenimiento: ${maintenanceState.enabled ? 'ACTIVO' : 'INACTIVO'}`);
  } catch (err) {
    console.error('Error cargando configuración de mantenimiento:', err.message);
  }
}

const bot = new Telegraf(process.env.BOT_TOKEN);
startServer(bot);

// ==========================================
// MIDDLEWARE GLOBAL DE MANTENIMIENTO
// ==========================================
bot.use(async (ctx, next) => {
  if (!maintenanceState.enabled) return next();

  const userId = ctx.from?.id;
  if (!userId) return;

  const isAuthorized = userId === ADMIN_ID || maintenanceState.whitelist.includes(userId);
  if (isAuthorized) {
    return next();
  }

  const maintMsg = '🚧 *REINO EN RECONSTRUCCIÓN* 🚧\n\n' +
                   'Las puertas de Abyss están cerradas en este momento debido a que los maestros forjadores y arquitectos se encuentran realizando labores de reconstrucción y mejoras estructurales.\n\n' +
                   '⏳ *No puedes acceder en este instante. Por favor, regresa más tarde.*\n' +
                   '🛡️ _Tus datos, progresos y pertenencias se encuentran totalmente a salvo._';

  if (ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery('🚧 El reino está en reconstrucción. Vuelve más tarde.', { show_alert: true });
    } catch (e) {}
    return;
  }

  try {
    await ctx.reply(maintMsg, { parse_mode: 'Markdown' });
  } catch (e) {}
});

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('✅ Base de datos MongoDB conectada');
    await initMaintenance();
    await initMarketPrices();

    startBackgroundSchedulers(bot, {
      evaluateDynamicPrice,
      recordDrop,
      creditReferralBonus,
      lastUserMessages
    });
  })
  .catch((err) => console.error('❌ Error conectando a MongoDB:', err));

// ==========================================
// REGISTRO DE MÓDULOS DELEGADOS
// ==========================================
registerDungeonHandlers(bot, {
  Player,
  getPlayer,
  recordDrop,
  creditReferralBonus,
  lastUserMessages
});

registerAdminHandlers(bot, {
  ADMIN_ID,
  MAX_LEVEL,
  Player,
  getPlayer,
  getRequiredExp,
  getGlobalStats,
  getMarketHistory,
  maintenanceState,
  adminFlags
});

const bossController = registerBossHandlers(bot, {
  ADMIN_ID,
  MAX_LEVEL,
  MAX_ENERGY,
  Player,
  getPlayer,
  getRequiredExp,
  creditReferralBonus,
  adminFlags
});

// ==========================================
// TECLADOS Y VISTAS BASE
// ==========================================
const MAIN_BOTTOM_KEYBOARD = Markup.keyboard([
  ['⚔️ Estado', '📈 Atributos', '🎒 Inventario'],
  ['🏪 Mercado P2P', '🏆 Salón de la Fama']
]).resize();

function getRestTimeRemaining(player) {
  const now = Date.now();
  const cooldownMs = player.getRestCooldownMs();
  const diff = (player.lastRestTime + cooldownMs) - now;
  return diff > 0 ? Math.ceil(diff / 1000) : 0;
}

async function getStatusView(player) {
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

  const todayUtc = getTodayUtcString();
  const bounty = await PlayerBounty.findOne({ userId: player.userId, bountyDateUtc: todayUtc });
  const isHuntingActive = bounty && (bounty.status === 'traveling' || bounty.status === 'arrived');

  const shopButton = isHuntingActive
    ? Markup.button.callback('🛒 Mercader Ambulante', 'bounty_merchant_menu')
    : Markup.button.callback('🛒 Tienda', 'menu_shop');

  const buttons = [
    [Markup.button.callback('🧭 Explorar el Reino', 'menu_explore')],
    [
      Markup.button.callback(
        restSecLeft > 0 ? `🏕️ Descanso (${formatSeconds(restSecLeft)})` : '🏕️ Descansar (+30% Salud)',
        'rest'
      )
    ],
    [
      shopButton,
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
  const baseAtk = Math.round(20 + (str * 1.2) + Math.floor(Math.sqrt(str) * 3));
  const minSpread = Math.round(baseAtk * 0.80);
  const maxSpread = Math.round(baseAtk * 1.20);

  const dodgeChance = (agi * 0.3).toFixed(1);
  const trapDodge = Math.min(60, 15 + (agi * 0.45)).toFixed(1);
  const restCooldownMin = (player.getRestCooldownMs() / 60000).toFixed(1);

  const critChance = Math.min(30, (luk * 0.25)).toFixed(1);
  const dropBonus = (luk * 0.05).toFixed(2);

  let text = `📈 *Distribución de Atributos*\n\n` +
             `Puntos Disponibles: *${player.statPoints}*\n\n` +
             `💪 *Fuerza (${str}/${MAX_STAT}):*\n` +
             `• Daño de Ataque Base: *${baseAtk}* (Rango: *${minSpread} - ${maxSpread}*).\n` +
             `• Mitigación de daño recibido: *${dmgMitigation}%*.\n` +
             `• +Oro extra en botín de mazmorras.\n\n` +
             `❤️ *Salud Máxima (${player.maxHp}/${MAX_BASE_HP} HP):*\n` +
             `• Cada mejora suma +5 HP de vida máxima.\n\n` +
             `🏃 *Agilidad (${agi}/${MAX_STAT}):*\n` +
             `• Esquiva de combate: *${dodgeChance}%* por asalto.\n` +
             `• Esquiva de trampas y accidentes: *${trapDodge}%* de éxito.\n` +
             `• Impacto rozante en Jefe Mundial: 50% de reducción.\n` +
             `• Cooldown de descanso: *${restCooldownMin} min* (base 15 min).\n\n` +
             `🍀 *Suerte (${luk}/${MAX_STAT}):*\n` +
             `• Golpe Crítico Ofensivo: *${critChance}%* (Multiplica daño por 1.4x).\n` +
             `• Bono de drop de pociones: *+${dropBonus}%*.\n` +
             `• Incrementa la probabilidad de fortunas y gemas en Caza Diaria.\n\n`;

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

function getReferralView(player) {
  player.checkAndBurnReferralGold();
  const unclimed = (player.referralGoldToday || 0) + (player.referralGoldUnclaimed || 0);

  let text = '🚩 *SISTEMA DE RECLUTAMIENTO DEL GREMIO*\n\n' +
             'Invita a nuevos aventureros a inscribirse en el reino bajo tu bandera.\n\n' +
             '🔑 *Tu Código de Recluta:* `' + player.referralCode + '`\n\n' +
             '🛡️ *Reclutas en tu hermandad:* ' + (player.recruitsCount || 0) + '\n\n' +
             '📊 *Tributos de Oro de Reclutas:*\n' +
             '• Oro ganado hoy: *' + (player.referralGoldToday || 0) + ' / 10,000g*\n' +
             '• Oro pendiente por reclamar: *' + unclimed + 'g*\n' +
             '• Total histórico obtenido: *' + (player.referralGoldTotalEarned || 0) + 'g*\n\n' +
             '⚠️ _Regla del Gremio: Recibes el 5% del oro generado por tus reclutas. El contador diario reinicia a las 00:00 UTC._';

  const buttons = [];
  if (unclimed > 0) {
    buttons.push([Markup.button.callback('📥 Reclamar +' + unclimed + 'g a mi Bolsa', 'claim_referral_gold')]);
  }
  buttons.push([Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

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
    Markup.button.webApp('📺 Ver Anuncio (+1 🥤 Bebida)', 'https://bot-rpg-wu42.onrender.com/ad-reward?purpose=energy_drink&userId=' + player.userId)
  ]);

  buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

function getGatekeeperMessage() {
  return '🏰 *PUERTAS DE LA CIUDADELA ANCESTRAL*\n\n' +
         '_Ante ti se alza una muralla colosal cubierta de líquenes y runas centelleantes. Dos gigantes acorazados bajan sus pesadas alabardas cruzándolas frente a tu pecho, haciendo temblar los adoquines._\n\n' +
         '— *"¡Alto ahí, forastero! Ninguna sombra sin linaje ni errante solitario cruza el foso hacia el Reino de Abyss. Solo aquellos respaldados por un aventurero activo pueden ingresar."*\n\n' +
         '📜 *Uno de los guardianes extiende un pergamino de sellos dorados:*\n' +
         '*"Introduce el código de recluta (6 caracteres) otorgado por tu reclutador para inscribir tu nombre en el padrón del gremio."*\n\n' +
         '💬 _Escribe el código directamente aquí en el chat para obtener acceso:_';
}

// ==========================================
// ENTRADA DE TEXTO
// ==========================================
bot.on('text', async (ctx, next) => {
  const textMsg = ctx.message.text.trim();
  if (textMsg.startsWith('/')) return next();

  const userId = ctx.from.id;

  // 1. Delegar configuración de HP y mensajes del Jefe Mundial
  if (await bossController.handleBossTextConfig(ctx, textMsg)) {
    return;
  }

  // 2. Interceptar entrada de Telegram ID para Whitelist
  if (userId === ADMIN_ID && adminFlags.whitelistAddWaiting) {
    adminFlags.whitelistAddWaiting = false;
    const newTesterId = parseInt(textMsg, 10);

    if (isNaN(newTesterId) || newTesterId <= 0) {
      return await ctx.reply('⚠️ Introduce un Telegram ID numérico válido.');
    }

    if (newTesterId === ADMIN_ID || maintenanceState.whitelist.includes(newTesterId)) {
      return await ctx.reply('⚠️ Este ID ya se encuentra autorizado.');
    }

    maintenanceState.whitelist.push(newTesterId);
    await Maintenance.updateOne({ key: 'global_config' }, { whitelist: maintenanceState.whitelist });

    return await ctx.reply(
      `✅ *ID ${newTesterId} agregado exitosamente a la whitelist de testers.*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver a Whitelist', 'adm_whitelist_menu')]])
      }
    );
  }

  // 3. Interceptar reapertura de reino con notas de parche
  if (userId === ADMIN_ID && adminFlags.maintenanceEndWaiting) {
    adminFlags.maintenanceEndWaiting = false;
    maintenanceState.enabled = false;
    await Maintenance.updateOne({ key: 'global_config' }, { enabled: false });

    const reopenMsg = '✨🏰 *¡EL REINO DE ABYSS REABRE SUS PUERTAS!* 🏰✨\n\n' +
                      'Los arquitectos reales han finalizado las labores de reconstrucción y mantenimiento.\n\n' +
                      '📜 *Novedades y Cambios Implementados:*\n' +
                      '──────────────────────────\n' +
                      textMsg + '\n' +
                      '──────────────────────────\n\n' +
                      '⚔️ _¡Que sus armas nunca pierdan el filo! Ya pueden ingresar al campamento._';

    await broadcastToAll(bot, Player, reopenMsg);

    return await ctx.reply(
      '🟢 *El modo mantenimiento ha sido DESACTIVADO y se transmitió el anuncio global de reapertura.*',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]])
      }
    );
  }

  const player = await getPlayer(userId, ctx.from.first_name);

  // 4. Verificación de aspirantes en la puerta
  if (!player.isVerified && userId !== ADMIN_ID) {
    const rawInput = textMsg.toUpperCase();
    const recruiter = await Player.findOne({ referralCode: rawInput, isVerified: true });

    if (!recruiter || recruiter.userId === userId) {
      return await ctx.reply(
        '⚔️ *Los guardianes cruzan sus alabardas con severidad:*\n\n' +
        '— *"Ese sello no figura en el padrón del reino o es inválido. Verifica el código de 6 caracteres con quien te invitó."*',
        { parse_mode: 'Markdown' }
      );
    }

    const isCreatorCode = (recruiter.userId === ADMIN_ID);
    const starterGold = isCreatorCode ? 500 : 250;

    player.isVerified = true;
    player.referredBy = recruiter.userId;
    player.gold = (player.gold || 0) + starterGold;
    recruiter.recruitsCount = (recruiter.recruitsCount || 0) + 1;

    await player.save();
    await recruiter.save();

    try {
      await bot.telegram.sendMessage(
        recruiter.userId,
        `🎉 *¡Nuevo recluta bajo tu estandarte!*\n\n*${player.name}* ha superado los muros canjeando tu código.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {}

    const view = await getStatusView(player);
    await ctx.reply('⚔️ ¡Campamento listo!', MAIN_BOTTOM_KEYBOARD);
    const sent = await ctx.reply(view.text, view.keyboard);
    lastUserMessages.set(userId, sent.message_id);
    return;
  }

  // 5. Cambio de nivel por admin
  if (userId === ADMIN_ID && adminFlags.targetLevelChangeId !== null) {
    const targetUserId = adminFlags.targetLevelChangeId;
    adminFlags.targetLevelChangeId = null;

    const newLevel = parseInt(textMsg, 10);
    if (isNaN(newLevel) || newLevel < 1 || newLevel > MAX_LEVEL) {
      return await ctx.reply(`⚠️ Por favor introduce un número válido entre 1 y ${MAX_LEVEL}.`);
    }

    const u = await Player.findOne({ userId: targetUserId });
    if (!u) return await ctx.reply('⚠️ No se encontró al jugador.');

    u.level = newLevel;
    u.exp = 1;
    await u.save();

    return await ctx.reply(
      `✅ *Nivel actualizado con éxito:* *${u.name}* ahora es Nivel ${u.level}.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]])
      }
    );
  }

  // 6. Broadcast global manual por admin
  if (userId === ADMIN_ID && adminFlags.broadcastWaiting) {
    adminFlags.broadcastWaiting = false;
    const broadcastMsg = `🌌 *Una voz divina resuena en todo el reino...*\n` +
                         `📜 _El Creador les proclama:_\n\n` +
                         `"${textMsg}"`;

    const statusMsg = await ctx.reply('⏳ Transmitiendo mensaje a todos los aventureros...');
    await broadcastToAll(bot, Player, broadcastMsg);

    return await ctx.telegram.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      null,
      `✅ *Transmisión completada exitosamente.*`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]])
      }
    );
  }

  // 7. Publicación en el Mercado P2P
  const itemId = pendingMarketSales.get(userId);
  if (itemId) {
    const price = parseInt(textMsg, 10);
    if (isNaN(price) || price <= 0) {
      return await ctx.reply('⚠️ Por favor escribe solo un número entero positivo para el precio.');
    }

    const res = await createListing(userId, ctx.from.first_name, itemId, price);
    pendingMarketSales.delete(userId);

    return await ctx.reply(res.msg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🏪 Ver Mercado', 'menu_market')],
        [Markup.button.callback('🏕️ Volver al Campamento', 'status')]
      ])
    });
  }

  return next();
});

// ==========================================
// COMANDOS DE NAVEGACIÓN Y MENÚS
// ==========================================
async function handleStartMenu(ctx) {
  try {
    const userId = ctx.from.id;
    pendingMarketSales.delete(userId);
    if (userId === ADMIN_ID) {
      adminFlags.broadcastWaiting = false;
      adminFlags.bossCustomHpWaiting = false;
      adminFlags.bossCustomMsgWaiting = false;
      adminFlags.targetLevelChangeId = null;
      adminFlags.whitelistAddWaiting = false;
      adminFlags.maintenanceEndWaiting = false;
    }

    const player = await getPlayer(userId, ctx.from.first_name);
    if (!player.isVerified && userId !== ADMIN_ID) {
      return await ctx.reply(getGatekeeperMessage(), { parse_mode: 'Markdown' });
    }

    const oldMsgId = lastUserMessages.get(userId);
    if (oldMsgId) {
      try { await ctx.telegram.deleteMessage(userId, oldMsgId); } catch (e) {}
    }

    const view = await getStatusView(player);
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
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.isVerified && ctx.from.id !== ADMIN_ID) return ctx.reply(getGatekeeperMessage(), { parse_mode: 'Markdown' });
  const view = await getStatusView(player);
  const sent = await ctx.reply(view.text, view.keyboard);
  lastUserMessages.set(ctx.from.id, sent.message_id);
});

bot.hears('📈 Atributos', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.isVerified && ctx.from.id !== ADMIN_ID) return ctx.reply(getGatekeeperMessage(), { parse_mode: 'Markdown' });
  const view = getStatsView(player);
  const sent = await ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
  lastUserMessages.set(ctx.from.id, sent.message_id);
});

bot.hears('🎒 Inventario', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.isVerified && ctx.from.id !== ADMIN_ID) return ctx.reply(getGatekeeperMessage(), { parse_mode: 'Markdown' });

  let text = `🎒 *Mochila de Aventurero*\n\n` +
             `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
             `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n\n`;

  if (player.onMissionUntil && Date.now() < player.onMissionUntil) {
    text += `🚶 *En expedición:* Pociones usadas: ${player.potionsUsedInMission || 0}/2\n\n`;
  }

  text += `*Objetos:*\n` +
          `• Poción Menor de Vida (+10 HP): ${player.potionsSmall || 0}\n` +
          `• Poción Mayor de Vida (+35 HP): ${player.potionsMedium || 0}\n` +
          `• Elixir de Energía (+1 ⚡): ${player.potionsEnergy || 0}\n` +
          `• 🥤 Bebida Energética (+2 ⚡): ${player.potionsEnergyDrink || 0}/5\n` +
          `• 🩸 Elixir de Sangre de Dragón (Revivir al 100%): ${player.potionsDragonBlood || 0}\n\n` +
          `Toca un botón para consumir un objeto:`;

  const buttons = [];
  if (player.potionsSmall > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Menor', 'use_potion_small')]);
  if (player.potionsMedium > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Mayor', 'use_potion_medium')]);
  if (player.potionsEnergy > 0) buttons.push([Markup.button.callback('⚡ Usar Elixir', 'use_potion_energy')]);
  if (player.potionsEnergyDrink > 0) buttons.push([Markup.button.callback('🥤 Beber Energética (+2 ⚡)', 'use_energy_drink')]);
  if (player.potionsDragonBlood > 0) buttons.push([Markup.button.callback('🩸 Beber Sangre de Dragón (Revivir)', 'use_dragon_blood')]);
  buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

  await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.hears('🏪 Mercado P2P', async (ctx) => {
  const userId = ctx.from.id;
  const player = await getPlayer(userId, ctx.from.first_name);
  if (!player.isVerified && userId !== ADMIN_ID) return ctx.reply(getGatekeeperMessage(), { parse_mode: 'Markdown' });

  const { text, listings } = await getMarketView(userId);
  const buttons = [];

  listings.forEach((item, idx) => {
    const idStr = String(item._id);
    if (String(item.sellerId) === String(userId)) {
      buttons.push([Markup.button.callback(`❌ Cancelar #${idx + 1} (${item.itemName})`, `mkt_del_${idStr}`)]);
    } else {
      buttons.push([Markup.button.callback(`🛒 Comprar #${idx + 1} (${item.price}g)`, `mkt_buy_${idStr}`)]);
    }
  });

  buttons.push([
    Markup.button.callback('📊 Tendencias (4h)', 'mkt_trends'),
    Markup.button.callback('📦 Publicar un Objeto', 'mkt_sell_menu')
  ]);
  buttons.push([
    Markup.button.callback('🔄 Actualizar', 'menu_market'),
    Markup.button.callback('⬅️ Volver', 'status')
  ]);

  await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.hears('🏆 Salón de la Fama', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.isVerified && ctx.from.id !== ADMIN_ID) return ctx.reply(getGatekeeperMessage(), { parse_mode: 'Markdown' });

  const topPlayers = await Player.find({ isVerified: true }).sort({ level: -1, exp: -1 }).limit(10);
  let text = '🏆 *SALÓN DE LA FAMA (TOP 10)* 🏆\n\n';
  topPlayers.forEach((p, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
    text += `${medal} *${p.name}* — Nivel ${p.level} (EXP: ${p.exp})\n`;
  });

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Actualizar', 'menu_ranking')],
      [Markup.button.callback('⬅️ Volver', 'status')]
    ])
  });
});

bot.action('status', async (ctx) => {
  await safeAnswerCb(ctx);
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('menu_explore', async (ctx) => {
  await safeAnswerCb(ctx);
  const clock = getUniversalTimeData();
  const text = '🧭 *Exploración y Desafíos del Reino*\n\n' +
               '🕰️ *Reloj Universal:* `' + clock.timeStr + '`\n' +
               '⏳ *Reinicio del Reino:* en `' + clock.countdownStr + '`\n' +
               '──────────────────────────\n\n' +
               '• 🌲 *Expediciones y Mazmorras:* Mazmorras de exploración rápida.\n' +
               '• 📜 *Tablón de Caza Diaria:* Contrato diario por forajidos o bestias.\n' +
               '• 🐲 *Jefe Mundial (Coloso):* Asalta a los colosos ancestrales.\n' +
               '• 🚩 *Reclutar Aventureros:* Tu código de reclutamiento y tributos.';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🌲 Mazmorras y Rutas', 'menu_dungeons')],
    [Markup.button.callback('📜 Tablón de Caza Diaria', 'menu_bounty')],
    [Markup.button.callback('🐲 Jefe Mundial (Coloso)', 'menu_boss')],
    [Markup.button.callback('🚩 Reclutar Aventureros', 'menu_referrals')],
    [Markup.button.callback('⬅️ Volver al Campamento', 'status')]
  ]);

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

// Caza diaria
bot.action('menu_bounty', async (ctx) => {
  await safeAnswerCb(ctx);
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const view = await getBountyBoardView(ctx.from.id, player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('bounty_refresh', async (ctx) => {
  await safeAnswerCb(ctx, 'Actualizando estado...');
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  return await renderBountyView(ctx, player);
});

bot.action('bounty_depart_prompt', async (ctx) => {
  await safeAnswerCb(ctx);
  const text = '🧭 *Modo de Caza*\n\n' +
               '• 🤖 *Modo Automático:* Viajas y la pelea se resuelve con IA preventiva.\n' +
               '• ⚔️ *Modo Manual:* Combates turno por turno asalto a asalto.';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🤖 Modo Automático (Configurar)', 'bounty_auto_select')],
    [Markup.button.callback('⚔️ Modo Manual (Turno por turno)', 'bounty_go_manual')],
    [Markup.button.callback('⬅️ Volver al Tablón', 'menu_bounty')]
  ]);

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('bounty_auto_select', async (ctx) => {
  await safeAnswerCb(ctx);
  const view = await getAutoSelectionView(ctx.from.id);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('bounty_go_auto_normal', (ctx) => startBountyTravel(ctx, bot, 'auto', false));
bot.action('bounty_go_auto_plus', (ctx) => startBountyTravel(ctx, bot, 'auto', true));
bot.action('bounty_go_manual', (ctx) => startBountyTravel(ctx, bot, 'manual'));
bot.action('bounty_manual_hit', (ctx) => executeManualBountyAttack(ctx, bot));
bot.action('bounty_retreat_prompt', async (ctx) => { await safeAnswerCb(ctx); return await promptBountyRetreat(ctx); });
bot.action('bounty_retreat_confirmed', (ctx) => handleBountyRetreat(ctx));

// Tienda, descanso y stats
bot.action('rest', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (player.hp >= player.maxHp) return safeAnswerCb(ctx, 'Tu salud ya está al máximo.', true);
  const secLeft = getRestTimeRemaining(player);
  if (secLeft > 0) return safeAnswerCb(ctx, `⏳ Espera ${formatSeconds(secLeft)} para volver a descansar.`, true);

  const healAmount = Math.ceil(player.maxHp * 0.30);
  player.hp = Math.min(player.maxHp, player.hp + healAmount);
  player.lastRestTime = Date.now();
  await player.save();

  await safeAnswerCb(ctx, `Descansaste y recuperaste ${healAmount} HP (+30%).`, true);
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('add_str', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (player.statPoints <= 0) return safeAnswerCb(ctx, 'Sin puntos.', true);
  player.statPoints -= 1; player.strength += 1;
  await player.save();
  await safeAnswerCb(ctx, '+1 Fuerza');
  const view = getStatsView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('add_hp', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (player.statPoints <= 0) return safeAnswerCb(ctx, 'Sin puntos.', true);
  player.statPoints -= 1; player.maxHp += 5; player.hp += 5;
  await player.save();
  await safeAnswerCb(ctx, '+5 HP');
  const view = getStatsView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('add_agi', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (player.statPoints <= 0) return safeAnswerCb(ctx, 'Sin puntos.', true);
  player.statPoints -= 1; player.agility = (player.agility || 0) + 1;
  await player.save();
  await safeAnswerCb(ctx, '+1 Agilidad');
  const view = getStatsView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('add_luk', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (player.statPoints <= 0) return safeAnswerCb(ctx, 'Sin puntos.', true);
  player.statPoints -= 1; player.luck = (player.luck || 0) + 1;
  await player.save();
  await safeAnswerCb(ctx, '+1 Suerte');
  const view = getStatsView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.catch((err, ctx) => {
  console.error(`Error controlado (${ctx?.updateType}):`, err.message);
});

async function startBotWithRetry(retries = 5, delayMs = 4000) {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch({ dropPendingUpdates: true });
    console.log('✅ Bot conectado con éxito a Telegram');
  } catch (err) {
    if (err.response?.error_code === 409 && retries > 0) {
      setTimeout(() => startBotWithRetry(retries - 1, delayMs), delayMs);
    } else {
      console.error('Error al lanzar Telegraf:', err.message);
    }
  }
}

startBotWithRetry();

const safeStop = (signal) => { try { bot.stop(signal); } catch (e) {} };
process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));
