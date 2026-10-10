const mongoose = require('mongoose');

const MAX_LEVEL = 50;
const MAX_STAT = 100;
const MAX_BASE_HP = 500;
const MAX_ENERGY = 10;

const playerSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  level: { type: Number, default: 1 },
  exp: { type: Number, default: 0 },
  hp: { type: Number, default: 50 },
  maxHp: { type: Number, default: 50 },
  energy: { type: Number, default: 10 },
  gold: { type: Number, default: 0 },
  statPoints: { type: Number, default: 0 },
  strength: { type: Number, default: 0 },
  agility: { type: Number, default: 0 },
  luck: { type: Number, default: 0 },

  // Inventario de consumibles
  potionsSmall: { type: Number, default: 0 },
  potionsMedium: { type: Number, default: 0 },
  potionsEnergy: { type: Number, default: 0 },
  potionsEnergyDrink: { type: Number, default: 0 },

  // Control de expediciones y estados
  onMissionUntil: { type: Number, default: 0 },
  knockedOutUntil: { type: Number, default: 0 },
  lastRestTime: { type: Number, default: 0 },
  potionsUsedInMission: { type: Number, default: 0 },

  // Anuncios y recompensas
  adsClaimedToday: { type: Number, default: 0 },
  lastAdClaimDate: { type: String, default: '' },
  totalAdsClaimed: { type: Number, default: 0 }
});

// Cooldown de descanso según nivel de agilidad
playerSchema.methods.getRestCooldownMs = function() {
  const agi = this.agility || 0;
  const minutes = Math.max(2, 5 - (agi * 0.03));
  return Math.round(minutes * 60 * 1000);
};

// Penalización al caer inconsciente (10% de EXP acumulada)
playerSchema.methods.applyDeathPenalty = function() {
  const lostExp = Math.floor(this.exp * 0.10);
  this.exp = Math.max(0, this.exp - lostExp);
  return lostExp;
};

// Suma de EXP y subida de nivel
playerSchema.methods.addExp = function(amount) {
  let leveledUp = false;
  this.exp += amount;

  while (this.level < MAX_LEVEL) {
    const reqExp = getRequiredExp(this.level);
    if (this.exp >= reqExp) {
      this.exp -= reqExp;
      this.level += 1;
      this.statPoints += 2;
      this.hp = this.maxHp;
      this.energy = MAX_ENERGY;
      leveledUp = true;
    } else {
      break;
    }
  }

  if (this.level >= MAX_LEVEL) {
    this.exp = 0;
  }

  return leveledUp;
};

const Player = mongoose.model('Player', playerSchema);

// Esquema de estadísticas globales de drops
const globalStatsSchema = new mongoose.Schema({
  key: { type: String, default: 'global', unique: true },
  totalDropsSmall: { type: Number, default: 0 },
  totalDropsMedium: { type: Number, default: 0 },
  totalDropsEnergy: { type: Number, default: 0 }
});

const GlobalStats = mongoose.model('GlobalStats', globalStatsSchema);

function getRequiredExp(level) {
  return Math.floor(100 * Math.pow(1.15, level - 1));
}

async function getPlayer(userId, name = 'Aventurero') {
  let player = await Player.findOne({ userId });
  if (!player) {
    player = await Player.create({ userId, name });
  } else if (name && player.name !== name) {
    player.name = name;
    await player.save();
  }
  return player;
}

async function recordDrop(type) {
  try {
    let stats = await GlobalStats.findOne({ key: 'global' });
    if (!stats) {
      stats = await GlobalStats.create({ key: 'global' });
    }
    if (type === 'small') stats.totalDropsSmall += 1;
    if (type === 'medium') stats.totalDropsMedium += 1;
    if (type === 'energy') stats.totalDropsEnergy += 1;
    await stats.save();
  } catch (err) {
    console.error('Error registrando drop global:', err.message);
  }
}

async function getGlobalStats() {
  let stats = await GlobalStats.findOne({ key: 'global' });
  if (!stats) {
    stats = await GlobalStats.create({ key: 'global' });
  }
  return stats;
}

module.exports = {
  Player,
  GlobalStats,
  getPlayer,
  getRequiredExp,
  recordDrop,
  getGlobalStats,
  MAX_LEVEL,
  MAX_STAT,
  MAX_BASE_HP,
  MAX_ENERGY
};
