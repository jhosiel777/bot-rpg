const mongoose = require('mongoose');

const MAX_LEVEL = 101;
const MAX_STAT = 100;
const MAX_BASE_HP = 500;
const MAX_ENERGY = 10;

// Caracteres limpios para evitar confusiones visuales (sin 0, O, 1, I)
const REFERRAL_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateRandomReferralCode(length = 6) {
  let result = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * REFERRAL_CHARSET.length);
    result += REFERRAL_CHARSET[idx];
  }
  return result;
}

function getTodayUtcString() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

// Estadísticas globales de drops
const globalStatsSchema = new mongoose.Schema({
  key: { type: String, default: 'global_drops', unique: true },
  totalDropsSmall: { type: Number, default: 0 },
  totalDropsMedium: { type: Number, default: 0 },
  totalDropsEnergy: { type: Number, default: 0 }
});
const GlobalStats = mongoose.model('GlobalStats', globalStatsSchema);

const playerSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  level: { type: Number, default: 1 },
  exp: { type: Number, default: 0 },
  gold: { type: Number, default: 0 },
  hp: { type: Number, default: 50 },
  maxHp: { type: Number, default: 50 },
  energy: { type: Number, default: 10 },
  strength: { type: Number, default: 0 },
  agility: { type: Number, default: 0 },
  luck: { type: Number, default: 0 },
  statPoints: { type: Number, default: 0 },
  lastRestTime: { type: Number, default: 0 },
  onMissionUntil: { type: Number, default: 0 },
  potionsUsedInMission: { type: Number, default: 0 },
  knockedOutUntil: { type: Number, default: 0 },

  // Inventario
  potionsSmall: { type: Number, default: 0 },
  potionsMedium: { type: Number, default: 0 },
  potionsEnergy: { type: Number, default: 0 },
  potionsEnergyDrink: { type: Number, default: 0 },
  potionsDragonBlood: { type: Number, default: 0 },

  // Anuncios
  adsClaimedToday: { type: Number, default: 0 },
  lastAdClaimDate: { type: String, default: '' },
  totalAdsClaimed: { type: Number, default: 0 },

  // Sistema de Reclutamiento / Referidos
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: Number, default: null }, // ID del reclutador
  isVerified: { type: Boolean, default: false }, // Debe ingresar código para pasar la puerta
  recruitsCount: { type: Number, default: 0 },
  referralGoldToday: { type: Number, default: 0 }, // Tope diario: 10,000g
  referralGoldUnclaimed: { type: Number, default: 0 }, // Bolsa disponible para reclamar
  referralGoldTotalEarned: { type: Number, default: 0 }, // Histórico de oro generado
  lastReferralDateUtc: { type: String, default: getTodayUtcString }
});

// Cooldown de descanso con Agilidad
playerSchema.methods.getRestCooldownMs = function() {
  const baseMinutes = 15;
  const reduction = (this.agility || 0) * 0.08;
  const finalMinutes = Math.max(7, baseMinutes - reduction);
  return finalMinutes * 60 * 1000;
};

// Penalización por K.O.
playerSchema.methods.applyDeathPenalty = function() {
  const reqExp = getRequiredExp(this.level);
  const penalty = Math.round(reqExp * 0.15);
  const lost = Math.min(this.exp, penalty);
  this.exp = Math.max(0, this.exp - lost);
  return lost;
};

// Subida de nivel
playerSchema.methods.addExp = function(amount) {
  if (this.level >= MAX_LEVEL) {
    this.exp = 0;
    return false;
  }

  this.exp += amount;
  let leveledUp = false;

  while (this.level < MAX_LEVEL && this.exp >= getRequiredExp(this.level)) {
    this.exp -= getRequiredExp(this.level);
    this.level += 1;
    this.statPoints += 3;
    this.hp = this.maxHp;
    this.energy = MAX_ENERGY;
    leveledUp = true;
  }

  if (this.level >= MAX_LEVEL) {
    this.exp = 0;
  }

  return leveledUp;
};

// Quema del 5% si no se reclama el oro al cambio de día UTC
playerSchema.methods.checkAndBurnReferralGold = function() {
  const todayUtc = getTodayUtcString();
  if (this.lastReferralDateUtc !== todayUtc) {
    if (this.referralGoldToday > 0) {
      // 5% de quema sobre lo que se generó hoy y no se cobró
      const burnedAmount = Math.round(this.referralGoldToday * 0.05);
      const remainingAmount = this.referralGoldToday - burnedAmount;

      this.referralGoldUnclaimed += remainingAmount;
      this.referralGoldToday = 0;
    }
    this.lastReferralDateUtc = todayUtc;
    return true;
  }
  return false;
};

// Cobro del oro acumulado por referidos
playerSchema.methods.claimReferralGold = function() {
  this.checkAndBurnReferralGold();
  const totalToClaim = (this.referralGoldToday || 0) + (this.referralGoldUnclaimed || 0);
  if (totalToClaim <= 0) return 0;

  this.gold += totalToClaim;
  this.referralGoldToday = 0;
  this.referralGoldUnclaimed = 0;
  return totalToClaim;
};

const Player = mongoose.model('Player', playerSchema);

function getRequiredExp(level) {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(100 * Math.pow(level, 1.5));
}

async function recordDrop(type) {
  try {
    let stats = await GlobalStats.findOne({ key: 'global_drops' });
    if (!stats) stats = await GlobalStats.create({ key: 'global_drops' });

    if (type === 'small') stats.totalDropsSmall += 1;
    if (type === 'medium') stats.totalDropsMedium += 1;
    if (type === 'energy') stats.totalDropsEnergy += 1;
    await stats.save();
  } catch (err) {
    console.error('Error registrando drop:', err.message);
  }
}

async function getGlobalStats() {
  let stats = await GlobalStats.findOne({ key: 'global_drops' });
  if (!stats) stats = await GlobalStats.create({ key: 'global_drops' });
  return stats;
}

// Genera un código de 6 caracteres garantizando que no esté repetido
async function generateUniqueReferralCode() {
  let code = '';
  let exists = true;
  while (exists) {
    code = generateRandomReferralCode(6);
    const found = await Player.findOne({ referralCode: code });
    if (!found) exists = false;
  }
  return code;
}

// Obtener o crear jugador (con migración transparente de antiguos jugadores)
async function getPlayer(userId, name = 'Aventurero') {
  let player = await Player.findOne({ userId });

  if (!player) {
    const uniqueCode = await generateUniqueReferralCode();
    player = await Player.create({
      userId,
      name,
      referralCode: uniqueCode,
      isVerified: false // El novato empieza sin verificar hasta poner el código
    });
  } else {
    let needsSave = false;

    // Migración automática para jugadores existentes antes de esta actualización
    if (player.isVerified === undefined || player.isVerified === null) {
      player.isVerified = true;
      needsSave = true;
    }

    if (!player.referralCode) {
      player.referralCode = await generateUniqueReferralCode();
      needsSave = true;
    }

    // Revisión de quema diaria al cargar
    if (player.checkAndBurnReferralGold()) {
      needsSave = true;
    }

    if (needsSave) {
      await player.save();
    }
  }

  return player;
}

// Acredita el 5% del oro ganado al reclutador (máx 10,000g/día)
async function creditReferralBonus(recruitUserId, goldEarned) {
  try {
    if (goldEarned <= 0) return;
    const recruit = await Player.findOne({ userId: recruitUserId });
    if (!recruit || !recruit.referredBy) return;

    const recruiter = await Player.findOne({ userId: recruit.referredBy });
    if (!recruiter) return;

    recruiter.checkAndBurnReferralGold();

    const maxDailyLimit = 10000;
    const currentToday = recruiter.referralGoldToday || 0;

    if (currentToday >= maxDailyLimit) return;

    const rawCommission = Math.round(goldEarned * 0.05);
    const availableQuota = maxDailyLimit - currentToday;
    const finalBonus = Math.min(rawCommission, availableQuota);

    if (finalBonus > 0) {
      recruiter.referralGoldToday += finalBonus;
      recruiter.referralGoldTotalEarned = (recruiter.referralGoldTotalEarned || 0) + finalBonus;
      await recruiter.save();
    }
  } catch (err) {
    console.error('Error acreditando tributo de recluta:', err.message);
  }
}

module.exports = {
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
};
