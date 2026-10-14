// utils/telegramUtils.js

async function safeAnswerCb(ctx, text, showAlert = false) {
  try {
    if (text) {
      await ctx.answerCbQuery(text, { show_alert: showAlert });
    } else {
      await ctx.answerCbQuery();
    }
  } catch (err) {}
}

async function safeEditMessage(ctx, text, extra = {}) {
  try {
    return await ctx.editMessageText(text, extra);
  } catch (err) {
    if (!err.description?.includes('message is not modified')) {
      console.error('Error al editar mensaje:', err.message);
    }
  }
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function formatHoursMinutes(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s < 10 ? '0' : ''}${s}s`;
  return `${s}s`;
}

// Envío escalonado: 1 mensaje cada 40ms (~25 msg/s, seguro bajo el límite de 30 de Telegram)
async function broadcastToAll(bot, PlayerModel, messageText) {
  try {
    const players = await PlayerModel.find({ isVerified: true }, 'userId');
    for (const p of players) {
      try {
        await bot.telegram.sendMessage(p.userId, messageText, { parse_mode: 'Markdown' });
      } catch (e) {
        // Ignora usuarios que bloquearon el bot
      }
      await new Promise((res) => setTimeout(res, 40));
    }
  } catch (err) {
    console.error('Error enviando broadcast global seguro:', err.message);
  }
}

module.exports = {
  safeAnswerCb,
  safeEditMessage,
  formatSeconds,
  formatHoursMinutes,
  broadcastToAll
};
