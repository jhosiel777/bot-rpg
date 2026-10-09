const mongoose = require('mongoose');

const MAX_HP = 100;
const MAX_ENERGY = 10;
const ENERGY_RECHARGE_MS = 5 * 60 * 1000;

const playerSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  name: { type: String, default: 'Aventurero' },
  hp: { type: Number, default: MAX_HP },
  gold: { type: Number, default: 0 },
  energy: { type: Number, default: MAX_ENERGY },
  lastEnergyUpdate: { type: Number, default: () => Date.now() },
  onMissionUntil: { type: Number, default: 0 }
});

const Player = mongoose.model('Player', playerSchema);

async function getPlayer(userId, name) {
  let player = await Player.findOne({ userId });
  if (!player) {
    player = await Player.create({
      userId,
      name: name || 'Aventurero'
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
  MAX_HP,
  MAX_ENERGY
};
