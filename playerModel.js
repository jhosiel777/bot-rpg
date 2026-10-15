const mongoose = require('mongoose');

const MAX_LEVEL = 101;
const MAX_STAT = 100;
const MAX_BASE_HP = 500;
const MAX_ENERGY = 10;
const ADMIN_ID = 835648800;

// 1 punto de energía cada 10 minutos (600,000 ms)
const ENERGY_REGEN_INTERVAL_MS = 10 * 60 * 1000;

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
  lastEnergyRegenTime: { type: Number, default: () => Date.now() },
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

  // Botin Diario
  dailyStreak: { type: Number, default: 0 },
  lastDailyClaimDate: { type: String, default: null },

  // Anuncios
  adsClaimedToday: { type: Number, default: 0 },
  lastAdClaimDate: { type: String, default: '' },
  totalAdsClaimed: { type: Number, default: 0 },

  // Reclutamiento / Referidos
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: Number, default: null },
  isVerified: { type: Boolean, default: false },
  recruitsCount: { type: Number, default: 0 },
  referralGoldToday: { type: Number, default: 0 },
  referralGoldUnclaimed: { type: Number, default: 0 },
  referralGoldTotalEarned: { type: Number, default: 0 },
  lastReferralDateUtc: { type: String, default: getTodayUtcString }
});

playerSchema.methods.getRestCooldownMs = function() {
  const baseMinutes = 15;
  const reduction = (this.agility || 0) * 0.08;
  const finalMinutes = Math.max(7, baseMinutes - reduction);
  return finalMinutes * 60 * 1000;
};

playerSchema.methods.applyDeathPenalty = function() {
  const reqExp = getRequiredExp(this.level);
  const penalty = Math.round(reqExp * 0.15);
  const lost = Math.min(this.exp, penalty);
  this.exp = Math.max(0, this.exp - lost);
  return lost;
};

// Cálculo matemático estricto de regeneración
playerSchema.methods.checkAndRegenEnergy = function() {
  const now = Date.now();

  if (!this.lastEnergyRegenTime || typeof this.lastEnergyRegenTime !== 'number') {
    this.lastEnergyRegenTime = now;
    return true;
  }

  if (this.energy >= MAX_ENERGY) {
    this.energy = MAX_ENERGY;
    this.lastEnergyRegenTime = now;
    return false;
  }

  const elapsedMs = now - this.lastEnergyRegenTime;

  if (elapsedMs >= ENERGY_REGEN_INTERVAL_MS) {
    const pointsGained = Math.floor(elapsedMs / ENERGY_REGEN_INTERVAL_MS);
    if (pointsGained > 0) {
      const newEnergy = this.energy + pointsGained;
      if (newEnergy >= MAX_ENERGY) {
        this.energy = MAX_ENERGY;
        this.lastEnergyRegenTime = now;
      } else {
        this.energy = newEnergy;
        this.lastEnergyRegenTime = now - (elapsedMs % ENERGY_REGEN_INTERVAL_MS);
      }
      return true;
    }
  }

  return false;
};

// Sincroniza y guarda en base de datos si hubo cambios
playerSchema.methods.syncAndSaveEnergy = async function() {
  if (this.checkAndRegenEnergy()) {
    await this.save();
    return true;
  }
  return false;
};

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
    this.lastEnergyRegenTime = Date.now();
    leveledUp = true;
  }

  if (this.level >= MAX_LEVEL) {
    this.exp = 0;
  }

  return leveledUp;
};

playerSchema.methods.checkAndBurnReferralGold = function() {
  const todayUtc = getTodayUtcString();
  if (this.lastReferralDateUtc !== todayUtc) {
    if (this.referralGoldToday > 0) {
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

// --- FUNCIONES DEL BONO DIARIO (UTC) ---
function getTodayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function getYesterdayUtc() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getTimeUntilMidnightUtc() {
  const now = new Date();
  const nextUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0
  ));
  const diffSec = Math.max(0, Math.ceil((nextUtc - now) / 1000));
  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  return hours + 'h ' + minutes + 'm';
}

function getDailyReward(streak) {
  let gold = 100;
  if (streak >= 30) gold = 1000;
  else if (streak >= 22) gold = 800;
  else if (streak >= 15) gold = 600;
  else if (streak >= 8) gold = 400;
  else if (streak >= 4) gold = 200;

  const givesElixir = streak > 0 && streak % 3 === 0;
  return { gold, givesElixir };
}

// Temporizador automático en segundo plano cada 60s
setInterval(async () => {
  try {
    const playersNeedRegen = await Player.find({ energy: { $lt: MAX_ENERGY } });
    for (const p of playersNeedRegen) {
      if (p.checkAndRegenEnergy()) {
        await p.save();
      }
    }
  } catch (e) {
    console.error('Error en loop de regeneración de energía:', e.message);
  }
}, 60 * 1000);

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

async function getPlayer(userId, name = 'Aventurero') {
  let player = await Player.findOne({ userId });

  if (!player) {
    const uniqueCode = await generateUniqueReferralCode();
    player = await Player.create({
      userId,
      name,
      referralCode: uniqueCode,
      isVerified: userId === ADMIN_ID,
      lastEnergyRegenTime: Date.now()
    });
  } else {
    let needsSave = false;

    if (userId === ADMIN_ID && !player.isVerified) {
      player.isVerified = true;
      needsSave = true;
    }

    if (!player.referralCode) {
      player.referralCode = await generateUniqueReferralCode();
      needsSave = true;
    }

    if (player.checkAndBurnReferralGold()) {
      needsSave = true;
    }

    // Comprobamos la regeneración y guardamos directamente
    if (player.checkAndRegenEnergy()) {
      needsSave = true;
    }

    if (needsSave) {
      await player.save();
    }
  }

  return player;
}

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
