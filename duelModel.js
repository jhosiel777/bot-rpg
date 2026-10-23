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
  betAmount: { type: Number, default: 0 },

  status: { 
    type: String, 
    enum: ['open', 'active', 'completed', 'cancelled'], 
    default: 'open' 
  },

  readyPlayers: { type: [Number], default: [] },
  acceptedAt: { type: Date, default: null },

  winnerId: { type: Number, default: null },
  combatLog: { type: [String], default: [] },
  gameState: { type: Object, default: null },

  createdAt: { type: Date, default: Date.now, expires: 86400 }
});

const Duel = mongoose.model('Duel', duelSchema);

module.exports = { Duel };
