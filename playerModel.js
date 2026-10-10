const mongoose = require('mongoose');

const MAX_BASE_HP = 100;
const MAX_ENERGY = 10;
const REST_COOLDOWN_MS = 5 * 60 * 1000; // Reducido a 5 minutos

function getRequiredExp(level) {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

const playerSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  level: { type: Number, default: 1 },
  exp: { type: Number, default: 0 },
  hp: { type: Number, default: 50 },
  maxHp: { type: Number, default: 50 },
  strength: { type: Number, default: 5 },
  statPoints: { type: Number, default: 0 },
  gold: { type: Number, default: 0 },
  energy: { type: Number, default: MAX_ENERGY },
  lastEnergyUpdate: { type: Number, default: () => Date.now() },
  onMissionUntil: { type: Number, default: 0 },
  lastRestTime: { type: Number, default: 0 },

  // Inventario básico
  potionsSmall: { type: Number, default: 0 },
  potionsMedium: { type: Number, default: 0 },
  potionsEnergy: { type: Number, default: 0 },

  // Penalización por derrota
  knockedOutUntil: { type: Number, default: 0 },

  // Sistema de Anuncios y Bebida Energética
  potionsEnergyDrink: { type: Number, default: 0 },
  adsClaimedToday: { type: Number, default: 0 },
  lastAdClaimDate: { type: String, default: '' }
});

// Regeneración pasiva de energía (1 cada 10 min)
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

// Verificación y subida de nivel
playerSchema.methods.checkLevelUp = function () {
  let req = getRequiredExp(this.level);
  let leveledUp = false;

  while (this.exp >= req) {
    this.exp -= req;
    this.level += 1;
    this.statPoints += 2;
    this.hp = this.maxHp;
    this.energy = MAX_ENERGY;
    req = getRequiredExp(this.level);
    leveledUp = true;
  }

  return leveledUp;
};

// Subida de nivel al ganar EXP en expedición
playerSchema.methods.addExp = function (amount) {
  this.exp += amount;
  return this.checkLevelUp();
};

// Penalización por muerte: pierde 20% de EXP acumulada
playerSchema.methods.applyDeathPenalty = function () {
  const lostExp = Math.floor(this.exp * 0.20);
  this.exp -= lostExp;
  return lostExp;
};

const Player = mongoose.model('Player', playerSchema);

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
  MAX_BASE_HP,
  MAX_ENERGY,
  REST_COOLDOWN_MS
};
