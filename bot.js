// bot.js
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const startServer = require('./server');
const DUNGEONS = require('./dungeons');
const ITEMS = require('./shop');
const { WorldBoss, getWorldBoss } = require('./bossModel');
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

const { safeAnswerCb, safeEditMessage, formatSeconds, formatHoursMinutes, broadcastToAll } = require('./utils/telegramUtils');
const { registerDungeonHandlers } = require('./handlers/dungeonHandler');
const { registerAdminHandlers } = require('./handlers/adminHandler');
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
const confirmedBossWarning = new Map();

let bossWaitMinutesConfig = 30;
let bossDurationMinutesConfig = 90;
let bossHpConfig = null;
let bossCustomEpicMessage = null;

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

// MIDDLEWARE GLOBAL DE MANTENIMIENTO
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

// Registro de submódulos
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

// Registrar comandos básicos de menú, Boss y P2P
bot.catch((err, ctx) => {
  console.error(`Error controlado en actualización (${ctx?.updateType}):`, err.message);
});

async function startBotWithRetry(retries = 5, delayMs = 4000) {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    await bot.launch({ dropPendingUpdates: true });
    console.log('✅ Bot conectado con éxito a Telegram');
  } catch (err) {
    if (err.response?.error_code === 409 && retries > 0) {
      console.log(`⚠️ Conflicto 409 temporal. Reintentando en ${delayMs / 1000}s...`);
      setTimeout(() => startBotWithRetry(retries - 1, delayMs), delayMs);
    } else {
      console.error('Error al lanzar Telegraf:', err.message);
    }
  }
}

startBotWithRetry();

const safeStop = (signal) => {
  try { bot.stop(signal); } catch (e) {}
};
process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));
