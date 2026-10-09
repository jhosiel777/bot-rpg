const { MarketListing } = require('./marketModel');
const { Player } = require('./playerModel');
const ITEMS = require('./shop');

const MARKET_FEE = 0.08;
const MAX_LISTINGS_PER_USER = 2;

function getItemBounds(itemId) {
  const item = ITEMS[itemId];
  if (!item) return null;

  const minPrice = Math.max(1, Math.floor(item.cost * 0.5));
  const maxPrice = Math.ceil(item.cost * 1.5);
  return { item, minPrice, maxPrice };
}

async function getMarketView(currentUserId) {
  const listings = await MarketListing.find({}).sort({ createdAt: -1 }).limit(10).lean();

  if (!listings.length) {
    return {
      text: '🏪 *Mercado Global P2P*\n\n' +
            'No hay ofertas activas en este momento.\n\n' +
            'Usa el botón de abajo para poner uno de tus objetos en venta.',
      listings: []
    };
  }

  let text = '🏪 *Mercado Global P2P*\n\n' +
             'Comisión del 8% deducida al vendedor tras la venta.\n\n' +
             '*Ofertas disponibles en el tablón:*\n\n';

  listings.forEach((it, idx) => {
    const isMine = it.sellerId === currentUserId;
    const tag = isMine ? ' *(Tuya)*' : '';
    text += `${idx + 1}. ${it.itemName} — 💰 ${it.price}g${tag}\n` +
            `   Vendedor: ${it.sellerName}\n\n`;
  });

  return { text, listings };
}

async function createListing(userId, userName, itemId, price) {
  const bounds = getItemBounds(itemId);
  if (!bounds) {
    return { success: false, msg: '❌ Objeto no válido.' };
  }

  const { item, minPrice, maxPrice } = bounds;

  if (price < minPrice || price > maxPrice) {
    return {
      success: false,
      msg: '❌ *Precio fuera de rango para ' + item.name + '*\n' +
           'El precio permitido debe estar entre *' + minPrice + 'g* y *' + maxPrice + 'g*.'
    };
  }

  const activeCount = await MarketListing.countDocuments({ sellerId: userId });
  if (activeCount >= MAX_LISTINGS_PER_USER) {
    return {
      success: false,
      msg: '❌ Límite alcanzado: solo puedes tener un máximo de ' + MAX_LISTINGS_PER_USER + ' ofertas activas.'
    };
  }

  const player = await Player.findOne({ userId });
  if (!player || (player[item.field] || 0) <= 0) {
    return { success: false, msg: '❌ No tienes ' + item.name + ' en tu inventario.' };
  }

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
    msg: '✅ Publicaste 1x *' + item.name + '* por *' + price + 'g*.\n' +
         'Recibirás *' + netProfit + 'g* cuando alguien lo compre (8% comisión aplicada).'
  };
}

async function buyListing(listingId, buyerId) {
  const buyer = await Player.findOne({ userId: buyerId });
  if (!buyer) return { success: false, msg: 'Jugador no encontrado.' };

  const listing = await MarketListing.findByIdAndDelete(listingId);
  if (!listing) {
    return { success: false, msg: 'Esta oferta ya no está disponible o fue comprada.' };
  }

  if (listing.sellerId === buyerId) {
    await MarketListing.create(listing);
    return { success: false, msg: 'No puedes comprar tu propia oferta. Puedes cancelarla para recuperarla.' };
  }

  if (buyer.gold < listing.price) {
    await MarketListing.create(listing);
    return { success: false, msg: '❌ Oro insuficiente. Cuesta ' + listing.price + 'g y tienes ' + buyer.gold + 'g.' };
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

  return { success: true, msg: '✅ Oferta cancelada. Recuperaste 1x ' + listing.itemName + '.' };
}

module.exports = {
  getMarketView,
  createListing,
  buyListing,
  cancelListing,
  getItemBounds
};
