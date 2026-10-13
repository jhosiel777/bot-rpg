const { Markup } = require('telegraf');
const { PlayerBounty, getTodayUtcString } = require('./bountyModel');
const { BOUNTY_TIERS, TRAVEL_EVENTS, getTierKey, generateBounty } = require('./bountyData');
const { Player, getRequiredExp, creditReferralBonus, MAX_LEVEL, MAX_ENERGY } = require('./playerModel');

const ADMIN_ID = 835648800;

const activeTravelTimers = new Map();
const manualAfkTimers = new Map();
const merchantRates = new Map();

function getUniversalTimeData() {
  const now = new Date();
  const utcHours = String(now.getUTCHours()).padStart(2, '0');
  const utcMins = String(now.getUTCMinutes()).padStart(2, '0');
  const utcSecs = String(now.getUTCSecs ? now.getUTCSecs() : now.getUTCSeconds()).padStart(2, '0');

  const resetTarget = new Date(now);
  resetTarget.setUTCHours(24, 0, 0, 0);
  const diffSec = Math.max(0, Math.floor((resetTarget.getTime() - now.getTime()) / 1000));
  const rHours = Math.floor(diffSec / 3600);
  const rMins = Math.floor((diffSec % 3600) / 60);
  const rSecs = diffSec % 60;

  return {
    timeStr: utcHours + ':' + utcMins + ':' + utcSecs + ' UTC',
    countdownStr: rHours + 'h ' + rMins + 'm ' + rSecs + 's'
  };
}

function getMerchantCatalog(userId) {
  let rate = merchantRates.get(userId);
  if (!rate) {
    rate = 1.10 + (Math.random() * 0.25);
    merchantRates.set(userId, rate);
  }

  const smallCost = Math.round(30 * rate);
  const mediumCost = Math.round(80 * rate);
  const energyCost = Math.round(100 * rate);

  return {
    rate,
    items: {
      small: { name: 'Poción Menor (+10 HP)', cost: smallCost, field: 'potionsSmall' },
      medium: { name: 'Poción Mayor (+35 HP)', cost: mediumCost, field: 'potionsMedium' },
      energy: { name: 'Elixir de Energía (+1 ⚡)', cost: energyCost, field: 'potionsEnergy' }
    }
  };
}

function getTierProgressInfo(playerLevel) {
  const tierKey = getTierKey(playerLevel);
  const cfg = BOUNTY_TIERS[tierKey];
  const tierNum = tierKey.replace('tier', '');

  if (tierKey === 'tier5') {
    return 'Tier 5 (Máximo Rango)';
  }

  const levelsLeft = (cfg.maxLevel - playerLevel) + 1;
  return 'Tier ' + tierNum + ' (Nivel ' + playerLevel + ') — Faltan ' + levelsLeft + ' nivel(es) para Tier ' + (parseInt(tierNum, 10) + 1);
}

function getVeteranDialogue(playerLevel) {
  if (playerLevel >= 1 && playerLevel <= 2) {
    return (
      '👤 *Un aventurero veterano que observa el tablón se gira hacia ti:*\n' +
      '_"Oye, novato... estas cacerías no son un juego de niños. El camino es traicionero y las bestias muerden fuerte. Te aconsejo explorar las rutas básicas del bosque y ganar un par de niveles antes de firmar esto."_\n\n'
    );
  }

  if (playerLevel === 3) {
    return (
      '👤 *El aventurero veterano te mira de arriba abajo con una sonrisa:*\n' +
      '_"Vaya, miren quién volvió. Te ves con mejor porte y más fuerte que antes, pero todavía te falta un poco de temple. Ve con cuidado si decides marchar."_\n\n'
    );
  }

  if (playerLevel === 4) {
    return (
      '👤 *El aventurero veterano asiente mientras afila su daga:*\n' +
      '_"Bien, creo que ahora tienes la fuerza necesaria para no pasar tantas penurias allá afuera... claro, siempre y cuando hayas distribuido con cabeza tus atributos."_\n\n'
    );
  }

  if (playerLevel === 5) {
    return (
      '🌫️ _Miras a tu alrededor frente al tablón... Aquel aventurero veterano que solía aconsejarte ya no está. Parece que ha llegado el momento de forjar tu propio camino._\n\n'
    );
  }

  if (playerLevel >= 101) {
    return (
      '👑 *Una figura envuelta en una capa desgastada se acerca entre la multitud:*\n' +
      '— *"¿Aún te acuerdas de mí? Ha pasado una eternidad desde aquel día en que apenas podías sostener un arma frente a este tablón. He seguido tus pasos desde las sombras, viendo cómo desafiaste mazmorras, doblegaste colosos y alcanzaste la cúspide absoluta de Abyss. Ya no queda nadie en este reino que pueda darte lecciones... Te has convertido en una verdadera leyenda viviente."*\n\n'
    );
  }

  return '';
}

async function getOrCreateDailyBounty(userId, player) {
  const todayUtc = getTodayUtcString();
  let bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });

  if (!bounty) {
    const baseAtk = Math.round(20 + ((player.strength || 0) * 1.2) + Math.floor(Math.sqrt(player.strength || 0) * 3));
    const generated = generateBounty(player.level, player.maxHp, baseAtk);

    bounty = await PlayerBounty.create({
      userId,
      bountyDateUtc: todayUtc,
      status: 'idle',
      tierKey: generated.tierKey,
      enemyName: generated.name,
      description: generated.description,
      isBeast: generated.isBeast,
      enemyMaxHp: generated.enemyHp,
      enemyCurrentHp: generated.enemyHp,
      enemyMinDmg: generated.enemyMinDmg,
      enemyMaxDmg: generated.enemyMaxDmg,
      durationMinutes: generated.durationMinutes,
      baseGold: generated.baseGold
    });
  }

  return bounty;
}

async function getBountyBoardView(userId, player, botInstance = null) {
  const bounty = await getOrCreateDailyBounty(userId, player);

  if (bounty.status === 'traveling' && bounty.arrivesAt && Date.now() >= new Date(bounty.arrivesAt).getTime()) {
    bounty.status = 'arrived';
    await bounty.save();

    if (bounty.mode === 'auto') {
      if (botInstance) {
        await resolveAutoCombat(botInstance, userId, bounty);
      }
    } else {
      if (botInstance) {
        try {
          await botInstance.telegram.sendMessage(
            userId,
            '📍 *¡Llegaste a la guarida de ' + bounty.enemyName + '!*\n\n' +
            'La criatura está justo frente a ti, alerta y lista para embestirte.\n' +
            '⚠️ _¡No tardes demasiado o el enemigo te tomará desprevenido!_',
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([[Markup.button.callback('⚔️ Enfrentar al Objetivo', 'bounty_back_to_fight')]])
            }
          );
        } catch (e) {}
      }
    }
    return await getBountyBoardView(userId, player, botInstance);
  }

  const clock = getUniversalTimeData();
  const tierProgressStr = getTierProgressInfo(player.level);

  let text = '📜 *TABLÓN DE RECOMPENSAS DEL REINO*\n' +
             '🕰️ *Reloj Universal:* `' + clock.timeStr + '`\n' +
             '⏳ *Reinicio del Reino:* en `' + clock.countdownStr + '`\n' +
             '🛡️ *Tu Rango:* ' + tierProgressStr + '\n' +
             '──────────────────────────\n\n';

  if (bounty.status === 'completed') {
    text += '✅ *¡Caza de hoy completada!*\n\n' +
            'Neutralizaste a *' + bounty.enemyName + '* y cobraste el botín.\n' +
            'El gremio colocará nuevos contratos a las 00:00 UTC.';

    const buttons = [];
    if (userId === ADMIN_ID) {
      buttons.push([Markup.button.callback('👑 Repetir Caza (Modo Creador)', 'bounty_admin_reset')]);
    }
    buttons.push([Markup.button.callback('⬅️ Volver a Explorar el Reino', 'menu_explore')]);
    return { text, keyboard: Markup.inlineKeyboard(buttons) };
  }

  if (bounty.retreatCooldownUntil && Date.now() < new Date(bounty.retreatCooldownUntil).getTime()) {
    const minLeft = Math.ceil((new Date(bounty.retreatCooldownUntil).getTime() - Date.now()) / 60000);
    text += '⚠️ *¡EL ENEMIGO ESCAPÓ TRAS TU RETIRADA!*\n\n' +
            'Decidiste huir del enfrentamiento. *' + bounty.enemyName + '* se ocultó en la maleza.\n' +
            '⏳ Tiempo de espera para reintentar rastrearlo: *' + minLeft + ' minuto(s)*.\n' +
            '🛡️ _Tu botín intacto te espera al regresar a la pista._';

    const buttons = [
      [Markup.button.callback('🔄 Actualizar Tiempo', 'bounty_refresh')],
      [Markup.button.callback('⬅️ Volver a Explorar el Reino', 'menu_explore')]
    ];
    return { text, keyboard: Markup.inlineKeyboard(buttons) };
  }

  if (bounty.status === 'traveling') {
    const secLeft = Math.max(0, Math.ceil((new Date(bounty.arrivesAt).getTime() - Date.now()) / 1000));
    const mins = Math.floor(secLeft / 60);
    const secs = secLeft % 60;
    const modeDesc = bounty.mode === 'auto'
      ? (bounty.adsClaimedForBounty >= 2 ? 'Automático Plus ⚡' : 'Automático Normal')
      : 'Manual';

    text += '🚶 *EN CAMINO HACIA EL OBJETIVO*\n\n' +
            '🎯 *Presa:* ' + bounty.enemyName + '\n' +
            '⏳ *Llegada estimada:* ' + mins + 'm ' + (secs < 10 ? '0' : '') + secs + 's\n' +
            '⚙️ *Modo asignado:* ' + modeDesc + '\n\n' +
            '_Tus sentidos vigilan el camino. Recibirás avisos si algo ocurre._';

    const buttons = [
      [Markup.button.callback('🔄 Actualizar Trayecto', 'bounty_refresh')],
      [Markup.button.callback('⬅️ Volver al Campamento', 'status')]
    ];
    return { text, keyboard: Markup.inlineKeyboard(buttons) };
  }

  if (bounty.status === 'arrived') {
    if (bounty.mode === 'manual') {
      text += '⚔️ *¡HAS ALCANZADO LA GUARIDA!*\n\n' +
              '🎯 *Objetivo:* ' + bounty.enemyName + '\n' +
              '❤️ Salud enemiga: *' + bounty.enemyCurrentHp + '/' + bounty.enemyMaxHp + ' HP*\n' +
              '⚔️ Daño estimado: *' + bounty.enemyMinDmg + ' - ' + bounty.enemyMaxDmg + '*\n' +
              '💰 Botín base: *' + bounty.baseGold + 'g*\n\n' +
              'Tu objetivo está frente a ti con el arma desenvainada.';

      const buttons = [
        [Markup.button.callback('⚔️ Atacar (1 ⚡)', 'bounty_manual_hit')],
        [Markup.button.callback('🎒 Abrir Mochila', 'bounty_inv')],
        [Markup.button.callback('🛒 Mercader Ambulante', 'bounty_merchant_menu')],
        [Markup.button.callback('🏃 Retirarme', 'bounty_retreat_prompt')]
      ];
      return { text, keyboard: Markup.inlineKeyboard(buttons) };
    }
  }

  const veteranDialogue = getVeteranDialogue(player.level);

  text += veteranDialogue +
          '🎯 *Contrato del Día:* *' + bounty.enemyName + '*\n\n' +
          '📝 *Informe del Encargo:*\n' + bounty.description + '\n\n' +
          '📊 *Ficha del Peligro:*\n' +
          '• Nivel de amenaza: *Tier ' + bounty.tierKey.replace('tier', '') + '*\n' +
          '• Duración del viaje: *' + bounty.durationMinutes + ' minuto(s)*\n' +
          '• Botín base estimado: *~' + bounty.baseGold + 'g*\n' +
          '• Salud enemiga: *' + bounty.enemyMaxHp + ' HP*\n\n' +
          '¿Deseas aceptar el encargo y partir?';

  const buttons = [
    [Markup.button.callback('🚀 Iniciar Caza (' + bounty.durationMinutes + ' min)', 'bounty_depart_prompt')],
    [Markup.button.callback('⬅️ Volver a Explorar el Reino', 'menu_explore')]
  ];

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

async function getMerchantView(userId) {
  const player = await Player.findOne({ userId });
  const catalog = getMerchantCatalog(userId).items;

  const text = '🛒 *MERCADER AMBULANTE DE LA RUTA*\n\n' +
               '_"No puedes volver a la ciudad en plena cacería, camarada. Te vendo lo que cargo en mi carreta, pero el flete en territorio salvaje cuesta un poco más..."_\n\n' +
               '💰 Tu Oro: *' + (player ? player.gold : 0) + 'g*\n\n' +
               '• 🧪 *Poción Menor (+10 HP):* 💰 ' + catalog.small.cost + 'g\n' +
               '• 🧪 *Poción Mayor (+35 HP):* 💰 ' + catalog.medium.cost + 'g\n' +
               '• ⚡ *Elixir de Energía (+1 ⚡):* 💰 ' + catalog.energy.cost + 'g\n\n' +
               '🔮 _"Quién sabe... lo que compres aquí podría darte bonos en oro al final... o no."_';

  const buttons = [
    [Markup.button.callback('Comprar Poción Menor (' + catalog.small.cost + 'g)', 'bounty_buy_pot_small')],
    [Markup.button.callback('Comprar Poción Mayor (' + catalog.medium.cost + 'g)', 'bounty_buy_pot_medium')],
    [Markup.button.callback('Comprar Elixir Energía (' + catalog.energy.cost + 'g)', 'bounty_buy_pot_energy')],
    [Markup.button.callback('⬅️ Volver al Combate', 'bounty_back_to_fight')]
  ];

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

async function buyFromMerchant(ctx, itemKey) {
  const userId = ctx.from.id;
  const player = await Player.findOne({ userId });
  const bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: getTodayUtcString() });
  if (!player || !bounty) return;

  const catalog = getMerchantCatalog(userId).items;
  const item = catalog[itemKey];
  if (!item) return;

  if (player.gold < item.cost) {
    return await ctx.answerCbQuery('❌ Oro insuficiente para pagarle al mercader.', { show_alert: true });
  }

  player.gold -= item.cost;
  player[item.field] = (player[item.field] || 0) + 1;
  bounty.goldSpentOnMerchant = (bounty.goldSpentOnMerchant || 0) + item.cost;

  await player.save();
  await bounty.save();

  await ctx.answerCbQuery('✅ Adquiriste 1x ' + item.name);
  const view = await getMerchantView(userId);
  return await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
}

async function getCombatView(ctx) {
  const userId = ctx.from.id;
  const player = await Player.findOne({ userId });
  const bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: getTodayUtcString() });

  if (!player || !bounty || bounty.status !== 'arrived') {
    return await renderBountyView(ctx, player, ctx.telegram ? { telegram: ctx.telegram } : null);
  }

  const combatText = '⚔️ *Combate contra ' + bounty.enemyName + '*\n\n' +
                     '❤️ Tu salud: *' + player.hp + '/' + player.maxHp + ' HP*\n' +
                     '⚡ Tu energía: *' + player.energy + '/' + MAX_ENERGY + '*\n' +
                     '❤️ Salud de ' + bounty.enemyName + ': *' + bounty.enemyCurrentHp + '/' + bounty.enemyMaxHp + ' HP*\n\n' +
                     '¿Qué decides hacer?';

  const buttons = [
    [Markup.button.callback('⚔️ Atacar (1 ⚡)', 'bounty_manual_hit')],
    [Markup.button.callback('🎒 Abrir Mochila', 'bounty_inv')],
    [Markup.button.callback('🛒 Mercader Ambulante', 'bounty_merchant_menu')],
    [Markup.button.callback('🏃 Retirarme', 'bounty_retreat_prompt')]
  ];

  return await ctx.editMessageText(combatText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function getAutoSelectionView(userId) {
  const todayUtc = getTodayUtcString();
  const bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });
  const tierCfg = BOUNTY_TIERS[bounty ? bounty.tierKey : 'tier1'];

  const normalLimit = tierCfg.autoPotionsBase;
  const plusLimit = tierCfg.autoPotionsWithAds;
  const adsWatched = bounty ? (bounty.adsClaimedForBounty || 0) : 0;

  const text = '🤖 *Configuración de Asalto Automático*\n\n' +
               'Elige el protocolo de supervivencia para tu expedición:\n\n' +
               '🔹 *Modo Normal:* Consume hasta *' + normalLimit + '* poción(es) de combate de forma inteligente y preventiva.\n\n' +
               '⚡ *Modo Plus (+2 Anuncios):* Desbloquea un cupo ampliado de hasta *' + plusLimit + '* pociones de combate.\n' +
               '📺 *Progreso de anuncios hoy:* ' + adsWatched + ' / 2\n\n' +
               '¿Cuál deseas emplear?';

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔹 Iniciar Auto Normal (Máx. ' + normalLimit + ')', 'bounty_go_auto_normal')],
    [Markup.button.webApp('⚡ Activar Auto Plus (Ver Anuncios)', 'https://bot-rpg-wu42.onrender.com/ad-reward?purpose=bounty_plus&userId=' + userId)],
    [Markup.button.callback('⚡ Iniciar Auto Plus (' + adsWatched + '/2)', 'bounty_go_auto_plus')],
    [Markup.button.callback('⬅️ Volver', 'menu_bounty')]
  ]);

  return { text, keyboard };
}

async function startBountyTravel(ctx, bot, mode = 'auto', isPlus = false) {
  const userId = ctx.from.id;
  const player = await Player.findOne({ userId });
  if (!player) return;

  const todayUtc = getTodayUtcString();
  let bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });

  if (!bounty) {
    bounty = await getOrCreateDailyBounty(userId, player);
    return await ctx.reply(
      '🌌 *¡El Tablón cambió ante tus ojos!*\n\n' +
      'Las campanas marcaron las 00:00 UTC y los contratos fueron renovados.\n' +
      'Tu nuevo objetivo es: *' + bounty.enemyName + '*.',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('📜 Ver Nuevo Contrato', 'menu_bounty')]])
      }
    );
  }

  if (isPlus && (bounty.adsClaimedForBounty || 0) < 2) {
    return await ctx.answerCbQuery('⚠️ Te falta ver ' + (2 - (bounty.adsClaimedForBounty || 0)) + ' anuncio(s) para activar el Modo Plus.', { show_alert: true });
  }

  if (bounty.retreatCooldownUntil && Date.now() < new Date(bounty.retreatCooldownUntil).getTime()) {
    const minLeft = Math.ceil((new Date(bounty.retreatCooldownUntil).getTime() - Date.now()) / 60000);
    return await ctx.answerCbQuery('Debes esperar ' + minLeft + ' min tras haberte retirado.', { show_alert: true });
  }

  if (player.knockedOutUntil && Date.now() < player.knockedOutUntil) {
    return await ctx.answerCbQuery('Estás inconsciente. Cúrate antes de partir.', { show_alert: true });
  }

  if (player.hp <= 0) {
    return await ctx.answerCbQuery('No tienes salud. Descansa o usa pociones.', { show_alert: true });
  }

  if (player.onMissionUntil && Date.now() < player.onMissionUntil) {
    return await ctx.answerCbQuery('Ya estás en una expedición de mazmorra.', { show_alert: true });
  }

  if (bounty.status === 'traveling') {
    return await ctx.answerCbQuery('Ya estás en camino.', { show_alert: true });
  }

  merchantRates.delete(userId);

  const travelMs = bounty.durationMinutes * 60 * 1000;
  const now = Date.now();

  bounty.status = 'traveling';
  bounty.mode = mode;
  bounty.startedAt = new Date(now);
  bounty.arrivesAt = new Date(now + travelMs);
  bounty.eventsLog = [];
  bounty.netGoldBonus = 0;
  bounty.eventsProcessedCount = 0;
  bounty.enemyCurrentHp = bounty.enemyMaxHp;
  await bounty.save();

  await ctx.answerCbQuery('¡Partiste hacia la caza!');

  scheduleTravelEvents(bot, userId, bounty._id, bounty.durationMinutes, travelMs);
  return await renderBountyView(ctx, player, bot);
}

function scheduleTravelEvents(bot, userId, bountyId, durationMinutes, totalMs) {
  if (activeTravelTimers.has(userId)) {
    clearInterval(activeTravelTimers.get(userId));
    activeTravelTimers.delete(userId);
  }

  const intervalMs = Math.max(20000, Math.floor(totalMs / (durationMinutes <= 5 ? 2 : 4)));

  const timer = setInterval(async () => {
    try {
      const bounty = await PlayerBounty.findById(bountyId);
      if (!bounty || bounty.status !== 'traveling') {
        clearInterval(timer);
        activeTravelTimers.delete(userId);
        return;
      }

      const now = Date.now();

      if (now >= new Date(bounty.arrivesAt).getTime()) {
        clearInterval(timer);
        activeTravelTimers.delete(userId);

        bounty.status = 'arrived';
        await bounty.save();

        if (bounty.mode === 'auto') {
          await resolveAutoCombat(bot, userId, bounty);
        } else {
          armManualAfkTimer(bot, userId, bounty);
          try {
            await bot.telegram.sendMessage(
              userId,
              '📍 *¡Llegaste a la guarida de ' + bounty.enemyName + '!*\n\n' +
              'La criatura está justo frente a ti, alerta y lista para embestirte.\n' +
              '⚠️ _¡No tardes demasiado o el enemigo te tomará desprevenido!_',
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('⚔️ Enfrentar al Objetivo', 'bounty_back_to_fight')]])
              }
            );
          } catch (e) {}
        }
        return;
      }

      const player = await Player.findOne({ userId });
      if (!player) return;

      const tierCfg = BOUNTY_TIERS[bounty.tierKey];
      if (bounty.eventsProcessedCount < tierCfg.eventCount) {
        await processSingleTravelEvent(bot, player, bounty, tierCfg);
      }
    } catch (err) {
      console.error('Error en scheduler de caza:', err);
    }
  }, intervalMs);

  activeTravelTimers.set(userId, timer);
}

function armManualAfkTimer(bot, userId, bounty) {
  if (manualAfkTimers.has(userId)) {
    clearTimeout(manualAfkTimers.get(userId));
  }

  const waitMinutes = ['tier1', 'tier2'].includes(bounty.tierKey) ? 5 : 10;
  const afkMs = waitMinutes * 60 * 1000;

  const t1 = setTimeout(async () => {
    try {
      const b = await PlayerBounty.findById(bounty._id);
      const p = await Player.findOne({ userId });
      if (!b || b.status !== 'arrived' || !p) return;

      const penaltyDmg = Math.max(10, Math.round(b.enemyMaxDmg * 0.7));
      p.hp = Math.max(1, p.hp - penaltyDmg);
      await p.save();

      await bot.telegram.sendMessage(
        userId,
        '⚠️ *¡EL ENEMIGO TE SORPRENDIÓ POR INACCIÓN!*\n\n' +
        'Te quedaste inmóvil demasiado tiempo frente a *' + b.enemyName + '* y te asestó un golpe de castigo perdiendo *-' + penaltyDmg + ' HP*.\n\n' +
        '_Si no atacas pronto, el enemigo te despojará y escapará._',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('⚔️ Atacar Ahora', 'bounty_back_to_fight')]])
        }
      );

      const t2 = setTimeout(async () => {
        const b2 = await PlayerBounty.findById(bounty._id);
        const p2 = await Player.findOne({ userId });
        if (!b2 || b2.status !== 'arrived' || !p2) return;

        p2.hp = 1;
        b2.status = 'failed';
        await p2.save();
        await b2.save();

        manualAfkTimers.delete(userId);

        await bot.telegram.sendMessage(
          userId,
          '💨 *¡EL ENEMIGO HA ESCAPADO!*\n\n' +
          'Aprovechando tu prolongada ausencia, *' + b2.enemyName + '* te propinó un golpe devastador dejándote a *1 HP* y huyó llevándose la recompensa.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('🏕️ Volver al Campamento', 'status')]])
          }
        );
      }, Math.max(afkMs / 2, 90000));

      manualAfkTimers.set(userId, t2);
    } catch (e) {
      console.error('Error en temporizador AFK:', e);
    }
  }, afkMs);

  manualAfkTimers.set(userId, t1);
}

async function processSingleTravelEvent(bot, player, bounty, tierCfg) {
  const luckVal = player.luck || 0;
  const agiVal = player.agility || 0;
  const strVal = player.strength || 0;

  const isHighTier = ['tier3', 'tier4', 'tier5'].includes(bounty.tierKey);
  const baseFortuneChance = isHighTier ? 0.30 : 0.45;
  const fortuneChance = Math.min(0.60, baseFortuneChance + (luckVal * 0.005));

  const alreadyGotGold = bounty.eventsLog.some(e => e.goldChange > 0);
  const rollFortune = Math.random() < fortuneChance && !alreadyGotGold;

  let eventMsg = '';
  let goldDelta = 0;
  let hpDelta = 0;

  if (rollFortune) {
    const bonusMin = tierCfg.goldBonusRange[0];
    const bonusMax = tierCfg.goldBonusRange[1];
    let gained = Math.floor(Math.random() * (bonusMax - bonusMin + 1)) + bonusMin;
    gained = Math.round(gained * (1 + (luckVal * 0.003)));
    goldDelta = gained;
    bounty.netGoldBonus += gained;

    const goldEvents = TRAVEL_EVENTS.filter(e => e.type === 'gold_gain');
    const ev = goldEvents[Math.floor(Math.random() * goldEvents.length)];

    eventMsg = '🧭 *Suceso en el camino:*\n' + ev.text + '\n' +
               '💰 *+' + gained + 'g* sumados para el botín final.';
  } else {
    const hazardEvents = TRAVEL_EVENTS.filter(e => e.type !== 'gold_gain');
    const ev = hazardEvents[Math.floor(Math.random() * hazardEvents.length)];

    if (ev.type === 'accident_dmg') {
      const avoidChance = Math.min(0.65, ev.avoidChanceBase + (agiVal * ev.avoidBonusPerAgi));
      if (Math.random() < avoidChance) {
        eventMsg = '🧭 *Suceso en el camino:*\n' + ev.dodgeText;
      } else {
        const hpLoss = Math.floor(Math.random() * (tierCfg.hpLossRange[1] - tierCfg.hpLossRange[0] + 1)) + tierCfg.hpLossRange[0];
        player.hp = Math.max(1, player.hp - hpLoss);
        hpDelta = -hpLoss;
        eventMsg = '🧭 *Suceso en el camino:*\n' + ev.failText + '\n' +
                   '🩸 Perdiste *-' + hpLoss + ' HP* por el tropiezo.';
      }
    } else if (ev.type === 'accident_gold_loss') {
      const avoidChance = Math.min(0.60, ev.avoidChanceBase + (agiVal * ev.avoidBonusPerAgi));
      if (Math.random() < avoidChance) {
        eventMsg = '🧭 *Suceso en el camino:*\n' + ev.dodgeText;
      } else {
        const goldLoss = Math.floor(Math.random() * (tierCfg.goldLossRange[1] - tierCfg.goldLossRange[0] + 1)) + tierCfg.goldLossRange[0];
        goldDelta = -goldLoss;
        bounty.netGoldBonus -= goldLoss;
        eventMsg = '🧭 *Suceso en el camino:*\n' + ev.failText + '\n' +
                   '💸 Perdiste *-' + goldLoss + 'g* en el camino.';
      }
    } else if (ev.type === 'ambush') {
      const avoidChance = Math.min(0.60, ev.avoidChanceBase + (strVal * ev.avoidBonusPerStr));
      if (Math.random() < avoidChance) {
        eventMsg = '🧭 *Suceso en el camino:*\n' + ev.dodgeText;
      } else {
        const hpLoss = Math.floor(Math.random() * (tierCfg.hpLossRange[1] - tierCfg.hpLossRange[0] + 1)) + tierCfg.hpLossRange[0];
        player.hp = Math.max(1, player.hp - hpLoss);
        hpDelta = -hpLoss;
        eventMsg = '🧭 *Suceso en el camino:*\n' + ev.failText + '\n' +
                   '🩸 Recibiste un arañazo perdiendo *-' + hpLoss + ' HP*.';
      }
    }
  }

  bounty.eventsProcessedCount += 1;
  bounty.eventsLog.push({
    timeSec: Math.round((Date.now() - new Date(bounty.startedAt).getTime()) / 1000),
    text: eventMsg,
    goldChange: goldDelta,
    hpChange: hpDelta
  });

  await player.save();
  await bounty.save();

  try {
    await bot.telegram.sendMessage(player.userId, eventMsg, { parse_mode: 'Markdown' });
  } catch (e) {}
}

function pickBestPotion(player, neededHp) {
  if (neededHp > 22) {
    if (player.potionsMedium > 0) {
      player.potionsMedium -= 1;
      return { heal: 35, name: 'Poción Mayor (+35 HP)' };
    }
    if (player.potionsSmall > 0) {
      player.potionsSmall -= 1;
      return { heal: 10, name: 'Poción Menor (+10 HP)' };
    }
  } else {
    if (player.potionsSmall > 0) {
      player.potionsSmall -= 1;
      return { heal: 10, name: 'Poción Menor (+10 HP)' };
    }
    if (player.potionsMedium > 0) {
      player.potionsMedium -= 1;
      return { heal: 35, name: 'Poción Mayor (+35 HP)' };
    }
  }
  return null;
}

async function resolveAutoCombat(bot, userId, bounty) {
  const player = await Player.findOne({ userId });
  if (!player) return;

  const tierCfg = BOUNTY_TIERS[bounty.tierKey];
  const maxCombatPotions = (bounty.adsClaimedForBounty || 0) >= 2 
    ? tierCfg.autoPotionsWithAds 
    : tierCfg.autoPotionsBase;

  let pathPotionUsed = null;

  if (player.hp < player.maxHp) {
    const missingHp = player.maxHp - player.hp;
    const consumedPath = pickBestPotion(player, missingHp);
    if (consumedPath) {
      player.hp = Math.min(player.maxHp, player.hp + consumedPath.heal);
      pathPotionUsed = consumedPath.name;
    }
  }

  let potionsUsedCount = 0;
  const potionsUsedDetails = [];
  let searchedPotionAndFailed = false;

  let enemyHp = bounty.enemyMaxHp;
  let playerHp = player.hp;
  const str = player.strength || 0;
  const luk = player.luck || 0;

  let turns = 0;
  let totalDmgDealt = 0;
  let totalDmgTaken = 0;
  let totalCrits = 0;
  const maxTurns = 25;

  const maxPossibleEnemyHit = Math.max(1, Math.round(bounty.enemyMaxDmg * (1 - ((str / (str + 60)) * 0.40))));

  while (enemyHp > 0 && playerHp > 0 && turns < maxTurns) {
    turns++;

    if (playerHp <= maxPossibleEnemyHit && potionsUsedCount < maxCombatPotions) {
      const preHeal = pickBestPotion(player, player.maxHp - playerHp);
      if (preHeal) {
        potionsUsedCount++;
        playerHp = Math.min(player.maxHp, playerHp + preHeal.heal);
        potionsUsedDetails.push(preHeal.name + ' (Turno ' + turns + ' - Preventiva)');
      } else {
        searchedPotionAndFailed = true;
      }
    }

    const baseAtk = 20 + (str * 1.2) + Math.floor(Math.sqrt(str) * 3);
    const variation = (Math.random() * 0.40) - 0.20;
    let pDmg = Math.round(baseAtk * (1 + variation));

    if (Math.random() < Math.min(0.30, luk * 0.0025)) {
      totalCrits++;
      pDmg = Math.round(pDmg * 1.40);
    }
    pDmg = Math.max(1, pDmg);
    totalDmgDealt += pDmg;
    enemyHp -= pDmg;

    if (enemyHp <= 0) break;

    const eDmgRaw = Math.floor(Math.random() * (bounty.enemyMaxDmg - bounty.enemyMinDmg + 1)) + bounty.enemyMinDmg;
    const mitigation = (str / (str + 60)) * 0.40;
    const finalDmg = Math.max(1, Math.round(eDmgRaw * (1 - mitigation)));
    totalDmgTaken += finalDmg;
    playerHp -= finalDmg;

    if (playerHp > 0 && playerHp < Math.round(player.maxHp * 0.40) && potionsUsedCount < maxCombatPotions) {
      const reactHeal = pickBestPotion(player, player.maxHp - playerHp);
      if (reactHeal) {
        potionsUsedCount++;
        playerHp = Math.min(player.maxHp, playerHp + reactHeal.heal);
        potionsUsedDetails.push(reactHeal.name + ' (Turno ' + turns + ')');
      } else {
        searchedPotionAndFailed = true;
      }
    }
  }

  player.hp = Math.max(0, playerHp);

  if (player.hp <= 0) {
    bounty.status = 'failed';
    const lostExp = player.applyDeathPenalty();
    player.knockedOutUntil = Date.now() + 2 * 60 * 60 * 1000;
    await player.save();
    await bounty.save();

    let narrativeKOFail = '';
    if (searchedPotionAndFailed) {
      narrativeKOFail = '🎒 _Revisaste desesperadamente tu mochila buscando una poción para resistir... pero no te quedaban más._\n\n';
    } else if (potionsUsedCount >= maxCombatPotions) {
      narrativeKOFail = '⚠️ _Agotaste tu cupo máximo de pociones del combate (' + maxCombatPotions + ') y el castigo del enemigo fue fulminante._\n\n';
    }

    const failMsg = '💀 *Caza Fallida: ' + bounty.enemyName + '*\n\n' +
                    'Caíste inconsciente tras *' + turns + ' asaltos* de combate.\n\n' +
                    '📊 *Resumen del Enfrentamiento:*\n' +
                    '• Salud enemiga restante: *' + Math.max(0, enemyHp) + '/' + bounty.enemyMaxHp + ' HP*\n' +
                    '• Daño total que le asestaste: *' + totalDmgDealt + '* (' + totalCrits + ' críticos)\n' +
                    '• Daño total recibido: *' + totalDmgTaken + ' HP*\n' +
                    (pathPotionUsed ? '• Dosis de auxilio de ruta: ' + pathPotionUsed + '\n' : '') +
                    (potionsUsedCount > 0 ? '• Pociones gastadas en combate: ' + potionsUsedDetails.join(', ') + '\n' : '') +
                    '\n' + narrativeKOFail +
                    '⏳ Quedaste inconsciente por 2 horas.\n' +
                    '⚠️ Perdiste ' + lostExp + ' de EXP acumulada.\n\n' +
                    '_Podrás reintentar el asalto cuando recuperes salud antes de las 00:00 UTC._';

    try {
      await bot.telegram.sendMessage(userId, failMsg, { parse_mode: 'Markdown' });
    } catch (e) {}
    return;
  }

  bounty.status = 'completed';
  bounty.enemyCurrentHp = 0;

  const rewardReport = applyBountyRewards(player, bounty);
  await player.save();
  await bounty.save();

  await creditReferralBonus(userId, rewardReport.finalGold);

  const successMsg = '🎉 *¡OBJETIVO ELIMINADO EN MODO AUTOMÁTICO!*\n\n' +
                     'Derrotaste a *' + bounty.enemyName + '* tras *' + turns + ' asaltos*.\n\n' +
                     '⚔️ *Ficha del Combate:*\n' +
                     '• Daño total infligido: *' + totalDmgDealt + '* (' + totalCrits + ' golpes críticos)\n' +
                     '• Daño total absorbido: *' + totalDmgTaken + ' HP*\n' +
                     '• Salud final restante: *' + player.hp + '/' + player.maxHp + ' HP*\n\n' +
                     '🧪 *Gestión de Pociones:*\n' +
                     (pathPotionUsed ? '• Auxilio de marcha previo al combate: ' + pathPotionUsed + ' _(Sin contar en cupo)_\n' : '• Marcha: Entraste al combate con tu temple intacto.\n') +
                     (potionsUsedCount > 0 ? '• Pociones consumidas en combate: ' + potionsUsedDetails.join(', ') + '\n\n' : '• Combate: ¡Victoria limpia sin consumir pociones!\n\n') +
                     '📊 *Informe Económico y Recompensas:*\n' +
                     '• Botín base del contrato: *' + bounty.baseGold + 'g*\n' +
                     (bounty.netGoldBonus !== 0 ? '• Balance de sucesos en ruta: *' + (bounty.netGoldBonus > 0 ? '+' : '') + bounty.netGoldBonus + 'g*\n' : '') +
                     (bounty.goldSpentOnMerchant > 0 ? '• ' + rewardReport.merchantPhrase + ': *+' + rewardReport.merchantComp + 'g*\n' : '') +
                     '💰 *Total cobrado en bolsa:* *+' + rewardReport.finalGold + 'g*\n' +
                     '🔮 *EXP ganada:* *+' + rewardReport.finalExp + '*\n' +
                     (rewardReport.leveledUp ? '\n🎉 *¡Subiste a Nivel ' + player.level + '!*' : '');

  try {
    await bot.telegram.sendMessage(
      userId,
      successMsg,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('📜 Volver al Tablón', 'menu_bounty')]])
      }
    );
  } catch (e) {}
}

function applyBountyRewards(player, bounty) {
  let merchantComp = 0;
  let merchantPhrase = 'Bono de comercio';

  if (bounty.goldSpentOnMerchant > 0) {
    const compRate = 0.65 + (Math.random() * 0.60);
    merchantComp = Math.round(bounty.goldSpentOnMerchant * compRate);

    const phrases = [
      'El mercader ambulante reconoció tu valía y te devolvió',
      'Al ver tu temple en batalla, el buhonero decidió reembolsarte',
      'El comerciante de la ruta quedó impresionado con tu hazaña y te entregó',
      'Como gratitud por tus compras en el sendero, el mercader te gratificó con'
    ];
    merchantPhrase = phrases[Math.floor(Math.random() * phrases.length)];
  }

  const finalGold = Math.max(150, bounty.baseGold + bounty.netGoldBonus + merchantComp);

  let finalExp = 0;
  const reqCurrent = getRequiredExp(player.level);

  const tierMultiplier = {
    tier1: 0.35,
    tier2: 0.45,
    tier3: 0.55,
    tier4: 0.70,
    tier5: 0.90
  }[bounty.tierKey] || 0.35;

  finalExp = Math.round(reqCurrent * (tierMultiplier + (Math.random() * 0.10)));

  player.gold += finalGold;
  const leveledUp = player.addExp(finalExp);

  bounty.totalGoldClaimed = finalGold;
  bounty.totalExpClaimed = finalExp;

  return { finalGold, finalExp, leveledUp, merchantComp, merchantPhrase };
}

async function promptBountyRetreat(ctx) {
  const userId = ctx.from.id;
  const bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: getTodayUtcString() });
  if (!bounty || bounty.status !== 'arrived') {
    return await ctx.answerCbQuery('No puedes retirarte ahora.', { show_alert: true });
  }

  const text = '⚠️ *¿Estás seguro de que deseas huir del combate?*\n\n' +
               'Si huyes:\n' +
               '• El enemigo se ocultará en la maleza.\n' +
               '• Deberás esperar 30 minutos de penalización para volver a rastrearlo.\n' +
               '• _Tu botín base intacto te esperará para el próximo intento._\n\n' +
               '¿Qué decides?';

  const buttons = [
    [Markup.button.callback('✅ Sí, huir y salvar mi pellejo', 'bounty_retreat_confirmed')],
    [Markup.button.callback('❌ No, continuar la pelea', 'bounty_back_to_fight')]
  ];

  return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function handleBountyRetreat(ctx) {
  const userId = ctx.from.id;
  const bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: getTodayUtcString() });
  if (!bounty || bounty.status !== 'arrived') {
    return await ctx.answerCbQuery('No puedes retirarte ahora.', { show_alert: true });
  }

  if (manualAfkTimers.has(userId)) {
    clearTimeout(manualAfkTimers.get(userId));
    manualAfkTimers.delete(userId);
  }

  bounty.status = 'idle';
  bounty.retreatCooldownUntil = new Date(Date.now() + 30 * 60 * 1000);
  bounty.enemyCurrentHp = bounty.enemyMaxHp;
  await bounty.save();

  await ctx.answerCbQuery('Te retiraste del asalto.');
  const text = '🏃 *¡TE RETIRASTE DEL COMBATE!*\n\n' +
               'Huiste de la guarida para salvar el pellejo.\n' +
               '• *' + bounty.enemyName + '* se replegó a una nueva posición.\n' +
               '• ⏳ Debes esperar *30 minutos* para reintentar rastrearlo hoy.\n' +
               '• 💰 _Tu botín completo te esperará intacto cuando regreses._';

  return await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Campamento', 'status')]])
  });
}

async function renderBountyView(ctx, player, botInstance = null) {
  const view = await getBountyBoardView(ctx.from.id, player, botInstance || ctx);
  try {
    return await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
  } catch (err) {
    if (!err.description?.includes('message is not modified')) {
      return await ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    }
  }
}

async function executeManualBountyAttack(ctx, bot) {
  const userId = ctx.from.id;
  const player = await Player.findOne({ userId });
  if (!player) return;

  const todayUtc = getTodayUtcString();
  const bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });

  if (!bounty || bounty.status !== 'arrived') {
    return await ctx.answerCbQuery('No tienes ningún objetivo localizado listo para combatir.', { show_alert: true });
  }

  if (manualAfkTimers.has(userId)) {
    clearTimeout(manualAfkTimers.get(userId));
    manualAfkTimers.delete(userId);
  }

  if (player.energy < 1) {
    armManualAfkTimer(bot, userId, bounty);
    return await ctx.answerCbQuery('Necesitas al menos 1⚡ de Energía para golpear.', { show_alert: true });
  }

  player.energy -= 1;
  const str = player.strength || 0;
  const luk = player.luck || 0;

  const baseAtk = 20 + (str * 1.2) + Math.floor(Math.sqrt(str) * 3);
  const variation = (Math.random() * 0.40) - 0.20;
  let pDmg = Math.round(baseAtk * (1 + variation));
  let isCrit = false;

  if (Math.random() < Math.min(0.30, luk * 0.0025)) {
    isCrit = true;
    pDmg = Math.round(pDmg * 1.40);
  }
  pDmg = Math.max(1, pDmg);

  bounty.enemyCurrentHp = Math.max(0, bounty.enemyCurrentHp - pDmg);

  if (bounty.enemyCurrentHp <= 0) {
    bounty.status = 'completed';
    const rewardReport = applyBountyRewards(player, bounty);
    await player.save();
    await bounty.save();
    await ctx.answerCbQuery();

    await creditReferralBonus(userId, rewardReport.finalGold);

    const victoryMsg = '🎉 *¡VICTORIA CONTRA ' + bounty.enemyName + '!*\n\n' +
                       'Asestaste el golpe final terminando la cacería.\n\n' +
                       '📊 *Informe de Recompensa:*\n' +
                       '• Botín base: *' + bounty.baseGold + 'g*\n' +
                       (bounty.netGoldBonus !== 0 ? '• Balance de viaje: *' + (bounty.netGoldBonus > 0 ? '+' : '') + bounty.netGoldBonus + 'g*\n' : '') +
                       (bounty.goldSpentOnMerchant > 0 ? '• ' + rewardReport.merchantPhrase + ': *+' + rewardReport.merchantComp + 'g*\n' : '') +
                       '💰 *Oro neto cobrado:* *+' + rewardReport.finalGold + 'g*\n' +
                       '🔮 *EXP ganada:* *+' + rewardReport.finalExp + '*\n' +
                       (rewardReport.leveledUp ? '\n🎉 *¡Subiste a Nivel ' + player.level + '!*' : '');

    return await ctx.editMessageText(victoryMsg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('📜 Volver al Tablón', 'menu_bounty')]])
    });
  }

  const eDmgRaw = Math.floor(Math.random() * (bounty.enemyMaxDmg - bounty.enemyMinDmg + 1)) + bounty.enemyMinDmg;
  const mitigation = (str / (str + 60)) * 0.40;
  const finalEnemyDmg = Math.max(1, Math.round(eDmgRaw * (1 - mitigation)));
  player.hp = Math.max(0, player.hp - finalEnemyDmg);

  if (player.hp === 0) {
    bounty.status = 'failed';
    const lostExp = player.applyDeathPenalty();
    player.knockedOutUntil = Date.now() + 2 * 60 * 60 * 1000;
    await player.save();
    await bounty.save();
    await ctx.answerCbQuery();

    const defeatMsg = '💀 *¡Has caído derrotado por ' + bounty.enemyName + '!* \n\n' +
                      'El enemigo te asestó un golpe de ' + finalEnemyDmg + ' de daño.\n' +
                      '⏳ Quedaste inconsciente por 2 horas.\n' +
                      '⚠️ Perdiste ' + lostExp + ' de EXP acumulada.\n\n' +
                      '_Podrás reintentar el asalto cuando recuperes salud antes de las 00:00 UTC._';

    return await ctx.editMessageText(defeatMsg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Campamento', 'status')]])
    });
  }

  await player.save();
  await bounty.save();
  await ctx.answerCbQuery();

  armManualAfkTimer(bot, userId, bounty);

  const combatText = '⚔️ *Combate contra ' + bounty.enemyName + '*\n\n' +
                     (isCrit ? '✨ *¡Golpe Crítico!* (1.4x)\n' : '') +
                     '💥 Daño infligido: *' + pDmg + '*\n' +
                     '🛡️ Daño recibido: *' + finalEnemyDmg + ' HP*\n\n' +
                     '❤️ Tu salud: *' + player.hp + '/' + player.maxHp + ' HP*\n' +
                     '⚡ Tu energía: *' + player.energy + '/' + MAX_ENERGY + '*\n' +
                     '❤️ Salud de ' + bounty.enemyName + ': *' + bounty.enemyCurrentHp + '/' + bounty.enemyMaxHp + ' HP*\n\n' +
                     '¿Qué decides hacer?';

  const buttons = [
    [Markup.button.callback('⚔️ Atacar de Nuevo (1 ⚡)', 'bounty_manual_hit')],
    [Markup.button.callback('🎒 Abrir Mochila', 'bounty_inv')],
    [Markup.button.callback('🛒 Mercader Ambulante', 'bounty_merchant_menu')],
    [Markup.button.callback('🏃 Retirarme', 'bounty_retreat_prompt')]
  ];

  return await ctx.editMessageText(combatText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function resetBountyForAdmin(userId) {
  const todayUtc = getTodayUtcString();
  await PlayerBounty.deleteOne({ userId, bountyDateUtc: todayUtc });
  if (manualAfkTimers.has(userId)) {
    clearTimeout(manualAfkTimers.get(userId));
    manualAfkTimers.delete(userId);
  }
}

module.exports = {
  getUniversalTimeData,
  getBountyBoardView,
  getAutoSelectionView,
  startBountyTravel,
  renderBountyView,
  executeManualBountyAttack,
  promptBountyRetreat,
  handleBountyRetreat,
  getMerchantView,
  buyFromMerchant,
  getCombatView,
  resetBountyForAdmin
};
