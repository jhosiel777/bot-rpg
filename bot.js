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
  getTodayUtc,
  getYesterdayUtc,
  getTimeUntilMidnightUtc,
  getDailyReward,
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
const { registerTavernHandlers } = require('./handlers/tavernHandler');
const { registerHomeHandlers } = require('./handlers/homeHandler');
const { startBackgroundSchedulers } = require('./utils/schedulers');

const ADMIN_ID = 835648800;
const LOGS_GROUP_ID = -1004496297432;

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
                    'Las puertas de Abyss están cerradas en este momento debido a labores de reconstrucción.\n\n' +
                    '⏳ *No puedes acceder en este instante. Por favor, regresa más tarde.*\n' +
                    '🛡️ _Tus datos y progresos se encuentran totalmente a salvo._';

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

registerTavernHandlers(bot, {
  Player,
  getPlayer
});

registerHomeHandlers(bot, {
  Player,
  getPlayer
});

// ==========================================
// TECLADOS Y VISTAS BASE
// ==========================================
const MAIN_BOTTOM_KEYBOARD = Markup.keyboard([
  ['⚔️ Estado', '📈 Atributos', '🎒 Inventario'],
  ['🏪 Mercado P2P', '🏆 Salón de la Fama'],
  ['🎁 Bono Diario']
]).resize();

function getRestTimeRemaining(player) {
  const now = Date.now();
  const cooldownMs = player.getRestCooldownMs();
  const diff = (player.lastRestTime + cooldownMs) - now;
  return diff > 0 ? Math.ceil(diff / 1000) : 0;
}

async function getStatusView(player) {
  const now = Date.now();
  if (player.knockedOutUntil && player.knockedOutUntil <= now) {
    player.knockedOutUntil = 0;
    if (player.hp <= 0) player.hp = 1;
    await player.save();
  } else if (player.hp <= 0 && !player.knockedOutUntil) {
    player.hp = 1;
    await player.save();
  }

  const reqExp = getRequiredExp(player.level);
  const restSecLeft = getRestTimeRemaining(player);
  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;

  let text = `⚔️ Aventurero: ${player.name}\n` +
             `⭐ Nivel: ${player.level}/${MAX_LEVEL}\n` +
             `🔮 EXP: ${player.exp}/${reqExp}\n` +
             `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
             `⚡ Energía: ${player.energy}/${playerMaxEnergy}\n` +
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
    [Markup.button.url('📢 Edictos & Crónicas del Reino', 'https://t.me/+WSbOMJvOo6Q5ZDJh')],
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
             '⚠️ _Regla del Gremio: Recibes el 5% del oro generado por tus reclutas._';

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

  // Lógica secuencial de Gemas de Resistencia (Tope de energía)
  if (!player.hasEnergyGem1) {
    text += `• 💎 *Gema de Resistencia I* — 💰 15.000 oro\n  _Aumenta permanentemente tu energía máxima a 11 ⚡._\n\n`;
    buttons.push([Markup.button.callback('💎 Comprar Gema Resistencia I (15.000g)', 'buy_gem_1')]);
  } else if (!player.hasEnergyGem2) {
    text += `• 💎 *Gema de Resistencia II* — 💰 45.000 oro\n  _Aumenta permanentemente tu energía máxima a 12 ⚡._\n\n`;
    buttons.push([Markup.button.callback('💎 Comprar Gema Resistencia II (45.000g)', 'buy_gem_2')]);
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
         '— *"¡Alto ahí, forastero! Solo aquellos respaldados por un aventurero activo pueden ingresar."*\n\n' +
         '📜 *Introduce el código de recluta (6 caracteres) otorgado por tu reclutador.*';
}

function getDailyBonusView(player) {
  const today = getTodayUtc();
  const yesterday = getYesterdayUtc();
  const alreadyClaimed = player.lastDailyClaimDate === today;

  let potentialStreak = 1;
  if (player.lastDailyClaimDate === yesterday) {
    potentialStreak = (player.dailyStreak || 0) + 1;
  } else if (alreadyClaimed) {
    potentialStreak = player.dailyStreak || 1;
  }

  const reward = getDailyReward(potentialStreak);

  let text = '🎁 *BONO DIARIO DE LA CIUDADELA*\n\n' +
             '¡Reclama tu botín diario cada día a las 00:00 UTC!\n\n' +
             '• Empiezas ganando 100g al día.\n' +
             '• Cada 3 días de racha recibes +1 Elixir de Energía (+1 ⚡).\n' +
             '• Al alcanzar los 30 días seguidos, ¡ganarás 1.000g diarios!\n\n' +
             '🔥 *Racha actual:* ' + (player.dailyStreak || 0) + ' días\n' +
             '💰 *Recompensa de hoy:* ' + reward.gold + 'g' + (reward.givesElixir ? ' + 1x ⚡ Elixir de Energía' : '') + '\n\n';

  if (alreadyClaimed) {
    text += '✅ *Ya reclamaste tu recompensa de hoy.*\n' +
            '⏳ Próximo reinicio en: *' + getTimeUntilMidnightUtc() + '* (00:00 UTC)';

    return {
      text,
      keyboard: Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Campamento', 'status')]])
    };
  }

  text += 'Para reclamar el botín de hoy, apoya al reino viendo un anuncio rápido en la Mini App:';

  const miniAppUrl = 'https://bot-rpg-wu42.onrender.com/ad-daily?userId=' + player.userId;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('📺 Ver Anuncio y Reclamar Bono', miniAppUrl)],
    [Markup.button.callback('⬅️ Volver al Campamento', 'status')]
  ]);

  return { text, keyboard };
}

// ==========================================
// ENTRADA DE TEXTO
// ==========================================
bot.on('text', async (ctx, next) => {
  const textMsg = ctx.message.text.trim();
  if (textMsg.startsWith('/')) return next();

  const userId = ctx.from.id;

  if (await bossController.handleBossTextConfig(ctx, textMsg)) {
    return;
  }

  if (userId === ADMIN_ID && adminFlags.whitelistAddWaiting) {
    adminFlags.whitelistAddWaiting = false;
    const newTesterId = parseInt(textMsg, 10);
    if (isNaN(newTesterId) || newTesterId <= 0) return await ctx.reply('⚠️ ID numérico inválido.');

    if (newTesterId === ADMIN_ID || maintenanceState.whitelist.includes(newTesterId)) {
      return await ctx.reply('⚠️ Este ID ya está autorizado.');
    }

    maintenanceState.whitelist.push(newTesterId);
    await Maintenance.updateOne({ key: 'global_config' }, { whitelist: maintenanceState.whitelist });
    return await ctx.reply(`✅ ID ${newTesterId} añadido a la whitelist.`);
  }

  if (userId === ADMIN_ID && adminFlags.maintenanceEndWaiting) {
    adminFlags.maintenanceEndWaiting = false;
    maintenanceState.enabled = false;
    await Maintenance.updateOne({ key: 'global_config' }, { enabled: false });

    const reopenMsg = '✨🏰 *¡EL REINO DE ABYSS REABRE SUS PUERTAS!* 🏰✨\n\n' +
                      '📜 *Novedades:*\n' + textMsg;
    await broadcastToAll(bot, Player, reopenMsg);
    return await ctx.reply('🟢 Mantenimiento desactivado.');
  }

  const player = await getPlayer(userId, ctx.from.first_name);

  if (!player.isVerified && userId !== ADMIN_ID) {
    const rawInput = textMsg.toUpperCase();
    const recruiter = await Player.findOne({ referralCode: rawInput, isVerified: true });
    if (!recruiter || recruiter.userId === userId) {
      return await ctx.reply('⚔️ Código inválido. Verifica el código de 6 caracteres.');
    }

    player.isVerified = true;
    player.referredBy = recruiter.userId;
    player.gold = (player.gold || 0) + (recruiter.userId === ADMIN_ID ? 500 : 250);
    recruiter.recruitsCount = (recruiter.recruitsCount || 0) + 1;
    await player.save();
    await recruiter.save();

    try {
      await bot.telegram.sendMessage(
        LOGS_GROUP_ID,
        `📢 *¡Nuevo Reclutamiento!*\n\n⚔️ *${recruiter.name}* acaba de reclutar a *${player.name}*.`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      console.error('Error enviando notificación al grupo:', err.message);
    }

    const view = await getStatusView(player);
    await ctx.reply('⚔️ ¡Bienvenido al reino!', MAIN_BOTTOM_KEYBOARD);
    const sent = await ctx.reply(view.text, view.keyboard);
    lastUserMessages.set(userId, sent.message_id);
    return;
  }

  if (userId === ADMIN_ID && adminFlags.targetLevelChangeId !== null) {
    const targetUserId = adminFlags.targetLevelChangeId;
    adminFlags.targetLevelChangeId = null;
    const newLevel = parseInt(textMsg, 10);
    if (isNaN(newLevel) || newLevel < 1 || newLevel > MAX_LEVEL) {
      return await ctx.reply(`⚠️ Nivel inválido (1 - ${MAX_LEVEL}).`);
    }

    const u = await Player.findOne({ userId: targetUserId });
    if (!u) return await ctx.reply('⚠️ No encontrado.');
    u.level = newLevel;
    u.exp = 1;
    await u.save();
    return await ctx.reply(`✅ Nivel de ${u.name} cambiado a ${u.level}.`);
  }

  if (userId === ADMIN_ID && adminFlags.broadcastWaiting) {
    adminFlags.broadcastWaiting = false;
    const broadcastMsg = `⚡🌌 *Súbitamente, un estruendo sacude los confines de Abyss...*\n` +
                          `📜 _Una presencia ancestral desciende y el Creador proclama:_\n\n` +
                          `"${textMsg}"`;
    await broadcastToAll(bot, Player, broadcastMsg);
    return await ctx.reply('✅ Mensaje transmitido a todos.');
  }

  const itemId = pendingMarketSales.get(userId);
  if (itemId) {
    const price = parseInt(textMsg, 10);
    if (isNaN(price) || price <= 0) return await ctx.reply('⚠️ Escribe un número entero positivo para el precio.');

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
// COMANDOS DE NAVEGACIÓN
// ==========================================
async function handleStartMenu(ctx) {
  try {
    const userId = ctx.from.id;
    pendingMarketSales.delete(userId);

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

bot.hears(/^\/(start|menu)$/i, handleStartMenu);
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

  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;
  let text = `🎒 *Mochila de Aventurero*\n\n` +
             `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
             `⚡ Energía: ${player.energy}/${playerMaxEnergy}\n\n`;

  text += `*Objetos:*\n` +
          `• Poción Menor de Vida (+10 HP): ${player.potionsSmall || 0}\n` +
          `• Poción Mayor de Vida (+35 HP): ${player.potionsMedium || 0}\n` +
          `• Elixir de Energía (+1 ⚡): ${player.potionsEnergy || 0}\n` +
          `• 🥤 Bebida Energética (+2 ⚡): ${player.potionsEnergyDrink || 0}/5\n` +
          `• 🩸 Elixir de Sangre de Dragón: ${player.potionsDragonBlood || 0}\n\n` +
          `Toca un botón para consumir un objeto:`;

  const buttons = [];
  if (player.potionsSmall > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Menor', 'use_potion_small')]);
  if (player.potionsMedium > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Mayor', 'use_potion_medium')]);
  if (player.potionsEnergy > 0) buttons.push([Markup.button.callback('⚡ Usar Elixir', 'use_potion_energy')]);
  if (player.potionsEnergyDrink > 0) buttons.push([Markup.button.callback('🥤 Beber Energética (+2 ⚡)', 'use_energy_drink')]);
  if (player.potionsDragonBlood > 0) buttons.push([Markup.button.callback('🩸 Beber Sangre de Dragón', 'use_dragon_blood')]);
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

bot.hears('🎁 Bono Diario', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.isVerified && ctx.from.id !== ADMIN_ID) return ctx.reply(getGatekeeperMessage(), { parse_mode: 'Markdown' });
  const view = getDailyBonusView(player);
  await ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('menu_daily_bonus', async (ctx) => {
  await safeAnswerCb(ctx);
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const view = getDailyBonusView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
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
               '• 🌲 *Expediciones y Mazmorras:* Exploración rápida.\n' +
               '• 📜 *Tablón de Caza Diaria:* Contrato diario.\n' +
               '• 🐲 *Jefe Mundial (Coloso):* Asalto a los colosos.\n' +
               '• 🍻 *Taberna del Jabalí Ebrio:* Ocio, misterios y descanso.\n' +
               '• 🏡 *Hogar del Aventurero:* Tus aposentos, billetera y títulos.\n' +
               '• 🚩 *Reclutar Aventureros:* Tu código de reclutamiento.';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🌲 Mazmorras y Rutas', 'menu_dungeons')],
    [Markup.button.callback('📜 Tablón de Caza Diaria', 'menu_bounty')],
    [Markup.button.callback('🐲 Jefe Mundial (Coloso)', 'menu_boss')],
    [Markup.button.callback('🍻 Taberna del Jabalí Ebrio', 'menu_tavern')],
    [Markup.button.callback('🏡 Hogar del Aventurero', 'menu_home')],
    [Markup.button.callback('🚩 Reclutar Aventureros', 'menu_referrals')],
    [Markup.button.callback('⬅️ Volver al Campamento', 'status')]
  ]);

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

// ==========================================
// ACCIONES DE CAZA DIARIA (BOUNTY)
// ==========================================
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
               '• ⚔️ *Modo Manual:* Combates asalto por asalto.';

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
bot.action('bounty_start_manual', (ctx) => executeManualBountyAttack(ctx, bot));
bot.action('bounty_manual_hit', (ctx) => executeManualBountyAttack(ctx, bot));
bot.action('bounty_retreat_prompt', async (ctx) => { await safeAnswerCb(ctx); return await promptBountyRetreat(ctx); });
bot.action('bounty_retreat_confirmed', (ctx) => handleBountyRetreat(ctx));
bot.action('bounty_retreat', async (ctx) => { await safeAnswerCb(ctx); return await promptBountyRetreat(ctx); });

bot.action('bounty_admin_reset', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
  await resetBountyForAdmin(ctx.from.id);
  await safeAnswerCb(ctx, '👑 Contrato reseteado.');
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  return await renderBountyView(ctx, player);
});

bot.action('bounty_merchant_menu', async (ctx) => {
  await safeAnswerCb(ctx);
  const view = await getMerchantView(ctx.from.id);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('bounty_buy_pot_small', (ctx) => buyFromMerchant(ctx, 'small'));
bot.action('bounty_buy_pot_medium', (ctx) => buyFromMerchant(ctx, 'medium'));
bot.action('bounty_buy_pot_energy', (ctx) => buyFromMerchant(ctx, 'energy'));

bot.action('bounty_back_to_fight', async (ctx) => {
  await safeAnswerCb(ctx);
  return await getCombatView(ctx);
});

// ==========================================
// MOCHILA EN COMBATE DE BOUNTY
// ==========================================
bot.action('bounty_inv', async (ctx) => {
  await safeAnswerCb(ctx);
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;

  let text = `🎒 *Mochila en Pleno Combate*\n\n` +
             `❤️ Salud: ${player.hp}/${player.maxHp} HP\n` +
             `⚡ Energía: ${player.energy}/${playerMaxEnergy}\n\n` +
             `*Objetos:*\n` +
             `• Poción Menor (+10 HP): ${player.potionsSmall || 0}\n` +
             `• Poción Mayor (+35 HP): ${player.potionsMedium || 0}\n` +
             `• Elixir Energía (+1 ⚡): ${player.potionsEnergy || 0}\n` +
             `• 🥤 Bebida (+2 ⚡): ${player.potionsEnergyDrink || 0}/5\n` +
             `• 🩸 Elixir Sangre Dragón: ${player.potionsDragonBlood || 0}\n\n` +
             `Toca una poción para consumirla:`;

  const buttons = [];
  if (player.potionsSmall > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Menor', 'bounty_use_pot_small')]);
  if (player.potionsMedium > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Mayor', 'bounty_use_pot_medium')]);
  if (player.potionsEnergy > 0) buttons.push([Markup.button.callback('⚡ Usar Elixir Energía', 'bounty_use_pot_energy')]);
  if (player.potionsEnergyDrink > 0) buttons.push([Markup.button.callback('🥤 Beber Energética (+2 ⚡)', 'bounty_use_energy_drink')]);
  if (player.potionsDragonBlood > 0) buttons.push([Markup.button.callback('🩸 Usar Sangre de Dragón', 'bounty_use_dragon_blood')]);
  buttons.push([Markup.button.callback('⬅️ Volver al Combate', 'bounty_back_to_fight')]);

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('bounty_use_pot_small', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsSmall || player.potionsSmall <= 0) return await safeAnswerCb(ctx, 'Sin pociones menores.', true);
  if (player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);
  player.potionsSmall -= 1;
  player.hp = Math.min(player.maxHp, player.hp + 10);
  await player.save();
  await safeAnswerCb(ctx, '+10 HP recuperados');
  return await getCombatView(ctx);
});

bot.action('bounty_use_pot_medium', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsMedium || player.potionsMedium <= 0) return await safeAnswerCb(ctx, 'Sin pociones mayores.', true);
  if (player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);
  player.potionsMedium -= 1;
  player.hp = Math.min(player.maxHp, player.hp + 35);
  await player.save();
  await safeAnswerCb(ctx, '+35 HP recuperados');
  return await getCombatView(ctx);
});

bot.action('bounty_use_pot_energy', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;
  if (!player.potionsEnergy || player.potionsEnergy <= 0) return await safeAnswerCb(ctx, 'Sin elixires.', true);
  if (player.energy >= playerMaxEnergy) return await safeAnswerCb(ctx, 'Energía al máximo.', true);
  player.potionsEnergy -= 1;
  player.energy = Math.min(playerMaxEnergy, player.energy + 1);
  await player.save();
  await safeAnswerCb(ctx, '+1⚡ Energía');
  return await getCombatView(ctx);
});

bot.action('bounty_use_energy_drink', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;
  if (!player.potionsEnergyDrink || player.potionsEnergyDrink <= 0) return await safeAnswerCb(ctx, 'Sin bebidas energéticas.', true);
  if (player.energy >= playerMaxEnergy) return await safeAnswerCb(ctx, 'Energía al máximo.', true);
  player.potionsEnergyDrink -= 1;
  player.energy = Math.min(playerMaxEnergy, player.energy + 2);
  await player.save();
  await safeAnswerCb(ctx, '🥤 +2⚡ Energía');
  return await getCombatView(ctx);
});

bot.action('bounty_use_dragon_blood', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsDragonBlood || player.potionsDragonBlood <= 0) return await safeAnswerCb(ctx, 'Sin sangre de dragón.', true);

  const isKO = player.knockedOutUntil && Date.now() < player.knockedOutUntil;
  if (!isKO && player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);

  if (isKO) {
    player.potionsDragonBlood -= 1;
    player.knockedOutUntil = 0;
    player.hp = player.maxHp;
    await player.save();
    await safeAnswerCb(ctx, '🩸 ¡Bebiste el Elixir! Ya no estás inconsciente y tienes 100% HP.', true);
    const view = await getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  }

  await safeAnswerCb(ctx);
  const confirmText = `🩸 *Confirmación:*\n\n¿Deseas beber el elixir para sanar al 100% (${player.hp}/${player.maxHp} HP)?`;
  const confirmBtns = Markup.inlineKeyboard([
    [Markup.button.callback('🩸 Sí, beber', 'use_dragon_blood_confirm')],
    [Markup.button.callback('❌ No, cancelar', 'menu_inv')]
  ]);
  return await safeEditMessage(ctx, confirmText, { parse_mode: 'Markdown', ...confirmBtns });
});

bot.action('use_dragon_blood_confirm', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsDragonBlood || player.potionsDragonBlood <= 0) return await safeAnswerCb(ctx, 'Sin elixires.', true);
  player.potionsDragonBlood -= 1;
  player.hp = player.maxHp;
  await player.save();
  await safeAnswerCb(ctx, '🩸 Salud restaurada.', true);
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

// ==========================================
// DESCANSO Y ASIGNACIÓN DE STATS
// ==========================================
bot.action('rest', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (player.hp >= player.maxHp) return safeAnswerCb(ctx, 'Tu salud ya está al máximo.', true);
  const secLeft = getRestTimeRemaining(player);
  if (secLeft > 0) return safeAnswerCb(ctx, `⏳ Espera ${formatSeconds(secLeft)} para descansar.`, true);

  const healAmount = Math.ceil(player.maxHp * 0.30);
  player.hp = Math.min(player.maxHp, player.hp + healAmount);
  player.lastRestTime = Date.now();
  await player.save();

  await safeAnswerCb(ctx, `Descansaste y recuperaste ${healAmount} HP (+30%).`, true);
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('menu_stats', async (ctx) => {
  await safeAnswerCb(ctx);
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const view = getStatsView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
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

// ==========================================
// INVENTARIO GENERAL Y USO DE POCIONES
// ==========================================
bot.action('menu_inv', async (ctx) => {
  try {
    await safeAnswerCb(ctx);
    const userId = ctx.from.id;
    const player = await getPlayer(userId, ctx.from.first_name);

    if (!player) {
      return await ctx.reply('⚠️ No se encontró la información de tu personaje.');
    }

    const pSmall = player.potionsSmall || 0;
    const pMed = player.potionsMedium || 0;
    const pEnergy = player.potionsEnergy || 0;
    const pDrink = player.potionsEnergyDrink || 0;
    const pDragon = player.potionsDragonBlood || 0;
    const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;

    let text = `🎒 *Mochila de Aventurero*\n\n` +
               `❤️ Salud: *${player.hp}/${player.maxHp}*\n` +
               `⚡ Energía: *${player.energy}/${playerMaxEnergy}*\n\n` +
               `*Objetos:*\n` +
               `• Poción Menor (+10 HP): *${pSmall}*\n` +
               `• Poción Mayor (+35 HP): *${pMed}*\n` +
               `• Elixir Energía (+1 ⚡): *${pEnergy}*\n` +
               `• 🥤 Bebida (+2 ⚡): *${pDrink}/5*\n` +
               `• 🩸 Elixir Sangre Dragón: *${pDragon}*\n\n` +
               `Toca un botón para consumir un objeto:`;

    const buttons = [];
    if (pSmall > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Menor', 'use_potion_small')]);
    if (pMed > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Mayor', 'use_potion_medium')]);
    if (pEnergy > 0) buttons.push([Markup.button.callback('⚡ Usar Elixir', 'use_potion_energy')]);
    if (pDrink > 0) buttons.push([Markup.button.callback('🥤 Beber Energética (+2 ⚡)', 'use_energy_drink')]);
    if (pDragon > 0) buttons.push([Markup.button.callback('🩸 Beber Sangre de Dragón', 'use_dragon_blood')]);
    
    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en menu_inv:', err);
    try {
      await ctx.answerCbQuery('⚠️ Error al abrir el inventario.', { show_alert: true });
    } catch (e) {}
  }
});

bot.action('use_potion_small', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsSmall || player.potionsSmall <= 0) return await safeAnswerCb(ctx, 'Sin pociones.', true);
  if (player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);
  player.potionsSmall -= 1;
  player.hp = Math.min(player.maxHp, player.hp + 10);
  await player.save();
  await safeAnswerCb(ctx, 'Recuperaste +10 HP');
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('use_potion_medium', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsMedium || player.potionsMedium <= 0) return await safeAnswerCb(ctx, 'Sin pociones.', true);
  if (player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);
  player.potionsMedium -= 1;
  player.hp = Math.min(player.maxHp, player.hp + 35);
  await player.save();
  await safeAnswerCb(ctx, 'Recuperaste +35 HP');
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('use_potion_energy', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;
  if (!player.potionsEnergy || player.potionsEnergy <= 0) return await safeAnswerCb(ctx, 'Sin elixires.', true);
  if (player.energy >= playerMaxEnergy) return await safeAnswerCb(ctx, 'Energía al máximo.', true);
  player.potionsEnergy -= 1;
  player.energy = Math.min(playerMaxEnergy, player.energy + 1);
  await player.save();
  await safeAnswerCb(ctx, 'Recuperaste +1⚡ Energía');
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('use_energy_drink', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;
  if (!player.potionsEnergyDrink || player.potionsEnergyDrink <= 0) return await safeAnswerCb(ctx, 'Sin bebidas energéticas.', true);
  if (player.energy >= playerMaxEnergy) return await safeAnswerCb(ctx, 'Energía al máximo.', true);
  player.potionsEnergyDrink -= 1;
  player.energy = Math.min(playerMaxEnergy, player.energy + 2);
  await player.save();
  await safeAnswerCb(ctx, '🥤 +2⚡ Energía');
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('use_dragon_blood', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsDragonBlood || player.potionsDragonBlood <= 0) return await safeAnswerCb(ctx, 'Sin sangre de dragón.', true);

  const isKO = player.knockedOutUntil && Date.now() < player.knockedOutUntil;
  if (!isKO && player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);

  if (isKO) {
    player.potionsDragonBlood -= 1;
    player.knockedOutUntil = 0;
    player.hp = player.maxHp;
    await player.save();
    await safeAnswerCb(ctx, '🩸 ¡Bebiste el Elixir! Ya no estás inconsciente y tienes 100% HP.', true);
    const view = await getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  }

  await safeAnswerCb(ctx);
  const confirmText = `🩸 *Confirmación:*\n\n¿Deseas beber el elixir para sanar al 100% (${player.hp}/${player.maxHp} HP)?`;
  const confirmBtns = Markup.inlineKeyboard([
    [Markup.button.callback('🩸 Sí, beber', 'use_dragon_blood_confirm')],
    [Markup.button.callback('❌ No, cancelar', 'menu_inv')]
  ]);
  return await safeEditMessage(ctx, confirmText, { parse_mode: 'Markdown', ...confirmBtns });
});

bot.action('use_dragon_blood_confirm', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsDragonBlood || player.potionsDragonBlood <= 0) return await safeAnswerCb(ctx, 'Sin elixires.', true);
  player.potionsDragonBlood -= 1;
  player.hp = player.maxHp;
  await player.save();
  await safeAnswerCb(ctx, '🩸 Salud restaurada.', true);
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

// ==========================================
// DESCANSO Y ASIGNACIÓN DE STATS
// ==========================================
bot.action('rest', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (player.hp >= player.maxHp) return safeAnswerCb(ctx, 'Tu salud ya está al máximo.', true);
  const secLeft = getRestTimeRemaining(player);
  if (secLeft > 0) return safeAnswerCb(ctx, `⏳ Espera ${formatSeconds(secLeft)} para descansar.`, true);

  const healAmount = Math.ceil(player.maxHp * 0.30);
  player.hp = Math.min(player.maxHp, player.hp + healAmount);
  player.lastRestTime = Date.now();
  await player.save();

  await safeAnswerCb(ctx, `Descansaste y recuperaste ${healAmount} HP (+30%).`, true);
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('menu_stats', async (ctx) => {
  await safeAnswerCb(ctx);
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const view = getStatsView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
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

// ==========================================
// INVENTARIO GENERAL Y USO DE POCIONES
// ==========================================
bot.action('menu_inv', async (ctx) => {
  try {
    await safeAnswerCb(ctx);
    const userId = ctx.from.id;
    const player = await getPlayer(userId, ctx.from.first_name);

    if (!player) {
      return await ctx.reply('⚠️ No se encontró la información de tu personaje.');
    }

    const pSmall = player.potionsSmall || 0;
    const pMed = player.potionsMedium || 0;
    const pEnergy = player.potionsEnergy || 0;
    const pDrink = player.potionsEnergyDrink || 0;
    const pDragon = player.potionsDragonBlood || 0;
    const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;

    let text = `🎒 *Mochila de Aventurero*\n\n` +
               `❤️ Salud: *${player.hp}/${player.maxHp}*\n` +
               `⚡ Energía: *${player.energy}/${playerMaxEnergy}*\n\n` +
               `*Objetos:*\n` +
               `• Poción Menor (+10 HP): *${pSmall}*\n` +
               `• Poción Mayor (+35 HP): *${pMed}*\n` +
               `• Elixir Energía (+1 ⚡): *${pEnergy}*\n` +
               `• 🥤 Bebida (+2 ⚡): *${pDrink}/5*\n` +
               `• 🩸 Elixir Sangre Dragón: *${pDragon}*\n\n` +
               `Toca un botón para consumir un objeto:`;

    const buttons = [];
    if (pSmall > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Menor', 'use_potion_small')]);
    if (pMed > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Mayor', 'use_potion_medium')]);
    if (pEnergy > 0) buttons.push([Markup.button.callback('⚡ Usar Elixir', 'use_potion_energy')]);
    if (pDrink > 0) buttons.push([Markup.button.callback('🥤 Beber Energética (+2 ⚡)', 'use_energy_drink')]);
    if (pDragon > 0) buttons.push([Markup.button.callback('🩸 Beber Sangre de Dragón', 'use_dragon_blood')]);
    
    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en menu_inv:', err);
    try {
      await ctx.answerCbQuery('⚠️ Error al abrir el inventario.', { show_alert: true });
    } catch (e) {}
  }
});

bot.action('use_potion_small', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsSmall || player.potionsSmall <= 0) return await safeAnswerCb(ctx, 'Sin pociones.', true);
  if (player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);
  player.potionsSmall -= 1;
  player.hp = Math.min(player.maxHp, player.hp + 10);
  await player.save();
  await safeAnswerCb(ctx, 'Recuperaste +10 HP');
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('use_potion_medium', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsMedium || player.potionsMedium <= 0) return await safeAnswerCb(ctx, 'Sin pociones.', true);
  if (player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);
  player.potionsMedium -= 1;
  player.hp = Math.min(player.maxHp, player.hp + 35);
  await player.save();
  await safeAnswerCb(ctx, 'Recuperaste +35 HP');
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('use_potion_energy', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;
  if (!player.potionsEnergy || player.potionsEnergy <= 0) return await safeAnswerCb(ctx, 'Sin elixires.', true);
  if (player.energy >= playerMaxEnergy) return await safeAnswerCb(ctx, 'Energía al máximo.', true);
  player.potionsEnergy -= 1;
  player.energy = Math.min(playerMaxEnergy, player.energy + 1);
  await player.save();
  await safeAnswerCb(ctx, 'Recuperaste +1⚡ Energía');
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('use_energy_drink', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;
  if (!player.potionsEnergyDrink || player.potionsEnergyDrink <= 0) return await safeAnswerCb(ctx, 'Sin bebidas energéticas.', true);
  if (player.energy >= playerMaxEnergy) return await safeAnswerCb(ctx, 'Energía al máximo.', true);
  player.potionsEnergyDrink -= 1;
  player.energy = Math.min(playerMaxEnergy, player.energy + 2);
  await player.save();
  await safeAnswerCb(ctx, '🥤 +2⚡ Energía');
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

bot.action('use_dragon_blood', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsDragonBlood || player.potionsDragonBlood <= 0) return await safeAnswerCb(ctx, 'Sin sangre de dragón.', true);

  const isKO = player.knockedOutUntil && Date.now() < player.knockedOutUntil;
  if (!isKO && player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);

  if (isKO) {
    player.potionsDragonBlood -= 1;
    player.knockedOutUntil = 0;
    player.hp = player.maxHp;
    await player.save();
    await safeAnswerCb(ctx, '🩸 ¡Bebiste el Elixir! Ya no estás inconsciente y tienes 100% HP.', true);
    const view = await getStatusView(player);
    return await safeEditMessage(ctx, view.text, view.keyboard);
  }

  await safeAnswerCb(ctx);
  const confirmText = `🩸 *Confirmación:*\n\n¿Deseas beber el elixir para sanar al 100% (${player.hp}/${player.maxHp} HP)?`;
  const confirmBtns = Markup.inlineKeyboard([
    [Markup.button.callback('🩸 Sí, beber', 'use_dragon_blood_confirm')],
    [Markup.button.callback('❌ No, cancelar', 'menu_inv')]
  ]);
  return await safeEditMessage(ctx, confirmText, { parse_mode: 'Markdown', ...confirmBtns });
});

bot.action('use_dragon_blood_confirm', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsDragonBlood || player.potionsDragonBlood <= 0) return await safeAnswerCb(ctx, 'Sin elixires.', true);
  player.potionsDragonBlood -= 1;
  player.hp = player.maxHp;
  await player.save();
  await safeAnswerCb(ctx, '🩸 Salud restaurada.', true);
  const view = await getStatusView(player);
  return await safeEditMessage(ctx, view.text, view.keyboard);
});

// ==========================================
// MOCHILA EN COMBATE CONTRA JEFE MUNDIAL
// ==========================================
bot.action('boss_inv', async (ctx) => {
  try {
    await safeAnswerCb(ctx);
    const userId = ctx.from.id;
    const player = await getPlayer(userId, ctx.from.first_name);

    if (!player) return;

    const pSmall = player.potionsSmall || 0;
    const pMed = player.potionsMedium || 0;
    const pEnergy = player.potionsEnergy || 0;
    const pDrink = player.potionsEnergyDrink || 0;
    const pDragon = player.potionsDragonBlood || 0;
    const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;

    let text = `🎒 *Mochila frente al Coloso*\n\n` +
               `❤️ Salud: *${player.hp}/${player.maxHp}*\n` +
               `⚡ Energía: *${player.energy}/${playerMaxEnergy}*\n\n` +
               `*Objetos:*\n` +
               `• Poción Menor (+10 HP): *${pSmall}*\n` +
               `• Poción Mayor (+35 HP): *${pMed}*\n` +
               `• Elixir Energía (+1 ⚡): *${pEnergy}*\n` +
               `• 🥤 Bebida (+2 ⚡): *${pDrink}/5*\n` +
               `• 🩸 Elixir Sangre Dragón: *${pDragon}*\n\n` +
               `Toca una poción para consumirla:`;

    const buttons = [];
    if (pSmall > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Menor', 'boss_use_pot_small')]);
    if (pMed > 0) buttons.push([Markup.button.callback('🧪 Usar Poción Mayor', 'boss_use_pot_medium')]);
    if (pEnergy > 0) buttons.push([Markup.button.callback('⚡ Usar Elixir', 'boss_use_pot_energy')]);
    if (pDrink > 0) buttons.push([Markup.button.callback('🥤 Beber Energética (+2 ⚡)', 'boss_use_energy_drink')]);
    if (pDragon > 0) buttons.push([Markup.button.callback('🩸 Usar Sangre de Dragón', 'boss_use_dragon_blood')]);

    buttons.push([Markup.button.callback('⬅️ Volver al Coloso', 'menu_boss')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en boss_inv:', err);
  }
});

bot.action('boss_use_pot_small', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsSmall || player.potionsSmall <= 0) return await safeAnswerCb(ctx, 'Sin pociones.', true);
  if (player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);
  player.potionsSmall -= 1;
  player.hp = Math.min(player.maxHp, player.hp + 10);
  await player.save();
  await safeAnswerCb(ctx, '+10 HP');
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'boss_inv' } });
});

bot.action('boss_use_pot_medium', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsMedium || player.potionsMedium <= 0) return await safeAnswerCb(ctx, 'Sin pociones.', true);
  if (player.hp >= player.maxHp) return await safeAnswerCb(ctx, 'Salud al máximo.', true);
  player.potionsMedium -= 1;
  player.hp = Math.min(player.maxHp, player.hp + 35);
  await player.save();
  await safeAnswerCb(ctx, '+35 HP');
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'boss_inv' } });
});

bot.action('boss_use_pot_energy', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;
  if (!player.potionsEnergy || player.potionsEnergy <= 0) return await safeAnswerCb(ctx, 'Sin elixires.', true);
  if (player.energy >= playerMaxEnergy) return await safeAnswerCb(ctx, 'Energía al máximo.', true);
  player.potionsEnergy -= 1;
  player.energy = Math.min(playerMaxEnergy, player.energy + 1);
  await player.save();
  await safeAnswerCb(ctx, '+1⚡ Energía');
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'boss_inv' } });
});

bot.action('boss_use_energy_drink', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;
  if (!player.potionsEnergyDrink || player.potionsEnergyDrink <= 0) return await safeAnswerCb(ctx, 'Sin bebidas energéticas.', true);
  if (player.energy >= playerMaxEnergy) return await safeAnswerCb(ctx, 'Energía al máximo.', true);
  player.potionsEnergyDrink -= 1;
  player.energy = Math.min(playerMaxEnergy, player.energy + 2);
  await player.save();
  await safeAnswerCb(ctx, '🥤 +2⚡ Energía');
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'boss_inv' } });
});

bot.action('boss_use_dragon_blood', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  if (!player.potionsDragonBlood || player.potionsDragonBlood <= 0) return await safeAnswerCb(ctx, 'Sin sangre de dragón.', true);
  player.potionsDragonBlood -= 1;
  player.hp = player.maxHp;
  player.knockedOutUntil = 0;
  await player.save();
  await safeAnswerCb(ctx, '🩸 Salud restaurada al 100%.', true);
  return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'boss_inv' } });
});

// ==========================================
// TIENDA DEL NPC
// ==========================================
bot.action('menu_shop', async (ctx) => {
  await safeAnswerCb(ctx);
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const view = getShopView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

Object.keys(ITEMS).forEach((key) => {
  const item = ITEMS[key];
  bot.action(`buy_${item.id}`, async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (player.gold < item.cost) return await safeAnswerCb(ctx, `❌ Oro insuficiente (${item.cost}g).`, true);

    player.gold -= item.cost;
    player[item.field] = (player[item.field] || 0) + 1;
    await player.save();

    await safeAnswerCb(ctx, `✅ Compraste 1x ${item.name}`, true);
    const view = getShopView(player);
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
  });
});

// Compras de Gemas de Resistencia (Tope de energía con oro)
bot.action('buy_gem_1', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);

  if (player.hasEnergyGem1) {
    return await safeAnswerCb(ctx, 'Ya compraste esta gema.', true);
  }

  const cost = 15000;
  if (player.gold < cost) {
    return await safeAnswerCb(ctx, `❌ Oro insuficiente. Necesitas ${cost}g.`, true);
  }

  player.gold -= cost;
  player.hasEnergyGem1 = true;
  player.maxEnergy = (player.maxEnergy || 10) + 1;
  player.energy = player.maxEnergy;
  await player.save();

  await safeAnswerCb(ctx, `✨ ¡Compraste la Gema I! Tu energía máxima ahora es ${player.maxEnergy} ⚡.`, true);
  const view = getShopView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('buy_gem_2', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);

  if (!player.hasEnergyGem1) {
    return await safeAnswerCb(ctx, 'Debes adquirir primero la Gema de Resistencia I.', true);
  }
  if (player.hasEnergyGem2) {
    return await safeAnswerCb(ctx, 'Ya compraste el máximo de gemas en la tienda.', true);
  }

  const cost = 45000;
  if (player.gold < cost) {
    return await safeAnswerCb(ctx, `❌ Oro insuficiente. Necesitas ${cost}g.`, true);
  }

  player.gold -= cost;
  player.hasEnergyGem2 = true;
  player.maxEnergy = (player.maxEnergy || 11) + 1;
  player.energy = player.maxEnergy;
  await player.save();

  await safeAnswerCb(ctx, `✨ ¡Compraste la Gema II! Tu energía máxima ahora es ${player.maxEnergy} ⚡.`, true);
  const view = getShopView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

// ==========================================
// MERCADO P2P
// ==========================================
bot.action('menu_market', async (ctx) => {
  await safeAnswerCb(ctx);
  const userId = ctx.from.id;
  pendingMarketSales.delete(userId);
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

  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

bot.action('mkt_trends', async (ctx) => {
  await safeAnswerCb(ctx);
  const text = await getMarketTrendsView();
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Actualizar', 'mkt_trends')],
    [Markup.button.callback('⬅️ Volver al Mercado', 'menu_market')]
  ]);
  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('mkt_sell_menu', async (ctx) => {
  await safeAnswerCb(ctx);
  const userId = ctx.from.id;
  pendingMarketSales.delete(userId);

  const player = await getPlayer(userId, ctx.from.first_name);
  const buttons = [];

  for (const key in ITEMS) {
    const it = ITEMS[key];
    const count = player[it.field] || 0;
    if (count > 0) {
      buttons.push([Markup.button.callback(`${it.name} (x${count})`, `mkt_prep_${it.id}`)]);
    }
  }

  if (!buttons.length) {
    return await safeEditMessage(ctx, '📦 *Publicar en el Mercado*\n\nNo tienes ningún objeto para vender.', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Mercado', 'menu_market')]])
    });
  }

  buttons.push([Markup.button.callback('⬅️ Cancelar', 'menu_market')]);
  return await safeEditMessage(ctx, '📦 *Publicar en el Mercado*\n\nSelecciona el objeto:', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
});

Object.keys(ITEMS).forEach((key) => {
  const item = ITEMS[key];
  bot.action(`mkt_prep_${item.id}`, async (ctx) => {
    await safeAnswerCb(ctx);
    const userId = ctx.from.id;
    const bounds = getItemBounds(item.id);
    pendingMarketSales.set(userId, item.id);

    const text = `📦 *Vender: ${item.name}*\n\n` +
                 `• Precio base: *${bounds.basePrice}g*\n` +
                 `• Rango permitido: *${bounds.minPrice}g* a *${bounds.maxPrice}g*\n` +
                 `• Comisión: 8%\n\n` +
                 `💬 *Escribe en el chat el precio en oro:*`;

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancelar', 'mkt_sell_menu')]])
    });
  });
});

bot.action(/mkt_buy_(.+)/, async (ctx) => {
  try {
    const listingId = ctx.match[1];
    const res = await buyListing(listingId, ctx.from.id);
    await safeAnswerCb(ctx, res.msg, true);

    if (res.success && res.sellerId) {
      try {
        await bot.telegram.sendMessage(
          res.sellerId,
          `💰 *¡Tu oferta fue vendida en el mercado!*\n\n` +
          `📦 Objeto: *${res.itemName}*\n` +
          `🪙 Ganancia neta: *+${res.sellerProfit}g* _(comisión del 8% descontada)_.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        console.error('No se pudo enviar notificación al vendedor:', err.message);
      }
    }

    const { text, listings } = await getMarketView(ctx.from.id);
    const buttons = [];
    listings.forEach((item, idx) => {
      const idStr = String(item._id);
      if (String(item.sellerId) === String(ctx.from.id)) {
        buttons.push([Markup.button.callback(`❌ Cancelar #${idx + 1} (${item.itemName})`, `mkt_del_${idStr}`)]);
      } else {
        buttons.push([Markup.button.callback(`🛒 Comprar #${idx + 1} (${item.price}g)`, `mkt_buy_${idStr}`)]);
      }
    });
    buttons.push([Markup.button.callback('📊 Tendencias (4h)', 'mkt_trends'), Markup.button.callback('📦 Publicar un Objeto', 'mkt_sell_menu')]);
    buttons.push([Markup.button.callback('🔄 Actualizar', 'menu_market'), Markup.button.callback('⬅️ Volver', 'status')]);
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en mkt_buy:', err);
    await safeAnswerCb(ctx, 'Error al procesar la compra.', true);
  }
});

bot.action(/mkt_del_(.+)/, async (ctx) => {
  const listingId = ctx.match[1];
  const res = await cancelListing(listingId, ctx.from.id);
  await safeAnswerCb(ctx, res.msg, true);
  const { text, listings } = await getMarketView(ctx.from.id);
  const buttons = [];
  listings.forEach((item, idx) => {
    const idStr = String(item._id);
    if (String(item.sellerId) === String(ctx.from.id)) {
      buttons.push([Markup.button.callback(`❌ Cancelar #${idx + 1} (${item.itemName})`, `mkt_del_${idStr}`)]);
    } else {
      buttons.push([Markup.button.callback(`🛒 Comprar #${idx + 1} (${item.price}g)`, `mkt_buy_${idStr}`)]);
    }
  });
  buttons.push([Markup.button.callback('📊 Tendencias (4h)', 'mkt_trends'), Markup.button.callback('📦 Publicar un Objeto', 'mkt_sell_menu')]);
  buttons.push([Markup.button.callback('🔄 Actualizar', 'menu_market'), Markup.button.callback('⬅️ Volver', 'status')]);
  return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
});

// ==========================================
// REFERIDOS Y RANKING
// ==========================================
bot.action('menu_referrals', async (ctx) => {
  await safeAnswerCb(ctx);
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const view = getReferralView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('claim_referral_gold', async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const claimed = player.claimReferralGold();
  if (claimed <= 0) return await safeAnswerCb(ctx, 'No tienes oro pendiente.', true);
  await player.save();
  await safeAnswerCb(ctx, `💰 ¡Reclamaste +${claimed}g!`, true);
  const view = getReferralView(player);
  return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
});

bot.action('menu_ranking', async (ctx) => {
  await safeAnswerCb(ctx);
  const topPlayers = await Player.find({ isVerified: true }).sort({ level: -1, exp: -1 }).limit(10);
  let text = '🏆 *SALÓN DE LA FAMA (TOP 10)* 🏆\n\n';
  topPlayers.forEach((p, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
    text += `${medal} *${p.name}* — Nivel ${p.level} (EXP: ${p.exp})\n`;
  });

  return await safeEditMessage(ctx, text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Actualizar Ranking', 'menu_ranking')],
      [Markup.button.callback('⬅️ Volver', 'status')]
    ])
  });
});

bot.command(['top', 'ranking'], async (ctx) => {
  const topPlayers = await Player.find({ isVerified: true }).sort({ level: -1, exp: -1 }).limit(10);
  let text = '🏆 *SALÓN DE LA FAMA (TOP 10)* 🏆\n\n';
  topPlayers.forEach((p, idx) => {
    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
    text += `${medal} *${p.name}* — Nivel ${p.level} (EXP: ${p.exp})\n`;
  });

  return await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Ir al Menú', 'status')]])
  });
});

// ==========================================
// CONTROL DE ERRORES Y ARRANQUE
// ==========================================
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
