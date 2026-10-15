const { Markup } = require('telegraf');
const { WorldBoss, getWorldBoss } = require('../bossModel');
const {
  safeAnswerCb,
  safeEditMessage,
  formatHoursMinutes,
  broadcastToAll
} = require('../utils/telegramUtils');

function formatPlayerName(name, maxLength = 20) {
  if (!name) return 'Aventurero';
  return name.length > maxLength ? name.slice(0, maxLength) + '…' : name;
}

function registerBossHandlers(bot, deps) {
  const {
    ADMIN_ID,
    MAX_LEVEL,
    MAX_ENERGY,
    Player,
    getPlayer,
    getRequiredExp,
    creditReferralBonus,
    adminFlags
  } = deps;

  const confirmedBossWarning = new Map();

  let bossWaitMinutesConfig = 30;
  let bossDurationMinutesConfig = 90;
  let bossHpConfig = null;
  let bossCustomEpicMessage = null;

  function getDefaultEpicMessage(bossName, waitMinutes, hp, durationMin) {
    return '⚡🌋 *¡UNA CATÁSTROFE ANCESTRAL SE AVECINA!*\n\n' +
           'El firmamento se tiñe de carmesí y los cimientos de la tierra se quiebran bajo nuestros pies. Las antiguas leyendas no mentían: *' + bossName + '* está abriendo los ojos tras milenios de letargo.\n\n' +
           '⏳ *Tiempo para su despertar:* ' + waitMinutes + ' minutos\n' +
           '⏱️ *Duración del asalto:* ' + durationMin + ' minutos de combate\n' +
           '❤️ *Vitalidad del Coloso:* ' + hp.toLocaleString() + ' HP\n' +
           '⚔️ *Requisito de entrada:* Nivel 5 o superior\n\n' +
           '_¡Reúnan sus armas, forjen sus estrategias y preparen sus pociones! La supervivencia del reino depende de todos._';
  }

  async function getBossCensus() {
    const aptPlayers = await Player.find({ level: { \$gte: 5 }, isVerified: true });
    const totalAptos = aptPlayers.length;
    const activeCount = Math.max(totalAptos, 3);

    let totalHp = 0;
    let totalStr = 0;
    let totalLvl = 0;

    aptPlayers.forEach((p) => {
      totalHp += (p.maxHp || 50);
      totalStr += (p.strength || 0);
      totalLvl += p.level;
    });

    const avgMaxHp = totalAptos > 0 ? Math.round(totalHp / totalAptos) : 80;
    const avgStr = totalAptos > 0 ? Math.round(totalStr / totalAptos) : 5;
    const avgLvl = totalAptos > 0 ? Math.round(totalLvl / totalAptos) : 8;

    const avgDmg = 20 + (avgStr * 1.2) + Math.floor(Math.sqrt(avgStr) * 3);
    const recommendedHp = Math.round(activeCount * avgDmg * 15);

    const minDmg = Math.max(50, Math.round(avgMaxHp * 0.25));
    const maxDmg = Math.max(75, Math.round(avgMaxHp * 0.35));
    const attacksPerTurn = avgMaxHp >= 200 ? 2 : 1;

    return {
      totalAptos,
      activeCount,
      avgMaxHp,
      avgStr,
      avgLvl,
      recommendedHp,
      minDmg,
      maxDmg,
      attacksPerTurn
    };
  }

  async function renderAdminBossPanel(ctx) {
    const boss = await getWorldBoss();
    const census = await getBossCensus();

    const selectedHp = bossHpConfig || census.recommendedHp;

    let text = `🐲 *Panel de Convocatoria del Jefe Mundial*\n\n` +
               `Estado actual: *${boss.status.toUpperCase()}*\n`;

    if (boss.status === 'scheduled') {
      const minsLeft = Math.max(0, Math.ceil((new Date(boss.battleStartsAt).getTime() - Date.now()) / 60000));
      text += `⏳ Batalla programada: inicia en *${minsLeft} min*\n` +
              `⏱️ Duración de batalla: *${boss.battleDurationMinutes || 90} min*\n` +
              `❤️ Salud programada: *${boss.maxHp.toLocaleString()} HP*\n\n`;
    } else if (boss.status === 'active') {
      text += `⚔️ *¡Batalla en curso!*\n` +
              `❤️ Salud restante: *${boss.currentHp}/${boss.maxHp} HP*\n` +
              `👥 Participantes: *${boss.participants.length}*\n\n`;
    } else {
      text += `\n📊 *Censo de Jugadores Aptos (Nivel 5+):*\n` +
              `• Jugadores censados: *${census.totalAptos}* (Mínimo: ${census.activeCount})\n` +
              `• Promedio Salud: *${census.avgMaxHp} HP* | Promedio Fuerza: *${census.avgStr}*\n` +
              `• 💡 *Salud Recomendada:* *${census.recommendedHp.toLocaleString()} HP*\n\n` +
              `⚙️ *Parámetros Seleccionados:*\n` +
              `• ❤️ Salud: *${selectedHp.toLocaleString()} HP*` + (bossHpConfig === null ? ' _(Recomendada)_' : '') + `\n` +
              `• ⏳ Tiempo de espera: *${bossWaitMinutesConfig} minutos*\n` +
              `• ⏱️ Duración de combate: *${bossDurationMinutesConfig} minutos*\n` +
              `• 📜 Mensaje épico: ` + (bossCustomEpicMessage ? `*Personalizado*` : `_Por defecto_`) + `\n\n` +
              `Ajusta los valores y pulsa *"🚀 Revisar y Comenzar Evento"*:`;
    }

    const buttons = [];

    if (boss.status === 'idle' || boss.status === 'defeated' || boss.status === 'escaped') {
      buttons.push([Markup.button.callback('🚀 Revisar y Comenzar Evento', 'adm_boss_review')]);
      buttons.push([
        Markup.button.callback(`💡 Usar Recomendada (${census.recommendedHp} HP)`, `adm_boss_sel_hp_${census.recommendedHp}`),
        Markup.button.callback('✏️ Salud Manual', 'adm_boss_custom_hp')
      ]);
      buttons.push([
        Markup.button.callback('🧪 500 HP', 'adm_boss_sel_hp_500'),
        Markup.button.callback('🧪 1000 HP', 'adm_boss_sel_hp_1000'),
        Markup.button.callback('🧪 2500 HP', 'adm_boss_sel_hp_2500')
      ]);
      buttons.push([
        Markup.button.callback('⏳ Espera: 1m', 'adm_boss_set_wait_1'),
        Markup.button.callback('⏳ 10m', 'adm_boss_set_wait_10'),
        Markup.button.callback('⏳ 30m', 'adm_boss_set_wait_30'),
        Markup.button.callback('⏳ 60m', 'adm_boss_set_wait_60'),
        Markup.button.callback('⏳ 120m', 'adm_boss_set_wait_120')
      ]);
      buttons.push([
        Markup.button.callback('⏱️ Combate: 60m', 'adm_boss_set_dur_60'),
        Markup.button.callback('⏱️ Combate: 90m', 'adm_boss_set_dur_90'),
        Markup.button.callback('⏱️ Combate: 120m', 'adm_boss_set_dur_120')
      ]);
    } else {
      buttons.push([Markup.button.callback('🛑 Cancelar / Forzar Retirada del Coloso', 'adm_boss_force_end')]);
    }

    buttons.push([Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }

  async function scheduleBossFight(ctx, hp, waitMinutes, durationMinutes) {
    const boss = await getWorldBoss();

    if (boss.status === 'scheduled' || boss.status === 'active') {
      return await safeAnswerCb(ctx, 'Ya hay un Jefe Mundial activo o programado.', true);
    }

    const census = await getBossCensus();
    const now = Date.now();
    const startsAt = new Date(now + waitMinutes * 60 * 1000);

    boss.status = 'scheduled';
    boss.name = 'Bahamut, el Destructor Carmesí';
    boss.level = census.avgLvl;
    boss.maxHp = hp;
    boss.currentHp = hp;
    boss.minDmg = census.minDmg;
    boss.maxDmg = census.maxDmg;
    boss.attacksPerTurn = census.attacksPerTurn;
    boss.damageType = 'Físico';
    boss.activeCount = census.activeCount;
    boss.avgMaxHp = census.avgMaxHp;
    boss.avgStr = census.avgStr;
    boss.scheduledAt = new Date(now);
    boss.battleStartsAt = startsAt;
    boss.battleEndsAt = null;
    boss.battleDurationMinutes = durationMinutes;
    boss.alert5MinSent = false;
    boss.participants = [];

    await boss.save();
    await safeAnswerCb(ctx, '¡Jefe Mundial programado exitosamente!');

    const announceMsg = bossCustomEpicMessage || getDefaultEpicMessage(boss.name, waitMinutes, hp, durationMinutes);
    await broadcastToAll(bot, Player, announceMsg);

    bossCustomEpicMessage = null;
    bossHpConfig = null;

    return await safeEditMessage(
      ctx,
      `✅ *Jefe Mundial convocado exitosamente.*\n\n` +
      `• Salud: *${hp.toLocaleString()} HP*\n` +
      `• Espera: *${waitMinutes} min*\n` +
      `• Duración de Combate: *${durationMinutes} min*\n` +
      `• Se envió el anuncio épico global a todo el reino.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]])
      }
    );
  }

  async function distributeBossRewards(boss) {
    try {
      const parts = [...boss.participants].sort((a, b) => b.totalDamage - a.totalDamage);
      if (!parts.length) return;

      const totalDmgAll = parts.reduce((acc, p) => acc + p.totalDamage, 0) || 1;
      const participantCount = parts.length;

      const goldMultiplier = 0.8 + Math.min(1.2, participantCount * 0.25);
      const expMultiplier = 1.0 + Math.min(1.5, participantCount * 0.30);

      const baseGoldPool = 350 + Math.round(boss.maxHp * goldMultiplier);
      const baseExpPool = 450 + Math.round(boss.maxHp * expMultiplier);

      const top1 = parts[0];
      const top2 = parts.length > 1 ? parts[1] : null;
      const top3 = parts.length > 2 ? parts[2] : null;
      const lastHitter = parts.find(p => p.lastHit) || top1;
      const firstHitter = parts.find(p => p.firstHit);

      const elixirWinners = new Set();
      const dropsSummary = [];

      if (top1) {
        elixirWinners.add(top1.userId);
        dropsSummary.push(`• 🩸 *${formatPlayerName(top1.name)}* (Top 1 Daño) obtuvo 1x Elixir de Sangre de Dragón.`);

        // Asignación de título: Verdugo de Titanes
        const top1Player = await Player.findOne({ userId: top1.userId });
        if (top1Player) {
          if (!top1Player.unlockedTitles) top1Player.unlockedTitles = ['Aventurero Novato'];
          if (!top1Player.unlockedTitles.includes('Verdugo de Titanes')) {
            top1Player.unlockedTitles.push('Verdugo de Titanes');
            if (typeof top1Player.markModified === 'function') {
              top1Player.markModified('unlockedTitles');
            }
            await top1Player.save();

            try {
              await bot.telegram.sendMessage(
                top1.userId,
                `🎖️🎉 *¡DISTINCIÓN LEGENDARIA DESBLOQUEADA!*\n\n` +
                `Por tu hazaña como máximo atacante (MVP) frente al Coloso, has obtenido: «*Verdugo de Titanes*».\n\n` +
                `_Puedes equipártelo en cualquier momento desde tu Hogar del Aventurero._`,
                { parse_mode: 'Markdown' }
              );
            } catch (e) {}
          }
        }
      }

      let secondRecipient = lastHitter;
      if (elixirWinners.has(secondRecipient.userId)) {
        secondRecipient = parts.find(p => !elixirWinners.has(p.userId));
      }

      if (secondRecipient && !elixirWinners.has(secondRecipient.userId)) {
        elixirWinners.add(secondRecipient.userId);
        const reason = (secondRecipient.userId === lastHitter.userId) ? 'Remate Final' : 'Top Participación';
        dropsSummary.push(`• 🩸 *${formatPlayerName(secondRecipient.name)}* (${reason}) obtuvo 1x Elixir de Sangre de Dragón.`);
      }

      if (parts.length >= 3 && elixirWinners.size < 3) {
        const candidates = parts.filter(p => !elixirWinners.has(p.userId));
        for (const cand of candidates) {
          if (elixirWinners.size >= 3) break;
          const isFirst = (firstHitter && firstHitter.userId === cand.userId);
          const chance = isFirst ? 0.40 : 0.20;
          if (Math.random() < chance) {
            elixirWinners.add(cand.userId);
            const reason = isFirst ? 'Primer Golpe' : 'Sorteo de Participación';
            dropsSummary.push(`• 🩸 *${formatPlayerName(cand.name)}* (${reason}) obtuvo 1x Elixir de Sangre de Dragón.`);
          }
        }
      }

      for (const p of parts) {
        const playerDoc = await Player.findOne({ userId: p.userId });
        if (!playerDoc) continue;

        const dmgRatio = p.totalDamage / totalDmgAll;

        let earnedGold = 80 + Math.round(baseGoldPool * dmgRatio);
        let rawExp = 100 + Math.round(baseExpPool * dmgRatio);

        if (p.userId === top1.userId) {
          earnedGold += 250;
          rawExp += 350;
        } else if (top2 && p.userId === top2.userId) {
          earnedGold += 150;
          rawExp += 200;
        } else if (top3 && p.userId === top3.userId) {
          earnedGold += 100;
          rawExp += 150;
        }

        if (lastHitter && p.userId === lastHitter.userId) {
          earnedGold += 150;
          rawExp += 200;
        }
        if (firstHitter && p.userId === firstHitter.userId) {
          earnedGold += 100;
          rawExp += 150;
        }

        let maxAllowedExp = 0;
        let tempLvl = playerDoc.level;
        for (let i = 0; i < 3; i++) {
          if (tempLvl + i < MAX_LEVEL) {
            maxAllowedExp += getRequiredExp(tempLvl + i);
          }
        }

        const earnedExp = Math.min(rawExp, maxAllowedExp);

        playerDoc.gold += earnedGold;
        const leveledUp = playerDoc.addExp(earnedExp);

        if (elixirWinners.has(p.userId)) {
          playerDoc.potionsDragonBlood = (playerDoc.potionsDragonBlood || 0) + 1;
        }

        await playerDoc.save();
        await creditReferralBonus(p.userId, earnedGold);

        const individualMsg = `🏆 *¡Recompensas del Coloso: ${boss.name}!* \n\n` +
                              `• Tu daño aportado: *${p.totalDamage.toLocaleString()}*\n` +
                              `• Bolsa Global (Pool): *${baseGoldPool.toLocaleString()}g* | *${baseExpPool.toLocaleString()} EXP*\n` +
                              `💰 Oro ganado: *+${earnedGold.toLocaleString()}g*\n` +
                              `🔮 EXP ganada: *+${earnedExp.toLocaleString()}*\n` +
                              (elixirWinners.has(p.userId) ? `🩸 *¡Obtuviste 1x Elixir de Sangre de Dragón!*\n` : '') +
                              (leveledUp ? `🎉 ¡Subiste a Nivel ${playerDoc.level}!` : '');

        try {
          await bot.telegram.sendMessage(p.userId, individualMsg, { parse_mode: 'Markdown' });
        } catch (e) {}
      }

      const publicMsg = `🎉 *¡${boss.name} HA SIDO ANIQUILADO!*\n\n` +
                        `📊 *Bolsa Total (Pool):* 💰 ${baseGoldPool.toLocaleString()}g | 🔮 ${baseExpPool.toLocaleString()} EXP\n\n` +
                        `🥇 *Top 1 en Daño:* ${formatPlayerName(top1.name)} (${top1.totalDamage.toLocaleString()} daño)\n` +
                        (top2 ? `🥈 *Top 2 en Daño:* ${formatPlayerName(top2.name)} (${top2.totalDamage.toLocaleString()} daño)\n` : '') +
                        (top3 ? `🥉 *Top 3 en Daño:* ${formatPlayerName(top3.name)} (${top3.totalDamage.toLocaleString()} daño)\n` : '') +
                        `⚡ *Primer Golpe:* ${firstHitter ? formatPlayerName(firstHitter.name) : 'N/A'}\n` +
                        `🗡️ *Golpe de Gracia:* ${formatPlayerName(lastHitter.name)}\n\n` +
                        `🎁 *Elixires de Sangre de Dragón repartidos:*\n` +
                        dropsSummary.join('\n');

      await broadcastToAll(bot, Player, publicMsg);
    } catch (err) {
      console.error('Error distribuyendo recompensas del jefe:', err);
    }
  }

  async function executeBossAttack(ctx, confirmedWarning = false) {
    const userId = ctx.from.id;
    const player = await getPlayer(userId, ctx.from.first_name);
    const boss = await getWorldBoss();

    if (boss.status !== 'active') {
      return await safeAnswerCb(ctx, 'El Jefe Mundial no se encuentra en combate activo.', true);
    }

    if (player.level < 5) {
      return await safeAnswerCb(ctx, 'Requieres nivel 5 o más.', true);
    }

    if (player.knockedOutUntil && Date.now() < player.knockedOutUntil) {
      return await safeAnswerCb(ctx, 'Estás inconsciente. No puedes atacar.', true);
    }

    if (player.hp <= 0) {
      return await safeAnswerCb(ctx, 'Estás sin salud. Cúrate primero.', true);
    }

    if (player.energy < 2) {
      return await safeAnswerCb(ctx, 'Necesitas al menos 2 puntos de Energía para atacar al Coloso.', true);
    }

    const sessionConfirmed = (confirmedBossWarning.get(userId) === String(boss._id));
    const isVulnerable = (player.hp <= boss.maxDmg);

    if (isVulnerable && !confirmedWarning && !sessionConfirmed) {
      await safeAnswerCb(ctx);
      const warnText = `⚠️ *¡ADVERTENCIA DE COMBATE CRÍTICO!*\n\n` +
                       `Tu salud actual (*${player.hp} HP*) es inferior o igual al ataque máximo del Coloso (*${boss.maxDmg}* daño).\n\n` +
                       `Podrías caer inconsciente de un solo impacto. Se recomienda curarte con pociones antes de asaltar.\n\n` +
                       `¿Deseas arriesgarte y atacar de todos modos?`;

      const warnBtns = Markup.inlineKeyboard([
        [Markup.button.callback('⚔️ Atacar de todos modos', 'boss_attack_confirm')],
        [Markup.button.callback('🎒 Curarme con Pociones', 'boss_inv')],
        [Markup.button.callback('⬅️ Retirarme', 'menu_boss')]
      ]);

      return await safeEditMessage(ctx, warnText, { parse_mode: 'Markdown', ...warnBtns });
    }

    if (confirmedWarning) {
      confirmedBossWarning.set(userId, String(boss._id));
    }

    player.energy -= 2;
    const str = player.strength || 0;
    const luk = player.luck || 0;
    const agi = player.agility || 0;

    const dañoBase = 20 + (str * 1.2) + Math.floor(Math.sqrt(str) * 3);
    const variation = (Math.random() * 0.40) - 0.20;
    let playerDmg = Math.round(dañoBase * (1 + variation));

    const critChance = Math.min(0.30, (luk * 0.0025));
    let isCrit = false;
    if (Math.random() < critChance) {
      isCrit = true;
      playerDmg = Math.round(playerDmg * 1.40);
    }
    playerDmg = Math.max(1, playerDmg);

    boss.currentHp = Math.max(0, boss.currentHp - playerDmg);

    let participant = boss.participants.find(p => p.userId === userId);
    if (!participant) {
      const isFirst = (boss.participants.length === 0);
      boss.participants.push({
        userId,
        name: player.name,
        totalDamage: playerDmg,
        attacksCount: 1,
        firstHit: isFirst,
        lastHit: false
      });
    } else {
      participant.totalDamage += playerDmg;
      participant.attacksCount += 1;
    }

    const isBossDefeated = (boss.currentHp <= 0);
    if (isBossDefeated) {
      const pRecord = boss.participants.find(p => p.userId === userId);
      if (pRecord) pRecord.lastHit = true;
      boss.status = 'defeated';
    }

    let bossDmg1 = Math.floor(Math.random() * (boss.maxDmg - boss.minDmg + 1)) + boss.minDmg;
    let attacksTaken = 1;
    let extraDmg = 0;

    if (boss.avgMaxHp >= 200 && Math.random() < 0.28) {
      attacksTaken = 2;
      extraDmg = Math.round(bossDmg1 * (Math.random() * 0.10 + 0.40));
    }

    const rawBossTotal = bossDmg1 + extraDmg;

    const strMitigationRatio = (str / (str + 60)) * 0.40;
    let mitigatedDmg = Math.round(rawBossTotal * (1 - strMitigationRatio));

    let grazed = false;
    const grazeChance = Math.min(0.40, agi * 0.004);
    if (Math.random() < grazeChance) {
      grazed = true;
      mitigatedDmg = Math.round(mitigatedDmg * 0.50);
    }

    const minAllowed = Math.round(rawBossTotal * 0.30);
    const finalDamageTaken = Math.max(minAllowed, mitigatedDmg);

    player.hp = Math.max(0, player.hp - finalDamageTaken);

    let knockOutMsg = '';
    if (player.hp === 0) {
      const lostExp = player.applyDeathPenalty();
      player.knockedOutUntil = Date.now() + 2 * 60 * 60 * 1000;
      knockOutMsg = `\n💀 *¡Has caído inconsciente!*\n` +
                    `El impacto del coloso fue descomunal. Espera 2h o usa un *Elixir de Sangre de Dragón*.\n` +
                    `⚠️ Perdiste ${lostExp} de EXP.`;
    }

    await player.save();
    await boss.save();
    await safeAnswerCb(ctx);

    let combatReport = `⚔️ *Asalto contra ${boss.name}*\n\n` +
                       (isCrit ? `✨ *¡Golpe Crítico Devastador!* (1.4x)\n` : '') +
                       `💥 Daño infligido: *${playerDmg.toLocaleString()} puntos*\n\n` +
                       `🛡️ *Ataque recibido (${attacksTaken} golpe/s):*\n` +
                       `• Daño original: ${rawBossTotal}\n` +
                       (grazed ? `🤸 ¡Impacto rozante de Agilidad! (-50%)\n` : '') +
                       `• Daño final recibido: *${finalDamageTaken} HP*\n` +
                       `❤️ Tu salud restante: *${player.hp}/${player.maxHp} HP*\n` +
                       `❤️ Salud del Coloso: *${boss.currentHp.toLocaleString()}/${boss.maxHp.toLocaleString()} HP*` +
                       knockOutMsg;

    if (isBossDefeated) {
      combatReport += `\n\n🎉 *¡EL COLOSO HA SIDO DERROTADO!* ¡Repartiendo botín del reino...!`;
      await ctx.reply(combatReport, { parse_mode: 'Markdown' });
      return await distributeBossRewards(boss);
    }

    const nextBtns = [
      [Markup.button.callback('⚔️ Atacar de Nuevo (2 ⚡)', 'boss_attack')],
      [Markup.button.callback('🎒 Mochila / Pociones', 'boss_inv')],
      [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
    ];

    return await safeEditMessage(ctx, combatReport, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(nextBtns) });
  }

  // --- BOT ACTIONS DEL JEFE MUNDIAL ---

  bot.action('adm_boss_panel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    return await renderAdminBossPanel(ctx);
  });

  bot.action(/adm_boss_set_wait_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    bossWaitMinutesConfig = parseInt(ctx.match[1], 10);
    await safeAnswerCb(ctx, `Espera fijada en ${bossWaitMinutesConfig} min.`);
    return await renderAdminBossPanel(ctx);
  });

  bot.action(/adm_boss_set_dur_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    bossDurationMinutesConfig = parseInt(ctx.match[1], 10);
    await safeAnswerCb(ctx, `Duración de combate fijada en ${bossDurationMinutesConfig} min.`);
    return await renderAdminBossPanel(ctx);
  });

  bot.action(/adm_boss_sel_hp_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    bossHpConfig = parseInt(ctx.match[1], 10);
    await safeAnswerCb(ctx, `Salud fijada en ${bossHpConfig.toLocaleString()} HP.`);
    return await renderAdminBossPanel(ctx);
  });

  bot.action('adm_boss_custom_hp', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    adminFlags.bossCustomHpWaiting = true;

    const text = `✏️ *Salud Personalizada para el Jefe Mundial*\n\n` +
                 `Escribe en el chat el valor numérico de la salud que deseas asignarle (por ejemplo: 750, 3000 o 15000).\n\n` +
                 `_Se guardará en la configuración previa sin iniciar el evento de inmediato._`;

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancelar', 'adm_boss_panel')]])
    });
  });

  bot.action('adm_boss_review', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const census = await getBossCensus();
    const hpToUse = bossHpConfig || census.recommendedHp;
    const bossName = 'Bahamut, el Destructor Carmesí';
    const previewMsg = bossCustomEpicMessage || getDefaultEpicMessage(bossName, bossWaitMinutesConfig, hpToUse, bossDurationMinutesConfig);

    let text = `📋 *Resumen de Convocatoria del Jefe Mundial*\n\n` +
               `• *Coloso:* ${bossName}\n` +
               `• *Salud Configurada:* ${hpToUse.toLocaleString()} HP\n` +
               `• *Tiempo de Espera:* ${bossWaitMinutesConfig} minutos\n` +
               `• *Duración de la Batalla:* ${bossDurationMinutesConfig} minutos\n\n` +
               `📜 *Mensaje de Anuncio que se Enviará:*\n` +
               `──────────────────────\n` +
               `${previewMsg}\n` +
               `──────────────────────\n\n` +
               `¿Todo listo para convocar al Coloso?`;

    const buttons = [
      [Markup.button.callback('✅ Confirmar y Despertar al Coloso', 'adm_boss_launch_confirmed')],
      [Markup.button.callback('✏️ Editar Mensaje Épico', 'adm_boss_edit_msg')]
    ];

    if (bossCustomEpicMessage) {
      buttons.push([Markup.button.callback('🔄 Restaurar Mensaje por Defecto', 'adm_boss_reset_msg')]);
    }

    buttons.push([Markup.button.callback('⬅️ Volver a Ajustar Parámetros', 'adm_boss_panel')] );

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('adm_boss_edit_msg', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    adminFlags.bossCustomMsgWaiting = true;

    const text = `✏️ *Editar Mensaje de Convocatoria*\n\n` +
                 `Escribe a continuación en el chat el texto con el que deseas proclamar la llegada del Jefe a todos los aventureros.`;

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancelar', 'adm_boss_review')]])
    });
  });

  bot.action('adm_boss_reset_msg', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    bossCustomEpicMessage = null;
    await safeAnswerCb(ctx, 'Mensaje restablecido al épico predeterminado.');
    const census = await getBossCensus();
    const hpToUse = bossHpConfig || census.recommendedHp;
    const bossName = 'Bahamut, el Destructor Carmesí';
    const previewMsg = getDefaultEpicMessage(bossName, bossWaitMinutesConfig, hpToUse, bossDurationMinutesConfig);

    let text = `📋 *Resumen de Convocatoria del Jefe Mundial*\n\n` +
               `• *Coloso:* ${bossName}\n` +
               `• *Salud Configurada:* ${hpToUse.toLocaleString()} HP\n` +
               `• *Tiempo de Espera:* ${bossWaitMinutesConfig} minutos\n` +
               `• *Duración de la Batalla:* ${bossDurationMinutesConfig} minutos\n\n` +
               `📜 *Mensaje de Anuncio que se Enviará:*\n` +
               `──────────────────────\n` +
               `${previewMsg}\n` +
               `──────────────────────\n\n` +
               `¿Todo listo para convocar al Coloso?`;

    const buttons = [
      [Markup.button.callback('✅ Confirmar y Despertar al Coloso', 'adm_boss_launch_confirmed')],
      [Markup.button.callback('✏️ Editar Mensaje Épico', 'adm_boss_edit_msg')],
      [Markup.button.callback('⬅️ Volver a Ajustar Parámetros', 'adm_boss_panel')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('adm_boss_launch_confirmed', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);

    const census = await getBossCensus();
    const hpToUse = bossHpConfig || census.recommendedHp;
    return await scheduleBossFight(ctx, hpToUse, bossWaitMinutesConfig, bossDurationMinutesConfig);
  });

  bot.action('adm_boss_force_end', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);

    const boss = await getWorldBoss();
    const wasActiveOrScheduled = (boss.status === 'scheduled' || boss.status === 'active');

    boss.status = 'idle';
    boss.participants = [];
    await boss.save();

    await safeAnswerCb(ctx, 'Evento del jefe cancelado.');

    if (wasActiveOrScheduled) {
      const retreatMsg = `💨 *La tierra deja de temblar...*\n\n` +
                         `El coloso ancestral ha decidido descender a su guarida subterránea. Están a salvo... por ahora.`;
      await broadcastToAll(bot, Player, retreatMsg);
    }

    return await safeEditMessage(ctx, '✅ *El evento del Jefe Mundial fue cancelado y se notificó a los jugadores.*', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]])
    });
  });

  bot.action('menu_boss', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const boss = await getWorldBoss();

    if (player.level < 5) {
      return await safeEditMessage(
        ctx,
        `🔒 *Jefe Mundial Bloqueado*\n\n` +
        `Debes alcanzar al menos el *Nivel 5* para participar en las batallas de Colosos. (Tu nivel: ${player.level})`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]])
        }
      );
    }

    let text = `🐲 *Frente de Batalla: ${boss.name}*\n\n`;

    if (boss.status === 'scheduled') {
      const minsLeft = Math.max(0, Math.ceil((new Date(boss.battleStartsAt).getTime() - Date.now()) / 60000));
      text += `⏳ El coloso está despertando. La batalla inicia en aproximadamente *${minsLeft} minutos*.\n\n` +
              `❤️ Salud prevista: *${boss.maxHp.toLocaleString()} HP*\n` +
              `⚔️ Daño estimado: *${boss.minDmg} - ${boss.maxDmg}*\n` +
              `⏱️ Duración del combate: *${boss.battleDurationMinutes || 90} minutos*\n\n` +
              `Asegúrate de preparar tu inventario y descansar antes del inicio.`;

      return await safeEditMessage(ctx, text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Actualizar', 'menu_boss')],
          [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
        ])
      });
    }

    if (boss.status === 'active') {
      const myPart = boss.participants.find(p => p.userId === player.userId);
      const myDmg = myPart ? myPart.totalDamage : 0;
      const hpPct = ((boss.currentHp / boss.maxHp) * 100).toFixed(1);
      const secLeft = Math.max(0, Math.ceil((new Date(boss.battleEndsAt).getTime() - Date.now()) / 1000));

      text += `🔥 *¡EL JEFE ESTÁ EN COMBATE!*\n\n` +
              `❤️ Salud del Coloso: *${boss.currentHp.toLocaleString()}/${boss.maxHp.toLocaleString()} HP* (${hpPct}%)\n` +
              `⏳ Tiempo restante: *${formatHoursMinutes(secLeft)}*\n` +
              `⚔️ Rango de ataque enemigo: *${boss.minDmg} - ${boss.maxDmg}* Físico\n` +
              `💥 Tu daño aportado: *${myDmg.toLocaleString()} puntos*\n\n` +
              `❤️ Tu salud actual: *${player.hp}/${player.maxHp} HP*\n` +
              `⚡ Tu energía: *${player.energy}/${MAX_ENERGY}*\n\n` +
              `¿Deseas asestar un asalto?`;

      const buttons = [
        [Markup.button.callback('⚔️ Atacar al Coloso (2 ⚡)', 'boss_attack')],
        [Markup.button.callback('🎒 Mochila / Pociones', 'boss_inv')],
        [Markup.button.callback('🔄 Actualizar', 'menu_boss')],
        [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
      ];

      return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }

    text += `_Actualmente ningún coloso amenaza las tierras. El Creador anunciará la próxima convocatoria._`;
    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]])
    });
  });

  bot.action('boss_attack', async (ctx) => {
    return await executeBossAttack(ctx, false);
  });

  bot.action('boss_attack_confirm', async (ctx) => {
    return await executeBossAttack(ctx, true);
  });

  return {
    handleBossTextConfig: async (ctx, textMsg) => {
      const userId = ctx.from.id;
      if (userId !== ADMIN_ID) return false;

      if (adminFlags.bossCustomHpWaiting) {
        adminFlags.bossCustomHpWaiting = false;
        const customHp = parseInt(textMsg, 10);
        if (isNaN(customHp) || customHp < 50) {
          await ctx.reply('⚠️ Escribe un número válido mayor a 50 para la salud del jefe.');
          return true;
        }
        bossHpConfig = customHp;
        await ctx.reply(`✅ *Salud guardada:* ${customHp.toLocaleString()} HP.`, { parse_mode: 'Markdown' });
        await renderAdminBossPanel(ctx);
        return true;
      }

      if (adminFlags.bossCustomMsgWaiting) {
        adminFlags.bossCustomMsgWaiting = false;
        bossCustomEpicMessage = textMsg;
        await ctx.reply(`✅ *Mensaje de convocatoria actualizado.*`, { parse_mode: 'Markdown' });

        const census = await getBossCensus();
        const hpToUse = bossHpConfig || census.recommendedHp;
        const bossName = 'Bahamut, el Destructor Carmesí';

        let text = `📋 *Resumen de Convocatoria del Jefe Mundial*\n\n` +
                   `• *Coloso:* ${bossName}\n` +
                   `• *Salud Configurada:* ${hpToUse.toLocaleString()} HP\n` +
                   `• *Tiempo de Espera:* ${bossWaitMinutesConfig} minutos\n` +
                   `• *Duración de la Batalla:* ${bossDurationMinutesConfig} minutos\n\n` +
                   `📜 *Mensaje de Anuncio que se Enviará:*\n` +
                   `──────────────────────\n` +
                   `${bossCustomEpicMessage}\n` +
                   `──────────────────────\n\n` +
                   `¿Todo listo para convocar al Coloso?`;

        const buttons = [
          [Markup.button.callback('✅ Confirmar y Despertar al Coloso', 'adm_boss_launch_confirmed')],
          [Markup.button.callback('✏️ Editar Mensaje Épico', 'adm_boss_edit_msg')],
          [Markup.button.callback('🔄 Restaurar Mensaje por Defecto', 'adm_boss_reset_msg')],
          [Markup.button.callback('⬅️ Volver a Ajustar Parámetros', 'adm_boss_panel')]
        ];

        await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        return true;
      }

      return false;
    }
  };
}

module.exports = {
  registerBossHandlers
};
