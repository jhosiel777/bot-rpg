const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');

function registerHomeHandlers(bot, { Player, getPlayer }) {

  // Menú Principal del Hogar
  bot.action('menu_home', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    const title = player.activeTitle || 'Sin título';
    let walletDisplay = '❌ _No vinculada_';

    if (player.tonWalletAddress) {
      const addr = player.tonWalletAddress;
      walletDisplay = `\`${addr.slice(0, 4)}...${addr.slice(-4)}\``;
    }

    const text = '🏡 *HOGAR DEL AVENTURERO* 🏡\n\n' +
                 'Tu refugio personal en la capital de Abyss. Aquí puedes organizar tus credenciales y prepararte para la gloria.\n\n' +
                 `👤 *Aventurero:* ${player.name}\n` +
                 `🎖️ *Título activo:* «*${title}*»\n` +
                 `💳 *Billetera TON:* ${walletDisplay}\n\n` +
                 '¿Qué deseas gestionar?';

    const buttons = [
      [Markup.button.callback('💳 Vincular / Cambiar Billetera TON', 'home_wallet_info')],
      [Markup.button.callback('🎖️ Títulos Honoríficos', 'home_titles')],
      [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
    ];

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // Información y vinculación de Wallet TON
  bot.action('home_wallet_info', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = '💳 *BILLETERA TON DE LA RED* 💳\n\n' +
               'Conectar tu billetera (Tonkeeper, Telegram Wallet u otras) te permitirá comerciar en el futuro mercado P2P y adquirir artefactos ancestrales.\n\n';

    if (player.tonWalletAddress) {
      text += `🔗 *Billetera actual:* \`\${player.tonWalletAddress}\`\n\n` +
              'Si deseas cambiarla, pulsa el botón de abajo para reconectar:';
    } else {
      text += '⚠️ _Actualmente no tienes ninguna billetera vinculada._\n\n' +
              'Pulsa el botón de abajo para abrir la Mini App y conectar tu billetera:';
    }

    const miniAppUrl = 'https://bot-rpg-wu42.onrender.com/connect-wallet?userId=' + player.userId;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.webApp('🔗 Conectar con TON Connect', miniAppUrl)],
      [Markup.button.callback('⬅️ Volver al Hogar', 'menu_home')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  // Vista de Títulos Honoríficos (Próximamente e instrucción)
  bot.action('home_titles', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    const text = '🎖️ *TÍTULOS HONORÍFICOS* 🎖️\n\n' +
                 'Los títulos son condecoraciones ganadas a través de grandes hazañas dentro del reino.\n\n' +
                 '📜 *¿Para qué servirán?*\n' +
                 '• **Salón de la Fama:** Tu título precederá a tu nombre en los rankings globales.\n' +
                 '• **Arena de Duelos (PvP):** Intimida a tus rivales exhibiendo tus logros antes de cada combate.\n\n' +
                 `🎖️ *Tu título actual:* «*${player.activeTitle || 'Aventurero Novato'}*»\n\n` +
                 '🔒 _El panel para equipar y seleccionar entre tus títulos desbloqueados estará disponible muy pronto._';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Volver al Hogar', 'menu_home')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });
}

module.exports = { registerHomeHandlers };
