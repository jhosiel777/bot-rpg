// handlers/dungeonHandler.js
const { Markup } = require('telegraf');
const DUNGEONS = require('../dungeons');
const { PlayerBounty, getTodayUtcString } = require('../bountyModel');
const { safeAnswerCb, safeEditMessage, formatHoursMinutes } = require('../utils/telegramUtils');

function rollDungeonDrops(dungeon, player, recordDrop) {
  if (!dungeon.drops) return '';
  const luckBonus = (player.luck || 0) * 0.0005;
  const obtained = [];

  if (dungeon.drops.energyChance > 0 && Math.random() < (dungeon.drops.energyChance + luckBonus)) {
    player.potionsEnergy = (player.potionsEnergy || 0) + 1;
    recordDrop('energy');
    obtained.push('⚡ Elixir de Energía');
  }

  if (dungeon.drops.mediumHpChance > 0 && Math.random() < (dungeon.drops.mediumHpChance + luckBonus)) {
    player.potionsMedium = (player.potionsMedium || 0) + 1;
    recordDrop('medium');
    obtained.push('🧪 Poción Mayor de Vida');
  }

  if (dungeon.drops.smallHpChance > 0 && Math.random() < (dungeon.drops.smallHpChance + luckBonus)) {
    player.potionsSmall = (player.potionsSmall || 0) + 1;
    recordDrop('small');
    obtained.push('🧪 Poción Menor de Vida');
  }

  return obtained.length > 0 ? `\n🎁 *¡Botín extra hallado!* Recibiste: ${obtained.join(', ')}` : '';
}

function resolveExpeditionCombat(p, dungeon, recordDrop) {
  p.onMissionUntil = 0;
  p.currentDungeonKey = null;
  p.potionsUsedInMission = 0;

  const luckVal = p.luck || 0;
  const agiVal = p.agility || 0;
  const strVal = p.strength || 0;

  // ==========================================
  // RESOLUCIÓN EXCLUSIVA: YACIMIENTO DE KHAZUR
  // ==========================================
  if (dungeon.id === 'yacimiento_khazur') {
    const hasPickaxe = p.equipment && p.equipment.weapon === 'pickaxe_khazur';

    // Selección aleatoria ponderada de golem
    const rollGolem = Math.random();
    let enemy = dungeon.enemies[0]; // Autómata Rocoso (50%)
    if (rollGolem >= 0.50 && rollGolem < 0.85) {
      enemy = dungeon.enemies[1]; // Guardián Rúnico (35%)
    } else if (rollGolem >= 0.85) {
      enemy = dungeon.enemies[2]; // Coloso Protector Ancestral (15%)
    }

    let trapMsg = '';
    // Trampas activas en el yacimiento (35% de probabilidad)
    if (Math.random() < 0.35) {
      const dodgeTrapChance = Math.min(0.50, 0.15 + (agiVal * 0.0035));
      if (Math.random() < dodgeTrapChance) {
        trapMsg = `🤸 ¡Tus reflejos de Agilidad te permitieron esquivar una trampa rúnica en la cantera!\n\n`;
      } else {
        const rawTrapDmg = Math.floor(Math.random() * 16) + 10;
        const strMitigationRatio = (strVal / (strVal + 60)) * 0.25;
        const finalTrapDmg = Math.max(5, Math.round(rawTrapDmg * (1 - strMitigationRatio)));
        p.hp = Math.max(0, p.hp - finalTrapDmg);
        trapMsg = `⚠️ ¡Activaste una trampa ancestral de estacas y perdiste ${finalTrapDmg} HP!\n\n`;
      }
    }

    if (p.hp <= 0) {
      const lostExp = p.applyDeathPenalty();
      p.knockedOutUntil = Date.now() + 2 * 60 * 60 * 1000;
      return `${trapMsg}💀 Las trampas del yacimiento fueron demoledoras y caíste inconsciente antes de alcanzar las vetas.\n` +
             `⏳ Espera 2 horas para despertar o usa pociones para reponerte.\n` +
             `⚠️ Perdiste ${lostExp} de EXP acumulada.`;
    }

    // Comportamiento reactivo de asaltos
    let hitsCount = 3;
    let fourthHitActivated = false;

    // Si tiene el pico equipado, 40% de probabilidad de desatar un 4.º golpe adicional
    if (hasPickaxe && Math.random() < 0.40) {
      hitsCount = 4;
      fourthHitActivated = true;
    }

    let rawCombatDmg = 0;
    let dodgedHits = 0;

    for (let i = 0; i < hitsCount; i++) {
      // Esquiva parcial por golpe: nunca puede esquivar el 100% de la ráfaga
      const dodgeChance = Math.min(0.30, agiVal * 0.0025);
      if (Math.random() < dodgeChance && dodgedHits < (hitsCount - 1)) {
        dodgedHits++;
      } else {
        rawCombatDmg += Math.floor(Math.random() * (enemy.maxDmg - enemy.minDmg + 1)) + enemy.minDmg;
      }
    }

    // Mitigación por Fuerza (hasta un 25%)
    const strMitigationRatio = Math.min(0.25, (strVal / 100) * 0.25);
    let mitigatedCombatDmg = Math.round(rawCombatDmg * (1 - strMitigationRatio));

    // Suerte: Golpe crítico afortunado
    const critChance = Math.min(0.25, 0.05 + (luckVal * 0.002));
    let isCrit = false;
    let critMsg = '';

    if (rawCombatDmg > 0 && Math.random() < critChance) {
      isCrit = true;
      mitigatedCombatDmg = Math.round(mitigatedCombatDmg * 0.70);
      critMsg = `✨ ¡Asestaste un *Golpe Crítico Afortunado*! Desestabilizaste los núcleos rúnicos del golem (+20% EXP).\n`;
    }

    const totalCombatDmg = Math.max(15, mitigatedCombatDmg);
    p.hp = Math.max(0, p.hp - totalCombatDmg);

    if (p.hp === 0) {
      const lostExp = p.applyDeathPenalty();
      p.knockedOutUntil = Date.now() + 2 * 60 * 60 * 1000;

      return `${trapMsg}⛏️ *Yacimiento Olvidado de Khazur:*\n\n` +
             `Fuiste pulverizado por la embestida de un *${enemy.name}*.\n` +
             `💥 Daño total recibido: *${totalCombatDmg} HP* (${hitsCount} asaltos)` + (dodgedHits > 0 ? ` [Esquivaste ${dodgedHits}]` : '') + `\n` +
             (fourthHitActivated ? `⚠️ _¡El Coloso detectó la vibración del Pico de Khazur y ejecutó un 4.º asalto extra!_\n` : '') +
             `💀 ¡Has quedado inconsciente!\n` +
             `⏳ No podrás explorar durante las próximas 2 horas.\n` +
             `⚠️ Perdiste ${lostExp} de EXP acumulada.\n` +
             `No pudiste asegurar ningún mineral en tu huida.`;
    }

    // Cálculo de recompensas por victoria
    const baseGold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
    const maxStrBonus = Math.floor(enemy.maxGold * 0.5);
    const strBonus = Math.min(strVal, maxStrBonus);
    const goldGained = baseGold + strBonus;

    let expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;
    if (isCrit) expGained = Math.round(expGained * 1.20);

    p.gold = (p.gold || 0) + goldGained;
    const leveledUp = p.addExp(expGained);
    const dropMsg = rollDungeonDrops(dungeon, p, recordDrop);

    // Sistema de Minería (Exclusivo con Pico de Khazur)
    let miningMsg = '';
    if (hasPickaxe) {
      const colosoBonus = enemy.isColoso ? 0.05 : 0.0;
      // Hierro: 15% base hasta 25% con suerte al máximo (+5% bono de coloso)
      const ironChance = 0.15 + Math.min(0.10, (luckVal / 100) * 0.10) + colosoBonus;
      // Hierro Ancestral: 5% base hasta 15% con suerte al máximo (+5% bono de coloso)
      const ancestralChance = 0.05 + Math.min(0.10, (luckVal / 100) * 0.10) + colosoBonus;

      const minedItems = [];
      if (Math.random() < ironChance) {
        p.ironOre = (p.ironOre || 0) + 1;
        minedItems.push('🪨 +1 Mena de Hierro');
      }
      if (Math.random() < ancestralChance) {
        p.ancestralIronOre = (p.ancestralIronOre || 0) + 1;
        minedItems.push('✨ +1 Mena de Hierro Ancestral');
      }

      if (minedItems.length > 0) {
        miningMsg = `\n\n⛏️ *Extracción Minera con éxito:*\n${minedItems.join('\n')}`;
      } else {
        miningMsg = `\n\n⛏️ _Picaste las rocas pero no lograste desprender ninguna mena valiosa esta vez._`;
      }
    } else {
      miningMsg = `\n\n💡 _No llevabas el Pico de Khazur equipado. No pudiste extraer minerales de las vetas._`;
    }

    return `${trapMsg}⛏️ *Yacimiento Olvidado de Khazur:*\n\n` +
           critMsg +
           `Destruiste al autómata: *${enemy.name}*.\n` +
           `💥 Daño recibido: *${totalCombatDmg} HP* (${hitsCount} asaltos)` + (dodgedHits > 0 ? ` [Esquivaste ${dodgedHits}]` : '') + `\n` +
           (fourthHitActivated ? `⚠️ _¡El Coloso reaccionó a tu pico y lanzó un 4.º asalto con furia!_\n` : '') +
           `❤️ Salud restante: ${p.hp}/${p.maxHp} HP\n` +
           `💰 Oro: +${goldGained} (Bono Fuerza: +${strBonus})\n` +
           `🔮 EXP: +${expGained}` +
           dropMsg +
           miningMsg +
           (leveledUp ? `\n\n🎉 *¡SUBISTE DE NIVEL!* Pasaste a Nivel ${p.level}. ¡Salud y Energía restauradas al 100%!` : '');
  }

  // ==========================================
  // RESOLUCIÓN: MAZMORRAS DE CERCANÍAS (BOSQUE, CRIPTA, DRAGÓN)
  // ==========================================
  const enemy = dungeon.enemies[Math.floor(Math.random() * dungeon.enemies.length)];
  const roll = Math.random();

  const peacefulChance = Math.min(0.30, 0.10 + (luckVal * 0.002));
  const maxStrBonus = Math.floor(enemy.maxGold * 0.5);
  const strBonus = Math.min(strVal, maxStrBonus);

  let resultMsg = '';

  if (roll < peacefulChance) {
    const baseGold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
    const bonusGold = baseGold + strBonus;
    const expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;
    p.gold = (p.gold || 0) + bonusGold;
    const leveledUp = p.addExp(expGained);
    const dropMsg = rollDungeonDrops(dungeon, p, recordDrop);

    resultMsg = `📦 ¡Expedición finalizada en ${dungeon.name}!\n\n` +
                `🍀 ¡Tu suerte te permitió sortear peligros y hallar un tesoro pacíficamente!\n` +
                `💰 Oro: +${bonusGold} (Bono Fuerza: +${strBonus})\n` +
                `🔮 EXP: +${expGained}` + dropMsg +
                (leveledUp ? `\n\n🎉 *¡SUBISTE DE NIVEL!* Pasaste a Nivel ${p.level}. ¡Salud y Energía restauradas al 100%!` : '');
  } else {
    let trapMsg = '';
    if (dungeon.hasTraps && Math.random() < 0.20) {
      const dodgeTrapChance = Math.min(0.60, 0.15 + (agiVal * 0.0045));
      if (Math.random() < dodgeTrapChance) {
        trapMsg = `🤸 ¡Tus reflejos de Agilidad te permitieron esquivar una trampa mortal en el camino!\n\n`;
      } else {
        const trapDmg = Math.floor(Math.random() * 8) + 5;
        p.hp = Math.max(0, p.hp - trapDmg);
        trapMsg = `⚠️ ¡Pisaste una trampa de pinchos y perdiste ${trapDmg} HP antes del combate!\n\n`;
      }
    }

    if (p.hp > 0) {
      const hitsCount = enemy.hits || 1;
      let rawCombatDmg = 0;
      let dodgedHits = 0;

      for (let i = 0; i < hitsCount; i++) {
        const dodgeChance = Math.min(0.35, agiVal * 0.003);
        if (Math.random() < dodgeChance) {
          dodgedHits++;
        } else {
          rawCombatDmg += Math.floor(Math.random() * (enemy.maxDmg - enemy.minDmg + 1)) + enemy.minDmg;
        }
      }

      const strMitigationRatio = (strVal / (strVal + 60)) * 0.40;
      let mitigatedCombatDmg = Math.round(rawCombatDmg * (1 - strMitigationRatio));

      const critChance = Math.min(0.25, 0.05 + (luckVal * 0.002));
      let isCrit = false;
      let critMsg = '';

      if (rawCombatDmg > 0 && Math.random() < critChance) {
        isCrit = true;
        mitigatedCombatDmg = Math.round(mitigatedCombatDmg * 0.65);
        critMsg = `✨ ¡Asestaste un *Golpe Crítico Afortunado*! Redujiste el ataque enemigo y ganaste +20% EXP.\n`;
      }

      const totalCombatDmg = Math.max(rawCombatDmg > 0 ? 1 : 0, mitigatedCombatDmg);
      p.hp = Math.max(0, p.hp - totalCombatDmg);

      const baseGold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
      const goldGained = baseGold + strBonus;

      let expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;
      if (isCrit) expGained = Math.round(expGained * 1.20);

      if (p.hp === 0) {
        const lostExp = p.applyDeathPenalty();
        p.knockedOutUntil = Date.now() + 2 * 60 * 60 * 1000;

        resultMsg = `${trapMsg}⚔️ Encuentro en ${dungeon.name}:\n\n` +
                    `Fuiste derrotado por un ${enemy.name}.\n` +
                    `💥 Daño de combate: ${totalCombatDmg}${dodgedHits > 0 ? ` (Esquivaste \${dodgedHits} golpe/s)` : ''}\n` +
                    `💀 ¡Has quedado inconsciente!\n` +
                    `⏳ No podrás explorar durante las próximas 2 horas.\n` +
                    `⚠️ Perdiste ${lostExp} de EXP acumulada.\n` +
                    `Descansa en el campamento o usa pociones para reponerte.`;
      } else {
        p.gold = (p.gold || 0) + goldGained;
        const leveledUp = p.addExp(expGained);
        const dropMsg = rollDungeonDrops(dungeon, p, recordDrop);

        resultMsg = `${trapMsg}⚔️ Encuentro en ${dungeon.name}:\n\n` +
                    critMsg +
                    `Derrotaste a un ${enemy.name}.\n` +
                    (hitsCount > 1 ? `💥 Daño recibido en ${hitsCount} asaltos: ${totalCombatDmg} (Esquivaste ${dodgedHits})\n` : `💥 Daño recibido: ${totalCombatDmg}\n`) +
                    `❤️ Salud: ${p.hp}/${p.maxHp}\n` +
                    `💰 Oro: +${goldGained} (Bono Fuerza: +${strBonus})\n` +
                    `🔮 EXP: +${expGained}` + dropMsg +
                    (leveledUp ? `\n\n🎉 *¡SUBISTE DE NIVEL!* Pasaste a Nivel ${p.level}. ¡Salud y Energía restauradas al 100%!` : '');
      }
    } else {
      const lostExp = p.applyDeathPenalty();
      p.knockedOutUntil = Date.now() + 2 * 60 * 60 * 1000;
      resultMsg = `${trapMsg}💀 La trampa fue mortal y caíste inconsciente antes de combatir.\n` +
                  `⏳ Espera 2 horas para recuperarte o usa pociones.\n` +
                  `⚠️ Perdiste ${lostExp} de EXP acumulada.`;
    }
  }

  return resultMsg;
}

function registerDungeonHandlers(bot, deps) {
  const { Player, getPlayer, recordDrop, creditReferralBonus, lastUserMessages } = deps;

  // Menú de Mazmorras: Cercanías del Reino
  bot.action('menu_dungeons', async (ctx) => {
    await safeAnswerCb(ctx);
    const text = '🌲 *CERCANÍAS DEL REINO: RUTAS Y MAZMORRAS*\n\n' +
                 'Senderos patrullados dentro del territorio de la ciudadela:\n\n' +
                 '• 🌲 *Bosque Umbrío (Fácil)* — Coste: 1 ⚡ | Viaje: 10s\n' +
                 '• 🪦 *Cripta Abandonada (Medio)* — Coste: 2 ⚡ | Viaje: 20s (Trampas activas)\n' +
                 '• 🌋 *Guarida del Dragón (Difícil)* — Coste: 3 ⚡ | Viaje: 35s (Ataques triples + Trampas)\n\n' +
                 '⚠️ _Si tu vida cae a 0, quedarás inconsciente durante 2 horas._';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🌲 Explorar Bosque (10s)', 'go_bosque')],
      [Markup.button.callback('🪦 Explorar Cripta (20s)', 'go_cripta')],
      [Markup.button.callback('🌋 Explorar Dragón (35s)', 'go_dragon')],
      [Markup.button.callback('🗺️ Explorar Fronteras ➡️', 'menu_borders')],
      [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  // Menú de Mazmorras: Fronteras del Reino
  bot.action('menu_borders', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = '🗺️ *FRONTERAS DEL REINO DE ABYSS* 🗺️\n\n' +
               'Más allá de las empalizadas de la ciudadela se extienden territorios peligrosos y olvidados, custodiados por la guardia real.\n\n' +
               '• *Permiso Fronterizo:* ' + (player.hasBorderPermit ? '✅ Autorizado' : '❌ Requerido (Herrería Real)') + '\n\n' +
               'Selecciona un territorio a explorar:';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⛏️ Yacimiento Olvidado de Khazur (2m)', 'go_khazur')],
      [Markup.button.callback('🔒 ??? (Próximamente)', 'border_locked')],
      [Markup.button.callback('🔒 ??? (Próximamente)', 'border_locked')],
      [Markup.button.callback('⬅️ Volver a Cercanías del Reino', 'menu_dungeons')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action('border_locked', async (ctx) => {
    return await safeAnswerCb(ctx, 'Territorio inexplorado. Se habilitará en próximas expansiones.', true);
  });

  async function startExpedition(ctx, dungeonKey) {
    const userId = ctx.from.id;
    try {
      const todayUtc = getTodayUtcString();
      const bounty = await PlayerBounty.findOne({ userId, bountyDateUtc: todayUtc });

      if (bounty && (bounty.status === 'traveling' || bounty.status === 'arrived')) {
        return await safeAnswerCb(ctx, '🧭 Ya estás en las tierras salvajes tras la pista de tu presa diaria.', true);
      }

      const player = await getPlayer(userId, ctx.from.first_name);
      const dungeon = DUNGEONS[dungeonKey];

      if (!dungeon) {
        return await safeAnswerCb(ctx, '⚠️ Destino no encontrado.', true);
      }

      // Validación de Permiso para zonas de frontera
      if (dungeon.requiresPermit && !player.hasBorderPermit) {
        return await safeAnswerCb(ctx, '⛔ La guardia real bloquea el paso: requieres el Permiso de Exploración de la Herrería Real.', true);
      }

      if (player.knockedOutUntil && Date.now() < player.knockedOutUntil) {
        const remainingSec = Math.ceil((player.knockedOutUntil - Date.now()) / 1000);
        return await safeAnswerCb(ctx, `💀 Sigues inconsciente. Espera ${formatHoursMinutes(remainingSec)}.`, true);
      }

      if (Date.now() < player.onMissionUntil) {
        const remaining = Math.ceil((player.onMissionUntil - Date.now()) / 1000);
        return await safeAnswerCb(ctx, `Ya estás en camino. Faltan ${remaining}s.`, true);
      }

      if (player.hp <= 0) {
        return await safeAnswerCb(ctx, '💀 Estás sin salud. Descansa o usa una poción.', true);
      }

      if (player.energy < dungeon.cost) {
        return await safeAnswerCb(ctx, `⚡ Necesitas ${dungeon.cost} de energía.`, true);
      }

      player.energy -= dungeon.cost;
      player.onMissionUntil = Date.now() + (dungeon.travelSec * 1000);
      player.currentDungeonKey = dungeonKey;
      player.potionsUsedInMission = 0;
      await player.save();
      await safeAnswerCb(ctx);

      const departText = `🚶 *Marchando hacia:* ${dungeon.name}\n\n` +
                         `⏳ Llegarás en *${dungeon.travelSec} segundos*.\nEl bot te enviará una crónica cuando ocurra el encuentro.`;

      await safeEditMessage(ctx, departText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('🔄 Ver Estado', 'status')]])
      });

      setTimeout(async () => {
        try {
          const p = await Player.findOne({ userId });
          if (p && p.onMissionUntil > 0 && Date.now() >= p.onMissionUntil) {
            const activeKey = p.currentDungeonKey || dungeonKey;
            const targetDungeon = DUNGEONS[activeKey] || dungeon;

            const initialGold = p.gold || 0;
            const resultMsg = resolveExpeditionCombat(p, targetDungeon, recordDrop);
            const netGoldGained = Math.max(0, (p.gold || 0) - initialGold);

            await p.save();

            if (netGoldGained > 0) {
              await creditReferralBonus(userId, netGoldGained, 'direct');
            }

            const returnButtons = targetDungeon.isBorder
              ? [
                  [Markup.button.callback('⛏️ Explorar Fronteras de Nuevo', 'menu_borders')],
                  [Markup.button.callback('🏕️ Ir al Campamento', 'status')]
                ]
              : [
                  [Markup.button.callback('🌲 Ir a Mazmorras', 'menu_dungeons')],
                  [Markup.button.callback('🏕️ Ir al Campamento', 'status')]
                ];

            const sent = await ctx.telegram.sendMessage(
              userId,
              resultMsg,
              {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(returnButtons)
              }
            );
            lastUserMessages.set(userId, sent.message_id);
          }
        } catch (err) {
          console.error('Error al resolver expedición:', err);
        }
      }, dungeon.travelSec * 1000);

    } catch (err) {
      console.error('Error al iniciar expedición:', err);
    }
  }

  bot.action('go_bosque', (ctx) => startExpedition(ctx, 'bosque'));
  bot.action('go_cripta', (ctx) => startExpedition(ctx, 'cripta'));
  bot.action('go_dragon', (ctx) => startExpedition(ctx, 'dragon'));
  bot.action('go_khazur', (ctx) => startExpedition(ctx, 'yacimiento_khazur'));
}

module.exports = {
  registerDungeonHandlers,
  resolveExpeditionCombat
};
