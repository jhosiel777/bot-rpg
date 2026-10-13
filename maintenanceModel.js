const mongoose = require('mongoose');

const maintenanceSchema = new mongoose.Schema({
  key: { type: String, default: 'global_config', unique: true },
  enabled: { type: Boolean, default: false },
  whitelist: { type: [Number], default: [] } // IDs autorizados además del Admin principal
});

module.exports = mongoose.model('Maintenance', maintenanceSchema);
