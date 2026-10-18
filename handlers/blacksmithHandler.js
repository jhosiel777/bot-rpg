// handlers/blacksmithHandler.js
const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');

function registerBlacksmithHandlers(bot, { Player, getPlayer }) {

  // ==========================================
  // MENÚ PRINCIPAL DE LA HERRERÍA REAL
  // ==========================================
  bot.action('menu_blacksmith', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = '⚒️ *HERRERÍA REAL DE LA CIUDADELA* ⚒️\n\n' +
               'El calor de las forjas golpea tu rostro mientras el maestro herrero martilla una pieza de acero candente.\n\n' +
               '— *"¿Vienes buscando equipo de calidad o los papeles para cruzar la empalizada?"*\n\n' +
               '💰 *Tu Oro:* ' + (player.gold || 0) + 'g\n\n' +
               '*Artículos disponibles:*\n';

    const buttons = [];

    if (!player.hasBorderPermit) {
      text += '• 📜 *Permiso de Exploración Fronteriza*\n' +
              '  _Autorización oficial para acceder a las zonas prohibidas fuera de los muros._\n' +
              '  Precio: *5,000g*\n\n';
      buttons.push([Markup.button.callback('📜 Comprar Permiso (5,000g)', 'buy_border_permit')]);
    } else {
      text += '• 📜 *Permiso Fronterizo:* ✅ Adquirido\n\n';

      if (!player.hasKhazurPickaxe) {
        text += '• ⛏️ *Pico de Khazur*\n' +
                '  _"Antiguo pico del legendario herrero Khazur, dicen que puede minar lo que sea."_\n' +
                '  Precio: *15,000g*\n\n';
        buttons.push([Markup.button.callback('⛏️ Comprar Pico de Khazur (15,000g)', 'buy_pickaxe_khazur')]);
      } else {
        text += '• ⛏️ *Pico de Khazur:* ✅ Comprado _(Equípalo en Hogar > Equipamiento)_\n\n';
      }
    }

    buttons.push([Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]);

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // ==========================================
  // COMPRA DEL PERMISO DE EXPLORACIÓN
  // ==========================================
  bot.action('buy_border_permit', async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (player.hasBorderPermit) {
      return await safeAnswerCb(ctx, 'Ya posees el Permiso de Exploración Fronteriza.', true);
    }

    if ((player.gold || 0) < 5000) {
      return await safeAnswerCb(ctx, 'Oro insuficiente. Necesitas 5,000g.', true);
    }

    player.gold -= 5000;
    player.hasBorderPermit = true;
    await player.save();

    await safeAnswerCb(ctx, '📜 ¡Compraste el Permiso de Exploración!', true);

    return bot.handleUpdate({
      ...ctx.update,
      callback_query: { ...ctx.callbackQuery, data: 'menu_blacksmith' }
    });
  });

  // ==========================================
  // COMPRA DEL PICO DE KHAZUR
  // ==========================================
  bot.action('buy_pickaxe_khazur', async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (!player.hasBorderPermit) {
      return await safeAnswerCb(ctx, 'Requieres primero el Permiso de Exploración.', true);
    }

    if (player.hasKhazurPickaxe) {
      return await safeAnswerCb(ctx, 'Ya posees el Pico de Khazur.', true);
    }

    if ((player.gold || 0) < 15000) {
      return await safeAnswerCb(ctx, 'Oro insuficiente. Necesitas 15,000g.', true);
    }

    player.gold -= 15000;
    player.hasKhazurPickaxe = true;
    await player.save();

    await safeAnswerCb(ctx, '⛏️ ¡Has adquirido el Pico de Khazur!');

    const narrativeText = '⚒️ *El herrero mira el pico antes de entregártelo, suspira y dice:*\n\n' +
                          '— *"Ahh, mi viejo amigo Khazur, falleció hace 45 años en ese yacimiento... ' +
                          'era el mejor herrero del reino, ¿sabes? También fue mi maestro.\n\n' +
                          'Desde entonces nadie ha vuelto a ese lugar. Hay grandes y valiosas menas, ' +
                          'pero ten cuidado: al portar un pico, el yacimiento se pone aún más agresivo."*\n\n' +
                          '⛏️ _El Pico de Khazur ha sido añadido a tus posesiones. Puedes equiparlo desde tu Hogar > Equipamiento._';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⚒️ Seguir en la Herrería', 'menu_blacksmith')],
      [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
    ]);

    return await safeEditMessage(ctx, narrativeText, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  });
}

module.exports = { registerBlacksmithHandlers };
