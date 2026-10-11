const { Markup } = require('telegraf');
const { PlayerBounty, getTodayUtcString } = require('./bountyModel');
const { BOUNTY_TIERS, TRAVEL_EVENTS, getTierKey, generateBounty } = require('./bountyData');
const { Player, getRequiredExp, MAX_LEVEL, MAX_ENERGY } = require('./playerModel');

// Almacén de intervalos de viaje activos en memoria
const activeTravelTimers = new Map();

// Obtener o inicializar el contrato diario de un jugador
async function getOrCreateDailyBounty(userId, playerLevel) {
  const todayUtc = getTodayUtcString();
  let bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });

  if (!bounty) {
    const generated = generateBounty(playerLevel);
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

// Vista principal del Tablón de Caza Diaria
async function getBountyBoardView(userId, player) {
  const todayUtc = getTodayUtcString();
  const bounty = await getOrCreateDailyBounty(userId, player.level);

  let text = `📜 *TABLÓN DE RECOMPENSAS DEL REINO*\n` +
             `_Los contratos se renuevan diariamente a las 00:00 UTC._\n\n`;

  if (bounty.status === 'completed') {
    text += `✅ *¡Caza de hoy completada!*\n\n` +
            `Ya cobraste la recompensa por neutralizar a *${bounty.enemyName}*.\n` +
            `Regresa después de las 00:00 UTC para recibir un nuevo encargo del Rey.`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Volver a Explorar el Reino', 'menu_explore')]
    ]);
    return { text, keyboard };
  }

  if (bounty.status === 'traveling') {
    const secLeft = Math.max(0, Math.ceil((new Date(bounty.arrivesAt).getTime() - Date.now()) / 1000));
    const mins = Math.floor(secLeft / 60);
    const secs = secLeft % 60;

    text += `🚶 *EN CAMINO HACIA EL OBJETIVO*\n\n` +
            `🎯 *Presa:* ${bounty.enemyName}\n` +
            `⏳ *Llegada estimada:* ${mins}m ${secs < 10 ? '0' : ''}${secs}s\n` +
            `⚙️ *Modo asignado:* ${bounty.mode === 'auto' ? 'Automático' : 'Manual'}\n\n` +
            `_Tus ojos y oídos siguen atentos al sendero. Recibirás avisos si surgen imprevistos._`;

    const buttons = [
      [Markup.button.callback('🔄 Actualizar Trayecto', 'bounty_refresh')],
      [Markup.button.callback('⬅️ Volver al Campamento', 'status')]
    ];
    return { text, keyboard: Markup.inlineKeyboard(buttons) };
  }

  if (bounty.status === 'arrived') {
    text += `⚔️ *¡HAS ALCANZADO LA GUARIDA!*\n\n` +
            `🎯 *Objetivo:* ${bounty.enemyName}\n` +
            `❤️ Salud enemiga: *${bounty.enemyCurrentHp}/${bounty.enemyMaxHp} HP*\n` +
            `⚔️ Daño estimado: *${bounty.enemyMinDmg} - ${bounty.enemyMaxDmg}*\n` +
            `💰 Botín base prometido: *${bounty.baseGold}g*\n\n` +
            `¿Cómo deseas resolver el asalto final?`;

    const buttons = [
      [Markup.button.callback('⚔️ Pelear Manualmente (Asalto por Asalto)', 'bounty_start_manual')],
      [Markup.button.callback('🤖 Resolver en Automático (Uso de Poción)', 'bounty_start_auto')],
      [Markup.button.callback('⬅️ Volver al Campamento', 'status')]
    ];
    return { text, keyboard: Markup.inlineKeyboard(buttons) };
  }

  // Estado 'idle' o 'failed' (reintentable dentro del mismo día)
  const tierCfg = BOUNTY_TIERS[bounty.tierKey];
  const maxPotionsAllowed = bounty.adsClaimedForBounty >= 2 
    ? tierCfg.autoPotionsWithAds 
    : tierCfg.autoPotionsBase;

  text += `🎯 *Contrato del Día:* *${bounty.enemyName}*\n\n` +
          `📝 *Informe del Encargo:*\n${bounty.description}\n\n` +
          `📊 *Ficha del Peligro:*\n` +
          `• Nivel de amenaza: *Tier ${bounty.tierKey.replace('tier', '')}*\n` +
          `• Duración del viaje: *${bounty.durationMinutes} minuto(s)*\n` +
          `• Botín base estimado: *~${bounty.baseGold}g*\n` +
          `• Salud enemiga: *${bounty.enemyMaxHp} HP*\n\n` +
          `🎒 *Capacidad Automática de Pociones:* ${maxPotionsAllowed} poción(es).\n` +
          (bounty.adsClaimedForBounty < 2 ? `_(Puedes ver anuncios en la Tienda para ampliar el cupo a ${tierCfg.autoPotionsWithAds})._\n\n` : `_(Cupo ampliado por patrocinio activo hoy)._\n\n`) +
          `¿Deseas partir tras su rastro?`;

  const buttons = [
    [Markup.button.callback(`🚀 Iniciar Caza (${bounty.durationMinutes} min)`, 'bounty_depart_prompt')],
    [Markup.button.callback('⬅️ Volver a Explorar el Reino', 'menu_explore')]
  ];

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

// Iniciar viaje de rastreo
async function startBountyTravel(ctx, bot, mode = 'auto') {
  const userId = ctx.from.id;
  const player = await Player.findOne({ userId });
  if (!player) return;

  const todayUtc = getTodayUtcString();
  let bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });

  // Detección de cambio de tablón si se cruzaron las 00:00 UTC
  if (!bounty) {
    bounty = await getOrCreateDailyBounty(userId, player.level);
    return await ctx.reply(
      `🌌 *¡El Tablón cambió ante tus ojos!*\n\n` +
      `Las campanas marcaron las 00:00 UTC y los contratos del día anterior fueron retirados.\n` +
      `Se te ha asignado un nuevo objetivo: *${bounty.enemyName}*.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('📜 Ver Nuevo Contrato', 'menu_bounty')]])
      }
    );
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
    return await ctx.answerCbQuery('Ya estás en camino tras la presa.', { show_alert: true });
  }

  const travelMs = bounty.durationMinutes * 60 * 1000;
  const now = Date.now();

  bounty.status = 'traveling';
  bounty.mode = mode;
  bounty.startedAt = new Date(now);
  bounty.arrivesAt = new Date(now + travelMs);
  bounty.eventsLog = [];
  bounty.netGoldBonus = 0;
  bounty.eventsProcessedCount = 0;
  await bounty.save();

  await ctx.answerCbQuery('¡Partiste hacia la caza!');

  // Programar eventos del camino a intervalos regulares
  scheduleTravelEvents(bot, userId, bounty._id, bounty.durationMinutes, travelMs);

  return await renderBountyView(ctx, player);
}

// Planificador de eventos procedurales a lo largo del viaje
function scheduleTravelEvents(bot, userId, bountyId, durationMinutes, totalMs) {
  // Limpiar timers previos si existieran
  if (activeTravelTimers.has(userId)) {
    clearInterval(activeTravelTimers.get(userId));
    activeTravelTimers.delete(userId);
  }

  const tierKey = getTierKey(1); // Determinado al consultar
  const intervalMs = Math.max(25000, Math.floor(totalMs / (durationMinutes <= 5 ? 2 : 4)));

  const timer = setInterval(async () => {
    try {
      const bounty = await PlayerBounty.findById(bountyId);
      if (!bounty || bounty.status !== 'traveling') {
        clearInterval(timer);
        activeTravelTimers.delete(userId);
        return;
      }

      const now = Date.now();

      // Llegada al destino
      if (now >= new Date(bounty.arrivesAt).getTime()) {
        clearInterval(timer);
        activeTravelTimers.delete(userId);

        bounty.status = 'arrived';
        await bounty.save();

        if (bounty.mode === 'auto') {
          await resolveAutoCombat(bot, userId, bounty);
        } else {
          try {
            await bot.telegram.sendMessage(
              userId,
              `📍 *¡Llegaste a la guarida de ${bounty.enemyName}!* \n\n` +
              `El objetivo está frente a ti. Entra al tablón para librar el combate manual.`,
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('⚔️ Iniciar Asalto Manual', 'menu_bounty')]])
              }
            );
          } catch (e) {}
        }
        return;
      }

      // Procesar evento intermedio si no ha superado el cupo
      const player = await Player.findOne({ userId });
      if (!player) return;

      const tierCfg = BOUNTY_TIERS[bounty.tierKey];
      if (bounty.eventsProcessedCount < tierCfg.eventCount) {
        await processSingleTravelEvent(bot, player, bounty, tierCfg);
      }
    } catch (err) {
      console.error('Error en scheduler de viaje de caza:', err);
    }
  }, intervalMs);

  activeTravelTimers.set(userId, timer);
}

// Procesa un evento aleatorio en el camino considerando Suerte y Agilidad
async function processSingleTravelEvent(bot, player, bounty, tierCfg) {
  const luckVal = player.luck || 0;
  const agiVal = player.agility || 0;
  const strVal = player.strength || 0;

  // En tiers altos el oro es más raro (base 30% en T3+, 45% en T1-T2)
  const isHighTier = ['tier3', 'tier4', 'tier5'].includes(bounty.tierKey);
  const baseFortuneChance = isHighTier ? 0.30 : 0.45;
  const fortuneChance = Math.min(0.60, baseFortuneChance + (luckVal * 0.005));

  const alreadyGotGold = bounty.eventsLog.some(e => e.goldChange > 0);
  const rollFortune = Math.random() < fortuneChance && !alreadyGotGold;

  let eventMsg = '';
  let goldDelta = 0;
  let hpDelta = 0;

  if (rollFortune) {
    // Evento de Oro (+Gemas o bolsas)
    const bonusMin = tierCfg.goldBonusRange[0];
    const bonusMax = tierCfg.goldBonusRange[1];
    let gained = Math.floor(Math.random() * (bonusMax - bonusMin + 1)) + bonusMin;

    // Bono de Suerte sobre el oro hallado
    gained = Math.round(gained * (1 + (luckVal * 0.003)));
    goldDelta = gained;
    bounty.netGoldBonus += gained;

    const goldEvents = TRAVEL_EVENTS.filter(e => e.type === 'gold_gain');
    const ev = goldEvents[Math.floor(Math.random() * goldEvents.length)];

    eventMsg = `🧭 *Suceso en el camino:*\n${ev.text}\n` +
               `💰 *+${gained}g* asegurados para la recompensa final.`;
  } else {
    // Evento de Tropiezo, Pérdida o Emboscada
    const hazardEvents = TRAVEL_EVENTS.filter(e => e.type !== 'gold_gain');
    const ev = hazardEvents[Math.floor(Math.random() * hazardEvents.length)];

    if (ev.type === 'accident_dmg') {
      const avoidChance = Math.min(0.65, ev.avoidChanceBase + (agiVal * ev.avoidBonusPerAgi));
      if (Math.random() < avoidChance) {
        eventMsg = `🧭 *Suceso en el camino:*\n${ev.dodgeText}`;
      } else {
        const hpLoss = Math.floor(Math.random() * (tierCfg.hpLossRange[1] - tierCfg.hpLossRange[0] + 1)) + tierCfg.hpLossRange[0];
        player.hp = Math.max(1, player.hp - hpLoss);
        hpDelta = -hpLoss;
        eventMsg = `🧭 *Suceso en el camino:*\n${ev.failText}\n` +
                   `🩸 Perdiste *-${hpLoss} HP* por el impacto.`;
      }
    } else if (ev.type === 'accident_gold_loss') {
      const avoidChance = Math.min(0.60, ev.avoidChanceBase + (agiVal * ev.avoidBonusPerAgi));
      if (Math.random() < avoidChance) {
        eventMsg = `🧭 *Suceso en el camino:*\n${ev.dodgeText}`;
      } else {
        const goldLoss = Math.floor(Math.random() * (tierCfg.goldLossRange[1] - tierCfg.goldLossRange[0] + 1)) + tierCfg.goldLossRange[0];
        goldDelta = -goldLoss;
        bounty.netGoldBonus -= goldLoss;
        eventMsg = `🧭 *Suceso en el camino:*\n${ev.failText}\n` +
                   `💸 Perdiste *-${goldLoss}g* en el tropiezo.`;
      }
    } else if (ev.type === 'ambush') {
      const avoidChance = Math.min(0.60, ev.avoidChanceBase + (strVal * ev.avoidBonusPerStr));
      if (Math.random() < avoidChance) {
        eventMsg = `🧭 *Suceso en el camino:*\n${ev.dodgeText}`;
      } else {
        const hpLoss = Math.floor(Math.random() * (tierCfg.hpLossRange[1] - tierCfg.hpLossRange[0] + 1)) + tierCfg.hpLossRange[0];
        player.hp = Math.max(1, player.hp - hpLoss);
        hpDelta = -hpLoss;
        eventMsg = `🧭 *Suceso en el camino:*\n${ev.failText}\n` +
                   `🩸 Recibiste un rasguño perdiendo *-${hpLoss} HP*.`;
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

// Resolución del combate automático con consumo inteligente de pociones
async function resolveAutoCombat(bot, userId, bounty) {
  const player = await Player.findOne({ userId });
  if (!player) return;

  const tierCfg = BOUNTY_TIERS[bounty.tierKey];
  const maxPotions = bounty.adsClaimedForBounty >= 2 
    ? tierCfg.autoPotionsWithAds 
    : tierCfg.autoPotionsBase;

  let potionsUsedCount = 0;
  const potionsUsedDetails = [];

  let enemyHp = bounty.enemyMaxHp;
  let playerHp = player.hp;
  const str = player.strength || 0;
  const luk = player.luck || 0;

  let turns = 0;
  const maxTurns = 20;

  while (enemyHp > 0 && playerHp > 0 && turns < maxTurns) {
    turns++;

    // Ataque del jugador
    const baseAtk = 20 + (str * 1.2) + Math.floor(Math.sqrt(str) * 3);
    const variation = (Math.random() * 0.40) - 0.20;
    let pDmg = Math.round(baseAtk * (1 + variation));
    if (Math.random() < Math.min(0.30, luk * 0.0025)) {
      pDmg = Math.round(pDmg * 1.40);
    }
    enemyHp -= Math.max(1, pDmg);

    if (enemyHp <= 0) break;

    // Ataque del enemigo
    const eDmgRaw = Math.floor(Math.random() * (bounty.enemyMaxDmg - bounty.enemyMinDmg + 1)) + bounty.enemyMinDmg;
    const mitigation = (str / (str + 60)) * 0.40;
    const finalDmg = Math.max(1, Math.round(eDmgRaw * (1 - mitigation)));
    playerHp -= finalDmg;

    // Consumo automático si la vida baja del 40%
    if (playerHp > 0 && playerHp < Math.round(player.maxHp * 0.40) && potionsUsedCount < maxPotions) {
      const consumed = tryConsumeHealthPotion(player, tierCfg.smartPotionChoice);
      if (consumed) {
        potionsUsedCount++;
        playerHp = Math.min(player.maxHp, playerHp + consumed.heal);
        potionsUsedDetails.push(consumed.name);
      }
    }
  }

  player.hp = Math.max(0, playerHp);

  // Derrota del jugador
  if (player.hp <= 0) {
    bounty.status = 'failed';
    const lostExp = player.applyDeathPenalty();
    player.knockedOutUntil = Date.now() + 2 * 60 * 60 * 1000;
    await player.save();
    await bounty.save();

    const failMsg = `💀 *Caza Fallida: ${bounty.enemyName}*\n\n` +
                    `Caíste inconsciente durante el enfrentamiento automático.\n` +
                    (potionsUsedCount > 0 ? `• Pociones consumidas antes de caer: ${potionsUsedDetails.join(', ')}\n` : '') +
                    `⏳ Quedaste inconsciente por 2 horas.\n` +
                    `⚠️ Perdiste ${lostExp} de EXP acumulada.\n\n` +
                    `_Podrás reintentar el asalto cuando te recuperes hoy antes de las 00:00 UTC._`;

    try {
      await bot.telegram.sendMessage(userId, failMsg, { parse_mode: 'Markdown' });
    } catch (e) {}
    return;
  }

  // Victoria: Liquidar recompensas con CAP de 2 niveles
  bounty.status = 'completed';
  bounty.enemyCurrentHp = 0;

  const rewardReport = applyBountyRewards(player, bounty);
  await player.save();
  await bounty.save();

  const successMsg = `🎉 *¡OBJETIVO ELIMINADO EN MODO AUTOMÁTICO!*\n\n` +
                     `Derrotaste con éxito a *${bounty.enemyName}* tras ${turns} asaltos.\n\n` +
                     (potionsUsedCount > 0 ? `🧪 *Pociones de salud utilizadas:* ${potionsUsedDetails.join(', ')}\n\n` : `✨ _No necesitaste usar ninguna poción._\n\n`) +
                     `📊 *Informe de Recompensa:*\n` +
                     `• Botín base: *${bounty.baseGold}g*\n` +
                     (bounty.netGoldBonus >= 0 ? `• Incidentes de viaje: *+${bounty.netGoldBonus}g*\n` : `• Incidentes de viaje: *${bounty.netGoldBonus}g*\n`) +
                     `💰 *Oro neto cobrado:* *+${rewardReport.finalGold}g*\n` +
                     `🔮 *EXP ganada:* *+${rewardReport.finalExp}*\n` +
                     (rewardReport.leveledUp ? `\n🎉 *¡Subiste a Nivel ${player.level}!*` : '');

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

// Intentar consumir poción de salud disponible
function tryConsumeHealthPotion(player, smartChoice) {
  if (smartChoice) {
    if (player.potionsMedium > 0) {
      player.potionsMedium -= 1;
      return { heal: 35, name: 'Poción Mayor (+35 HP)' };
    }
    if (player.potionsSmall > 0) {
      player.potionsSmall -= 1;
      return { heal: 10, name: 'Poción Menor (+10 HP)' };
    }
  } else {
    const hasSmall = player.potionsSmall > 0;
    const hasMed = player.potionsMedium > 0;
    if (hasSmall && hasMed) {
      if (Math.random() < 0.5) {
        player.potionsSmall -= 1;
        return { heal: 10, name: 'Poción Menor (+10 HP)' };
      } else {
        player.potionsMedium -= 1;
        return { heal: 35, name: 'Poción Mayor (+35 HP)' };
      }
    } else if (hasMed) {
      player.potionsMedium -= 1;
      return { heal: 35, name: 'Poción Mayor (+35 HP)' };
    } else if (hasSmall) {
      player.potionsSmall -= 1;
      return { heal: 10, name: 'Poción Menor (+10 HP)' };
    }
  }
  return null;
}

// Aplicar recompensas con tope estricto de 2 niveles (+15% residual)
function applyBountyRewards(player, bounty) {
  const finalGold = Math.max(50, bounty.baseGold + bounty.netGoldBonus);
  const rawExp = Math.round(bounty.baseGold * 1.35);

  // Calcular la EXP máxima permitida para exactamente 2 niveles + 15% residual
  let maxExpCap = 0;
  const currentLvl = player.level;
  if (currentLvl < MAX_LEVEL) {
    maxExpCap += (getRequiredExp(currentLvl) - player.exp); // Lo que falta para el 1er nivel
    if (currentLvl + 1 < MAX_LEVEL) {
      maxExpCap += getRequiredExp(currentLvl + 1); // 2do nivel completo
      if (currentLvl + 2 < MAX_LEVEL) {
        maxExpCap += Math.round(getRequiredExp(currentLvl + 2) * 0.15); // 15% residual
      }
    }
  }

  const finalExp = Math.min(rawExp, maxExpCap > 0 ? maxExpCap : rawExp);

  player.gold += finalGold;
  const leveledUp = player.addExp(finalExp);

  bounty.totalGoldClaimed = finalGold;
  bounty.totalExpClaimed = finalExp;

  return { finalGold, finalExp, leveledUp };
}

// Renderizar la vista actualizada del tablón
async function renderBountyView(ctx, player) {
  const view = await getBountyBoardView(ctx.from.id, player);
  try {
    return await ctx.editMessageText(view.text, { parse_mode: 'Markdown', ...view.keyboard });
  } catch (err) {
    if (!err.description?.includes('message is not modified')) {
      return await ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
    }
  }
}

// Combate manual por turnos (Asalto por Asalto)
async function executeManualBountyAttack(ctx, bot) {
  const userId = ctx.from.id;
  const player = await Player.findOne({ userId });
  if (!player) return;

  const todayUtc = getTodayUtcString();
  const bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });

  if (!bounty || bounty.status !== 'arrived') {
    return await ctx.answerCbQuery('No tienes ningún objetivo localizado listo para combatir.', { show_alert: true });
  }

  if (player.energy < 1) {
    return await ctx.answerCbQuery('Necesitas al menos 1⚡ de Energía para asestar un golpe.', { show_alert: true });
  }

  player.energy -= 1;
  const str = player.strength || 0;
  const luk = player.luck || 0;

  // Ataque del aventurero
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

  // Si muere el forajido
  if (bounty.enemyCurrentHp <= 0) {
    bounty.status = 'completed';
    const rewardReport = applyBountyRewards(player, bounty);
    await player.save();
    await bounty.save();
    await ctx.answerCbQuery();

    const victoryMsg = `🎉 *¡VICTORIA CONTRA ${bounty.enemyName}!*\n\n` +
                       `Asestaste el golpe final acabando con la amenaza.\n\n` +
                       `📊 *Informe de Recompensa:*\n` +
                       `• Botín base: *${bounty.baseGold}g*\n` +
                       (bounty.netGoldBonus >= 0 ? `• Incidentes de viaje: *+${bounty.netGoldBonus}g*\n` : `• Incidentes de viaje: *${bounty.netGoldBonus}g*\n`) +
                       `💰 *Oro neto cobrado:* *+${rewardReport.finalGold}g*\n` +
                       `🔮 *EXP ganada:* *+${rewardReport.finalExp}*\n` +
                       (rewardReport.leveledUp ? `\n🎉 *¡Subiste a Nivel ${player.level}!*` : '');

    return await ctx.editMessageText(victoryMsg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('📜 Volver al Tablón', 'menu_bounty')]])
    });
  }

  // Contraataque del forajido
  const eDmgRaw = Math.floor(Math.random() * (bounty.enemyMaxDmg - bounty.enemyMinDmg + 1)) + bounty.enemyMinDmg;
  const mitigation = (str / (str + 60)) * 0.40;
  const finalEnemyDmg = Math.max(1, Math.round(eDmgRaw * (1 - mitigation)));
  player.hp = Math.max(0, player.hp - finalEnemyDmg);

  // Si el jugador cae derrotado
  if (player.hp === 0) {
    bounty.status = 'failed';
    const lostExp = player.applyDeathPenalty();
    player.knockedOutUntil = Date.now() + 2 * 60 * 60 * 1000;
    await player.save();
    await bounty.save();
    await ctx.answerCbQuery();

    const defeatMsg = `💀 *¡Has caído derrotado por ${bounty.enemyName}!* \n\n` +
                      `El enemigo te asestó un golpe fulminante de ${finalEnemyDmg} de daño.\n` +
                      `⏳ Quedaste inconsciente por 2 horas.\n` +
                      `⚠️ Perdiste ${lostExp} de EXP acumulada.\n\n` +
                      `_Podrás reintentar el asalto cuando recuperes salud antes de las 00:00 UTC._`;

    return await ctx.editMessageText(defeatMsg, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Campamento', 'status')]])
    });
  }

  await player.save();
  await bounty.save();
  await ctx.answerCbQuery();

  const combatText = `⚔️ *Combate contra ${bounty.enemyName}*\n\n` +
                     (isCrit ? `✨ *¡Golpe Crítico!* (1.4x)\n` : '') +
                     `💥 Daño infligido: *${pDmg}*\n` +
                     `🛡️ Daño recibido: *${finalEnemyDmg} HP*\n\n` +
                     `❤️ Tu salud: *${player.hp}/${player.maxHp} HP*\n` +
                     `⚡ Tu energía: *${player.energy}/${MAX_ENERGY}*\n` +
                     `❤️ Salud de ${bounty.enemyName}: *${bounty.enemyCurrentHp}/${bounty.enemyMaxHp} HP*\n\n` +
                     `¿Qué decides hacer?`;

  const buttons = [
    [Markup.button.callback('⚔️ Atacar de Nuevo (1 ⚡)', 'bounty_manual_hit')],
    [Markup.button.callback('🎒 Abrir Mochila', 'menu_inv')],
    [Markup.button.callback('🏃 Retirarme', 'menu_bounty')]
  ];

  return await ctx.editMessageText(combatText, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

module.exports = {
  getBountyBoardView,
  startBountyTravel,
  renderBountyView,
  executeManualBountyAttack
};
