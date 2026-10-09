const express = require('express');
const { Telegraf, Markup } = require('telegraf');

const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot funcionando'));
app.listen(port, () => console.log(`Servidor activo en puerto ${port}`));

const bot = new Telegraf(process.env.BOT_TOKEN);
const players = new Map();

const MAX_HP = 100;
const MAX_ENERGY = 10;
const MAX_LIVES = 3;
const ENERGY_RECHARGE_MS = 5 * 60 * 1000; // 1 energía cada 5 min

const DUNGEONS = {
  bosque: {
    name: '🌲 Bosque Umbrío',
    cost: 1,
    travelSec: 10,
    enemies: [
      { name: 'Duende Ladrón', minDmg: 5, maxDmg: 12, minGold: 6, maxGold: 14 },
      { name: 'Lobo Salvaje', minDmg: 10, maxDmg: 18, minGold: 10, maxGold: 20 }
    ]
  },
  cripta: {
    name: '🪦 Cripta Abandonada',
    cost: 2,
    travelSec: 20,
    enemies: [
      { name: 'Esqueleto Guerrero', minDmg: 15, maxDmg: 28, minGold: 18, maxGold: 32 },
      { name: 'Necrófago', minDmg: 22, maxDmg: 35, minGold: 25, maxGold: 45 }
    ]
  },
  dragon: {
    name: '🌋 Guarida del Dragón',
    cost: 3,
    travelSec: 35,
    enemies: [
      { name: 'Cría de Dragón', minDmg: 30, maxDmg: 50, minGold: 50, maxGold: 85 },
      { name: 'Dragón de Magma', minDmg: 45, maxDmg: 75, minGold: 80, maxGold: 140 }
    ]
  }
};

function getPlayer(id, name) {
  if (!players.has(id)) {
    players.set(id, {
      name: name || 'Aventurero',
      hp: MAX_HP,
      gold: 0,
      lives: MAX_LIVES,
      energy: MAX_ENERGY,
      lastEnergyUpdate: Date.now(),
      onMissionUntil: 0
    });
  }

  const p = players.get(id);
  rechargeEnergy(p);
  return p;
}

function rechargeEnergy(p) {
  const now = Date.now();
  const timePassed = now - p.lastEnergyUpdate;

  if (p.energy < MAX_ENERGY && timePassed >= ENERGY_RECHARGE_MS) {
    const gained = Math.floor(timePassed / ENERGY_RECHARGE_MS);
    p.energy = Math.min(MAX_ENERGY, p.energy + gained);
    p.lastEnergyUpdate = now - (timePassed % ENERGY_RECHARGE_MS);
  }
}

function getStatusView(player) {
  rechargeEnergy(player);

  const text = `⚔️ Aventurero: ${player.name}\n` +
               `❤️‍🩹 Vidas: ${player.lives}/${MAX_LIVES}\n` +
               `❤️ Salud: ${player.hp}/${MAX_HP}\n` +
               `⚡ Energía: ${player.energy}/${MAX_ENERGY}\n` +
               `💰 Oro: ${player.gold}\n\n` +
               `¿Qué decides hacer?`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗺️ Elegir Expedición', 'menu_dungeons')],
    [Markup.button.callback('🏕️ Descansar (+30 Salud)', 'rest')],
    [Markup.button.callback('🔄 Actualizar Estado', 'status')]
  ]);

  return { text, keyboard };
}

bot.start((ctx) => {
  const player = getPlayer(ctx.from.id, ctx.from.first_name);
  const view = getStatusView(player);
  return ctx.reply(view.text, view.keyboard);
});

bot.action('status', async (ctx) => {
  await ctx.answerCbQuery();
  const player = getPlayer(ctx.from.id, ctx.from.first_name);
  const view = getStatusView(player);
  return ctx.editMessageText(view.text, view.keyboard);
});

bot.action('menu_dungeons', async (ctx) => {
  await ctx.answerCbQuery();
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

  return ctx.editMessageText(text, keyboard);
});

bot.action('rest', async (ctx) => {
  const player = getPlayer(ctx.from.id, ctx.from.first_name);

  if (Date.now() < player.onMissionUntil) {
    await ctx.answerCbQuery('Estás de viaje en una expedición.');
    return;
  }

  if (player.hp >= MAX_HP) {
    await ctx.answerCbQuery('Tu salud ya está al máximo (100 HP).');
    return;
  }

  if (player.energy < 1) {
    await ctx.answerCbQuery('⚡ No tienes energía para descansar.');
    return;
  }

  player.energy -= 1;
  player.hp = Math.min(MAX_HP, player.hp + 30);
  await ctx.answerCbQuery('Descansaste y recuperaste 30 HP.');

  const view = getStatusView(player);
  return ctx.editMessageText(view.text, view.keyboard);
});

async function startExpedition(ctx, dungeonKey) {
  const player = getPlayer(ctx.from.id, ctx.from.first_name);
  const dungeon = DUNGEONS[dungeonKey];

  if (Date.now() < player.onMissionUntil) {
    const remaining = Math.ceil((player.onMissionUntil - Date.now()) / 1000);
    await ctx.answerCbQuery(`Ya estás en camino. Faltan ${remaining}s.`);
    return;
  }

  if (player.lives <= 0) {
    await ctx.answerCbQuery('💀 Te has quedado sin vidas.');
    return;
  }

  if (player.hp < 15) {
    await ctx.answerCbQuery('⚠️ Salud muy baja. Descansa antes de viajar.');
    return;
  }

  if (player.energy < dungeon.cost) {
    await ctx.answerCbQuery(`⚡ Necesitas ${dungeon.cost} de energía.`);
    return;
  }

  player.energy -= dungeon.cost;
  player.onMissionUntil = Date.now() + (dungeon.travelSec * 1000);
  await ctx.answerCbQuery();

  const departText = `🚶 Marchando hacia: ${dungeon.name}\n\n` +
                     `⏳ Llegarás en ${dungeon.travelSec} segundos. El bot te avisará cuando ocurra el encuentro.`;

  await ctx.editMessageText(departText, Markup.inlineKeyboard([[Markup.button.callback('🔄 Ver Estado', 'status')]]));

  setTimeout(async () => {
    player.onMissionUntil = 0;
    const enemy = dungeon.enemies[Math.floor(Math.random() * dungeon.enemies.length)];
    const roll = Math.random();

    let resultMsg = '';

    if (roll < 0.35) {
      const gold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
      player.gold += gold;
      resultMsg = `📦 ¡Expedición finalizada en ${dungeon.name}!\n\n` +
                  `Evitaste peligros y hallaste un tesoro con ${gold} monedas de oro.`;
    } else {
      const dmg = Math.floor(Math.random() * (enemy.maxDmg - enemy.minDmg + 1)) + enemy.minDmg;
      const gold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
      player.hp -= dmg;
      player.gold += gold;

      if (player.hp <= 0) {
        player.lives -= 1;
        player.hp = MAX_HP;
        resultMsg = `⚔️ Encuentro en ${dungeon.name}:\n\n` +
                    `Fuiste abatido por un ${enemy.name} (recibiste ${dmg} de daño).\n` +
                    `💀 Perdiste 1 vida. Te quedan ${player.lives} vidas y tu salud se restableció a 100.`;
      } else {
        resultMsg = `⚔️ Encuentro en ${dungeon.name}:\n\n` +
                    `Derrotaste a un ${enemy.name}.\n` +
                    `💥 Sufriste ${dmg} de daño (Salud restante: ${player.hp}/100).\n` +
                    `💰 Obtuviste ${gold} monedas de oro.`;
      }
    }

    try {
      await ctx.telegram.sendMessage(ctx.from.id, resultMsg, Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver al Campamento', 'status')]]));
    } catch (e) {
      console.error('Error enviando mensaje de expedición:', e);
    }
  }, dungeon.travelSec * 1000);
}

bot.action('go_bosque', (ctx) => startExpedition(ctx, 'bosque'));
bot.action('go_cripta', (ctx) => startExpedition(ctx, 'cripta'));
bot.action('go_dragon', (ctx) => startExpedition(ctx, 'dragon'));

// Iniciar bot
bot.launch().then(() => console.log('Bot conectado con éxito a Telegram'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
