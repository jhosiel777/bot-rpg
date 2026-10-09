const mongoose = require('mongoose');

const BASE_START_HP = 50;
const MAX_BASE_HP = 100;
const MAX_ENERGY = 10;
const ENERGY_RECHARGE_MS = 5 * 60 * 1000;
const REST_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos de cooldown

const playerSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  name: { type: String, default: 'Aventurero' },
  level: { type: Number, default: 1 },
  exp: { type: Number, default: 0 },
  statPoints: { type: Number, default: 0 },
  strength: { type: Number, default: 0 },
  maxHp: { type: Number, default: BASE_START_HP },
  hp: { type: Number, default: BASE_START_HP },
  gold: { type: Number, default: 0 },
  energy: { type: Number, default: MAX_ENERGY },
  lastEnergyUpdate: { type: Number, default: () => Date.now() },
  onMissionUntil: { type: Number, default: 0 },
  lastRestTime: { type: Number, default: 0 },
  // Inventario
  potionsSmall: { type: Number, default: 0 },
  potionsMedium: { type: Number, default: 0 },
  potionsEnergy: { type: Number, default: 0 }
  // Noqueo
   knockedOutUntil: { type: Number, default: 0 }
});

function getRequiredExp(level) {
  return Math.round(100 * Math.pow(level, 1.5));
}

playerSchema.methods.addExp = function(amount) {
  this.exp += amount;
  let req = getRequiredExp(this.level);

  while (this.exp >= req) {
    this.exp -= req;
    this.level += 1;
    this.statPoints += 2;
    req = getRequiredExp(this.level);
  }
};

playerSchema.methods.applyDeathPenalty = function() {
  const penalty = Math.round(getRequiredExp(this.level) * (0.35 + Math.random() * 0.15));
  this.exp -= penalty;

  while (this.exp < 0 && this.level > 1) {
    this.level -= 1;
    if (this.statPoints >= 2) {
      this.statPoints -= 2;
    } else {
      this.statPoints = 0;
    }
    const prevReq = getRequiredExp(this.level);
    this.exp += prevReq;
  }

  if (this.exp < 0) {
    this.exp = 0;
  }

  return penalty;
};

const Player = mongoose.model('Player', playerSchema);

async function getPlayer(userId, name) {
  let player = await Player.findOne({ userId });
  if (!player) {
    player = await Player.create({
      userId,
      name: name || 'Aventurero',
      hp: BASE_START_HP,
      maxHp: BASE_START_HP
    });
  }

  const now = Date.now();
  const timePassed = now - player.lastEnergyUpdate;
  if (player.energy < MAX_ENERGY && timePassed >= ENERGY_RECHARGE_MS) {
    const gained = Math.floor(timePassed / ENERGY_RECHARGE_MS);
    player.energy = Math.min(MAX_ENERGY, player.energy + gained);
    player.lastEnergyUpdate = now - (timePassed % ENERGY_RECHARGE_MS);
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
