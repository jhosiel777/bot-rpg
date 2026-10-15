const mongoose = require('mongoose');

const duelSchema = new mongoose.Schema({
  creatorId: { type: Number, required: true },
  creatorName: { type: String, required: true },
  creatorTitle: { type: String, default: 'Aventurero Novato' },

  opponentId: { type: Number, default: null },
  opponentName: { type: String, default: null },
  opponentTitle: { type: String, default: null },

  mode: { 
    type: String, 
    enum: ['friendly', 'gold', 'gram'], 
    required: true 
  },
  betAmount: { type: Number, default: 0 }, // 0 para friendly, 50-500 para gold, 0.05-0.50 para gram

  status: { 
    type: String, 
    enum: ['open', 'completed', 'cancelled'], 
    default: 'open' 
  },

  winnerId: { type: Number, default: null },
  combatLog: { type: [String], default: [] },

  createdAt: { type: Date, default: Date.now, expires: 86400 } // Se elimina tras 24h si queda abandonado
});

const Duel = mongoose.model('Duel', duelSchema);

module.exports = { Duel };
