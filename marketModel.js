const mongoose = require('mongoose');

const marketListingSchema = new mongoose.Schema({
  sellerId: { type: Number, required: true },
  sellerName: { type: String, required: true },
  itemId: { type: String, required: true },
  itemName: { type: String, required: true },
  price: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const MarketListing = mongoose.model('MarketListing', marketListingSchema);

module.exports = { MarketListing };
