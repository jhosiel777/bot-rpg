const { Markup } = require('telegraf');
const { PlayerBounty, getTodayUtcString } = require('./bountyModel');
const { BOUNTY_TIERS, TRAVEL_EVENTS, getTierKey, generateBounty } = require('./bountyData');
const { Player, getRequiredExp, MAX_LEVEL, MAX_ENERGY } = require('./playerModel');

const ADMIN_ID = 835648800;

// Almacén de temporizadores en memoria
const activeTravelTimers = new Map();
const manualAfkTimers = new Map();

function getUniversalTimeData() {
  const now = new Date();
  const utcHours = String(now.getUTCHours()).padStart(2, '0');
  const utcMins = String(now.getUTCMinutes()).padStart(2, '0');
  const utcSecs = String(now.getUTCSeconds()).padStart(2, '0');

  // Tiempo restante para las 00:00:00 UTC
  const resetTarget = new Date(now);
  resetTarget.setUTCHours(24, 0, 0, 0);
  const diffSec = Math.max(0, Math.floor((resetTarget.getTime() - now.getTime()) / 1000));
  const rHours = Math.floor(diffSec / 3600);
  const rMins = Math.floor((diffSec % 3600) / 60);
  const rSecs = diffSec % 60;

  return {
    timeStr: `${utcHours}:${utcMins}:${utcSecs} UTC`,
    countdownStr: `${rHours}h ${rMins}m ${rSecs}s`
  };
}

// Obtener o inicializar contrato diario
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

// Vista principal del Tablón
async function getBountyBoardView(userId, player) {
  const todayUtc = getTodayUtcString();
  const bounty = await getOrCreateDailyBounty(userId, player.level);
  const clock = getUniversalTimeData();

  let text = `📜 *TABLÓN DE RECOMPENSAS DEL REINO*\n` +
             `🕰️ *Reloj Universal:* \`\${clock.timeStr}\`\n` +
             `⏳ *Reinicio del Reino:* en \`\${clock.countdownStr}\`\n` +
             `──────────────────────────\n\n`;

  if (bounty.status === 'completed') {
    text += `✅ *¡Caza de hoy completada!*\n\n` +
            `Neutralizaste a *${bounty.enemyName}* y cobraste el botín.\n` +
            `El gremio colocará nuevos contratos a las 00:00 UTC.`;

    const buttons = [];
    if (userId === ADMIN_ID) {
      buttons.push([Markup.button.callback('👑 Repetir Caza (Modo Creador)', 'bounty_admin_reset')]);
    }
    buttons.push([Markup.button.callback('⬅️ Volver a Explorar el Reino', 'menu_explore')]);
    return { text, keyboard: Markup.inlineKeyboard(buttons) };
  }

  if (bounty.status === 'traveling') {
    const secLeft = Math.max(0, Math.ceil((new Date(bounty.arrivesAt).getTime() - Date.now()) / 1000));
    const mins = Math.floor(secLeft / 60);
    const secs = secLeft % 60;

    text += `🚶 *EN CAMINO HACIA EL OBJETIVO*\n\n` +
            `🎯 *Presa:* ${bounty.enemyName}\n` +
            `⏳ *Llegada estimada:* ${mins}m ${secs < 10 ? '0' : ''}${secs}s\n` +
            `⚙️ *Modo:* ${bounty.mode === 'auto' ? (bounty.adsClaimedForBounty >= 2 ? 'Automático Plus ⚡' : 'Automático Normal') : 'Manual'}\n\n` +
            `_Tus sentidos vigilan el camino. Recibirás avisos si algo ocurre._`;

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
            `💰 Botín base: *${bounty.baseGold}g*\n\n` +
            `¿Cómo deseas proceder?`;

    const buttons = [
      [Markup.button.callback('⚔️ Pelear Manualmente (Asalto por Asalto)', 'bounty_start_manual')],
      [Markup.button.callback('🤖 Resolver en Automático', 'bounty_auto_select')],
      [Markup.button.callback('⬅️ Volver al Campamento', 'status')]
    ];
    return { text, keyboard: Markup.inlineKeyboard(buttons) };
  }

  const tierCfg = BOUNTY_TIERS[bounty.tierKey];

  text += `🎯 *Contrato del Día:* *${bounty.enemyName}*\n\n` +
          `📝 *Informe del Encargo:*\n${bounty.description}\n\n` +
          `📊 *Ficha del Peligro:*\n` +
          `• Nivel de amenaza: *Tier ${bounty.tierKey.replace('tier', '')}*\n` +
          `• Duración del viaje: *${bounty.durationMinutes} minuto(s)*\n` +
          `• Botín base estimado: *~${bounty.baseGold}g*\n` +
          `• Salud enemiga: *${bounty.enemyMaxHp} HP*\n\n` +
          `¿Deseas aceptar el encargo y partir?`;

  const buttons = [
    [Markup.button.callback(`🚀 Iniciar Caza (${bounty.durationMinutes} min)`, 'bounty_depart_prompt')],
    [Markup.button.callback('⬅️ Volver a Explorar el Reino', 'menu_explore')]
  ];

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

// Pantalla para elegir entre Auto Normal o Auto Plus
async function getAutoSelectionView(userId) {
  const todayUtc = getTodayUtcString();
  const bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });
  const tierCfg = BOUNTY_TIERS[bounty ? bounty.tierKey : 'tier1'];

  const normalLimit = tierCfg.autoPotionsBase;
  const plusLimit = tierCfg.autoPotionsWithAds;

  const text = `🤖 *Configuración de Asalto Automático*\n\n` +
               `Elige el protocolo de supervivencia para tu expedición:\n\n` +
               `🔹 *Modo Normal:* Consume hasta *${normalLimit}* poción(es) de salud si tu vida cae por debajo del 40%.\n\n` +
               `⚡ *Modo Plus (+2 Anuncios):* Desbloquea un cupo ampliado de hasta *${plusLimit}* pociones de salud si el combate se complica.\n\n` +
               `¿Cuál deseas emplear?`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(`🔹 Iniciar Auto Normal (Máx. ${normalLimit})`, 'bounty_go_auto_normal')],
    [Markup.button.webApp(`⚡ Activar Auto Plus (Ver Anuncios)`, 'https://bot-rpg-wu42.onrender.com/ad-reward')],
    [Markup.button.callback(`⚡ Iniciar Auto Plus (Si ya viste 2 ads)`, 'bounty_go_auto_plus')],
    [Markup.button.callback('⬅️ Volver', 'menu_bounty')]
  ]);

  return { text, keyboard };
}

// Iniciar viaje de rastreo
async function startBountyTravel(ctx, bot, mode = 'auto', isPlus = false) {
  const userId = ctx.from.id;
  const player = await Player.findOne({ userId });
  if (!player) return;

  const todayUtc = getTodayUtcString();
  let bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });

  if (!bounty) {
    bounty = await getOrCreateDailyBounty(userId, player.level);
    return await ctx.reply(
      `🌌 *¡El Tablón cambió ante tus ojos!*\n\n` +
      `Las campanas marcaron las 00:00 UTC y los contratos fueron renovados.\n` +
      `Tu nuevo objetivo es: *${bounty.enemyName}*.`,
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
    return await ctx.answerCbQuery('Ya estás en camino.', { show_alert: true });
  }

  const travelMs = bounty.durationMinutes * 60 * 1000;
  const now = Date.now();

  bounty.status = 'traveling';
  bounty.mode = mode;
  if (isPlus) {
    bounty.adsClaimedForBounty = 2;
  }
  bounty.startedAt = new Date(now);
  bounty.arrivesAt = new Date(now + travelMs);
  bounty.eventsLog = [];
  bounty.netGoldBonus = 0;
  bounty.eventsProcessedCount = 0;
  await bounty.save();

  await ctx.answerCbQuery('¡Partiste hacia la caza!');

  scheduleTravelEvents(bot, userId, bounty._id, bounty.durationMinutes, travelMs);
  return await renderBountyView(ctx, player);
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
          // Activar temporizador AFK para modo manual
          armManualAfkTimer(bot, userId, bounty);
          try {
            await bot.telegram.sendMessage(
              userId,
              `📍 *¡Llegaste a la guarida de ${bounty.enemyName}!* \n\n` +
              `El enemigo está frente a ti. Entra al tablón para combatir.\n` +
              `⚠️ _¡No tardes demasiado o el enemigo te sorprenderá!_`,
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([[Markup.button.callback('⚔️ Iniciar Asalto Manual', 'menu_bounty')]])
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

// Temporizador AFK en Modo Manual (5 min en T1-T2, 10 min en T3-T5)
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

      // Primer aviso AFK: Golpe de castigo
      const penaltyDmg = Math.max(10, Math.round(b.enemyMaxDmg * 0.7));
      p.hp = Math.max(1, p.hp - penaltyDmg);
      await p.save();

      await bot.telegram.sendMessage(
        userId,
        `⚠️ *¡EL ENEMIGO TE SORPRENDIÓ POR INACCIÓN!*\n\n` +
        `Te quedaste quieto demasiado tiempo frente a *${b.enemyName}* y te asestó un golpe de castigo perdiendo *-${penaltyDmg} HP*.\n\n` +
        `_Si no atacas pronto, el enemigo te despojará y escapará._`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('⚔️ Atacar Ahora', 'bounty_start_manual')]])
        }
      );

      // Segundo aviso AFK: Golpe de gracia y huida con el botín
      const t2 = setTimeout(async () => {
        const b2 = await PlayerBounty.findById(bounty._id);
        const p2 = await Player.findOne({ userId });
        if (!b2 || b2.status !== 'arrived' || !p2) return;

        p2.hp = 1; // Queda a 1 HP
        b2.status = 'failed';
        await p2.save();
        await b2.save();

        manualAfkTimers.delete(userId);

        await bot.telegram.sendMessage(
          userId,
          `💨 *¡EL ENEMIGO HA ESCAPADO!*\n\n` +
          `Aprovechando tu prolongada ausencia, *${b2.enemyName}* te propinó un golpe devastador dejándote a *1 HP* y huyó llevándose casi todo el botín.\n\n` +
          `La misión de hoy ha fallado. Podrás reintentarla cuando recuperes salud.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('🏕️ Volver al Campamento', 'status')]])
          }
        );
      }, Math.max( afkMs / 2, 90000));

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

    eventMsg = `🧭 *Suceso en el camino:*\n${ev.text}\n` +
               `💰 *+${gained}g* sumados para el botín final.`;
  } else {
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
                   `🩸 Perdiste *-${hpLoss} HP* por el tropiezo.`;
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
                   `💸 Perdiste *-${goldLoss}g* en el camino.`;
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
                   `🩸 Recibiste un arañazo perdiendo *-${hpLoss} HP*.`;
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
    const baseAtk = 20 + (str * 1.2) + Math.floor(Math.sqrt(str) * 3);
    const variation = (Math.random() * 0.40) - 0.20;
    let pDmg = Math.round(baseAtk * (1 + variation));
    if (Math.random() < Math.min(0.30, luk * 0.0025)) {
      pDmg = Math.round(pDmg * 1.40);
    }
    enemyHp -= Math.max(1, pDmg);

    if (enemyHp <= 0) break;

    const eDmgRaw = Math.floor(Math.random() * (bounty.enemyMaxDmg - bounty.enemyMinDmg + 1)) + bounty.enemyMinDmg;
    const mitigation = (str / (str + 60)) * 0.40;
    const finalDmg = Math.max(1, Math.round(eDmgRaw * (1 - mitigation)));
    playerHp -= finalDmg;

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

  if (player.hp <= 0) {
    bounty.status = 'failed';
    const lostExp = player.applyDeathPenalty();
    player.knockedOutUntil = Date.now() + 2 * 60 * 60 * 1000;
    await player.save();
    await bounty.save();

    const failMsg = `💀 *Caza Fallida: ${bounty.enemyName}*\n\n` +
                    `Caíste inconsciente durante la resolución automática.\n` +
                    (potionsUsedCount > 0 ? `• Pociones usadas: ${potionsUsedDetails.join(', ')}\n` : '') +
                    `⏳ Quedaste inconsciente por 2 horas.\n` +
                    `⚠️ Perdiste ${lostExp} de EXP acumulada.\n\n` +
                    `_Podrás reintentar el asalto cuando te recuperes antes de las 00:00 UTC._`;

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

  const successMsg = `🎉 *¡OBJETIVO ELIMINADO EN MODO AUTOMÁTICO!*\n\n` +
                     `Derrotaste a *${bounty.enemyName}* tras ${turns} asaltos.\n\n` +
                     (potionsUsedCount > 0 ? `🧪 *Pociones de salud utilizadas:* ${potionsUsedDetails.join(', ')}\n\n` : `✨ _No fue necesario usar ninguna poción._\n\n`) +
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

function applyBountyRewards(player, bounty) {
  const finalGold = Math.max(50, bounty.baseGold + bounty.netGoldBonus);
  const rawExp = Math.round(bounty.baseGold * 1.35);

  let maxExpCap = 0;
  const currentLvl = player.level;
  if (currentLvl < MAX_LEVEL) {
    maxExpCap += (getRequiredExp(currentLvl) - player.exp);
    if (currentLvl + 1 < MAX_LEVEL) {
      maxExpCap += getRequiredExp(currentLvl + 1);
      if (currentLvl + 2 < MAX_LEVEL) {
        maxExpCap += Math.round(getRequiredExp(currentLvl + 2) * 0.15);
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

async function executeManualBountyAttack(ctx, bot) {
  const userId = ctx.from.id;
  const player = await Player.findOne({ userId });
  if (!player) return;

  const todayUtc = getTodayUtcString();
  const bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });

  if (!bounty || bounty.status !== 'arrived') {
    return await ctx.answerCbQuery('No tienes ningún objetivo localizado listo para combatir.', { show_alert: true });
  }

  // Desactivar temporalmente timer AFK al interactuar
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

    const victoryMsg = `🎉 *¡VICTORIA CONTRA ${bounty.enemyName}!*\n\n` +
                       `Asestaste el golpe final terminando la cacería.\n\n` +
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

    const defeatMsg = `💀 *¡Has caído derrotado por ${bounty.enemyName}!* \n\n` +
                      `El enemigo te asestó un golpe de ${finalEnemyDmg} de daño.\n` +
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

  // Re-armar temporizador AFK para el siguiente asalto
  armManualAfkTimer(bot, userId, bounty);

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

// Reset de Admin para repetir la caza
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
  resetBountyForAdmin
};
