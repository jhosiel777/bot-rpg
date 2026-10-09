const { MarketListing } = require('./marketModel');
const { Player } = require('./playerModel');
const ITEMS = require('./shop');

const MARKET_FEE = 0.08; // 8% de comisión
const MAX_LISTINGS_PER_USER = 2; // Máximo 2 ofertas activas por usuario

// Función dinámica: calcula los límites usando shop.js en tiempo real
function getItemBounds(itemId) {
  const item = ITEMS[itemId];
  if (!item) return null;

  const minPrice = Math.max(1, Math.floor(item.cost * 0.5));
  const maxPrice = Math.ceil(item.cost * 1.5);
  return { item, minPrice, maxPrice };
}

// Resumen de límites de todos los objetos para informar al usuario
function getMarketLimitsHelp() {
  let help = '📋 *Límites de precios permitidos (±50% de la tienda):*\n\n';
  for (const key in ITEMS) {
    const { item, minPrice, maxPrice } = getItemBounds(key);
    help += `• *\${item.name}* (ID: \`${item.id}\`)\n` +
            `  Precio tienda: \${item.cost}g | Rango: *${minPrice}g* a *${maxPrice}g*\n\n`;
  }
  help += `📌 *Uso:* \`/vender <id_objeto> <precio>\`\n` +
          `_Ejemplo:_ \`/vender potion_small 40\``;
  return help;
}

// Vista de las ofertas activas en el mercado
async function getMarketView(currentUserId) {
  const listings = await MarketListing.find({}).sort({ createdAt: -1 }).limit(10).lean();

  if (!listings.length) {
    return {
      text: '🏪 *Mercado Global P2P*\n\n' +
            'No hay ofertas activas en este momento.\n\n' +
            '💡 Para publicar un objeto usa:\n' +
            '`/vender <id_objeto> <precio>`\n' +
            'O escribe `/limites` para ver los rangos permitidos.',
      listings: []
    };
  }

  let text = '🏪 *Mercado Global P2P*\n\n' +
             'Comisión del 8% deducida al vendedor tras la venta.\n\n' +
             '*Ofertas disponibles en el tablón:*\n\n';

  listings.forEach((it, idx) => {
    const isMine = it.sellerId === currentUserId;
    const tag = isMine ? ' *(Tuya)*' : '';
    text += `${idx + 1}.${it.itemName} — 💰 ${it.price}g${tag}\n` +
            `   Vendedor: \${it.sellerName}\n\n`;
  });

  text += `💡 Usa \`/vender\` o \`/limites\` para publicar.`;

  return { text, listings };
}

// Publicar un objeto en el mercado
async function createListing(userId, userName, itemId, price) {
  const bounds = getItemBounds(itemId);
  if (!bounds) {
    return {
      success: false,
      msg: `❌ Objeto no válido.\n\n\${getMarketLimitsHelp()}`
    };
  }

  const { item, minPrice, maxPrice } = bounds;

  if (price < minPrice || price > maxPrice) {
    return {
      success: false,
      msg: `❌ Precio fuera de rango para *\${item.name}*.\n` +
           `El precio permitido va desde *\${minPrice}g* hasta *${maxPrice}g* (Tienda:${item.cost}g).`
    };
  }

  const activeCount = await MarketListing.countDocuments({ sellerId: userId });
  if (activeCount >= MAX_LISTINGS_PER_USER) {
    return {
      success: false,
      msg: `❌ Límite alcanzado: solo puedes tener un máximo de \${MAX_LISTINGS_PER_USER} ofertas activas.`
    };
  }

  const player = await Player.findOne({ userId });
  if (!player || (player[item.field] || 0) <= 0) {
    return { success: false, msg: `❌ No tienes \${item.name} en tu inventario.` };
  }

  // Depósito en custodia: retira el ítem inmediatamente
  player[item.field] -= 1;
  await player.save();

  const listing = new MarketListing({
    sellerId: userId,
    sellerName: userName || 'Aventurero',
    itemId: item.id,
    itemName: item.name,
    price
  });

  await listing.save();

  const netProfit = Math.floor(price * (1 - MARKET_FEE));
  return {
    success: true,
    msg: `✅ Publicaste 1x *${item.name}* por *${price}g*.\n` +
         `Recibirás *\${netProfit}g* cuando alguien lo compre (8% comisión aplicada).`
  };
}

// Comprar una oferta de forma atómica
async function buyListing(listingId, buyerId) {
  const buyer = await Player.findOne({ userId: buyerId });
  if (!buyer) return { success: false, msg: 'Jugador no encontrado.' };

  const listing = await MarketListing.findByIdAndDelete(listingId);
  if (!listing) {
    return { success: false, msg: 'Esta oferta ya no está disponible o fue comprada.' };
  }

  if (listing.sellerId === buyerId) {
    await MarketListing.create(listing);
    return { success: false, msg: 'No puedes comprar tu propia oferta. Cancélala si quieres recuperarla.' };
  }

  if (buyer.gold < listing.price) {
    await MarketListing.create(listing);
    return { success: false, msg: `❌ Oro insuficiente. Cuesta ${listing.price}g y tienes${buyer.gold}g.` };
  }

  const item = ITEMS[listing.itemId];
  if (!item) {
    await MarketListing.create(listing);
    return { success: false, msg: 'Error de integridad del objeto.' };
  }

  const sellerProfit = Math.floor(listing.price * (1 - MARKET_FEE));
  const seller = await Player.findOne({ userId: listing.sellerId });

  buyer.gold -= listing.price;
  buyer[item.field] = (buyer[item.field] || 0) + 1;
  await buyer.save();

  if (seller) {
    seller.gold += sellerProfit;
    await seller.save();
  }

  return {
    success: true,
    sellerId: listing.sellerId,
    sellerProfit,
    price: listing.price,
    itemName: listing.itemName
  };
}

// Cancelar una oferta y devolver el ítem
async function cancelListing(listingId, sellerId) {
  const listing = await MarketListing.findOneAndDelete({ _id: listingId, sellerId });
  if (!listing) {
    return { success: false, msg: 'No se encontró la oferta o ya fue procesada.' };
  }

  const item = ITEMS[listing.itemId];
  const player = await Player.findOne({ userId: sellerId });
  if (player && item) {
    player[item.field] = (player[item.field] || 0) + 1;
    await player.save();
  }

  return { success: true, msg: `✅ Oferta cancelada. Recuperaste 1x \${listing.itemName}.` };
}

module.exports = {
  getMarketView,
  createListing,
  buyListing,
  cancelListing,
  getMarketLimitsHelp,
  getItemBounds
};
