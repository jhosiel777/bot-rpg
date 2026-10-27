const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');
const { Duel } = require('../duelModel');

const ADMIN_ID = 835648800;

// Función para limpiar nombres en la interfaz de la taberna y el ranking
function shortenName(name) {
  if (!name) return 'Aventurero';
  let clean = name.replace(/(#|@)\S+/g, ''); 
  clean = clean.replace(/[^\p{L}\p{N}\s]/gu, '').trim(); 
  return clean.split(/\s+/)[0] || 'Aventurero'; 
}

// Función para obtener la fecha de inicio del lunes actual (00:00 UTC)
function getStartOfWeekUtc() {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function registerTavernHandlers(bot, { Player, getPlayer }) {

  bot.action('menu_tavern', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = '🍻 *TABERNA DEL JABALÍ EBRIO* 🍻\n\n' +
               'El humo de pipa y el tintineo de jarras llenan el aire. Aventureros descansan, conciertan desafíos de arena y cuentan hazañas legendarias.\n\n' +
               '¿Qué deseas hacer en la taberna?';

    const buttons = [
      [Markup.button.callback('⚔️ Arena de Duelos (PvP)', 'tavern_pvp')],
      [Markup.button.callback('🏆 Ranking de Gladiadores', 'tavern_pvp_ranking')],
      [Markup.button.callback('👤 Hablar con el Mercader Misterioso', 'tavern_merchant')],
      [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('tavern_merchant', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    const currentWeek = getStartOfWeekUtc();
    if (player.lastGoldPurchaseWeek !== currentWeek) {
      player.weeklyGoldPurchases = 0;
      player.lastGoldPurchaseWeek = currentWeek;
      await player.save();
    }

    const weeklyBought = player.weeklyGoldPurchases || 0;

    let text = '👤 *MERCADER MISTERIOSO*\n\n' +
               '— *"Poseo reliquias que la moneda ordinaria no puede pagar..."*\n\n';

    if (!player.hasAncestralGem) {
      text += '• 🔮 *Gema Ancestral de Resistencia*\n' +
              '  _Aumenta permanentemente tu energía máxima en +2 ⚡ y confiere el título honorífico «Mecenas de Abyss»._\n' +
              '  Precio: *0.15 TON*\n\n';
    }

    text += '• 💰 *Bolsa de 1.100 de Oro*\n' +
            '  _Inyección inmediata de riqueza real. Confiere el título «Mecenas de Abyss» si aún no lo posees._\n' +
            '  Precio: *0.10 TON* | Compras esta semana: *' + weeklyBought + '/6*\n\n' +
            'Conecta tu billetera para sellar el pacto:';

    const buttons = [];

    if (!player.hasAncestralGem) {
      const gemUrl = 'https://bot-rpg-wu42.onrender.com/buy-web3?purpose=ancestral_gem&userId=' + player.userId;
      buttons.push([Markup.button.webApp('💎 Gema Ancestral (0.15 TON)', gemUrl)]);
    }

    if (weeklyBought < 6) {
      const goldUrl = 'https://bot-rpg-wu42.onrender.com/buy-web3?purpose=gold_pack&userId=' + player.userId;
      buttons.push([Markup.button.webApp('💰 1.100 Oro (0.10 TON) [' + weeklyBought + '/6]', goldUrl)]);
    } else {
      buttons.push([Markup.button.callback('🚫 Límite semanal de Oro alcanzado (6/6)', 'merchant_limit_info')]);
    }

    buttons.push([Markup.button.callback('⬅️ Volver a la Taberna', 'menu_tavern')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('merchant_limit_info', async (ctx) => {
    return await safeAnswerCb(ctx, '⚠️ Alcanzaste el límite de 6 compras semanales. Se reinicia el lunes a las 00:00 UTC.', true);
  });

  bot.action('tavern_pvp', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if ((player.level || 1) < 5) {
      return await safeAnswerCb(ctx, '⚠️ Requieres alcanzar el Nivel 5 para entrar a la Arena de Duelos.', true);
    }

    if (!player.tonWalletAddress) {
      const connectUrl = 'https://bot-rpg-wu42.onrender.com/connect-wallet?userId=' + player.userId;
      const textNoWallet = '⚔️ *ARENA DE DUELOS: ACCESO DENEGADO* ⚔️\n\n' +
                           'Para combatir en la Arena interactiva debes tener vinculada una **Billetera TON** en tu perfil.\n\n' +
                           'Pulsa el botón de abajo para conectarla vía TON Connect:';
      return await safeEditMessage(ctx, textNoWallet, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.webApp('🔗 Vincular Billetera TON', connectUrl)],
          [Markup.button.callback('⬅️ Volver a la Taberna', 'menu_tavern')]
        ])
      });
    }

    const text = '⚔️ *ARENA DE DUELOS DE LA TABERNA* ⚔️\n\n' +
                 'Los gladiadores del reino miden su temple en combates por turnos interactivos en el chat. Las estadísticas de tus armaduras y armas se aplican directamente en la batalla.\n\n' +
                 '📜 *MODALIDADES DE COMBATE:*\n' +
                 '• 🤝 *Amistoso:* Sin riesgo de monedas. Otorga gloria para el Ranking y títulos honoríficos.\n' +
                 '• 💰 *Oro:* Apuestas de 50 a 500 de Oro (quema el 5% del pozo).\n' +
                 '• 💎 *GRAM:* Apuestas de 0.05 a 0.50 GRAM (comisión del 8%, mínimo 0.02 GRAM para apoyar al creador).\n\n' +
                 '⚠️ *ADVERTENCIA DE JUEGO RESPONSABLE:*\n' +
                 '_Los duelos con GRAM implican riesgo de saldo real. Si solo buscas competir o divertirte, usa las modalidades Amistoso u Oro._';

    const buttons = [
      [Markup.button.callback('➕ Crear Desafío', 'pvp_create_menu')],
      [Markup.button.callback('📋 Duelos Disponibles', 'pvp_list_open')],
      [Markup.button.callback('🏆 Ranking de Gladiadores', 'tavern_pvp_ranking')],
      [Markup.button.callback('⬅️ Volver a la Taberna', 'menu_tavern')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('pvp_create_menu', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    const text = '➕ *CREAR NUEVO DESAFÍO EN LA ARENA*\n\n' +
                 `💰 *Tu Oro:* ${player.gold || 0}\n` +
                 `💎 *Tu Saldo GRAM:* ${Number(player.gram || 0).toFixed(3)} GRAM\n\n` +
                 'Selecciona la modalidad de tu duelo:';

    const buttons = [
      [Markup.button.callback('🤝 Duelo Amistoso (Sin Apuesta)', 'pvp_create_friendly')],
      [Markup.button.callback('💰 Duelo por Oro', 'pvp_mode_gold')],
      [Markup.button.callback('💎 Duelo por GRAM', 'pvp_mode_gram')],
      [Markup.button.callback('⬅️ Volver a la Arena', 'tavern_pvp')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('pvp_create_friendly', async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    await Duel.create({
      creatorId: player.userId,
      creatorName: player.name,
      creatorTitle: player.activeTitle || 'Aventurero Novato',
      mode: 'friendly',
      betAmount: 0
    });

    await safeAnswerCb(ctx, '¡Desafío amistoso publicado!', true);
    return await ctx.reply('🤝 *¡Desafío Amistoso creado!*\n\nTu reto ha sido colocado en la lista de duelos abiertos. Cuando otro aventurero acepte, el combate iniciará aquí en el chat.');
  });

  bot.action('pvp_mode_gold', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    const text = '💰 *DUELO POR ORO DEL REINO*\n\n' +
                 `Tu reserva actual: *${player.gold || 0} de Oro*\n` +
                 '_El 5% del pozo acumulado será consumido por los sacerdotes de la arena (quema económica)._\n\n' +
                 'Elige el monto a apostar:';

    const buttons = [
      [Markup.button.callback('50 Oro', 'pvp_set_gold_50'), Markup.button.callback('100 Oro', 'pvp_set_gold_100')],
      [Markup.button.callback('250 Oro', 'pvp_set_gold_250'), Markup.button.callback('500 Oro', 'pvp_set_gold_500')],
      [Markup.button.callback('⬅️ Volver', 'pvp_create_menu')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/pvp_set_gold_(\d+)/, async (ctx) => {
    const bet = parseInt(ctx.match[1], 10);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if ((player.gold || 0) < bet) return await safeAnswerCb(ctx, `No posees suficiente Oro (${bet}).`, true);

    player.gold -= bet;
    await player.save();

    await Duel.create({
      creatorId: player.userId,
      creatorName: player.name,
      creatorTitle: player.activeTitle || 'Aventurero Novato',
      mode: 'gold',
      betAmount: bet
    });

    await safeAnswerCb(ctx, `Duelo por ${bet} de Oro creado.`, true);
    return await ctx.reply(`💰 *¡Desafío por ${bet} de Oro publicado!*\n\nTus ${bet} de Oro han quedado congelados en garantía. Si cancelas el duelo antes de que sea disputado, retornarán al instante a tu bolsa.`);
  });

  bot.action('pvp_mode_gram', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const gramBal = Number(player.gram || 0);

    const text = '💎 *DUELO POR GRAM (WEB3)*\n\n' +
                 `Tu saldo disponible: *${gramBal.toFixed(3)} GRAM*\n\n` +
                 '• *Rango de apuesta:* 0.05 a 0.50 GRAM.\n' +
                 '• *Comisión de arena:* 8% del pozo (mínimo 0.02 GRAM) destinada a apoyar al creador y mantener activo el reino.\n' +
                 '• El monto se descuenta de tu balance interno al crear o aceptar el reto.\n\n' +
                 'Elige el monto a apostar:';

    const buttons = [
      [Markup.button.callback('0.05 GRAM', 'pvp_set_gram_0.05'), Markup.button.callback('0.10 GRAM', 'pvp_set_gram_0.10')],
      [Markup.button.callback('0.25 GRAM', 'pvp_set_gram_0.25'), Markup.button.callback('0.50 GRAM', 'pvp_set_gram_0.50')],
      [Markup.button.callback('⬅️ Volver', 'pvp_create_menu')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/pvp_set_gram_(0\.05|0\.10|0\.25|0\.50)/, async (ctx) => {
    const bet = parseFloat(ctx.match[1]);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if ((player.gram || 0) < bet) return await safeAnswerCb(ctx, `Saldo de GRAM insuficiente (${bet} GRAM).`, true);

    player.gram = Math.max(0, player.gram - bet);
    await player.save();

    await Duel.create({
      creatorId: player.userId,
      creatorName: player.name,
      creatorTitle: player.activeTitle || 'Aventurero Novato',
      mode: 'gram',
      betAmount: bet
    });

    await safeAnswerCb(ctx, `Duelo por ${bet} GRAM creado.`, true);
    return await ctx.reply(`💎 *¡Desafío por ${bet} GRAM publicado!*\n\nTus ${bet} GRAM han quedado congelados en garantía. Si cancelas el reto antes del combate, se te reintegrarán íntegramente.`);
  });

  bot.action('pvp_list_open', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const openDuels = await Duel.find({ status: 'open' }).sort({ createdAt: -1 }).limit(8);

    if (openDuels.length === 0) {
      const textEmpty = '📋 *TABLÓN DE DUELOS ABIERTOS*\n\nNo hay desafíos pendientes en este momento. ¡Sé el primero en levantar tu estandarte!';
      const buttons = [
        [Markup.button.callback('➕ Crear Desafío', 'pvp_create_menu')],
        [Markup.button.callback('⬅️ Volver a la Arena', 'tavern_pvp')]
      ];
      return await safeEditMessage(ctx, textEmpty, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }

    let text = '📋 *TABLÓN DE DUELOS ABIERTOS*\n\nSelecciona un desafío para aceptar la batalla o retirar tu propio reto:\n\n';
    const buttons = [];

    for (const d of openDuels) {
      const isCreator = (d.creatorId === player.userId);
      let modeIcon = '🤝';
      let stakeText = 'Amistoso';

      if (d.mode === 'gold') { modeIcon = '💰'; stakeText = `${d.betAmount} Oro`; } 
      else if (d.mode === 'gram') { modeIcon = '💎'; stakeText = `${d.betAmount} GRAM`; }

      const label = isCreator
        ? `❌ Cancelar mi reto (${modeIcon} ${stakeText})`
        : `⚔️ [«${d.creatorTitle || 'Aventurero Novato'}»] ${shortenName(d.creatorName)} (${modeIcon} ${stakeText})`;

      const actionCb = isCreator ? `pvp_cancel_${d._id}` : `pvp_accept_${d._id}`;
      buttons.push([Markup.button.callback(label, actionCb)]);
    }

    buttons.push([Markup.button.callback('🔄 Actualizar Lista', 'pvp_list_open')]);
    buttons.push([Markup.button.callback('⬅️ Volver a la Arena', 'tavern_pvp')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/pvp_cancel_([a-f0-9]{24})/, async (ctx) => {
    const duelId = ctx.match[1];
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const duel = await Duel.findById(duelId);
    
    if (!duel || duel.status !== 'open') return await safeAnswerCb(ctx, 'Este duelo ya no está disponible o ha finalizado.', true);
    if (duel.creatorId !== player.userId) return await safeAnswerCb(ctx, 'Solo el creador puede cancelar este duelo.', true);

    if (duel.mode === 'gold' && duel.betAmount > 0) player.gold = (player.gold || 0) + duel.betAmount;
    else if (duel.mode === 'gram' && duel.betAmount > 0) player.gram = (player.gram || 0) + duel.betAmount;

    duel.status = 'cancelled';
    await duel.save();
    await player.save();

    await safeAnswerCb(ctx, 'Desafío cancelado y fondos reembolsados.', true);
    return await ctx.reply('✅ *Has cancelado tu desafío.* Los fondos congelados han retornado a tu balance.');
  });

  bot.action('tavern_pvp_ranking', async (ctx) => {
    await safeAnswerCb(ctx);
    const topGladiators = await Player.where('pvpWins').gt(0).sort({ pvpWins: -1, pvpLosses: 1 }).limit(10);

    let text = '🏆 *TABLÓN DE GLADIADORES DE ABYSS* 🏆\n\nLos combatientes más victoriosos de la arena:\n\n';

    if (topGladiators.length === 0) {
      text += '_Aún ningún guerrero ha grabado su nombre en la arena. ¡Sé el primero en triunfar!_';
    } else {
      topGladiators.forEach((g, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🎖️';
        const totalFights = (g.pvpWins || 0) + (g.pvpLosses || 0);
        const winRate = totalFights > 0 ? Math.round((g.pvpWins / totalFights) * 100) : 0;
        text += `${medal} *#${index + 1} [«${g.activeTitle || 'Aventurero Novato'}»] ${shortenName(g.name)}*\n   Victorias: *${g.pvpWins}* | Derrotas: *${g.pvpLosses || 0}* | Efectividad: *${winRate}% WR*\n\n`;
      });
    }

    const buttons = [[Markup.button.callback('⚔️ Ir a la Arena de Duelos', 'tavern_pvp')]];
    if (ctx.from.id === ADMIN_ID) buttons.push([Markup.button.callback('⚠️ Reiniciar Ranking PvP', 'admin_pvp_reset_prompt')]);
    buttons.push([Markup.button.callback('⬅️ Volver a la Taberna', 'menu_tavern')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('admin_pvp_reset_prompt', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acción no autorizada.', true);
    await safeAnswerCb(ctx);
    const text = '⚠️ *CONFIRMACIÓN DE REINICIO DE RANKING PVP* ⚠️\n\n¿Estás seguro de que deseas reiniciar a cero las victorias y derrotas de todos los gladiadores del reino?\n\n_Esta acción es irreversible y vaciará el tablón de gladiadores._';
    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('🔴 Sí, reiniciar a cero', 'admin_pvp_reset_confirm')], [Markup.button.callback('❌ No, cancelar', 'tavern_pvp_ranking')]]);
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action('admin_pvp_reset_confirm', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acción no autorizada.', true);
    const setKey = String.fromCharCode(36) + 'set';
    const resetPayload = {}; resetPayload[setKey] = { pvpWins: 0, pvpLosses: 0 };
    await Player.updateMany({}, resetPayload);
    await safeAnswerCb(ctx, '🏆 Ranking PvP reiniciado con éxito.', true);
    return await safeEditMessage(ctx, '🏆 *TABLÓN DE GLADIADORES DE ABYSS* 🏆\n\nLos combatientes más victoriosos de la arena:\n\n_Aún ningún guerrero ha grabado su nombre en la arena. ¡Sé el primero en triunfar!_', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('⚔️ Ir a la Arena de Duelos', 'tavern_pvp')], [Markup.button.callback('⚠️ Reiniciar Ranking PvP', 'admin_pvp_reset_prompt')], [Markup.button.callback('⬅️ Volver a la Taberna', 'menu_tavern')]]) });
  });
}

module.exports = { registerTavernHandlers };
