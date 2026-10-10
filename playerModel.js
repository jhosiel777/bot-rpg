const mongoose = require('mongoose');

const MAX_LEVEL = 101;
const MAX_STAT = 100;
const MAX_BASE_HP = 300;
const MAX_ENERGY = 10;
const BASE_REST_COOLDOWN_MS = 15 * 60 * 1000;

function getRequiredExp(level) {
  if (level >= MAX_LEVEL) return 'MAX';
  if (level === 100) return 50000;
  return Math.floor(20 * Math.pow(level, 1.5));
}

const playerSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  level: { type: Number, default: 1 },
  exp: { type: Number, default: 0 },
  hp: { type: Number, default: 50 },
  maxHp: { type: Number, default: 50 },
  strength: { type: Number, default: 5 },
  agility: { type: Number, default: 0 },
  luck: { type: Number, default: 0 },
  statPoints: { type: Number, default: 0 },
  gold: { type: Number, default: 0 },
  energy: { type: Number, default: MAX_ENERGY },
  lastEnergyUpdate: { type: Number, default: () => Date.now() },
  onMissionUntil: { type: Number, default: 0 },
  potionsUsedInMission: { type: Number, default: 0 },
  lastRestTime: { type: Number, default: 0 },

  potionsSmall: { type: Number, default: 0 },
  potionsMedium: { type: Number, default: 0 },
  potionsEnergy: { type: Number, default: 0 },

  knockedOutUntil: { type: Number, default: 0 },

  potionsEnergyDrink: { type: Number, default: 0 },
  adsClaimedToday: { type: Number, default: 0 },
  lastAdClaimDate: { type: String, default: '' }
});

playerSchema.methods.getRestCooldownMs = function () {
  const agi = this.agility || 0;
  const reductionMs = agi * 3 * 1000;
  return Math.max(10 * 60 * 1000, BASE_REST_COOLDOWN_MS - reductionMs);
};

playerSchema.methods.updateEnergy = function () {
  const now = Date.now();
  const REGEN_TIME_MS = 10 * 60 * 1000;
  const timePassed = now - this.lastEnergyUpdate;

  if (timePassed >= REGEN_TIME_MS && this.energy < MAX_ENERGY) {
    const energyToAdd = Math.floor(timePassed / REGEN_TIME_MS);
    this.energy = Math.min(MAX_ENERGY, this.energy + energyToAdd);
    this.lastEnergyUpdate = now - (timePassed % REGEN_TIME_MS);
  }
};

playerSchema.methods.checkLevelUp = function () {
  if (this.level >= MAX_LEVEL) {
    this.level = MAX_LEVEL;
    return false;
  }

  let req = getRequiredExp(this.level);
  let leveledUp = false;

  while (typeof req === 'number' && this.exp >= req && this.level < MAX_LEVEL) {
    this.exp -= req;
    this.level += 1;

    if (this.level === 101) {
      this.statPoints += 5;
    } else if (this.level % 10 === 0) {
      this.statPoints += 3;
    } else {
      this.statPoints += 2;
    }

    this.hp = this.maxHp;
    this.energy = MAX_ENERGY;
    req = getRequiredExp(this.level);
    leveledUp = true;
  }

  return leveledUp;
};

playerSchema.methods.addExp = function (amount) {
  if (this.level >= MAX_LEVEL) return false;
  this.exp += amount;
  return this.checkLevelUp();
};

playerSchema.methods.applyDeathPenalty = function () {
  const lostExp = Math.floor(this.exp * 0.20);
  this.exp -= lostExp;
  return lostExp;
};

const Player = mongoose.model('Player', playerSchema);

// Esquema para estadísticas globales de drops
const globalStatsSchema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  totalDropsSmall: { type: Number, default: 0 },
  totalDropsMedium: { type: Number, default: 0 },
  totalDropsEnergy: { type: Number, default: 0 }
});

const GlobalStats = mongoose.model('GlobalStats', globalStatsSchema);

async function recordDrop(type) {
  try {
    const incField = {};
    if (type === 'small') incField.totalDropsSmall = 1;
    if (type === 'medium') incField.totalDropsMedium = 1;
    if (type === 'energy') incField.totalDropsEnergy = 1;

    await GlobalStats.findOneAndUpdate(
      { key: 'main' },
      { $inc: incField },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('Error registrando drop global:', err.message);
  }
}

async function getGlobalStats() {
  let stats = await GlobalStats.findOne({ key: 'main' });
  if (!stats) {
    stats = await GlobalStats.create({ key: 'main' });
  }
  return stats;
}

async function getPlayer(userId, name) {
  let player = await Player.findOne({ userId });
  if (!player) {
    player = new Player({
      userId,
      name: name || 'Aventurero',
      lastEnergyUpdate: Date.now()
    });
    await player.save();
  } else {
    player.updateEnergy();
    player.checkLevelUp();
    await player.save();
  }
  return player;
}

module.exports = {
  Player,
  getPlayer,
  getRequiredExp,
  GlobalStats,
  recordDrop,
  getGlobalStats,
  MAX_LEVEL,
  MAX_STAT,
  MAX_BASE_HP,
  MAX_ENERGY
};
