const mongoose = require('mongoose');

const bossParticipantSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  name: { type: String, required: true },
  totalDamage: { type: Number, default: 0 },
  attacksCount: { type: Number, default: 0 },
  firstHit: { type: Boolean, default: false },
  lastHit: { type: Boolean, default: false }
}, { _id: false });

const worldBossSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['idle', 'scheduled', 'active', 'defeated', 'escaped'],
    default: 'idle'
  },
  // Identificador de jefe: 'coloso' | 'malakor' | 'vaelgathar'
  bossType: { type: String, default: 'coloso' },
  name: { type: String, default: 'Coloso Protector Ancestral' },
  level: { type: Number, default: 10 },
  maxHp: { type: Number, default: 1000 },
  currentHp: { type: Number, default: 1000 },
  minDmg: { type: Number, default: 50 },
  maxDmg: { type: Number, default: 75 },
  attacksPerTurn: { type: Number, default: 1 },
  damageType: { type: String, default: 'Físico' },

  // Resistencias y propiedades especiales
  resistanceType: { type: String, default: 'none' }, // 'none' | 'magical' | 'physical'
  critChance: { type: Number, default: 0 },          // Para Malakor: 0.22
  critMultiplier: { type: Number, default: 1.0 },    // Para Malakor: 1.40 (+40%)

  // Censo de jugadores aptos (nivel >= 5)
  activeCount: { type: Number, default: 3 },
  avgMaxHp: { type: Number, default: 100 },
  avgStr: { type: Number, default: 5 },

  // Tiempos del evento
  scheduledAt: { type: Date, default: null },
  battleStartsAt: { type: Date, default: null },
  battleEndsAt: { type: Date, default: null },
  alert5MinSent: { type: Boolean, default: false },

  // Participación y tabla de daño
  participants: [bossParticipantSchema]
}, { timestamps: true });

const WorldBoss = mongoose.model('WorldBoss', worldBossSchema);

// Obtener o crear la instancia única del Jefe Mundial
async function getWorldBoss() {
  let boss = await WorldBoss.findOne();
  if (!boss) {
    boss = await WorldBoss.create({ status: 'idle' });
  }
  return boss;
}

module.exports = {
  WorldBoss,
  getWorldBoss
};
