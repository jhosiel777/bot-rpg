// utils/schedulers.js
const { WorldBoss } = require('../bossModel');
const { Player } = require('../playerModel');
const DUNGEONS = require('../dungeons');
const { resolveExpeditionCombat } = require('../handlers/dungeonHandler');
const { broadcastToAll } = require('./telegramUtils');

function startBackgroundSchedulers(bot, deps) {
  const { evaluateDynamicPrice, recordDrop, creditReferralBonus, lastUserMessages } = deps;

  // 1. Ciclo de mercado 4h UTC
  function scheduleNextUtcCycle() {
    const now = new Date();
    const currentHour = now.getUTCHours();
    const nextCycleHour = Math.floor(currentHour / 4) * 4 + 4;

    const target = new Date(now);
    target.setUTCHours(nextCycleHour, 0, 0, 0);
    const delayMs = target.getTime() - now.getTime();

    setTimeout(async () => {
      try {
        const cycleEnd = new Date();
        const cycleStart = new Date(cycleEnd.getTime() - 4 * 60 * 60 * 1000);
        await evaluateDynamicPrice(cycleStart, cycleEnd);
      } catch (err) {
        console.error('Error en ciclo dinámico 4h:', err.message);
      }
      scheduleNextUtcCycle();
    }, delayMs);
  }
  scheduleNextUtcCycle();

  // 2. Scheduler de Jefe Mundial (cada 15s)
  setInterval(async () => {
    try {
      const boss = await WorldBoss.findOne();
      if (!boss) return;
      const now = Date.now();

      if (boss.status === 'scheduled' && boss.battleStartsAt) {
        const msUntilStart = new Date(boss.battleStartsAt).getTime() - now;

        if (msUntilStart <= 5 * 60 * 1000 && msUntilStart > 0 && !boss.alert5MinSent) {
          boss.alert5MinSent = true;
          await boss.save();

          const alertMsg = '⚠️ *¡ALERTA MÁXIMA EN EL REINO!*\n\n' +
                           'Faltan *5 minutos* para la llegada del Coloso ancestral.\n\n' +
                           '• Nombre: *' + boss.name + '*\n' +
                           '• Salud Total: *' + boss.maxHp.toLocaleString() + ' HP*\n' +
                           '• Límite de Combate: *' + (boss.battleDurationMinutes || 90) + ' min*';
          await broadcastToAll(bot, Player, alertMsg);
        }

        if (msUntilStart <= 0) {
          boss.status = 'active';
          const duration = boss.battleDurationMinutes || 90;
          boss.battleEndsAt = new Date(now + duration * 60 * 1000);
          await boss.save();

          const startMsg = '🐲 *¡EL JEFE MUNDIAL HA DESPERTADO!*\n\n' +
                           '*' + boss.name + '* ruge desatando el caos.\n' +
                           '❤️ Salud: *' + boss.currentHp + '/' + boss.maxHp + ' HP*\n' +
                           '⏳ Tiempo límite: *' + duration + ' min*';
          await broadcastToAll(bot, Player, startMsg);
        }
      }

      if (boss.status === 'active' && boss.battleEndsAt && now > new Date(boss.battleEndsAt).getTime()) {
        boss.status = 'escaped';
        await boss.save();
        await broadcastToAll(bot, Player, '💨 *El Jefe Mundial ha escapado...* Regresó a su guarida subterránea.');
      }
    } catch (err) {
      console.error('Error en scheduler de Jefe Mundial:', err.message);
    }
  }, 15000);

  // 3. Verificador persistente de expediciones vencidas tras reinicios (cada 10s)
  setInterval(async () => {
    try {
      const finishedExpeditions = await Player.find({
        onMissionUntil: { $gt: 0, $lte: Date.now() }
      });

      for (const p of finishedExpeditions) {
        const dungeon = DUNGEONS.bosque; // Por defecto resolución segura
        const resultMsg = resolveExpeditionCombat(p, dungeon, recordDrop);
        await p.save();
        await creditReferralBonus(p.userId, p.gold);

        try {
          await bot.telegram.sendMessage(p.userId, resultMsg, { parse_mode: 'Markdown' });
        } catch (e) {}
      }
    } catch (e) {
      console.error('Error verificando expediciones persistentes:', e.message);
    }
  }, 10000);
}

module.exports = {
  startBackgroundSchedulers
};
