const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const startServer = require('./server');
const DUNGEONS = require('./dungeons');
const ITEMS = require('./shop');
const { Player, getPlayer, getRequiredExp, MAX_BASE_HP, MAX_ENERGY, REST_COOLDOWN_MS } = require('./playerModel');

startServer();

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Base de datos MongoDB conectada'))
  .catch((err) => console.error('❌ Error conectando a MongoDB:', err));

const bot = new Telegraf(process.env.BOT_TOKEN);

const activeExpeditions = new Set();
const lastUserMessages = new Map();

bot.catch((err, ctx) => {
  console.error(`Error controlado en actualización (${ctx?.updateType}):`, err.message);
});

async function safeAnswerCb(ctx, text) {
  try {
    await ctx.answerCbQuery(text);
  } catch (err) {}
}

function getRestTimeRemaining(player) {
  const now = Date.now();
  const diff = (player.lastRestTime + REST_COOLDOWN_MS) - now;
  return diff > 0 ? Math.ceil(diff / 1000) : 0;
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function getStatusView(player) {
  const reqExp = getRequiredExp(player.level);
  const restSecLeft = getRestTimeRemaining(player);

  let text = `⚔️ Aventurero: ${player.name}\n` +
             `⭐ Nivel: ${player.level}\n` +
             `🔮 EXP: ${player.exp}/${reqExp}\n` +
             `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
             `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n` +
             `💰 Oro: ${player.gold}\n\n`;

  if (restSecLeft > 0) {
    text += `⏳ Próximo descanso en: ${formatSeconds(restSecLeft)}\n`;
  } else {
    text += `🏕️ Descanso disponible (+30% Salud)\n`;
  }

  if (player.statPoints > 0) {
    text += `✨ ¡Tienes ${player.statPoints} punto(s) de atributo sin asignar!\n`;
  }

  text += `\n¿Qué decides hacer?`;

  const buttons = [
    [Markup.button.callback('🗺️ Elegir Expedición', 'menu_dungeons')],
    [
      Markup.button.callback(
        restSecLeft > 0 ? `🏕️ Descanso (${formatSeconds(restSecLeft)})` : '🏕️ Descansar (+30% Salud)',
        'rest'
      )
    ],
    [
      Markup.button.callback('🛒 Tienda', 'menu_shop'),
      Markup.button.callback('🎒 Inventario', 'menu_inv')
    ]
  ];

  if (player.statPoints > 0) {
    buttons.push([Markup.button.callback(`📈 Distribuir Puntos (${player.statPoints})`, 'menu_stats')]);
  }

  buttons.push([Markup.button.callback('🔄 Actualizar Estado', 'status')]);

  return { text, keyboard: Markup.inlineKeyboard(buttons) };
}

bot.start(async (ctx) => {
  try {
    const userId = ctx.from.id;
    const oldMsgId = lastUserMessages.get(userId);
    if (oldMsgId) {
      try {
        await ctx.telegram.deleteMessage(userId, oldMsgId);
      } catch (e) {}
    }

    const player = await getPlayer(userId, ctx.from.first_name);
    const view = getStatusView(player);
    const sent = await ctx.reply(view.text, view.keyboard);
    lastUserMessages.set(userId, sent.message_id);
  } catch (err) {
    console.error('Error en /start:', err);
  }
});

bot.action('status', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const view = getStatusView(player);
    lastUserMessages.set(ctx.from.id, ctx.callbackQuery.message.message_id);
    return await ctx.editMessageText(view.text, view.keyboard);
  } catch (err) {
    console.error('Error en status:', err);
  }
});

// Menú Tienda
bot.action('menu_shop', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = `🛒 *Tienda del Aventurero*\n` +
               `💰 Tu Oro: ${player.gold}\n\n` +
               `Objetos disponibles para compra:\n\n`;

    const buttons = [];

    for (const key in ITEMS) {
      const item = ITEMS[key];
      text += `• ${item.name} — 💰 ${item.cost} oro\n  _${item.desc}_\n\n`;
      buttons.push([Markup.button.callback(`Comprar ${item.name} (${item.cost}g)`, `buy_${item.id}`)]);
    }

    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en menu_shop:', err);
  }
});

// Comprar objetos
bot.action(/^buy_(.+)\$/, async (ctx) => {
  const itemId = ctx.match[1];
  const item = ITEMS[itemId];
  if (!item) return;

  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (player.gold < item.cost) {
      await safeAnswerCb(ctx, `❌ Oro insuficiente. Cuesta ${item.cost} oro.`);
      return;
    }

    player.gold -= item.cost;
    player[item.field] = (player[item.field] || 0) + 1;
    await player.save();

    await safeAnswerCb(ctx, `✅ Compraste 1x ${item.name}`);

    // Refrescar tienda
    let text = `🛒 *Tienda del Aventurero*\n` +
               `💰 Tu Oro: ${player.gold}\n\n` +
               `Objetos disponibles para compra:\n\n`;

    const buttons = [];
    for (const key in ITEMS) {
      const it = ITEMS[key];
      text += `• ${it.name} — 💰 ${it.cost} oro\n  _${it.desc}_\n\n`;
      buttons.push([Markup.button.callback(`Comprar ${it.name} (${it.cost}g)`, `buy_${it.id}`)]);
    }
    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en buy action:', err);
  }
});

// Menú Inventario
bot.action('menu_inv', async (ctx) => {
  await safeAnswerCb(ctx);
  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = `🎒 *Mochila de Aventurero*\n\n` +
               `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
               `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n\n` +
               `*Objetos:*\n` +
               `• Poción Menor de Vida (+10 HP): ${player.potionsSmall || 0}\n` +
               `• Poción Mayor de Vida (+30 HP): ${player.potionsMedium || 0}\n` +
               `• Elixir de Energía (+1 ⚡): ${player.potionsEnergy || 0}\n\n` +
               `Toca un botón para consumir un objeto:`;

    const buttons = [];
    if (player.potionsSmall > 0) {
      buttons.push([Markup.button.callback('🧪 Usar Menor (+10 HP)', 'use_potion_small')]);
    }
    if (player.potionsMedium > 0) {
      buttons.push([Markup.button.callback('🧪 Usar Mayor (+30 HP)', 'use_potion_medium')]);
    }
    if (player.potionsEnergy > 0) {
      buttons.push([Markup.button.callback('⚡ Usar Elixir (+1 ⚡)', 'use_potion_energy')]);
    }

    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error en menu_inv:', err);
  }
});

// Usar objetos
bot.action(/^use_(.+)\$/, async (ctx) => {
  const itemId = ctx.match[1];
  const item = ITEMS[itemId];
  if (!item) return;

  try {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (!player[item.field] || player[item.field] <= 0) {
      await safeAnswerCb(ctx, 'No te quedan más pociones de este tipo.');
      return;
    }

    if (item.type === 'hp') {
      if (player.hp >= player.maxHp) {
        await safeAnswerCb(ctx, 'Tu salud ya está al máximo.');
        return;
      }
      player[item.field] -= 1;
      player.hp = Math.min(player.maxHp, player.hp + item.value);
      await safeAnswerCb(ctx, `Recuperaste +${item.value} HP.`);
    } else if (item.type === 'energy') {
      if (player.energy >= MAX_ENERGY) {
        await safeAnswerCb(ctx, 'Tu energía ya está al máximo.');
        return;
      }
      player[item.field] -= 1;
      player.energy = Math.min(MAX_ENERGY, player.energy + item.value);
      await safeAnswerCb(ctx, `Recuperaste +${item.value} Energía.`);
    }

    await player.save();

    // Refrescar inventario
    let text = `🎒 *Mochila de Aventurero*\n\n` +
               `❤️ Salud: ${player.hp}/${player.maxHp}\n` +
               `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n\n` +
               `*Objetos:*\n` +
               `• Poción Menor de Vida (+10 HP): ${player.potionsSmall || 0}\n` +
               `• Poción Mayor de Vida (+30 HP): ${player.potionsMedium || 0}\n` +
               `• Elixir de Energía (+1 ⚡): ${player.potionsEnergy || 0}\n\n` +
               `Toca un botón para consumir un objeto:`;

    const buttons = [];
    if (player.potionsSmall > 0) {
      buttons.push([Markup.button.callback('🧪 Usar Menor (+10 HP)', 'use_potion_small')]);
    }
    if (player.potionsMedium > 0) {
      buttons.push([Markup.button.callback('🧪 Usar Mayor (+30 HP)', 'use_potion_medium')]);
    }
    if (player.potionsEnergy > 0) {
      buttons.push([Markup.button.callback('⚡ Usar Elixir (+1 ⚡)', 'use_potion_energy')]);
    }
    buttons.push([Markup.button.callback('⬅️ Volver', 'status')]);

    return await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('Error al usar objeto:', err);
  }
});

// Descansar con cooldown de 5 min (sin costo de energía)
bot.action('rest', async (ctx) => {
  const userId = ctx.from.id;
  if (activeExpeditions.has(userId)) {
    await safeAnswerCb(ctx, 'Estás de viaje en una expedición.');
    return;
  }

  try {
    const player = await getPlayer(userId, ctx.from.first_name);

    if (Date.now() < player.onMissionUntil) {
      await safeAnswerCb(ctx, 'Estás de viaje en una expedición.');
      return;
    }

    if (player.hp >= player.maxHp) {
      await safeAnswerCb(ctx, `Tu salud ya está al máximo (${player.maxHp} HP).`);
      return;
    }

    const secLeft = getRestTimeRemaining(player);
    if (secLeft > 0) {
      await safeAnswerCb(ctx, `⏳ Debes esperar ${formatSeconds(secLeft)} para volver a descansar.`);
      return;
    }

    const healAmount = Math.ceil(player.maxHp * 0.30);
    player.hp = Math.min(player.maxHp, player.hp + healAmount);
    player.lastRestTime = Date.now();
    await player.save();

    await safeAnswerCb(ctx, `Descansaste y recuperaste ${healAmount} HP (+30%).`);

    const view = getStatusView(player);
    return await ctx.editMessageText(view.text, view.keyboard);
  } catch (err) {
    console.error('Error en rest:', err);
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
  const userId = ctx.from.id;
  if (activeExpeditions.has(userId)) {
    await safeAnswerCb(ctx, 'Ya estás en una expedición.');
    return;
  }

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

async function startExpedition(ctx, dungeonKey) {
  const userId = ctx.from.id;

  if (activeExpeditions.has(userId)) {
    await safeAnswerCb(ctx, 'Ya tienes una expedición en curso.');
    return;
  }

  try {
    const player = await getPlayer(userId, ctx.from.first_name);
    const dungeon = DUNGEONS[dungeonKey];

    if (Date.now() < player.onMissionUntil) {
      const remaining = Math.ceil((player.onMissionUntil - Date.now()) / 1000);
      await safeAnswerCb(ctx, `Ya estás en camino. Faltan ${remaining}s.`);
      return;
    }

    if (player.hp <= 0) {
      await safeAnswerCb(ctx, '💀 Estás sin salud. Descansa o usa una poción.');
      return;
    }

    if (player.energy < dungeon.cost) {
      await safeAnswerCb(ctx, `⚡ Necesitas ${dungeon.cost} de energía.`);
      return;
    }

    activeExpeditions.add(userId);

    player.energy -= dungeon.cost;
    player.onMissionUntil = Date.now() + (dungeon.travelSec * 1000);
    await player.save();
    await safeAnswerCb(ctx);

    const departText = `🚶 Marchando hacia: ${dungeon.name}\n\n` +
                       `⏳ Llegarás en ${dungeon.travelSec} segundos. El bot te avisará cuando ocurra el encuentro.`;

    await ctx.editMessageText(departText, Markup.inlineKeyboard([[Markup.button.callback('🔄 Ver Estado', 'status')]]));

    setTimeout(async () => {
      try {
        const p = await Player.findOne({ userId });
        if (p) {
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
                          `Vuelve al campamento para descansar o usa una poción desde tu inventario.`;
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

          const sent = await ctx.telegram.sendMessage(
            userId,
            resultMsg,
            Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Campamento', 'status')]])
          );
          lastUserMessages.set(userId, sent.message_id);
        }
      } catch (err) {
        console.error('Error al resolver la expedición:', err);
      } finally {
        activeExpeditions.delete(userId);
      }
    }, dungeon.travelSec * 1000);

  } catch (err) {
    activeExpeditions.delete(userId);
    console.error('Error al iniciar expedición:', err);
  }
}

bot.action('go_bosque', (ctx) => startExpedition(ctx, 'bosque'));
bot.action('go_cripta', (ctx) => startExpedition(ctx, 'cripta'));
bot.action('go_dragon', (ctx) => startExpedition(ctx, 'dragon'));

bot.launch()
  .then(() => console.log('✅ Bot conectado con éxito a Telegram'))
  .catch((err) => console.error('Error al lanzar Telegraf:', err.message));

const safeStop = (signal) => {
  try {
    bot.stop(signal);
  } catch (e) {}
};

process.once('SIGINT', () => safeStop('SIGINT'));
process.once('SIGTERM', () => safeStop('SIGTERM'));
