// handlers/bossHandler.js
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

const BOSS_CATALOG = {
  coloso: {
    id: 'coloso',
    name: 'Coloso Protector Ancestral',
    title: '🗿 Coloso Protector Ancestral',
    damageType: 'Físico',
    resistanceType: 'none',
    minDmg: 50,
    maxDmg: 75,
    desc: 'Titán de roca rúnica con asaltos pesados estándar.'
  },
  malakor: {
    id: 'malakor',
    name: 'Malakor, el Hereje de las Sombras',
    title: '🧙‍♂️ Malakor, el Hereje de las Sombras',
    damageType: 'Mágico',
    resistanceType: 'magical',
    minDmg: 35,
    maxDmg: 55, // 2 golpes fijos -> hasta 110 base + críticos (+40%)
    attacksPerTurn: 2,
    critChance: 0.22,
    critMultiplier: 1.40,
    desc: 'Mago oscuro (2 asaltos fijos, máx 110 daño base, 22% crítico +40%, resistencia mágica).'
  },
  vaelgathar: {
    id: 'vaelgathar',
    name: 'Vaelgathar, Señor de las Cenizas',
    title: '🐲 Vaelgathar, Señor de las Cenizas',
    damageType: 'Físico',
    resistanceType: 'physical',
    minDmg: 35,
    maxDmg: 55, // 2 a 4 asaltos -> hasta 220 conectando los 4
    desc: 'Dragón volcánico colosal (2 a 4 asaltos brutales, máx 220 daño acumulado, resistencia física).'
  }
};

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

  let selectedBossType = 'coloso';
  let bossWaitMinutesConfig = 30;
  let bossDurationMinutesConfig = 90;
  let bossHpConfig = null;
  let bossCustomEpicMessage = null;

  function getDefaultEpicMessage(bossType, bossName, waitMinutes, hp, durationMin) {
    let narrative = '';
    if (bossType === 'malakor') {
      narrative = 'Un manto espectral bloquea el sol y las almas del abismo susurran perdición. El gran hechicero oscuro *' + bossName + '* ha emergido de las sombras empuñando magia prohibida.\n\n';
    } else if (bossType === 'vaelgathar') {
      narrative = 'Ríos de lava viva brotan de las fallas terrestres y un rugido ensordecedor resquebraja las montañas. El dragón milenario *' + bossName + '* desciende envuelto en llamas eternas.\n\n';
    } else {
      narrative = 'El firmamento se tiñe de carmesí y los cimientos de la tierra se quiebran bajo nuestros pies. Las antiguas leyendas no mentían: *' + bossName + '* está abriendo los ojos tras milenios de letargo.\n\n';
    }

    return '⚡🌋 *¡UNA CATÁSTROFE ANCESTRAL SE AVECINA!*\n\n' +
           narrative +
           '⏳ *Tiempo para su despertar:* ' + waitMinutes + ' minutos\n' +
           '⏱️ *Duración del asalto:* ' + durationMin + ' minutos de combate\n' +
           '❤️ *Vitalidad del Jefe:* ' + hp.toLocaleString() + ' HP\n' +
           '⚔️ *Requisito de entrada:* Nivel 5 o superior\n\n' +
           '_¡Reúnan sus armas, forjen sus estrategias y preparen sus pociones! La supervivencia del reino depende de todos._';
  }

  async function getBossCensus() {
    const aptPlayers = await Player.find({ level: { $gte: 5 }, isVerified: true });
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

    return {
      totalAptos,
      activeCount,
      avgMaxHp,
      avgStr,
      avgLvl,
      recommendedHp
    };
  }

  async function renderAdminBossPanel(ctx) {
    const boss = await getWorldBoss();
    const census = await getBossCensus();
    const currentBossData = BOSS_CATALOG[selectedBossType] || BOSS_CATALOG.coloso;
    const selectedHp = bossHpConfig || census.recommendedHp;

    let text = `🐲 *Panel de Convocatoria del Jefe Mundial*\n\n` +
               `Estado actual: *${boss.status.toUpperCase()}*\n`;

    if (boss.status === 'scheduled') {
      const minsLeft = Math.max(0, Math.ceil((new Date(boss.battleStartsAt).getTime() - Date.now()) / 60000));
      text += `⏳ Batalla programada: inicia en *${minsLeft} min*\n` +
              `👾 Jefe: *${boss.name}*\n` +
              `⏱️ Duración de batalla: *${boss.battleDurationMinutes || 90} min*\n` +
              `❤️ Salud programada: *${boss.maxHp.toLocaleString()} HP*\n\n`;
    } else if (boss.status === 'active') {
      text += `⚔️ *¡Batalla en curso!*\n` +
              `👾 Jefe: *${boss.name}*\n` +
              `❤️ Salud restante: *${boss.currentHp}/${boss.maxHp} HP*\n` +
              `👥 Participantes: *${boss.participants.length}*\n\n`;
    } else {
      text += `\n👾 *Jefe Seleccionado:* *${currentBossData.title}*\n` +
              `ℹ️ _${currentBossData.desc}_\n\n` +
              `📊 *Censo de Jugadores Aptos (Nivel 5+):*\n` +
              `• Jugadores: *${census.totalAptos}* | Salud Media: *${census.avgMaxHp} HP* | Fuerza Media: *${census.avgStr}*\n` +
              `• 💡 *Salud Recomendada:* *${census.recommendedHp.toLocaleString()} HP*\n\n` +
              `⚙️ *Parámetros Seleccionados:*\n` +
              `• ❤️ Salud: *${selectedHp.toLocaleString()} HP*` + (bossHpConfig === null ? ' _(Recomendada)_' : '') + `\n` +
              `• ⏳ Tiempo de espera: *${bossWaitMinutesConfig} minutos*\n` +
              `• ⏱️ Duración de combate: *${bossDurationMinutesConfig} minutos*\n` +
              `• 📜 Mensaje épico: ` + (bossCustomEpicMessage ? `*Personalizado*` : `_Por defecto_`) + `\n\n` +
              `Elige el Jefe, ajusta los valores y pulsa *"🚀 Revisar y Comenzar"*:`;
    }

    const buttons = [];

    if (boss.status === 'idle' || boss.status === 'defeated' || boss.status === 'escaped') {
      buttons.push([
        Markup.button.callback((selectedBossType === 'coloso' ? '✅ ' : '') + '🗿 Coloso', 'adm_boss_type_coloso'),
        Markup.button.callback((selectedBossType === 'malakor' ? '✅ ' : '') + '🧙‍♂️ Malakor', 'adm_boss_type_malakor'),
        Markup.button.callback((selectedBossType === 'vaelgathar' ? '✅ ' : '') + '🐲 Vaelgathar', 'adm_boss_type_vaelgathar')
      ]);

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
        Markup.button.callback('⏳ 60m', 'adm_boss_set_wait_60')
      ]);
      buttons.push([
        Markup.button.callback('⏱️ Combate: 60m', 'adm_boss_set_dur_60'),
        Markup.button.callback('⏱️ Combate: 90m', 'adm_boss_set_dur_90'),
        Markup.button.callback('⏱️ Combate: 120m', 'adm_boss_set_dur_120')
      ]);
    } else {
      buttons.push([Markup.button.callback('🛑 Cancelar / Forzar Retirada del Jefe', 'adm_boss_force_end')]);
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
    const bossData = BOSS_CATALOG[selectedBossType] || BOSS_CATALOG.coloso;
    const now = Date.now();
    const startsAt = new Date(now + waitMinutes * 60 * 1000);

    boss.status = 'scheduled';
    boss.bossType = bossData.id;
    boss.name = bossData.name;
    boss.level = census.avgLvl;
    boss.maxHp = hp;
    boss.currentHp = hp;
    boss.minDmg = bossData.minDmg;
    boss.maxDmg = bossData.maxDmg;
    boss.attacksPerTurn = bossData.attacksPerTurn || 1;
    boss.damageType = bossData.damageType;
    boss.resistanceType = bossData.resistanceType;
    boss.critChance = bossData.critChance || 0;
    boss.critMultiplier = bossData.critMultiplier || 1.0;

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
    await safeAnswerCb(ctx, `¡${boss.name} programado exitosamente!`);

    const announceMsg = bossCustomEpicMessage || getDefaultEpicMessage(boss.bossType, boss.name, waitMinutes, hp, durationMinutes);
    await broadcastToAll(bot, Player, announceMsg);

    bossCustomEpicMessage = null;
    bossHpConfig = null;

    return await safeEditMessage(
      ctx,
      `✅ *Jefe Mundial convocado exitosamente.*\n\n` +
      `• Jefe: *${boss.name}*\n` +
      `• Salud: *${hp.toLocaleString()} HP*\n` +
      `• Espera: *${waitMinutes} min*\n` +
      `• Duración de Combate: *${durationMinutes} min*\n` +
      `• Se transmitió el anuncio épico global al reino.`,
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

      const top3Ids = new Set([top1.userId, top2?.userId, top3?.userId].filter(Boolean));
      const dropsSummary = [];

      // Distinción honorífica de MVP
      if (top1) {
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
                `Por tu hazaña como máximo atacante (MVP) frente al Jefe Mundial, has obtenido: «*Verdugo de Titanes*».\n\n` +
                `_Puedes equipártelo en tu Hogar del Aventurero._`,
                { parse_mode: 'Markdown' }
              );
            } catch (e) {}
          }
        }
      }

      for (const p of parts) {
        const playerDoc = await Player.findOne({ userId: p.userId });
        if (!playerDoc) continue;

        const isTop3 = top3Ids.has(p.userId);
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

        playerDoc.gold = (playerDoc.gold || 0) + earnedGold;
        const leveledUp = playerDoc.addExp(earnedExp);

        // ==========================================
        // TABLAS DE BOTÍN SEGÚN EL TIPO DE JEFE
        // ==========================================
        const extraDrops = [];

        if (boss.bossType === 'malakor') {
          // Tela: 50% base | 70% Top 3
          const clothChance = isTop3 ? 0.70 : 0.50;
          if (Math.random() < clothChance) {
            playerDoc.cloth = (playerDoc.cloth || 0) + 1;
            extraDrops.push('🧵 1x Tela');
          }

          // Hilo Mágico: 20% base | 30% Top 3
          const threadChance = isTop3 ? 0.30 : 0.20;
          if (Math.random() < threadChance) {
            playerDoc.magicThread = (playerDoc.magicThread || 0) + 1;
            extraDrops.push('✨ 1x Hilo Mágico');
          }
        } else if (boss.bossType === 'vaelgathar') {
          // Escama de Dragón de Obsidiana: 25% base | 40% Top 3
          const scaleChance = isTop3 ? 0.40 : 0.25;
          if (Math.random() < scaleChance) {
            playerDoc.obsidianScale = (playerDoc.obsidianScale || 0) + 1;
            extraDrops.push('🖤 1x Escama de Dragón de Obsidiana');
          }

          // Esencia de Dragón: 5% base | 10% Top 3
          const essenceChance = isTop3 ? 0.10 : 0.05;
          if (Math.random() < essenceChance) {
            playerDoc.dragonEssence = (playerDoc.dragonEssence || 0) + 1;
            extraDrops.push('🔮 1x Esencia de Dragón');
          }
        } else {
          // Coloso Clásico: Elixir de Sangre de Dragón al Top 1 y Golpe de Gracia
          if (p.userId === top1.userId || p.userId === lastHitter.userId) {
            playerDoc.potionsDragonBlood = (playerDoc.potionsDragonBlood || 0) + 1;
            extraDrops.push('🩸 1x Elixir de Sangre de Dragón');
          }
        }

        if (extraDrops.length > 0) {
          dropsSummary.push(`• *${formatPlayerName(p.name)}:* ${extraDrops.join(', ')}`);
        }

        await playerDoc.save();
        await creditReferralBonus(p.userId, earnedGold);

        const individualMsg = `🏆 *¡Recompensas por vencer a: ${boss.name}!* \n\n` +
                              `• Tu daño aportado: *${p.totalDamage.toLocaleString()}*\n` +
                              `• Bolsa Global: *${baseGoldPool.toLocaleString()}g* | *${baseExpPool.toLocaleString()} EXP*\n` +
                              `💰 Oro ganado: *+${earnedGold.toLocaleString()}g*\n` +
                              `🔮 EXP ganada: *+${earnedExp.toLocaleString()}*\n` +
                              (extraDrops.length > 0 ? `🎁 *Materiales obtenidos:*\n${extraDrops.map(d => '  ' + d).join('\n')}\n` : '') +
                              (leveledUp ? `🎉 ¡Subiste a Nivel ${playerDoc.level}!` : '');

        try {
          await bot.telegram.sendMessage(p.userId, individualMsg, { parse_mode: 'Markdown' });
        } catch (e) {}
      }

      const publicMsg = `🎉 *¡${boss.name} HA SIDO ANIQUILADO!* 🏆\n\n` +
                        `📊 *Bolsa Total (Pool):* 💰 ${baseGoldPool.toLocaleString()}g | 🔮 ${baseExpPool.toLocaleString()} EXP\n\n` +
                        `🥇 *Top 1 en Daño (MVP):* ${formatPlayerName(top1.name)} (${top1.totalDamage.toLocaleString()} daño)\n` +
                        (top2 ? `🥈 *Top 2 en Daño:* ${formatPlayerName(top2.name)} (${top2.totalDamage.toLocaleString()} daño)\n` : '') +
                        (top3 ? `🥉 *Top 3 en Daño:* ${formatPlayerName(top3.name)} (${top3.totalDamage.toLocaleString()} daño)\n` : '') +
                        `⚡ *Primer Golpe:* ${firstHitter ? formatPlayerName(firstHitter.name) : 'N/A'}\n` +
                        `🗡️ *Golpe de Gracia:* ${formatPlayerName(lastHitter.name)}\n\n` +
                        `🎁 *Botín especial extraído:*\n` +
                        (dropsSummary.length > 0 ? dropsSummary.slice(0, 10).join('\n') : '_Nadie logró desprender materiales raros esta vez._');

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
      return await safeAnswerCb(ctx, 'Necesitas al menos 2 puntos de Energía para asaltar al Jefe.', true);
    }

    const sessionConfirmed = (confirmedBossWarning.get(userId) === String(boss._id));
    const isVulnerable = (player.hp <= (boss.bossType === 'vaelgathar' ? 120 : boss.maxDmg));

    if (isVulnerable && !confirmedWarning && !sessionConfirmed) {
      await safeAnswerCb(ctx);
      const warnText = `⚠️ *¡ADVERTENCIA DE COMBATE CRÍTICO!*\n\n` +
                       `Tu salud actual (*${player.hp} HP*) es baja frente al potencial destructivo de *${boss.name}*.\n\n` +
                       `Podrías caer inconsciente si encadena sus impactos más fuertes. Se recomienda curarte con pociones antes de continuar.\n\n` +
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

    // Daño del jugador
    const dañoBase = 20 + (str * 1.2) + Math.floor(Math.sqrt(str) * 3);
    const variation = (Math.random() * 0.40) - 0.20;
    let playerDmg = Math.round(dañoBase * (1 + variation));

    // Resistencia física del dragón Vaelgathar (-15% daño físico recibido)
    if (boss.resistanceType === 'physical') {
      playerDmg = Math.round(playerDmg * 0.85);
    }

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

    // ==========================================
    // CÁLCULO DEL ATAQUE DEL JEFE AL JUGADOR
    // ==========================================
    let attacksTaken = 1;
    let rawBossTotal = 0;
    let bossCritsLanded = 0;

    if (boss.bossType === 'malakor') {
      // 2 ataques fijos por turno
      attacksTaken = 2;
      for (let i = 0; i < 2; i++) {
        let hit = Math.floor(Math.random() * (55 - 35 + 1)) + 35; // Base máx 55 por golpe = 110 máx base
        if (Math.random() < 0.22) { // 22% de crítico
          bossCritsLanded++;
          hit = Math.round(hit * 1.40); // +40% daño crítico
        }
        rawBossTotal += hit;
      }
    } else if (boss.bossType === 'vaelgathar') {
      // De 2 a 4 ataques aleatorios
      attacksTaken = Math.floor(Math.random() * 3) + 2; // 2, 3 o 4
      for (let i = 0; i < attacksTaken; i++) {
        const hit = Math.floor(Math.random() * (55 - 35 + 1)) + 35; // 4 hits * 55 = 220 máx absoluto
        rawBossTotal += hit;
      }
    } else {
      // Coloso Clásico
      rawBossTotal = Math.floor(Math.random() * (boss.maxDmg - boss.minDmg + 1)) + boss.minDmg;
      if (boss.avgMaxHp >= 200 && Math.random() < 0.28) {
        attacksTaken = 2;
        rawBossTotal += Math.round(rawBossTotal * (Math.random() * 0.10 + 0.40));
      }
    }

    // Mitigación por Fuerza del jugador (hasta 40%)
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
                    `La acometida fue abrumadora. Espera 2h o usa un *Elixir de Sangre de Dragón*.\n` +
                    `⚠️ Perdiste ${lostExp} de EXP.`;
    }

    await player.save();
    await boss.save();
    await safeAnswerCb(ctx);

    const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;

    let combatReport = `⚔️ *Asalto contra ${boss.name}*\n\n` +
                       (isCrit ? `✨ *¡Golpe Crítico Devastador!* (1.4x)\n` : '') +
                       (boss.resistanceType === 'physical' ? `🛡️ _Las escamas de obsidiana del dragón absorbieron parte de tu daño._\n` : '') +
                       `💥 Daño infligido: *${playerDmg.toLocaleString()} puntos*\n\n` +
                       `🛡️ *Ataque recibido (${attacksTaken} asalto/s):*\n` +
                       (bossCritsLanded > 0 ? `⚡ _¡Malakor canalizó ${bossCritsLanded} impacto(s) crítico(s) arcano(s)! (+40%)_\n` : '') +
                       `• Daño original: ${rawBossTotal}\n` +
                       (grazed ? `🤸 ¡Impacto rozante de Agilidad! (-50%)\n` : '') +
                       `• Daño final recibido: *${finalDamageTaken} HP*\n` +
                       `❤️ Tu salud: *${player.hp}/${player.maxHp} HP*\n` +
                       `⚡ Tu energía: *${player.energy}/${playerMaxEnergy}*\n` +
                       `❤️ Salud del Jefe: *${boss.currentHp.toLocaleString()}/${boss.maxHp.toLocaleString()} HP*` +
                       knockOutMsg;

    if (isBossDefeated) {
      combatReport += `\n\n🎉 *¡${boss.name} HA SIDO DERROTADO!* ¡Repartiendo botín del reino...!`;
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

  // --- BOT ACTIONS DEL PANEL ADMIN ---

  bot.action('adm_boss_panel', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    return await renderAdminBossPanel(ctx);
  });

  // Selector de Tipo de Jefe
  bot.action(/adm_boss_type_(coloso|malakor|vaelgathar)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    selectedBossType = ctx.match[1];
    await safeAnswerCb(ctx, `Jefe seleccionado: ${BOSS_CATALOG[selectedBossType].name}`);
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
    await safeAnswerCb(ctx, `Duración fijada en ${bossDurationMinutesConfig} min.`);
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
                 `Escribe en el chat el valor numérico de salud (ej: 750, 3000 o 15000).\n\n` +
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
    const currentBoss = BOSS_CATALOG[selectedBossType] || BOSS_CATALOG.coloso;
    const previewMsg = bossCustomEpicMessage || getDefaultEpicMessage(currentBoss.id, currentBoss.name, bossWaitMinutesConfig, hpToUse, bossDurationMinutesConfig);

    let text = `📋 *Resumen de Convocatoria del Jefe Mundial*\n\n` +
               `• *Jefe a Despertar:* ${currentBoss.title}\n` +
               `• *Propiedad:* ${currentBoss.desc}\n` +
               `• *Salud Configurada:* ${hpToUse.toLocaleString()} HP\n` +
               `• *Tiempo de Espera:* ${bossWaitMinutesConfig} minutos\n` +
               `• *Duración del Combate:* ${bossDurationMinutesConfig} minutos\n\n` +
               `📜 *Mensaje de Anuncio que se transmitirá:*\n` +
               `──────────────────────\n` +
               `${previewMsg}\n` +
               `──────────────────────\n\n` +
               `¿Todo listo para convocar al Jefe?`;

    const buttons = [
      [Markup.button.callback('✅ Confirmar y Despertar al Jefe', 'adm_boss_launch_confirmed')],
      [Markup.button.callback('✏️ Editar Mensaje Épico', 'adm_boss_edit_msg')]
    ];

    if (bossCustomEpicMessage) {
      buttons.push([Markup.button.callback('🔄 Restaurar Mensaje por Defecto', 'adm_boss_reset_msg')]);
    }

    buttons.push([Markup.button.callback('⬅️ Volver a Ajustar Parámetros', 'adm_boss_panel')]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('adm_boss_edit_msg', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    adminFlags.bossCustomMsgWaiting = true;

    const text = `✏️ *Editar Mensaje de Convocatoria*\n\n` +
                 `Escribe a continuación en el chat el texto con el que proclamarás la llegada del Jefe a todos los aventureros.`;

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancelar', 'adm_boss_review')]])
    });
  });

  bot.action('adm_boss_reset_msg', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    bossCustomEpicMessage = null;
    await safeAnswerCb(ctx, 'Mensaje restablecido al predeterminado.');
    const census = await getBossCensus();
    const hpToUse = bossHpConfig || census.recommendedHp;
    const currentBoss = BOSS_CATALOG[selectedBossType] || BOSS_CATALOG.coloso;
    const previewMsg = getDefaultEpicMessage(currentBoss.id, currentBoss.name, bossWaitMinutesConfig, hpToUse, bossDurationMinutesConfig);

    let text = `📋 *Resumen de Convocatoria del Jefe Mundial*\n\n` +
               `• *Jefe a Despertar:* ${currentBoss.title}\n` +
               `• *Salud Configurada:* ${hpToUse.toLocaleString()} HP\n` +
               `• *Tiempo de Espera:* ${bossWaitMinutesConfig} minutos\n` +
               `• *Duración del Combate:* ${bossDurationMinutesConfig} minutos\n\n` +
               `📜 *Mensaje de Anuncio que se Enviará:*\n` +
               `──────────────────────\n` +
               `${previewMsg}\n` +
               `──────────────────────\n\n` +
               `¿Todo listo para convocar al Jefe?`;

    const buttons = [
      [Markup.button.callback('✅ Confirmar y Despertar al Jefe', 'adm_boss_launch_confirmed')],
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
      const retreatMsg = `💨 *La calma regresa a las tierras de Abyss...*\n\n` +
                         `La presencia de *${boss.name}* se ha disipado en los confines del reino. Están a salvo... por ahora.`;
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
      text += `⏳ El jefe está despertando. La batalla inicia en aproximadamente *${minsLeft} minutos*.\n\n` +
              `❤️ Salud prevista: *${boss.maxHp.toLocaleString()} HP*\n` +
              `⚔️ Daño estimado: *${boss.minDmg} - ${boss.maxDmg}* (${boss.damageType})\n` +
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
      const playerMaxEnergy = player.maxEnergy || MAX_ENERGY;

      text += `🔥 *¡EL JEFE ESTÁ EN COMBATE!*\n\n` +
              `❤️ Salud de ${boss.name}: *${boss.currentHp.toLocaleString()}/${boss.maxHp.toLocaleString()} HP* (${hpPct}%)\n` +
              `⏳ Tiempo restante: *${formatHoursMinutes(secLeft)}*\n` +
              `⚔️ Ataque: *${boss.minDmg} - ${boss.maxDmg}* (${boss.damageType})\n` +
              `💥 Tu daño aportado: *${myDmg.toLocaleString()} puntos*\n\n` +
              `❤️ Tu salud: *${player.hp}/${player.maxHp} HP*\n` +
              `⚡ Tu energía: *${player.energy}/${playerMaxEnergy}*\n\n` +
              `¿Deseas asestar un asalto?`;

      const buttons = [
        [Markup.button.callback('⚔️ Atacar al Jefe (2 ⚡)', 'boss_attack')],
        [Markup.button.callback('🎒 Mochila / Pociones', 'boss_inv')],
        [Markup.button.callback('🔄 Actualizar', 'menu_boss')],
        [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
      ];

      return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
    }

    text += `_Actualmente ningún jefe amenaza las tierras. El Creador anunciará la próxima convocatoria._`;
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
        const currentBoss = BOSS_CATALOG[selectedBossType] || BOSS_CATALOG.coloso;

        let text = `📋 *Resumen de Convocatoria del Jefe Mundial*\n\n` +
                   `• *Jefe:* ${currentBoss.title}\n` +
                   `• *Salud Configurada:* ${hpToUse.toLocaleString()} HP\n` +
                   `• *Tiempo de Espera:* ${bossWaitMinutesConfig} minutos\n` +
                   `• *Duración del Combate:* ${bossDurationMinutesConfig} minutos\n\n` +
                   `📜 *Mensaje de Anuncio que se Enviará:*\n` +
                   `──────────────────────\n` +
                   `${bossCustomEpicMessage}\n` +
                   `──────────────────────\n\n` +
                   `¿Todo listo para convocar al Jefe?`;

        const buttons = [
          [Markup.button.callback('✅ Confirmar y Despertar al Jefe', 'adm_boss_launch_confirmed')],
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
