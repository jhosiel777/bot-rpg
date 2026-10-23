const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');
const { Duel } = require('../duelModel');
// Mantenemos shortenName para acortar nombres en la UI. simulatePvPDuel se eliminó porque ahora es web.
const { shortenName } = require('../pvpEngine'); 

const ADMIN_ID = 835648800;
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://bot-rpg-wu42.onrender.com';

function registerTavernHandlers(bot, { Player, getPlayer }) {

  // ==========================================
  // MENÚ PRINCIPAL DE LA TABERNA
  // ==========================================
  bot.action('menu_tavern', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = '🍻 *TABERNA DEL JABALÍ EBRIO* 🍻\n\n' +
               'El humo de pipa y el tintineo de jarras llenan el aire. Aventureros descansan, conciertan desafíos de arena y cuentan hazañas legendarias.\n\n' +
               '¿Qué deseas hacer en la taberna?';

    const buttons = [
      [Markup.button.callback('⚔️ Arena de Duelos (PvP)', 'tavern_pvp')],
      [Markup.button.callback('🏆 Ranking de Gladiadores', 'tavern_pvp_ranking')]
    ];

    if (!player.hasAncestralGem) {
      buttons.push([Markup.button.callback('👤 Hablar con el Mercader Misterioso', 'tavern_merchant')]);
    }

    buttons.push([Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]);

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // ==========================================
  // MERCADER MISTERIOSO (GEMA ANCESTRAL)
  // ==========================================
  bot.action('tavern_merchant', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (player.hasAncestralGem) {
      return await safeAnswerCb(ctx, 'El mercader no tiene nada más que ofrecerte por ahora.', true);
    }

    const text = '👤 *MERCADER MISTERIOSO*\n\n' +
                 '— *"Poseo reliquias que la moneda ordinaria no puede pagar..."*\n\n' +
                 '• 🔮 *Gema Ancestral de Resistencia*\n' +
                 '  _Aumenta permanentemente tu energía máxima en +2 ⚡ y confiere el título honorífico «Mecenas de Abyss»._\n' +
                 '  Precio: *0.15 TON*\n\n' +
                 'Conecta tu billetera para sellar el pacto:';

    const miniAppUrl = 'https://bot-rpg-wu42.onrender.com/buy-web3?purpose=ancestral_gem&userId=' + player.userId;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.webApp('💎 Comprar con TON (0.15)', miniAppUrl)],
      [Markup.button.callback('⬅️ Volver a la Taberna', 'menu_tavern')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  // ==========================================
  // VISTA PRINCIPAL: ARENA DE DUELOS (PVP)
  // ==========================================
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
                 'Los gladiadores del reino miden su temple en combates en vivo interactivos (Mini App). Las estadísticas de tus armaduras y armas se aplican directamente en la batalla.\n\n' +
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

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // ==========================================
  // CREACIÓN DE DUELO: SELECCIÓN DE MODO
  // ==========================================
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

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
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
    return await ctx.reply('🤝 *¡Desafío Amistoso creado!*\n\nTu reto ha sido colocado en la lista de duelos abiertos. Cuando otro aventurero acepte, recibirás el enlace para entrar a la Arena Web.');
  });

  bot.action('pvp_mode_gold', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    const text = '💰 *DUELO POR ORO DEL REINO*\n\n' +
                 `Tu reserva actual: *${player.gold || 0} de Oro*\n` +
                 '_El 5% del pozo acumulado será consumido por los sacerdotes de la arena (quema económica)._\n\n' +
                 'Elige el monto a apostar:';

    const buttons = [
      [
        Markup.button.callback('50 Oro', 'pvp_set_gold_50'),
        Markup.button.callback('100 Oro', 'pvp_set_gold_100')
      ],
      [
        Markup.button.callback('250 Oro', 'pvp_set_gold_250'),
        Markup.button.callback('500 Oro', 'pvp_set_gold_500')
      ],
      [Markup.button.callback('⬅️ Volver', 'pvp_create_menu')]
    ];

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  bot.action(/pvp_set_gold_(\d+)/, async (ctx) => {
    const bet = parseInt(ctx.match[1], 10);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if ((player.gold || 0) < bet) {
      return await safeAnswerCb(ctx, `No posees suficiente Oro (${bet}).`, true);
    }

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
      [
        Markup.button.callback('0.05 GRAM', 'pvp_set_gram_0.05'),
        Markup.button.callback('0.10 GRAM', 'pvp_set_gram_0.10')
      ],
      [
        Markup.button.callback('0.25 GRAM', 'pvp_set_gram_0.25'),
        Markup.button.callback('0.50 GRAM', 'pvp_set_gram_0.50')
      ],
      [Markup.button.callback('⬅️ Volver', 'pvp_create_menu')]
    ];

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  bot.action(/pvp_set_gram_(0\.05|0\.10|0\.25|0\.50)/, async (ctx) => {
    const bet = parseFloat(ctx.match[1]);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if ((player.gram || 0) < bet) {
      return await safeAnswerCb(ctx, `Saldo de GRAM insuficiente (${bet} GRAM).`, true);
    }

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

  // ==========================================
  // LISTA DE DUELOS DISPONIBLES
  // ==========================================
  bot.action('pvp_list_open', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    const openDuels = await Duel.find({ status: 'open' }).sort({ createdAt: -1 }).limit(8);

    if (openDuels.length === 0) {
      const textEmpty = '📋 *TABLÓN DE DUELOS ABIERTOS*\n\n' +
                        'No hay desafíos pendientes en este momento. ¡Sé el primero en levantar tu estandarte!';
      const buttons = [
        [Markup.button.callback('➕ Crear Desafío', 'pvp_create_menu')],
        [Markup.button.callback('⬅️ Volver a la Arena', 'tavern_pvp')]
      ];
      return await safeEditMessage(ctx, textEmpty, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }

    let text = '📋 *TABLÓN DE DUELOS ABIERTOS*\n\n' +
               'Selecciona un desafío para aceptar la batalla o retirar tu propio reto:\n\n';

    const buttons = [];

    for (const d of openDuels) {
      // Ignorar duelos que ya fueron aceptados por alguien y están contando sus 30s
      if (d.acceptedAt) continue;

      const isCreator = (d.creatorId === player.userId);
      let modeIcon = '🤝';
      let stakeText = 'Amistoso';

      if (d.mode === 'gold') {
        modeIcon = '💰';
        stakeText = `${d.betAmount} Oro`;
      } else if (d.mode === 'gram') {
        modeIcon = '💎';
        stakeText = `${d.betAmount} GRAM`;
      }

      const creatorTitle = d.creatorTitle || 'Aventurero Novato';
      const cleanCreatorName = shortenName(d.creatorName);

      const label = isCreator
        ? `❌ Cancelar mi reto (${modeIcon} ${stakeText})`
        : `⚔️ [«${creatorTitle}»] ${cleanCreatorName} (${modeIcon} ${stakeText})`;

      const actionCb = isCreator ? `pvp_cancel_${d._id}` : `pvp_accept_${d._id}`;
      buttons.push([Markup.button.callback(label, actionCb)]);
    }

    if (buttons.length === 0) {
      return await safeEditMessage(ctx, '📋 *TABLÓN DE DUELOS ABIERTOS*\n\nTodos los duelos actuales ya están en proceso. ¡Prueba actualizar en un momento!', { 
        parse_mode: 'Markdown', 
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Actualizar Lista', 'pvp_list_open')],
          [Markup.button.callback('⬅️ Volver a la Arena', 'tavern_pvp')]
        ]) 
      });
    }

    buttons.push([Markup.button.callback('🔄 Actualizar Lista', 'pvp_list_open')]);
    buttons.push([Markup.button.callback('⬅️ Volver a la Arena', 'tavern_pvp')]);

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // ==========================================
  // CANCELAR DUELO PROPIO
  // ==========================================
  bot.action(/pvp_cancel_([a-f0-9]{24})/, async (ctx) => {
    const duelId = ctx.match[1];
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    const duel = await Duel.findById(duelId);
    if (!duel || duel.status !== 'open') {
      return await safeAnswerCb(ctx, 'Este duelo ya no está disponible o ha finalizado.', true);
    }

    if (duel.creatorId !== player.userId) {
      return await safeAnswerCb(ctx, 'Solo el creador puede cancelar este duelo.', true);
    }

    if (duel.mode === 'gold' && duel.betAmount > 0) {
      player.gold = (player.gold || 0) + duel.betAmount;
    } else if (duel.mode === 'gram' && duel.betAmount > 0) {
      player.gram = (player.gram || 0) + duel.betAmount;
    }

    duel.status = 'cancelled';
    await duel.save();
    await player.save();

    await safeAnswerCb(ctx, 'Desafío cancelado y fondos reembolsados.', true);
    return await ctx.reply('✅ *Has cancelado tu desafío.* Los fondos congelados han retornado a tu balance.');
  });

  // ==========================================
  // ACEPTAR Y PREPARAR COMBATE PVP (WEB APP)
  // ==========================================
  bot.action(/pvp_accept_([a-f0-9]{24})/, async (ctx) => {
    const duelId = ctx.match[1];
    const opponent = await getPlayer(ctx.from.id, ctx.from.first_name);

    const duel = await Duel.findById(duelId);
    if (!duel || duel.status !== 'open' || duel.acceptedAt) {
      return await safeAnswerCb(ctx, 'El duelo ya no está abierto o fue tomado por otro aventurero.', true);
    }

    if (duel.creatorId === opponent.userId) {
      return await safeAnswerCb(ctx, 'No puedes batirte en duelo contra ti mismo.', true);
    }

    if ((opponent.level || 1) < 5 || !opponent.tonWalletAddress) {
      return await safeAnswerCb(ctx, 'Requieres nivel 5 y billetera TON vinculada para aceptar duelos.', true);
    }

    if (duel.mode === 'gold' && (opponent.gold || 0) < duel.betAmount) {
      return await safeAnswerCb(ctx, `No tienes suficiente Oro para aceptar (${duel.betAmount} Oro).`, true);
    }
    if (duel.mode === 'gram' && (opponent.gram || 0) < duel.betAmount) {
      return await safeAnswerCb(ctx, `No tienes suficiente GRAM para aceptar (${duel.betAmount} GRAM).`, true);
    }

    // Congelar fondos del retador
    if (duel.mode === 'gold') opponent.gold -= duel.betAmount;
    if (duel.mode === 'gram') opponent.gram = Math.max(0, opponent.gram - duel.betAmount);
    await opponent.save();

    const creator = await Player.findOne({ userId: duel.creatorId });
    if (!creator) {
      return await safeAnswerCb(ctx, 'El creador del duelo ya no existe en el reino.', true);
    }

    await safeAnswerCb(ctx, '⚔️ ¡Aceptaste el desafío! Preparando la Arena...');

    // Fijar al oponente e iniciar reloj de 30 segundos (Sin cambiar a active aún)
    duel.opponentId = opponent.userId;
    duel.opponentName = opponent.name;
    duel.opponentTitle = opponent.activeTitle || 'Aventurero Novato';
    duel.acceptedAt = new Date(); // Inicia el reloj de 30 segundos
    await duel.save();

    const p1Label = `[«${creator.activeTitle || 'Aventurero Novato'}»] *${shortenName(creator.name)}*`;
    const p2Label = `[«${opponent.activeTitle || 'Aventurero Novato'}»] *${shortenName(opponent.name)}*`;

    const textReady = `⚔️🔥 *¡EL DUELO HA SIDO ACEPTADO!* 🔥⚔️\n\n` +
                      `🛡️ ${p1Label}\n` +
                      `⚡ *VS*\n` +
                      `🛡️ ${p2Label}\n\n` +
                      `⚠️ *ATENCIÓN:* Los fondos están asegurados. Ambos gladiadores tienen exactamente **30 segundos** para pulsar el botón de abajo y entrar a la Arena. Si alguno no entra a tiempo, el duelo se cancelará y los fondos serán devueltos.`;

    const creatorUrl = `${SERVER_URL}/pvp-arena?duelId=${duel._id}&userId=${creator.userId}`;
    const opponentUrl = `${SERVER_URL}/pvp-arena?duelId=${duel._id}&userId=${opponent.userId}`;

    // Actualiza el mensaje actual del que aceptó
    await safeEditMessage(ctx, textReady, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.webApp('🎮 Entrar a la Arena', opponentUrl)]])
    });

    // Notifica al creador que su duelo fue aceptado
    try {
      await bot.telegram.sendMessage(creator.userId, textReady, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.webApp('🎮 Entrar a la Arena', creatorUrl)]])
      });
    } catch (e) {}
  });

  // ==========================================
  // RANKING DE GLADIADORES (PVP)
  // ==========================================
  bot.action('tavern_pvp_ranking', async (ctx) => {
    await safeAnswerCb(ctx);

    const topGladiators = await Player.where('pvpWins').gt(0)
      .sort({ pvpWins: -1, pvpLosses: 1 })
      .limit(10);

    let text = '🏆 *TABLÓN DE GLADIADORES DE ABYSS* 🏆\n\n' +
               'Los combatientes más victoriosos de la arena:\n\n';

    if (topGladiators.length === 0) {
      text += '_Aún ningún guerrero ha grabado su nombre en la arena. ¡Sé el primero en triunfar!_';
    } else {
      topGladiators.forEach((g, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🎖️';
        const totalFights = (g.pvpWins || 0) + (g.pvpLosses || 0);
        const winRate = totalFights > 0 ? Math.round((g.pvpWins / totalFights) * 100) : 0;
        const title = g.activeTitle || 'Aventurero Novato';
        const cleanName = shortenName(g.name);

        text += `${medal} *#${index + 1} [«${title}»] ${cleanName}*\n` +
                `    Victorias: *${g.pvpWins}* | Derrotas: *${g.pvpLosses || 0}* | Efectividad: *${winRate}% WR*\n\n`;
      });
    }

    const buttons = [
      [Markup.button.callback('⚔️ Ir a la Arena de Duelos', 'tavern_pvp')]
    ];

    if (ctx.from.id === ADMIN_ID) {
      buttons.push([Markup.button.callback('⚠️ Reiniciar Ranking PvP', 'admin_pvp_reset_prompt')]);
    }

    buttons.push([Markup.button.callback('⬅️ Volver a la Taberna', 'menu_tavern')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  // ==========================================
  // CONFIRMACIÓN DE REINICIO DE RANKING (SOLO ADMIN)
  // ==========================================
  bot.action('admin_pvp_reset_prompt', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
      return await safeAnswerCb(ctx, 'Acción no autorizada.', true);
    }
    await safeAnswerCb(ctx);

    const text = '⚠️ *CONFIRMACIÓN DE REINICIO DE RANKING PVP* ⚠️\n\n' +
                 '¿Estás seguro de que deseas reiniciar a cero las victorias y derrotas de todos los gladiadores del reino?\n\n' +
                 '_Esta acción es irreversible y vaciará el tablón de gladiadores._';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔴 Sí, reiniciar a cero', 'admin_pvp_reset_confirm')],
      [Markup.button.callback('❌ No, cancelar', 'tavern_pvp_ranking')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action('admin_pvp_reset_confirm', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
      return await safeAnswerCb(ctx, 'Acción no autorizada.', true);
    }

    const setKey = String.fromCharCode(36) + 'set';
    const resetPayload = {};
    resetPayload[setKey] = { pvpWins: 0, pvpLosses: 0 };

    await Player.updateMany({}, resetPayload);
    await safeAnswerCb(ctx, '🏆 Ranking PvP reiniciado con éxito.', true);

    const text = '🏆 *TABLÓN DE GLADIADORES DE ABYSS* 🏆\n\n' +
                 'Los combatientes más victoriosos de la arena:\n\n' +
                 '_Aún ningún guerrero ha grabado su nombre en la arena. ¡Sé el primero en triunfar!_';

    const buttons = [
      [Markup.button.callback('⚔️ Ir a la Arena de Duelos', 'tavern_pvp')],
      [Markup.button.callback('⚠️ Reiniciar Ranking PvP', 'admin_pvp_reset_prompt')],
      [Markup.button.callback('⬅️ Volver a la Taberna', 'menu_tavern')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });
}

module.exports = { registerTavernHandlers };
