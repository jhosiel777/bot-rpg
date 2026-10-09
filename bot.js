const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot funcionando'));
app.listen(port, () => console.log(`Servidor activo en puerto ${port}`));

const bot = new Telegraf(process.env.BOT_TOKEN);

// Conexión a MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Base de datos MongoDB conectada'))
  .catch((err) => console.error('❌ Error conectando a MongoDB:', err));

// Esquema del jugador en la nube
const playerSchema = new mongoose.Schema({
  userId: { type: Number, required: true, unique: true },
  name: { type: String, default: 'Aventurero' },
  hp: { type: Number, default: 100 },
  gold: { type: Number, default: 0 },
  energy: { type: Number, default: 10 },
  lastEnergyUpdate: { type: Number, default: () => Date.now() },
  onMissionUntil: { type: Number, default: 0 }
});

const Player = mongoose.model('Player', playerSchema);

const MAX_HP = 100;
const MAX_ENERGY = 10;
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

async function getPlayer(userId, name) {
  let player = await Player.findOne({ userId });
  if (!player) {
    player = await Player.create({
      userId,
      name: name || 'Aventurero'
    });
  }

  // Recargar energía si pasó el tiempo
  const now = Date.now();
  const timePassed = now - player.lastEnergyUpdate;
  if (player.energy < MAX_ENERGY && timePassed >= ENERGY_RECHARGE_MS) {
    const gained = Math.floor(timePassed / ENERGY_RECHARGE_MS);
    player.energy = Math.min(MAX_ENERGY, player.energy + gained);
    player.lastEnergyUpdate = now - (timePassed % ENERGY_RECHARGE_MS);
    await player.save();
  }

  return player;
}

function getStatusView(player) {
  const text = `⚔️ Aventurero: ${player.name}\n` +
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

bot.start(async (ctx) => {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const view = getStatusView(player);
  return ctx.reply(view.text, view.keyboard);
});

bot.action('status', async (ctx) => {
  await ctx.answerCbQuery();
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
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
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);

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
  await player.save();
  await ctx.answerCbQuery('Descansaste y recuperaste 30 HP.');

  const view = getStatusView(player);
  return ctx.editMessageText(view.text, view.keyboard);
});

async function startExpedition(ctx, dungeonKey) {
  const player = await getPlayer(ctx.from.id, ctx.from.first_name);
  const dungeon = DUNGEONS[dungeonKey];

  if (Date.now() < player.onMissionUntil) {
    const remaining = Math.ceil((player.onMissionUntil - Date.now()) / 1000);
    await ctx.answerCbQuery(`Ya estás en camino. Faltan ${remaining}s.`);
    return;
  }

  if (player.hp <= 0) {
    await ctx.answerCbQuery('💀 Estás sin salud. Descansa en el campamento.');
    return;
  }

  if (player.energy < dungeon.cost) {
    await ctx.answerCbQuery(`⚡ Necesitas ${dungeon.cost} de energía.`);
    return;
  }

  player.energy -= dungeon.cost;
  player.onMissionUntil = Date.now() + (dungeon.travelSec * 1000);
  await player.save();
  await ctx.answerCbQuery();

  const departText = `🚶 Marchando hacia: ${dungeon.name}\n\n` +
                     `⏳ Llegarás en ${dungeon.travelSec} segundos. El bot te avisará cuando ocurra el encuentro.`;

  await ctx.editMessageText(departText, Markup.inlineKeyboard([[Markup.button.callback('🔄 Ver Estado', 'status')]]));

  setTimeout(async () => {
    const p = await Player.findOne({ userId: ctx.from.id });
    if (!p) return;

    p.onMissionUntil = 0;
    const enemy = dungeon.enemies[Math.floor(Math.random() * dungeon.enemies.length)];
    const roll = Math.random();

    let resultMsg = '';

    if (roll < 0.35) {
      const gold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
      p.gold += gold;
      resultMsg = `📦 ¡Expedición finalizada en ${dungeon.name}!\n\n` +
                  `Evitaste peligros y hallaste un tesoro con ${gold} monedas de oro.`;
    } else {
      const dmg = Math.floor(Math.random() * (enemy.maxDmg - enemy.minDmg + 1)) + enemy.minDmg;
      const gold = Math.floor(Math.random() * (enemy.maxGold - enemy.minGold + 1)) + enemy.minGold;
      p.hp = Math.max(0, p.hp - dmg);

      if (p.hp === 0) {
        resultMsg = `⚔️ Encuentro en ${dungeon.name}:\n\n` +
                    `Fuiste abatido por un ${enemy.name} (recibiste ${dmg} de daño).\n` +
                    `💀 Caíste inconsciente. Vuelve al campamento y descansa para recuperar salud.`;
      } else {
        p.gold += gold;
        resultMsg = `⚔️ Encuentro en ${dungeon.name}:\n\n` +
                    `Derrotaste a un ${enemy.name}.\n` +
                    `💥 Sufriste ${dmg} de daño (Salud restante: ${p.hp}/100).\n` +
                    `💰 Obtuviste ${gold} monedas de oro.`;
      }
    }

    await p.save();

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

bot.launch().then(() => console.log('Bot conectado con éxito a Telegram'));

const stopBot = (signal) => {
  try {
    bot.stop(signal);
  } catch (e) {
    // Evita que lance el error si ya no estaba activo
  }
};

process.once('SIGINT', () => stopBot('SIGINT'));
process.once('SIGTERM', () => stopBot('SIGTERM'));
