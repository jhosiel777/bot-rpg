const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const startServer = require('./server');
const DUNGEONS = require('./dungeons');
const { Player, getPlayer, getRequiredExp, MAX_BASE_HP, MAX_ENERGY } = require('./playerModel');

// Iniciar servidor web para Render
startServer();

// Conectar base de datos
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Base de datos MongoDB conectada'))
  .catch((err) => console.error('❌ Error conectando a MongoDB:', err));

const bot = new Telegraf(process.env.BOT_TOKEN);

// Manejador global de errores para evitar que peticiones viejas o caídas de red tumben el proceso
bot.catch((err, ctx) => {
  console.error(`Error controlado en actualización (${ctx?.updateType}):`, err.message);
});

// Función auxiliar para responder botones evitando el error 400 de timeout
async function safeAnswerCb(ctx, text) {
  try {
    await ctx.answerCbQuery(text);
  } catch (err) {
    // Si la consulta expiró en Telegram, se ignora de forma segura
  }
}

function getStatusView(player) {
  const reqExp = getRequiredExp(player.level);

  let text = `⚔️ Aventurero: ${player.name}\n` +
             `⭐ Nivel: ${player.level}\n` +
             `🔮 EXP: ${player.exp}/${reqExp}\n` +
             `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
             `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n` +
             `💰 Oro: ${player.gold}\n\n`;

  if (player.statPoints > 0) {
    text += `✨ ¡Tienes ${player.statPoints} punto(s) de atributo sin asignar!\n\n`;
  }

  text += `¿Qué decides hacer?`;

  const buttons = [
    [Markup.button.callback('🗺️ Elegir Expedición', 'menu_dungeons')],
    [Markup.button.callback('🏕️ Descansar (+30% Salud)', 'rest')]
  ];

  if (player.statPoints > 0) {
    buttons.push([Markup.button.callback(`📈 Distribuir Puntos (${player.statPoints})`, 'menu_stats')]);
  }

  buttons.push([Markup.button.callback('🔄 Actualizar Estado', 'status')]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

bot.start(async (ctx) => {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const view = getStatusView(player);
    return await ctx.reply(view.text, view.keyboard);
  } catch (err) {
    console.error('Error en /start:', err);
  }
});

bot.action('status', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const view = getStatusView(player);
    return await ctx.editMessageText(view.text, view.keyboard);
  } catch (err) {
    console.error('Error en status:', err);
  }
});

bot.action('menu_stats', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    const text = `📈 Distribución de Atributos:\n\n` +
                 `Puntos Disponibles: ${player.statPoints}\n` +
                 `💪 Fuerza: ${player.strength} (Aumenta el botín y reduce daño recibido)\n` +
                 `❤️ Salud Máxima: ${player.maxHp}/${MAX_BASE_HP}\n\n` +
                 `Elige dónde asignar tus puntos:`;

    const buttons = [];
    if (player.statPoints > 0) {
      buttons.push([Markup.button.callback('💪 +1 Fuerza', 'add_str')]);
      if (player.maxHp < MAX_BASE_HP) {
        buttons.push([Markup.button.callback('❤️ +5 Salud Máxima', 'add_hp')]);
      }
    }
    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
  } catch (err) {
    console.error('Error en menu_stats:', err);
  }
});

bot.action('add_str', async (ctx) => {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (player.statPoints <= 0) {
      await safeAnswerCb(ctx, 'No tienes puntos disponibles.');
      return;
    }

    player.statPoints -= 1;
    player.strength += 1;
    await player.save();
    await safeAnswerCb(ctx, '+1 Fuerza asignado');

    const view = getStatusView(player);
    return await ctx.editMessageText(view.text, view.keyboard);
  } catch (err) {
    console.error('Error en add_str:', err);
  }
});

bot.action('add_hp', async (ctx) => {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (player.statPoints <= 0) {
      await safeAnswerCb(ctx, 'No tienes puntos disponibles.');
      return;
    }
    if (player.maxHp >= MAX_BASE_HP) {
      await safeAnswerCb(ctx, 'Ya alcanzaste el tope de 100 HP base.');
      return;
    }

    player.statPoints -= 1;
    player.maxHp = Math.min(MAX_BASE_HP, player.maxHp + 5);
    player.hp = Math.min(player.maxHp, player.hp + 5);
    await player.save();
    await safeAnswerCb(ctx, '+5 Salud Máxima asignado');

    const view = getStatusView(player);
    return await ctx.editMessageText(view.text, view.keyboard);
  } catch (err) {
    console.error('Error en add_hp:', err);
  }
});

bot.action('menu_dungeons', async (ctx) => {
  await safeAnswerCb(ctx);
  const text = `🗺️ Elige tu destino de exploración:\n\n` +
               `🌲 Bosque Umbrío (Fácil) — Cuesta 1 ⚡ — Viaje: 10s\n` +
               `🪦 Cripta Abandonada (Medio) — Cuesta 2 ⚡ — Viaje: 20s\n` +
               `🌋 Guarida del Dragón (Difícil) — Cuesta 3 ⚡ — Viaje: 35s`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🌲 Explorar Bosque (10s)', 'go_bosque')],
    [Markup.button.callback('🪦 Explorar Cripta (20s)', 'go_cripta')],
    [Markup.button.callback('🌋 Explorar Dragón (35s)', 'go_dragon')],
    [Markup.button.callback('⬅️ Volver', 'status')]
  ]);

  try {
    return await ctx.editMessageText(text, keyboard);
  } catch (err) {
    console.error('Error en menu_dungeons:', err);
  }
});

bot.action('rest', async (ctx) => {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (Date.now() < player.onMissionUntil) {
      await safeAnswerCb(ctx, 'Estás de viaje en una expedición.');
      return;
    }

    if (player.hp >= player.maxHp) {
      await safeAnswerCb(ctx, `Tu salud ya está al máximo (${player.maxHp} HP).`);
      return;
    }

    if (player.energy < 1) {
      await safeAnswerCb(ctx, '⚡ No tienes energía para descansar.');
      return;
    }

    const healAmount = Math.ceil(player.maxHp * 0.30);
    player.energy -= 1;
    player.hp = Math.min(player.maxHp, player.hp + healAmount);
    await player.save();
    await safeAnswerCb(ctx, `Descansaste y recuperaste ${healAmount} HP (+30%).`);

    const view = getStatusView(player);
    return await ctx.editMessageText(view.text, view.keyboard);
  } catch (err) {
    console.error('Error en rest:', err);
  }
});

async function startExpedition(ctx, dungeonKey) {
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const dungeon = DUNGEONS[dungeonKey];

    if (Date.now() < player.onMissionUntil) {
      const remaining = Math.ceil((player.onMissionUntil - Date.now()) / 1000);
      await safeAnswerCb(ctx, `Ya estás en camino. Faltan ${remaining}s.`);
      return;
    }

    if (player.hp <= 0) {
      await safeAnswerCb(ctx, '💀 Estás sin salud. Descansa en el campamento.');
      return;
    }

    if (player.energy < dungeon.cost) {
      await safeAnswerCb(ctx, `⚡ Necesitas ${dungeon.cost} de energía.`);
      return;
    }

    player.energy -= dungeon.cost;
    player.onMissionUntil = Date.now() + (dungeon.travelSec * 1000);
    await player.save();
    await safeAnswerCb(ctx);

    const departText = `🚶 Marchando hacia: ${dungeon.name}\n\n` +
                       `⏳ Llegarás en ${dungeon.travelSec} segundos. El bot te avisará cuando ocurra el encuentro.`;

    await ctx.editMessageText(departText, Markup.inlineKeyboard([[Markup.button.callback('🔄 Ver Estado', 'status')]]));

    setTimeout(async () => {
      try {
        const p = await Player.findOne({ userId: ctx.from.id });
        if (!p) return;

        p.onMissionUntil = 0;
        const enemy = dungeon.enemies[Math.floor(Math.random() * dungeon.enemies.length)];
        const roll = Math.random();

        let resultMsg = '';

        if (roll < 0.30) {
          const bonusGold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold + p.strength;
          const expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;
          p.gold += bonusGold;
          p.addExp(expGained);

          resultMsg = `📦 ¡Expedición finalizada en ${dungeon.name}!\n\n` +
                      `Evitaste peligros y hallaste un tesoro.\n` +
                      `💰 Oro: +${bonusGold}\n` +
                      `🔮 EXP: +${expGained}`;
        } else {
          const dmg = Math.max(1, Math.floor(Math.random() * (enemy.maxDmg - enemy.minDmg + 1)) + enemy.minDmg - Math.floor(p.strength / 2));
          const goldGained = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold + p.strength;
          const expGained = Math.floor(Math.random() * (enemy.maxExp - enemy.minExp + 1)) + enemy.minExp;

          p.hp = Math.max(0, p.hp - dmg);

          if (p.hp === 0) {
            const lostExp = p.applyDeathPenalty();
            resultMsg = `⚔️ Encuentro en ${dungeon.name}:\n\n` +
                        `Fuiste abatido por un ${enemy.name} (recibiste ${dmg} de daño).\n` +
                        `💀 Caíste inconsciente.\n` +
                        `⚠️ Penalización: Perdiste ${lostExp} de EXP (Nivel actual: ${p.level}).\n` +
                        `Vuelve al campamento y descansa para restaurar tu salud.`;
          } else {
            p.gold += goldGained;
            p.addExp(expGained);
            resultMsg = `⚔️ Encuentro en ${dungeon.name}:\n\n` +
                        `Derrotaste a un ${enemy.name}.\n` +
                        `💥 Daño recibido: ${dmg} (Salud: ${p.hp}/${p.maxHp})\n` +
                        `💰 Oro: +${goldGained}\n` +
                        `🔮 EXP: +${expGained}`;
          }
        }

        await p.save();

        await ctx.telegram.sendMessage(
          ctx.from.id,
          resultMsg,
          Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Campamento', 'status')]])
        );
      } catch (err) {
        console.error('Error al resolver la expedición:', err);
      }
    }, dungeon.travelSec * 1000);

  } catch (err) {
    console.error('Error al iniciar expedición:', err);
  }
}

bot.action('go_bosque', (ctx) => startExpedition(ctx, 'bosque'));
bot.action('go_cripta', (ctx) => startExpedition(ctx, 'cripta'));
bot.action('go_dragon', (ctx) => startExpedition(ctx, 'dragon'));

// Iniciar conexión con Telegram
bot.launch()
  .then(() => console.log('✅ Bot conectado con éxito a Telegram'))
  .catch((err) => console.error('Error al lanzar Telegraf:', err.message));

// Detención limpia
const safeStop = (signal) => {
  try {
    bot.stop(signal);
  } catch (e) {}
};

process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));
