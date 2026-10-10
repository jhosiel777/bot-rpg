const mongoose = require('mongoose');
const ITEMS = require('./shop');
const { Player } = require('./playerModel');

// Esquema de publicaciones activas en el mercado
const marketListingSchema = new mongoose.Schema({
  sellerId: { type: Number, required: true },
  sellerName: { type: String, required: true },
  itemId: { type: String, required: true },
  itemName: { type: String, required: true },
  price: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const MarketListing = mongoose.model('MarketListing', marketListingSchema);

// Esquema para el registro histórico global de transacciones P2P
const marketLogSchema = new mongoose.Schema({
  sellerId: { type: Number, required: true },
  sellerName: { type: String, required: true },
  buyerId: { type: Number, required: true },
  buyerName: { type: String, required: true },
  itemId: { type: String, required: true },
  itemName: { type: String, required: true },
  price: { type: Number, required: true },
  tax: { type: Number, required: true },
  sellerProfit: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const MarketLog = mongoose.model('MarketLog', marketLogSchema);

// Esquema para el seguimiento de precio dinámico (Oferta y Demanda)
const dynamicPriceSchema = new mongoose.Schema({
  itemId: { type: String, required: true, unique: true },
  currentBasePrice: { type: Number, required: true },
  previousBasePrice: { type: Number, default: 0 },
  lastUpdate: { type: Date, default: Date.now }
});

const DynamicPrice = mongoose.model('DynamicPrice', dynamicPriceSchema);

// Caché en memoria para responder de forma síncrona
const priceCache = new Map();

async function initDynamicPrices() {
  try {
    const docs = await DynamicPrice.find();
    for (const d of docs) {
      priceCache.set(d.itemId, d.currentBasePrice);
    }
  } catch (err) {
    console.error('Error cargando precios dinámicos:', err.message);
  }
}
initDynamicPrices();

// Evaluación y ajuste diario de precio según oferta y demanda
async function evaluateDynamicPrice(itemId) {
  const item = Object.values(ITEMS).find((i) => i.id === itemId);
  if (!item) return;

  const originalCost = item.cost;
  let record = await DynamicPrice.findOne({ itemId });

  if (!record) {
    record = await DynamicPrice.create({
      itemId,
      currentBasePrice: originalCost,
      previousBasePrice: originalCost,
      lastUpdate: new Date()
    });
    priceCache.set(itemId, originalCost);
    return;
  }

  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const timeSinceLastUpdate = now - new Date(record.lastUpdate).getTime();

  // Solo se recalibra si pasaron al menos 24 horas
  if (timeSinceLastUpdate >= ONE_DAY_MS) {
    const sinceDate = new Date(record.lastUpdate);

    // Transacciones del ítem durante el último período
    const logs = await MarketLog.find({
      itemId,
      createdAt: { \$gte: sinceDate }
    });

    const buyers = new Set(logs.map((l) => l.buyerId));
    record.previousBasePrice = record.currentBasePrice;

    // Regla de liquidez mínima: al menos 2 compradores distintos
    if (logs.length >= 2 && buyers.size >= 2) {
      const totalPrice = logs.reduce((sum, l) => sum + l.price, 0);
      const avgPrice = totalPrice / logs.length;

      if (avgPrice > record.currentBasePrice) {
        const rawIncrease = (avgPrice - record.currentBasePrice) / record.currentBasePrice;
        const cappedIncrease = Math.min(0.15, rawIncrease);
        record.currentBasePrice = Math.round(record.currentBasePrice * (1 + cappedIncrease));
      } else if (avgPrice < record.currentBasePrice) {
        const rawDecrease = (record.currentBasePrice - avgPrice) / record.currentBasePrice;
        const cappedDecrease = Math.min(0.15, rawDecrease);
        const newPrice = Math.round(record.currentBasePrice * (1 - cappedDecrease));
        record.currentBasePrice = Math.max(originalCost, newPrice);
      }
    } else {
      // Sin demanda en 24h: fuerza de gravedad (-5% hacia el precio base)
      const decayedPrice = Math.round(record.currentBasePrice * 0.95);
      record.currentBasePrice = Math.max(originalCost, decayedPrice);
    }

    record.lastUpdate = new Date();
    await record.save();
    priceCache.set(itemId, record.currentBasePrice);
  }
}

// Rango de precios: min 0.5x y max 1.5x del precio dinámico actual
function getItemBounds(itemId) {
  const item = Object.values(ITEMS).find((i) => i.id === itemId);
  if (!item) return { minPrice: 1, maxPrice: 100 };

  const refPrice = priceCache.get(itemId) || item.cost;
  return {
    minPrice: Math.max(1, Math.floor(refPrice * 0.5)),
    maxPrice: Math.ceil(refPrice * 1.5)
  };
}

// Vista de tendencias estilo bolsa / cripto (24h)
async function getMarketTrendsView() {
  let text = `📊 *Bolsa y Tendencias del Mercado (24h)*\n\n` +
             `Los precios de los recursos escasos fluctúan según las compras reales entre aventureros.\n\n`;

  const dynamicItemIds = ['energy_drink'];

  for (const id of dynamicItemIds) {
    const item = Object.values(ITEMS).find((i) => i.id === id);
    if (!item) continue;

    const record = await DynamicPrice.findOne({ itemId: id });
    const currentPrice = record ? record.currentBasePrice : item.cost;
    const prevPrice = (record && record.previousBasePrice) ? record.previousBasePrice : item.cost;

    const diff = currentPrice - prevPrice;
    const pct = prevPrice > 0 ? ((diff / prevPrice) * 100).toFixed(1) : '0.0';

    let trendIcon = '⚪';
    let trendSign = '';
    if (diff > 0) {
      trendIcon = '🟢';
      trendSign = '+';
    } else if (diff < 0) {
      trendIcon = '🔴';
    }

    const bounds = getItemBounds(id);

    text += `*${item.name}*\n` +
            `• Precio Referencia: *${currentPrice}g* (${trendIcon} ${trendSign}${pct}% 24h)\n` +
            `• Rango de Venta: ${bounds.minPrice}g — ${bounds.maxPrice}g\n` +
            `• Precio Base Original: ${item.cost}g\n\n`;
  }

  text += `━━━━━━━━━━━━━━━━━━━━\n` +
          `📖 *¿Cómo funciona este sistema?*\n` +
          `• *Alta Demanda:* Si un ítem se vende con fluidez entre distintos jugadores, su valor sube hasta *+15% al día*.\n` +
          `• *Fuerza de Gravedad:* Si no tiene compras en 24h, su valor desciende un 5% diario hacia su base original.\n` +
          `• *Piso Protegido:* Ningún ítem puede devaluarse por debajo de su precio base original.`;

  return text;
}

// Vista general del Mercado P2P
async function getMarketView(userId) {
  for (const k in ITEMS) {
    evaluateDynamicPrice(ITEMS[k].id).catch(() => {});
  }

  const listings = await MarketListing.find().sort({ createdAt: -1 });

  let text = `🏪 *Mercado P2P entre Aventureros*\n\n` +
             `Compra y vende pociones libremente con otros jugadores.\n` +
             `_Comisión de venta: 8% (la asume el vendedor)._\n\n`;

  if (listings.length === 0) {
    text += `_Actualmente no hay ofertas publicadas. ¡Sé el primero en vender algo!_`;
  } else {
    text += `*Ofertas activas:*\n\n`;
    listings.forEach((item, idx) => {
      const isMine = String(item.sellerId) === String(userId);
      text += `*#${idx + 1} • ${item.itemName}*\n` +
              `• Precio: 💰 ${item.price} oro\n` +
              `• Vendedor: ${isMine ? 'Tú (👑)' : item.sellerName}\n\n`;
    });
  }

  return { text, listings };
}

// Crear una nueva oferta
async function createListing(userId, sellerName, itemId, price) {
  await evaluateDynamicPrice(itemId);

  const item = Object.values(ITEMS).find((i) => i.id === itemId);
  if (!item) {
    return { success: false, msg: '❌ Objeto inválido.' };
  }

  const bounds = getItemBounds(itemId);
  if (price < bounds.minPrice || price > bounds.maxPrice) {
    return {
      success: false,
      msg: `⚠️ El precio debe estar entre *${bounds.minPrice}g* y *${bounds.maxPrice}g*.`
    };
  }

  const userListingsCount = await MarketListing.countDocuments({ sellerId: userId });
  if (userListingsCount >= 3) {
    return {
      success: false,
      msg: '⚠️ Ya tienes el máximo de 3 publicaciones simultáneas en el mercado.'
    };
  }

  const player = await Player.findOne({ userId });
  if (!player || !player[item.field] || player[item.field] <= 0) {
    return {
      success: false,
      msg: '❌ No tienes este objeto disponible en tu inventario.'
    };
  }

  player[item.field] -= 1;
  await player.save();

  await MarketListing.create({
    sellerId: userId,
    sellerName: sellerName || player.name,
    itemId: item.id,
    itemName: item.name,
    price
  });

  return {
    success: true,
    msg: `✅ ¡Pusiste a la venta 1x *${item.name}* por *${price}g* en el mercado!`
  };
}

// Comprar una oferta publicada
async function buyListing(listingId, buyerId) {
  const listing = await MarketListing.findById(listingId);
  if (!listing) {
    return { success: false, msg: 'Esta oferta ya no está disponible.' };
  }

  if (String(listing.sellerId) === String(buyerId)) {
    return { success: false, msg: 'No puedes comprar tu propia oferta.' };
  }

  const buyer = await Player.findOne({ userId: buyerId });
  if (!buyer) {
    return { success: false, msg: 'Jugador no encontrado.' };
  }

  if (buyer.gold < listing.price) {
    return { success: false, msg: `Oro insuficiente (${listing.price}g necesario).` };
  }

  const item = Object.values(ITEMS).find((i) => i.id === listing.itemId);
  if (!item) {
    return { success: false, msg: 'El objeto ya no es válido.' };
  }

  buyer.gold -= listing.price;
  buyer[item.field] = (buyer[item.field] || 0) + 1;
  await buyer.save();

  const tax = Math.round(listing.price * 0.08);
  const sellerProfit = listing.price - tax;

  const seller = await Player.findOne({ userId: listing.sellerId });
  if (seller) {
    seller.gold += sellerProfit;
    await seller.save();
  }

  await MarketLog.create({
    sellerId: listing.sellerId,
    sellerName: listing.sellerName,
    buyerId: buyer.userId,
    buyerName: buyer.name,
    itemId: listing.itemId,
    itemName: listing.itemName,
    price: listing.price,
    tax,
    sellerProfit
  });

  await MarketListing.findByIdAndDelete(listingId);

  evaluateDynamicPrice(listing.itemId).catch(() => {});

  return {
    success: true,
    msg: `✅ ¡Compraste 1x ${listing.itemName} por ${listing.price}g!`,
    sellerId: listing.sellerId,
    itemName: listing.itemName,
    sellerProfit
  };
}

// Cancelar una oferta y recuperar el objeto
async function cancelListing(listingId, userId) {
  const listing = await MarketListing.findById(listingId);
  if (!listing) {
    return { success: false, msg: 'La oferta ya no existe.' };
  }

  if (String(listing.sellerId) !== String(userId)) {
    return { success: false, msg: 'No tienes permiso para cancelar esta oferta.' };
  }

  const item = Object.values(ITEMS).find((i) => i.id === listing.itemId);
  if (item) {
    const player = await Player.findOne({ userId });
    if (player) {
      player[item.field] = (player[item.field] || 0) + 1;
      await player.save();
    }
  }

  await MarketListing.findByIdAndDelete(listingId);

  return { success: true, msg: '✅ Oferta cancelada y devuelta a tu inventario.' };
}

// Consultar historial P2P paginado (Admin)
async function getMarketHistory(page = 1, limit = 5) {
  const skip = (page - 1) * limit;
  const total = await MarketLog.countDocuments();
  const totalPages = Math.ceil(total / limit) || 1;
  const logs = await MarketLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit);
  return { logs, total, totalPages, page };
}

module.exports = {
  MarketListing,
  MarketLog,
  DynamicPrice,
  getItemBounds,
  getMarketView,
  createListing,
  buyListing,
  cancelListing,
  getMarketHistory,
  getMarketTrendsView
};
