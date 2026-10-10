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
  itemName: { type: String, required: true },
  price: { type: Number, required: true },
  tax: { type: Number, required: true },
  sellerProfit: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const MarketLog = mongoose.model('MarketLog', marketLogSchema);

// Rango de precios permitidos (50% a 250% del precio base de tienda)
function getItemBounds(itemId) {
  const item = Object.values(ITEMS).find((i) => i.id === itemId);
  if (!item) return { minPrice: 1, maxPrice: 100 };
  return {
    minPrice: Math.max(1, Math.floor(item.cost * 0.5)),
    maxPrice: Math.ceil(item.cost * 2.5)
  };
}

// Vista general del Mercado P2P
async function getMarketView(userId) {
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

  // Descontar objeto del inventario del vendedor
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

  // Cobro al comprador y entrega del ítem
  buyer.gold -= listing.price;
  buyer[item.field] = (buyer[item.field] || 0) + 1;
  await buyer.save();

  // Pago neto al vendedor (comisión 8%)
  const tax = Math.round(listing.price * 0.08);
  const sellerProfit = listing.price - tax;

  const seller = await Player.findOne({ userId: listing.sellerId });
  if (seller) {
    seller.gold += sellerProfit;
    await seller.save();
  }

  // Registrar en el historial global de transacciones
  await MarketLog.create({
    sellerId: listing.sellerId,
    sellerName: listing.sellerName,
    buyerId: buyer.userId,
    buyerName: buyer.name,
    itemName: listing.itemName,
    price: listing.price,
    tax,
    sellerProfit
  });

  // Eliminar oferta completada
  await MarketListing.findByIdAndDelete(listingId);

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

// Consultar historial P2P paginado (para el Admin)
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
  getItemBounds,
  getMarketView,
  createListing,
  buyListing,
  cancelListing,
  getMarketHistory
};
