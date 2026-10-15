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
  const enemy = dungeon.enemies[Math.floor(Math.random() * dungeon.enemies.length)];
  const roll = Math.random();

  const luckVal = p.luck || 0;
  const agiVal = p.agility || 0;
  const strVal = p.strength || 0;

  const peacefulChance = Math.min(0.30, 0.10 + (luckVal * 0.002));
  const maxStrBonus = Math.floor(enemy.maxGold * 0.5);
  const strBonus = Math.min(strVal, maxStrBonus);

  let resultMsg = '';

  if (roll < peacefulChance) {
    const baseGold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
    const bonusGold = baseGold + strBonus;
    const expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;
    p.gold += bonusGold;
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
        p.gold += goldGained;
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

  bot.action('menu_dungeons', async (ctx) => {
    await safeAnswerCb(ctx);
    const text = `🗺️ Elige tu destino de exploración:\n\n` +
                 `💀 Si tu vida cae a 0 quedas noqueado por 2 horas:\n\n` +
                 `🌲 Bosque Umbrío (Fácil) — Cuesta 1 ⚡ — Viaje: 10s\n` +
                 `🪦 Cripta Abandonada (Medio) — Cuesta 2 ⚡ — Viaje: 20s (Trampas activas)\n` +
                 `🌋 Guarida del Dragón (Difícil) — Cuesta 3 ⚡ — Viaje: 35s (Ataques triples + Trampas)`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🌲 Explorar Bosque (10s)', 'go_bosque')],
      [Markup.button.callback('🪦 Explorar Cripta (20s)', 'go_cripta')],
      [Markup.button.callback('🌋 Explorar Dragón (35s)', 'go_dragon')],
      [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
    ]);

    return await safeEditMessage(ctx, text, keyboard);
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

      const departText = `🚶 Marchando hacia: ${dungeon.name}\n\n` +
                         `⏳ Llegarás en ${dungeon.travelSec} segundos. El bot te avisará cuando ocurra el encuentro.`;

      await safeEditMessage(ctx, departText, Markup.inlineKeyboard([[Markup.button.callback('🔄 Ver Estado', 'status')]]));

      setTimeout(async () => {
        try {
          const p = await Player.findOne({ userId });
          if (p && p.onMissionUntil > 0 && Date.now() >= p.onMissionUntil) {
            const activeKey = p.currentDungeonKey || dungeonKey;
            const targetDungeon = DUNGEONS[activeKey] || dungeon;

            const resultMsg = resolveExpeditionCombat(p, targetDungeon, recordDrop);
            await p.save();
            await creditReferralBonus(userId, p.gold);

            const sent = await ctx.telegram.sendMessage(
              userId,
              resultMsg,
              Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]])
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
}

module.exports = {
  registerDungeonHandlers,
  resolveExpeditionCombat
};
