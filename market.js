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

// Esquema de transacciones completadas (auditoría e historial)
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

// Esquema de precio dinámico de referencia
const dynamicPriceSchema = new mongoose.Schema({
  itemId: { type: String, required: true, unique: true },
  currentBasePrice: { type: Number, required: true },
  previousBasePrice: { type: Number, required: true },
  lastUpdate: { type: Date, default: Date.now }
});

const MarketListing = mongoose.model('MarketListing', marketListingSchema);
const MarketLog = mongoose.model('MarketLog', marketLogSchema);
const DynamicPrice = mongoose.model('DynamicPrice', dynamicPriceSchema);

// Caché en memoria para consultas instantáneas
const priceCache = new Map();

// Helper: determina si un ítem tiene economía fluctuante
function isDynamicItem(item) {
  return item && (item.dynamic === true || item.npcSell === false);
}

async function initMarketPrices() {
  try {
    for (const key in ITEMS) {
      const item = ITEMS[key];
      if (!isDynamicItem(item)) continue;

      let record = await DynamicPrice.findOne({ itemId: item.id });
      if (!record) {
        record = await DynamicPrice.create({
          itemId: item.id,
          currentBasePrice: item.cost,
          previousBasePrice: item.cost,
          lastUpdate: new Date()
        });
      }
      priceCache.set(item.id, {
        currentBasePrice: record.currentBasePrice,
        previousBasePrice: record.previousBasePrice,
        lastUpdate: record.lastUpdate
      });
    }
    console.log('✅ Precios dinámicos (ítems especiales) cargados en memoria');
  } catch (err) {
    console.error('Error inicializando precios dinámicos:', err.message);
  }
}

// Obtener bandas permitidas
function getItemBounds(itemId) {
  let item = null;
  for (const k in ITEMS) {
    if (ITEMS[k].id === itemId) item = ITEMS[k];
  }
  if (!item) return { minPrice: 1, maxPrice: 99999, basePrice: 100 };

  // Ítems dinámicos: bandas 0.5x a 1.5x sobre el precio de mercado
  if (isDynamicItem(item)) {
    const cached = priceCache.get(itemId);
    const base = cached ? cached.currentBasePrice : item.cost;
    const minPrice = Math.max(1, Math.round(base * 0.5));
    const maxPrice = Math.max(minPrice, Math.round(base * 1.5));
    return { minPrice, maxPrice, basePrice: base };
  }

  // Ítems estándar de tienda: precio fijo de referencia
  const minPrice = Math.max(1, Math.round(item.cost * 0.5));
  const maxPrice = Math.max(minPrice, Math.round(item.cost * 1.5));
  return { minPrice, maxPrice, basePrice: item.cost };
}

// Evaluación de oferta y demanda cada 4h UTC solo para activos especiales
async function evaluateDynamicPrice(windowStart = null, windowEnd = null) {
  const now = windowEnd ? new Date(windowEnd) : new Date();
  const startTime = windowStart ? new Date(windowStart) : new Date(now.getTime() - 4 * 60 * 60 * 1000);

  for (const key in ITEMS) {
    const item = ITEMS[key];
    if (!isDynamicItem(item)) continue;

    const originalCost = item.cost;

    let record = await DynamicPrice.findOne({ itemId: item.id });
    if (!record) {
      record = await DynamicPrice.create({
        itemId: item.id,
        currentBasePrice: originalCost,
        previousBasePrice: originalCost,
        lastUpdate: now
      });
    }

    const currentBase = record.currentBasePrice;
    let newBase = currentBase;

    const logs = await MarketLog.find({
      itemId: item.id,
      createdAt: { $gte: startTime,$lte: now }
    });

    if (logs.length === 0) {
      if (currentBase > originalCost) {
        newBase = Math.max(originalCost, Math.round(currentBase * 0.99));
      } else {
        newBase = originalCost;
      }
    } else {
      const uniqueUsers = new Set();
      let totalAmount = 0;

      logs.forEach((log) => {
        uniqueUsers.add(String(log.sellerId));
        uniqueUsers.add(String(log.buyerId));
        totalAmount += log.price;
      });

      const avgPrice = totalAmount / logs.length;
      const priceDeltaRatio = (avgPrice - currentBase) / currentBase;

      let maxCap = 0;
      if (uniqueUsers.size >= 4) {
        maxCap = 0.05; // Máx ±5%
      } else if (uniqueUsers.size >= 2) {
        maxCap = 0.01; // Máx ±1%
      }

      if (maxCap > 0) {
        const clampedDelta = Math.max(-maxCap, Math.min(maxCap, priceDeltaRatio));
        newBase = Math.round(currentBase * (1 + clampedDelta));
      }

      if (newBase < originalCost) {
        newBase = originalCost;
      }
    }

    record.previousBasePrice = currentBase;
    record.currentBasePrice = newBase;
    record.lastUpdate = now;
    await record.save();

    priceCache.set(item.id, {
      currentBasePrice: newBase,
      previousBasePrice: currentBase,
      lastUpdate: now
    });
  }

  console.log(`📊 Mercado P2P: Ciclo de 4h UTC evaluado (${now.toISOString()})`);
}

// Vista principal de listados activos
async function getMarketView(currentUserId) {
  const listings = await MarketListing.find().sort({ createdAt: -1 });

  let text = `🏪 *Mercado P2P del Reino*\n\n` +
             `Compra y vende objetos directamente con otros aventureros.\n` +
             `• Comisión del mercado: *8%* por venta exitosa.\n` +
             `• Bienes especiales regulados por oferta y demanda (Ciclos UTC de 4h).\n\n`;

  if (!listings.length) {
    text += `_No hay ofertas publicadas actualmente. ¡Sé el primero en vender!_`;
  } else {
    text += `*Ofertas disponibles:*\n\n`;
    listings.forEach((item, index) => {
      const isMine = String(item.sellerId) === String(currentUserId);
      const mark = isMine ? ' (Tu oferta)' : '';
      text += `*#${index + 1} • ${item.itemName}*${mark}\n` +
              `  Precio: 💰 ${item.price} oro | Vendedor: ${item.sellerName}\n\n`;
    });
  }

  return { text, listings };
}

// Publicar un ítem a la venta
async function createListing(sellerId, sellerName, itemId, price) {
  let itemDef = null;
  for (const k in ITEMS) {
    if (ITEMS[k].id === itemId) itemDef = ITEMS[k];
  }

  if (!itemDef) return { success: false, msg: 'Objeto no válido.' };

  const player = await Player.findOne({ userId: sellerId });
  if (!player) return { success: false, msg: 'Jugador no encontrado.' };

  const currentCount = player[itemDef.field] || 0;
  if (currentCount <= 0) {
    return { success: false, msg: `No tienes ${itemDef.name} en tu mochila.` };
  }

  const userListings = await MarketListing.countDocuments({ sellerId });
  if (userListings >= 3) {
    return { success: false, msg: '⚠️ Ya tienes el máximo de 3 publicaciones simultáneas en el mercado.' };
  }

  const { minPrice, maxPrice } = getItemBounds(itemId);
  if (price < minPrice || price > maxPrice) {
    return {
      success: false,
      msg: `⚠️ Precio fuera del rango permitido.\nPara ${itemDef.name} el precio debe estar entre *${minPrice}g* y *${maxPrice}g*.`
    };
  }

  player[itemDef.field] -= 1;
  await player.save();

  await MarketListing.create({
    sellerId,
    sellerName: sellerName || 'Aventurero',
    itemId: itemDef.id,
    itemName: itemDef.name,
    price
  });

  return {
    success: true,
    msg: `✅ ¡Publicaste 1x *${itemDef.name}* en el mercado por *${price} oro*!`
  };
}

// Comprar un ítem publicado
async function buyListing(listingId, buyerId) {
  const listing = await MarketListing.findById(listingId);
  if (!listing) {
    return { success: false, msg: 'Esta oferta ya no está disponible.' };
  }

  if (String(listing.sellerId) === String(buyerId)) {
    return { success: false, msg: 'No puedes comprar tu propia oferta.' };
  }

  const buyer = await Player.findOne({ userId: buyerId });
  if (!buyer) return { success: false, msg: 'Comprador no encontrado.' };

  if (buyer.gold < listing.price) {
    return { success: false, msg: `Oro insuficiente. Necesitas ${listing.price}g.` };
  }

  const seller = await Player.findOne({ userId: listing.sellerId });
  if (!seller) return { success: false, msg: 'El vendedor ya no existe.' };

  let itemDef = null;
  for (const k in ITEMS) {
    if (ITEMS[k].id === listing.itemId) itemDef = ITEMS[k];
  }
  if (!itemDef) return { success: false, msg: 'Objeto no reconocido.' };

  if (itemDef.id === 'energy_drink' && (buyer.potionsEnergyDrink || 0) >= 5) {
    return { success: false, msg: '⚠️ Tu mochila ya tiene el tope de 5 Bebidas Energéticas.' };
  }

  const tax = Math.round(listing.price * 0.08);
  const sellerProfit = listing.price - tax;

  buyer.gold -= listing.price;
  buyer[itemDef.field] = (buyer[itemDef.field] || 0) + 1;
  await buyer.save();

  seller.gold += sellerProfit;
  await seller.save();

  await MarketLog.create({
    sellerId: seller.userId,
    sellerName: seller.name,
    buyerId: buyer.userId,
    buyerName: buyer.name,
    itemId: listing.itemId,
    itemName: listing.itemName,
    price: listing.price,
    tax,
    sellerProfit
  });

  await MarketListing.findByIdAndDelete(listingId);

  return {
    success: true,
    msg: `✅ Compraste 1x *${listing.itemName}* por ${listing.price} oro.`,
    sellerId: seller.userId,
    itemName: listing.itemName,
    sellerProfit
  };
}

// Cancelar una oferta propia
async function cancelListing(listingId, sellerId) {
  const listing = await MarketListing.findOne({ _id: listingId, sellerId });
  if (!listing) {
    return { success: false, msg: 'Oferta no encontrada o ya fue retirada.' };
  }

  let itemDef = null;
  for (const k in ITEMS) {
    if (ITEMS[k].id === listing.itemId) itemDef = ITEMS[k];
  }

  if (itemDef) {
    const player = await Player.findOne({ userId: sellerId });
    if (player) {
      player[itemDef.field] = (player[itemDef.field] || 0) + 1;
      await player.save();
    }
  }

  await MarketListing.findByIdAndDelete(listingId);

  return {
    success: true,
    msg: `✅ Retiraste tu oferta de *${listing.itemName}*. El objeto volvió a tu mochila.`
  };
}

// Tendencias exclusivas para activos especiales y escasos
async function getMarketTrendsView() {
  let text = `📊 *Tendencias de Activos Especiales (Ciclos UTC de 4h)*\n\n` +
             `Los precios de referencia fluctúan cada 4 horas fijas (00, 04, 08, 12, 16, 20 UTC):\n\n`;

  let foundDynamic = false;

  for (const key in ITEMS) {
    const item = ITEMS[key];
    if (!isDynamicItem(item)) continue;

    foundDynamic = true;
    const cached = priceCache.get(item.id) || {
      currentBasePrice: item.cost,
      previousBasePrice: item.cost
    };

    const current = cached.currentBasePrice;
    const prev = cached.previousBasePrice;
    const diff = current - prev;
    const pct = prev > 0 ? ((diff / prev) * 100).toFixed(1) : '0.0';

    let icon = '⚪';
    let sign = '';
    if (diff > 0) {
      icon = '🟢';
      sign = '+';
    } else if (diff < 0) {
      icon = '🔴';
    }

    const { minPrice, maxPrice } = getItemBounds(item.id);

    text += `${icon} *${item.name}*\n` +
            `• Base actual: *${current}g* (${sign}${pct}% en este ciclo)\n` +
            `• Rango permitido P2P: *${minPrice}g* - *${maxPrice}g*\n` +
            `• Piso mínimo absoluto: ${item.cost}g\n\n`;
  }

  if (!foundDynamic) {
    text += `_No hay activos con cotización flotante configurados._\n\n`;
  }

  text += `_Reglas de cotización:_\n` +
          `• 2-3 usuarios únicos en el ciclo: impacto máx. ±1%.\n` +
          `• 4 o más usuarios únicos: impacto máx. ±5%.\n` +
          `• Sin ventas en 4h: decae 1% hacia su piso original.\n` +
          `• El precio jamás desciende por debajo de su valor base.\n` +
          `• Las pociones ordinarias de tienda no fluctúan en bolsa.`;

  return text;
}

// Historial para panel de admin
async function getMarketHistory(page = 1, limit = 5) {
  const skip = (page - 1) * limit;
  const total = await MarketLog.countDocuments();
  const totalPages = Math.ceil(total / limit) || 1;
  const logs = await MarketLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit);

  return { logs, total, totalPages };
}

module.exports = {
  MarketListing,
  MarketLog,
  DynamicPrice,
  initMarketPrices,
  getItemBounds,
  evaluateDynamicPrice,
  getMarketView,
  createListing,
  buyListing,
  cancelListing,
  getMarketTrendsView,
  getMarketHistory
};
