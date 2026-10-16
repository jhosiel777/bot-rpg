const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');
const { Duel } = require('../duelModel');
const { simulatePvPDuel, shortenName } = require('../pvpEngine');
const { syncPlayerTitles } = require('./homeHandler');

const ADMIN_ID = 835648800;
const ADMIN_WALLET_ADDRESS = 'UQACsFyGAD7F82-ta84_iLKmCyHsL3809ZmzRqHYZGTdXC1O';
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
                           'Para combatir en la Arena y registrar tus victorias en el reino, debes tener vinculada una **Billetera TON** en tu perfil.\n\n' +
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
                 'Los gladiadores del reino miden su temple en combates simulados al instante por atributos:\n\n' +
                 '• *Fuerza:* Define el daño base y mitiga hasta un *25%* de daño recibido.\n' +
                 '• *Agilidad:* Decide la iniciativa y probabilidad de esquivar.\n' +
                 '• *Suerte:* Probabilidad de golpes críticos (*x1.25 de daño*).\n' +
                 '• *Pociones Automáticas:* Si tu vida cae bajo el 40%, beberás automáticamente hasta *2 pociones* de tu mochila (priorizando la mejor poción disponible).\n\n' +
                 '📜 *MODALIDADES DE COMBATE:*\n' +
                 '• 🤝 *Amistoso:* Sin riesgo de monedas. Otorga gloria para el Ranking y títulos honoríficos.\n' +
                 '• 💰 *Oro:* Apuestas de 50 a 500 de Oro (quema el 5% del pozo).\n' +
                 '• 💎 *GRAM:* Apuestas de 0.05 a 0.50 GRAM (comisión del 8%, mínimo 0.02 GRAM para apoyar al creador y mantener el proyecto).\n\n' +
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
    return await ctx.reply('🤝 *¡Desafío Amistoso creado!*\n\nTu reto ha sido colocado en la lista de duelos abiertos. Cuando otro aventurero acepte, el combate se resolverá de inmediato.');
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
  // ACEPTAR Y RESOLVER COMBATE PVP
  // ==========================================
  bot.action(/pvp_accept_([a-f0-9]{24})/, async (ctx) => {
    const duelId = ctx.match[1];
    const opponent = await getPlayer(ctx.from.id, ctx.from.first_name);

    const duel = await Duel.findById(duelId);
    if (!duel || duel.status !== 'open') {
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

    if (duel.mode === 'gold') opponent.gold -= duel.betAmount;
    if (duel.mode === 'gram') opponent.gram = Math.max(0, opponent.gram - duel.betAmount);
    await opponent.save();

    const creator = await Player.findOne({ userId: duel.creatorId });
    if (!creator) {
      return await safeAnswerCb(ctx, 'El creador del duelo ya no existe en el reino.', true);
    }

    await safeAnswerCb(ctx, '⚔️ ¡Aceptaste el desafío! Iniciando combate...');

    duel.opponentId = opponent.userId;
    duel.opponentName = opponent.name;
    duel.opponentTitle = opponent.activeTitle || 'Aventurero Novato';

    const p1Label = `[«${creator.activeTitle || 'Aventurero Novato'}»] *${shortenName(creator.name)}*`;
    const p2Label = `[«${opponent.activeTitle || 'Aventurero Novato'}»] *${shortenName(opponent.name)}*`;

    let progressMsg = await ctx.reply(
      '⚔️🔥 *¡COMIENZA EL DUELO EN LA ARENA!* 🔥⚔️\n\n' +
      `🛡️ ${p1Label}\n` +
      '⚡ *VS*\n' +
      `🛡️ ${p2Label}\n\n` +
      '_Los gladiadores desenvainan sus armas y cruzan miradas en el centro de la arena..._',
      { parse_mode: 'Markdown' }
    );

    await new Promise((r) => setTimeout(r, 1500));

    const result = simulatePvPDuel(creator, opponent);

    if (result.potionsUsedP1.small > 0) creator.potionsSmall = Math.max(0, (creator.potionsSmall || 0) - result.potionsUsedP1.small);
    if (result.potionsUsedP1.medium > 0) creator.potionsMedium = Math.max(0, (creator.potionsMedium || 0) - result.potionsUsedP1.medium);
    if (result.potionsUsedP2.small > 0) opponent.potionsSmall = Math.max(0, (opponent.potionsSmall || 0) - result.potionsUsedP2.small);
    if (result.potionsUsedP2.medium > 0) opponent.potionsMedium = Math.max(0, (opponent.potionsMedium || 0) - result.potionsUsedP2.medium);

    const isCreatorWinner = (result.winnerId === creator.userId);
    const winner = isCreatorWinner ? creator : opponent;
    const loser = isCreatorWinner ? opponent : creator;

    winner.pvpWins = (winner.pvpWins || 0) + 1;
    loser.pvpLosses = (loser.pvpLosses || 0) + 1;

    let rewardWinnerNote = '';
    let rewardLoserNote = '';

    if (duel.mode === 'friendly') {
      rewardWinnerNote = '🤝 *Resultado:* ¡Duelo Amistoso ganado! La victoria suma a tu reputación y gloria en el reino.';
      rewardLoserNote = '🤝 *Resultado:* Has caído en el duelo amistoso, pero te retiras con el honor intacto.';
    } else if (duel.mode === 'gold') {
      const pot = duel.betAmount * 2;
      const burned = Math.round(pot * 0.05);
      const prize = pot - burned;
      winner.gold = (winner.gold || 0) + prize;
      rewardWinnerNote = `💰 *Pozo:* ${pot} Oro | 🔥 *Quemado (5%):* ${burned}g\n🏆 *Premio:* Ganaste +${prize} de Oro acreditados a tu bolsa.`;
      rewardLoserNote = `💸 Has caído en combate y perdido tu apuesta de ${duel.betAmount} de Oro.`;
    } else if (duel.mode === 'gram') {
      const pot = Number((duel.betAmount * 2).toFixed(4));
      const rawFee = pot * 0.08;
      const fee = Math.max(0.02, Math.floor(rawFee * 10000) / 10000);
      const prize = Math.floor((pot - fee) * 10000) / 10000;

      winner.gram = (winner.gram || 0) + prize;
      rewardWinnerNote = `💎 *Pozo:* ${pot} GRAM | 💡 *Comisión soporte (8%):* ${fee} GRAM\n🏆 *Premio Web3:* Ganaste +${prize} GRAM acreditados a tu balance.`;
      rewardLoserNote = `💎 Has caído en combate y cedido tu apuesta de ${duel.betAmount} GRAM en la arena.`;

      fetch(`${SERVER_URL}/send-ton-payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: ADMIN_ID,
          toAddress: ADMIN_WALLET_ADDRESS,
          amountTon: fee,
          isUserWithdrawal: false
        })
      }).catch((e) => console.error('Error enviando comisión PvP:', e.message));
    }

    await syncPlayerTitles(creator, bot);
    await syncPlayerTitles(opponent, bot);

    await creator.save();
    await opponent.save();

    duel.status = 'completed';
    duel.winnerId = winner.userId;
    duel.combatLog = result.combatLog;
    await duel.save();

    const logText = result.combatLog.slice(-12).join('\n');
    const baseCombatBody = `⚔️📜 *CRÓNICA DE LA ARENA* 📜⚔️\n\n` +
                           `🛡️ ${p1Label}  VS  ${p2Label}\n\n` +
                           `${logText}\n\n`;

    const opponentIsWinner = (winner.userId === opponent.userId);
    const opponentHeader = opponentIsWinner ? '🏆🎉 *¡VICTORIA ÉPICA EN LA ARENA!*' : '💀❌ *HAS SIDO DERROTADO EN LA ARENA...*';
    const opponentFinalMsg = `${opponentHeader}\n\n${baseCombatBody}${opponentIsWinner ? rewardWinnerNote : rewardLoserNote}`;

    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        undefined,
        opponentFinalMsg,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      await ctx.reply(opponentFinalMsg, { parse_mode: 'Markdown' });
    }

    const creatorIsWinner = (winner.userId === creator.userId);
    const creatorHeader = creatorIsWinner ? '🏆🎉 *¡VICTORIA ÉPICA EN LA ARENA!*' : '💀❌ *HAS SIDO DERROTADO EN LA ARENA...*';
    const creatorFinalMsg = `${creatorHeader}\n\n${baseCombatBody}${creatorIsWinner ? rewardWinnerNote : rewardLoserNote}`;

    try {
      await bot.telegram.sendMessage(creator.userId, creatorFinalMsg, { parse_mode: 'Markdown' });
    } catch (e) {}
  });

  // ==========================================
  // RANKING DE GLADIADORES (PVP)
  // ==========================================
  bot.action('tavern_pvp_ranking', async (ctx) => {
    await safeAnswerCb(ctx);

    const topGladiators = await Player.find({ pvpWins: { $gt: 0 } })
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
                `   Victorias: *${g.pvpWins}* | Derrotas: *${g.pvpLosses || 0}* | Efectividad: *${winRate}% WR*\n\n`;
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

    await Player.updateMany({}, { \$set: { pvpWins: 0, pvpLosses: 0 } });
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

module.exports = { registerTavernHandlers };const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');
const { Duel } = require('../duelModel');
const { simulatePvPDuel, shortenName } = require('../pvpEngine');
const { syncPlayerTitles } = require('./homeHandler');

const ADMIN_WALLET_ADDRESS = 'UQACsFyGAD7F82-ta84_iLKmCyHsL3809ZmzRqHYZGTdXC1O';
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
                           'Para combatir en la Arena y registrar tus victorias en el reino, debes tener vinculada una **Billetera TON** en tu perfil.\n\n' +
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
                 'Los gladiadores del reino miden su temple en combates simulados al instante por atributos:\n\n' +
                 '• *Fuerza:* Define el daño base y mitiga hasta un *25%* de daño recibido.\n' +
                 '• *Agilidad:* Decide la iniciativa y probabilidad de esquivar.\n' +
                 '• *Suerte:* Probabilidad de golpes críticos (*x1.25 de daño*).\n' +
                 '• *Pociones Automáticas:* Si tu vida cae bajo el 40%, beberás automáticamente hasta *2 pociones* de tu mochila (priorizando la mejor poción disponible).\n\n' +
                 '📜 *MODALIDADES DE COMBATE:*\n' +
                 '• 🤝 *Amistoso:* Sin riesgo de monedas. Otorga gloria para el Ranking y títulos honoríficos.\n' +
                 '• 💰 *Oro:* Apuestas de 50 a 500 de Oro (quema el 5% del pozo).\n' +
                 '• 💎 *GRAM:* Apuestas de 0.05 a 0.50 GRAM (comisión del 8%, mínimo 0.02 GRAM para apoyar al creador y mantener el proyecto).\n\n' +
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

  // Crear Duelo Amistoso
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
    return await ctx.reply('🤝 *¡Desafío Amistoso creado!*\n\nTu reto ha sido colocado en la lista de duelos abiertos. Cuando otro aventurero acepte, el combate se resolverá de inmediato.');
  });

  // Menú Duelo de Oro
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

  // Procesar creación de duelo por Oro
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

  // Menú Duelo de GRAM
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

  // Procesar creación de duelo por GRAM
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

    buttons.push([Markup.button.callback('🔄 Actualizar Lista', 'pvp_list_open')]);
    buttons.push([Markup.button.callback('⬅️ Volver a la Arena', 'tavern_pvp')]);

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // ==========================================
  // CANCELAR DUELO PROPIO (REEMBOLSO DE FONDOS)
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
  // ACEPTAR Y RESOLVER COMBATE PVP (PROGRESIVO & PERSONALIZADO)
  // ==========================================
  bot.action(/pvp_accept_([a-f0-9]{24})/, async (ctx) => {
    const duelId = ctx.match[1];
    const opponent = await getPlayer(ctx.from.id, ctx.from.first_name);

    const duel = await Duel.findById(duelId);
    if (!duel || duel.status !== 'open') {
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

    if (duel.mode === 'gold') opponent.gold -= duel.betAmount;
    if (duel.mode === 'gram') opponent.gram = Math.max(0, opponent.gram - duel.betAmount);
    await opponent.save();

    const creator = await Player.findOne({ userId: duel.creatorId });
    if (!creator) {
      return await safeAnswerCb(ctx, 'El creador del duelo ya no existe en el reino.', true);
    }

    await safeAnswerCb(ctx, '⚔️ ¡Aceptaste el desafío! Iniciando combate...');

    duel.opponentId = opponent.userId;
    duel.opponentName = opponent.name;
    duel.opponentTitle = opponent.activeTitle || 'Aventurero Novato';

    // Formato con título equipado por delante y nombres acortados
    const p1Label = `[«${creator.activeTitle || 'Aventurero Novato'}»] *${shortenName(creator.name)}*`;
    const p2Label = `[«${opponent.activeTitle || 'Aventurero Novato'}»] *${shortenName(opponent.name)}*`;

    // 1. Mensaje progresivo: Presentación de la batalla
    let progressMsg = await ctx.reply(
      '⚔️🔥 *¡COMIENZA EL DUELO EN LA ARENA!* 🔥⚔️\n\n' +
      `🛡️ ${p1Label}\n` +
      '⚡ *VS*\n' +
      `🛡️ ${p2Label}\n\n` +
      '_Los gladiadores desenvainan sus armas y cruzan miradas en el centro de la arena..._',
      { parse_mode: 'Markdown' }
    );

    // Pausa de tensión (1.5 segundos)
    await new Promise((r) => setTimeout(r, 1500));

    // 2. Simulación de combate
    const result = simulatePvPDuel(creator, opponent);

    // Descontar pociones consumidas de sus inventarios reales
    if (result.potionsUsedP1.small > 0) creator.potionsSmall = Math.max(0, (creator.potionsSmall || 0) - result.potionsUsedP1.small);
    if (result.potionsUsedP1.medium > 0) creator.potionsMedium = Math.max(0, (creator.potionsMedium || 0) - result.potionsUsedP1.medium);
    if (result.potionsUsedP2.small > 0) opponent.potionsSmall = Math.max(0, (opponent.potionsSmall || 0) - result.potionsUsedP2.small);
    if (result.potionsUsedP2.medium > 0) opponent.potionsMedium = Math.max(0, (opponent.potionsMedium || 0) - result.potionsUsedP2.medium);

    const isCreatorWinner = (result.winnerId === creator.userId);
    const winner = isCreatorWinner ? creator : opponent;
    const loser = isCreatorWinner ? opponent : creator;

    winner.pvpWins = (winner.pvpWins || 0) + 1;
    loser.pvpLosses = (loser.pvpLosses || 0) + 1;

    let rewardWinnerNote = '';
    let rewardLoserNote = '';

    if (duel.mode === 'friendly') {
      rewardWinnerNote = '🤝 *Resultado:* ¡Duelo Amistoso ganado! La victoria suma a tu reputación y gloria en el reino.';
      rewardLoserNote = '🤝 *Resultado:* Has caído en el duelo amistoso, pero te retiras con el honor intacto.';
    } else if (duel.mode === 'gold') {
      const pot = duel.betAmount * 2;
      const burned = Math.round(pot * 0.05);
      const prize = pot - burned;
      winner.gold = (winner.gold || 0) + prize;
      rewardWinnerNote = `💰 *Pozo:* ${pot} Oro | 🔥 *Quemado (5%):* ${burned}g\n🏆 *Premio:* Ganaste +${prize} de Oro acreditados a tu bolsa.`;
      rewardLoserNote = `💸 Has caído en combate y perdido tu apuesta de ${duel.betAmount} de Oro.`;
    } else if (duel.mode === 'gram') {
      const pot = Number((duel.betAmount * 2).toFixed(4));
      const rawFee = pot * 0.08;
      const fee = Math.max(0.02, Math.floor(rawFee * 10000) / 10000);
      const prize = Math.floor((pot - fee) * 10000) / 10000;

      winner.gram = (winner.gram || 0) + prize;
      rewardWinnerNote = `💎 *Pozo:* ${pot} GRAM | 💡 *Comisión soporte (8%):* ${fee} GRAM\n🏆 *Premio Web3:* Ganaste +${prize} GRAM acreditados a tu balance.`;
      rewardLoserNote = `💎 Has caído en combate y cedido tu apuesta de ${duel.betAmount} GRAM en la arena.`;

      fetch(`${SERVER_URL}/send-ton-payout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 835648800,
          toAddress: ADMIN_WALLET_ADDRESS,
          amountTon: fee,
          isUserWithdrawal: false
        })
      }).catch((e) => console.error('Error enviando comisión PvP:', e.message));
    }

    // Sincronizar títulos honoríficos tras el combate
    await syncPlayerTitles(creator, bot);
    await syncPlayerTitles(opponent, bot);

    await creator.save();
    await opponent.save();

    duel.status = 'completed';
    duel.winnerId = winner.userId;
    duel.combatLog = result.combatLog;
    await duel.save();

    // Crónica final del combate
    const logText = result.combatLog.slice(-12).join('\n');
    const baseCombatBody = `⚔️📜 *CRÓNICA DE LA ARENA* 📜⚔️\n\n` +
                           `🛡️ ${p1Label}  VS  ${p2Label}\n\n` +
                           `${logText}\n\n`;

    // 3. Notificación personalizada para el oponente (quien aceptó el duelo)
    const opponentIsWinner = (winner.userId === opponent.userId);
    const opponentHeader = opponentIsWinner ? '🏆🎉 *¡VICTORIA ÉPICA EN LA ARENA!*' : '💀❌ *HAS SIDO DERROTADO EN LA ARENA...*';
    const opponentFinalMsg = `${opponentHeader}\n\n${baseCombatBody}${opponentIsWinner ? rewardWinnerNote : rewardLoserNote}`;

    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        undefined,
        opponentFinalMsg,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      await ctx.reply(opponentFinalMsg, { parse_mode: 'Markdown' });
    }

    // 4. Notificación personalizada para el creador (en su chat privado)
    const creatorIsWinner = (winner.userId === creator.userId);
    const creatorHeader = creatorIsWinner ? '🏆🎉 *¡VICTORIA ÉPICA EN LA ARENA!*' : '💀❌ *HAS SIDO DERROTADO EN LA ARENA...*';
    const creatorFinalMsg = `${creatorHeader}\n\n${baseCombatBody}${creatorIsWinner ? rewardWinnerNote : rewardLoserNote}`;

    try {
      await bot.telegram.sendMessage(creator.userId, creatorFinalMsg, { parse_mode: 'Markdown' });
    } catch (e) {}
  });

  // ==========================================
  // RANKING DE GLADIADORES (PVP)
  // ==========================================
  bot.action('tavern_pvp_ranking', async (ctx) => {
    await safeAnswerCb(ctx);

    const topGladiators = await Player.find({ pvpWins: { $gt: 0 } })
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
                `   Victorias: *${g.pvpWins}* | Derrotas: *${g.pvpLosses || 0}* | Efectividad: *${winRate}% WR*\n\n`;
      });
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⚔️ Ir a la Arena de Duelos', 'tavern_pvp')],
      [Markup.button.callback('⬅️ Volver a la Taberna', 'menu_tavern')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });
}

module.exports = { registerTavernHandlers };
