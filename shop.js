const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('./utils/telegramUtils');

const ITEMS = {
  potion_small: {
    id: 'potion_small',
    name: '🧪 Poción Menor de Vida',
    desc: 'Restaura +10 HP de salud.',
    cost: 30,
    field: 'potionsSmall',
    type: 'hp',
    value: 10,
    npcSell: true,
    dynamic: false
  },
  potion_medium: {
    id: 'potion_medium',
    name: '🧪 Poción Mayor de Vida',
    desc: 'Restaura +35 HP de salud.',
    cost: 80,
    field: 'potionsMedium',
    type: 'hp',
    value: 35,
    npcSell: true,
    dynamic: false
  },
  potion_energy: {
    id: 'potion_energy',
    name: '⚡ Elixir de Energía',
    desc: 'Recupera +1 punto de Energía.',
    cost: 100,
    field: 'potionsEnergy',
    type: 'energy',
    value: 1,
    npcSell: true,
    dynamic: false
  },
  energy_drink: {
    id: 'energy_drink',
    name: '🥤 Bebida Energética',
    desc: 'Recupera +2 puntos de Energía al instante. Máximo 5 en mochila.',
    cost: 300,
    field: 'potionsEnergyDrink',
    type: 'energy',
    value: 2,
    npcSell: false,
    dynamic: true
  },
  dragon_blood: {
    id: 'dragon_blood',
    name: '🩸 Elixir de Sangre de Dragón',
    desc: 'Elimina de inmediato el estado de inconsciencia y restaura tu salud completa.',
    cost: 2500,
    field: 'potionsDragonBlood',
    type: 'revive',
    value: 0,
    npcSell: false,
    dynamic: true
  }
};

function getShopView(player) {
  let text = `🛒 *Tienda del Aventurero*\n` +
             `💰 Tu Oro: ${player.gold}\n\n` +
             `Objetos disponibles:\n\n`;

  const buttons = [];
  for (const key in ITEMS) {
    const item = ITEMS[key];
    if (item.npcSell === false) continue;
    text += `• ${item.name} — 💰 ${item.cost} oro\n  _${item.desc}_\n\n`;
    buttons.push([Markup.button.callback(`Comprar ${item.name} (${item.cost}g)`, `buy_${item.id}`)]);
  }

  if (!player.hasEnergyGem1) {
    text += `• 💎 *Gema de Resistencia I* — 💰 15.000 oro\n  _Aumenta permanentemente tu energía máxima en +1 ⚡._\n\n`;
    buttons.push([Markup.button.callback('💎 Comprar Gema Resistencia I (15.000g)', 'buy_gem_1')]);
  } else if (!player.hasEnergyGem2) {
    text += `• 💎 *Gema de Resistencia II* — 💰 45.000 oro\n  _Aumenta permanentemente tu energía máxima en +1 ⚡ adicional._\n\n`;
    buttons.push([Markup.button.callback('💎 Comprar Gema Resistencia II (45.000g)', 'buy_gem_2')]);
  }

  text += `• 🥤 Bebida Energética — 📺 Gratis (Patrocinio)\n  _Recupera +2 ⚡. Límite: 3/día. Máx: 5 en mochila._\n\n`;
  buttons.push([
    Markup.button.webApp('📺 Ver Anuncio (+1 🥤 Bebida)', 'https://bot-rpg-wu42.onrender.com/ad-reward?purpose=energy_drink&userId=' + player.userId)
  ]);

  buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

function registerShopHandlers(bot, { getPlayer }) {
  bot.action('menu_shop', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const view = getShopView(player);
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
  });

  Object.keys(ITEMS).forEach((key) => {
    const item = ITEMS[key];
    if (item.npcSell === false) return;

    bot.action(`buy_${item.id}`, async (ctx) => {
      const player = await getPlayer(ctx.from.id, ctx.from.first_name);
      if (player.gold < item.cost) return await safeAnswerCb(ctx, `❌ Oro insuficiente (${item.cost}g).`, true);

      player.gold -= item.cost;
      player[item.field] = (player[item.field] || 0) + 1;
      await player.save();

      await safeAnswerCb(ctx, `✅ Compraste 1x ${item.name}`, true);
      const view = getShopView(player);
      return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
    });
  });

  bot.action('buy_gem_1', async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (player.hasEnergyGem1) {
      return await safeAnswerCb(ctx, 'Ya compraste esta gema.', true);
    }

    const cost = 15000;
    if (player.gold < cost) {
      return await safeAnswerCb(ctx, `❌ Oro insuficiente. Necesitas ${cost}g.`, true);
    }

    player.gold -= cost;
    player.hasEnergyGem1 = true;
    player.maxEnergy = (player.maxEnergy || 10) + 1;
    player.energy = player.maxEnergy;
    await player.save();

    await safeAnswerCb(ctx, `✨ ¡Compraste la Gema I! (+1 ⚡). Tu energía máxima ahora es ${player.maxEnergy} ⚡.`, true);
    const view = getShopView(player);
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
  });

  bot.action('buy_gem_2', async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (!player.hasEnergyGem1) {
      return await safeAnswerCb(ctx, 'Debes adquirir primero la Gema de Resistencia I.', true);
    }
    if (player.hasEnergyGem2) {
      return await safeAnswerCb(ctx, 'Ya compraste el máximo de gemas en la tienda.', true);
    }

    const cost = 45000;
    if (player.gold < cost) {
      return await safeAnswerCb(ctx, `❌ Oro insuficiente. Necesitas ${cost}g.`, true);
    }

    player.gold -= cost;
    player.hasEnergyGem2 = true;
    player.maxEnergy = (player.maxEnergy || 11) + 1;
    player.energy = player.maxEnergy;
    await player.save();

    await safeAnswerCb(ctx, `✨ ¡Compraste la Gema II! (+1 ⚡ adicional). Tu energía máxima ahora es ${player.maxEnergy} ⚡.`, true);
    const view = getShopView(player);
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
  });
}

Object.defineProperty(ITEMS, 'registerShopHandlers', { value: registerShopHandlers, enumerable: false });
Object.defineProperty(ITEMS, 'getShopView', { value: getShopView, enumerable: false });
Object.defineProperty(ITEMS, 'ITEMS', { value: ITEMS, enumerable: false });

module.exports = ITEMS;
