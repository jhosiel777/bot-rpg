const { Telegraf, Markup } = require('telegraf');

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('Bot funcionando'));
app.listen(port, () => console.log(`Servidor web activo en puerto ${port}`));

const bot = new Telegraf(process.env.BOT_TOKEN);
const players = new Map();

function getPlayer(id, name) {
  if (!players.has(id)) {
    players.set(id, { name, hp: 100, maxHp: 100, gold: 0, level: 1 });
  }
  return players.get(id);
}

function mainMenu(player) {
  const text = `⚔️ *Aventurero:* ${player.name}\n` +
               `❤️ *Vida:* ${player.hp}/${player.maxHp}\n` +
               `💰 *Oro:* ${player.gold}\n` +
               `⭐ *Nivel:* ${player.level}\n\n` +
               `¿Qué decides hacer?`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🌲 Explorar Mazmorra', 'explore')],
    [Markup.button.callback('🏕️ Descansar (+25 Vida)', 'rest')],
    [Markup.button.callback('🔄 Actualizar Estado', 'status')]
  ]);

  return { text, keyboard };
}

bot.start((ctx) => {
  const player = getPlayer(ctx.from.id, ctx.from.first_name);
  const menu = mainMenu(player);
  return ctx.replyWithMarkdown(menu.text, menu.keyboard);
});

bot.action('status', async (ctx) => {
  await ctx.answerCbQuery();
  const player = getPlayer(ctx.from.id, ctx.from.first_name);
  const menu = mainMenu(player);
  return ctx.editMessageText(menu.text, { parse_mode: 'Markdown', ...menu.keyboard });
});

bot.action('rest', async (ctx) => {
  const player = getPlayer(ctx.from.id, ctx.from.first_name);
  if (player.hp >= player.maxHp) {
    await ctx.answerCbQuery('¡Tu vida ya está al máximo!');
    return;
  }
  player.hp = Math.min(player.maxHp, player.hp + 25);
  await ctx.answerCbQuery('Te has recuperado un poco.');
  const menu = mainMenu(player);
  return ctx.editMessageText(menu.text, { parse_mode: 'Markdown', ...menu.keyboard });
});

bot.action('explore', async (ctx) => {
  const player = getPlayer(ctx.from.id, ctx.from.first_name);

  if (player.hp <= 10) {
    await ctx.answerCbQuery('⚠️ Tienes muy poca vida. ¡Descansa primero!');
    return;
  }

  await ctx.answerCbQuery();
  const roll = Math.random();

  if (roll < 0.45) {
    const goldFound = Math.floor(Math.random() * 15) + 5;
    player.gold += goldFound;
    return ctx.editMessageText(
      `💎 ¡Encontraste un cofre oculto con *${goldFound} monedas de oro*!`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'status')]])
      }
    );
  } else if (roll < 0.85) {
    const damage = Math.floor(Math.random() * 15) + 10;
    player.hp = Math.max(1, player.hp - damage);
    return ctx.editMessageText(
      `👺 ¡Un trasgo te atacó por la espalda y te quitó *${damage} puntos de vida*!`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'status')]])
      }
    );
  } else {
    player.level += 1;
    player.maxHp += 10;
    player.hp = player.maxHp;
    return ctx.editMessageText(
      `✨ ¡Derrotaste a un mini-jefe y subiste a *Nivel ${player.level}*! Tu vida aumentó y se restauró por completo.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Volver', 'status')]])
      }
    );
  }
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
