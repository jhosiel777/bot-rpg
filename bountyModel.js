const mongoose = require('mongoose');

const bountyEventLogSchema = new mongoose.Schema({
  timeSec: { type: Number, default: 0 },
  text: { type: String, required: true },
  goldChange: { type: Number, default: 0 },
  hpChange: { type: Number, default: 0 }
}, { _id: false });

const playerBountySchema = new mongoose.Schema({
  userId: { type: Number, required: true, index: true },
  bountyDateUtc: { type: String, required: true, index: true },

  status: {
    type: String,
    enum: ['idle', 'traveling', 'arrived', 'completed', 'failed'],
    default: 'idle'
  },

  tierKey: { type: String, default: 'tier1' },
  enemyName: { type: String, required: true },
  description: { type: String, required: true },
  isBeast: { type: Boolean, default: false },

  enemyMaxHp: { type: Number, required: true },
  enemyCurrentHp: { type: Number, required: true },
  enemyMinDmg: { type: Number, required: true },
  enemyMaxDmg: { type: Number, required: true },

  durationMinutes: { type: Number, required: true },
  startedAt: { type: Date, default: null },
  arrivesAt: { type: Date, default: null },

  mode: { type: String, enum: ['manual', 'auto'], default: 'auto' },
  adsClaimedForBounty: { type: Number, default: 0 },

  baseGold: { type: Number, required: true },
  netGoldBonus: { type: Number, default: 0 },
  goldSpentOnMerchant: { type: Number, default: 0 },
  retreatCooldownUntil: { type: Date, default: null },

  totalGoldClaimed: { type: Number, default: 0 },
  totalExpClaimed: { type: Number, default: 0 },

  eventsLog: [bountyEventLogSchema],
  eventsProcessedCount: { type: Number, default: 0 }
}, { timestamps: true });

playerBountySchema.index({ userId: 1, bountyDateUtc: 1 }, { unique: true });

const PlayerBounty = mongoose.model('PlayerBounty', playerBountySchema);

function getTodayUtcString() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

module.exports = {
  PlayerBounty,
  getTodayUtcString
};
