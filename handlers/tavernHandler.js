const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');

function registerTavernHandlers(bot, { Player, getPlayer }) {

  // Menú principal de la Taberna
  bot.action('menu_tavern', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = '🍻 *TABERNA DEL JABALÍ EBRIO* 🍻\n\n' +
               'El humo de pipa y el tintineo de jarras llenan el aire. Aventureros descansan y cuentan hazañas.\n\n' +
               '¿Qué deseas hacer en la taberna?';

    const buttons = [];

    // Botón condicional: solo si NO tiene la gema ancestral de GRAM
    if (!player.hasAncestralGem) {
      buttons.push([Markup.button.callback('👤 Hablar con el Mercader Misterioso', 'tavern_merchant')]);
    }

    // Futuros módulos
    // buttons.push([Markup.button.callback('⚔️ Arena de Duelos (PvP)', 'tavern_pvp')]);
    // buttons.push([Markup.button.callback('🎲 Juego de Dados', 'tavern_dice')]);

    buttons.push([Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]);

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // Vista del Mercader Misterioso
  bot.action('tavern_merchant', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (player.hasAncestralGem) {
      return await safeAnswerCb(ctx, 'El mercader no tiene nada más que ofrecerte por ahora.', true);
    }

    const text = '👤 *MERCADER MISTERIOSO*\n\n' +
                 '— *"Poseo reliquias que la moneda ordinaria no puede pagar..."*\n\n' +
                 '• 🔮 *Gema Ancestral de Resistencia*\n' +
                 '  _Aumenta permanentemente tu energía máxima en +2 ⚡._\n' +
                 '  Precio: *0.15 GRAM*\n\n' +
                 'Conecta tu billetera para sellar el pacto:';

    const miniAppUrl = 'https://bot-rpg-wu42.onrender.com/buy-web3?purpose=ancestral_gem&userId=' + player.userId;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.webApp('💎 Comprar con GRAM (0.15)', miniAppUrl)],
      [Markup.button.callback('⬅️ Volver a la Taberna', 'menu_tavern')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });
}

module.exports = { registerTavernHandlers };
