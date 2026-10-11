const mongoose = require('mongoose');

const bountyEventLogSchema = new mongoose.Schema({
  timeSec: { type: Number, default: 0 },
  text: { type: String, required: true },
  goldChange: { type: Number, default: 0 },
  hpChange: { type: Number, default: 0 }
}, { _id: false });

const playerBountySchema = new mongoose.Schema({
  userId: { type: Number, required: true, index: true },
  // Fecha UTC (YYYY-MM-DD) del contrato activo
  bountyDateUtc: { type: String, required: true, index: true },

  // Estado del contrato: 'idle', 'traveling', 'arrived', 'completed', 'failed'
  status: {
    type: String,
    enum: ['idle', 'traveling', 'arrived', 'completed', 'failed'],
    default: 'idle'
  },

  // Datos del enemigo generado
  tierKey: { type: String, default: 'tier1' },
  enemyName: { type: String, required: true },
  description: { type: String, required: true },
  isBeast: { type: Boolean, default: false },

  // Atributos y combate
  enemyMaxHp: { type: Number, required: true },
  enemyCurrentHp: { type: Number, required: true },
  enemyMinDmg: { type: Number, required: true },
  enemyMaxDmg: { type: Number, required: true },

  // Tiempos y rutas
  durationMinutes: { type: Number, required: true },
  startedAt: { type: Date, default: null },
  arrivesAt: { type: Date, default: null },

  // Modo de resolución seleccionado: 'manual' o 'auto'
  mode: { type: String, enum: ['manual', 'auto'], default: 'auto' },

  // Beneficio de anuncios para modo automático (vistos en el día)
  adsClaimedForBounty: { type: Number, default: 0 },

  // Economía
  baseGold: { type: Number, required: true },
  netGoldBonus: { type: Number, default: 0 }, // Suma o resta de eventos
  totalGoldClaimed: { type: Number, default: 0 },
  totalExpClaimed: { type: Number, default: 0 },

  // Registro de eventos ocurridos en el sendero
  eventsLog: [bountyEventLogSchema],
  eventsProcessedCount: { type: Number, default: 0 }
}, { timestamps: true });

// Índice compuesto único: 1 contrato por usuario por día UTC
playerBountySchema.index({ userId: 1, bountyDateUtc: 1 }, { unique: true });

const PlayerBounty = mongoose.model('PlayerBounty', playerBountySchema);

// Función auxiliar para obtener la fecha actual en formato YYYY-MM-DD UTC
function getTodayUtcString() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

module.exports = {
  PlayerBounty,
  getTodayUtcString
};
