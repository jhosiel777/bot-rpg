const { Player } = require('./playerModel');

async function getRankingText(currentUserId) {
  try {
    const topPlayers = await Player.find({})
      .sort({ level: -1, exp: -1, gold: -1 })
      .limit(10)
      .lean();

    if (!topPlayers.length) {
      return '🏆 *Salón de la Fama*\n\nAún no hay aventureros registrados.';
    }

    const medals = ['🥇', '🥈', '🥉'];
    let text = '🏆 *Salón de la Fama — Top Aventureros*\n\n';

    topPlayers.forEach((p, idx) => {
      const icon = medals[idx] || ('*#' + (idx + 1) + '*');
      const cleanName = (p.name || 'Aventurero').replace(/[_*[\]()~`>#+-=|{}.!]/g, ' ');
      text += icon + ' *' + cleanName + '*\n' +
              '   ⭐ Nivel: ' + p.level + ' | 🔮 EXP: ' + p.exp + ' | 💰 Oro: ' + p.gold + '\n\n';
    });

    const inTop = topPlayers.some((p) => p.userId === currentUserId);
    if (!inTop) {
      const currentPlayer = await Player.findOne({ userId: currentUserId }).lean();
      if (currentPlayer) {
        const higherCount = await Player.countDocuments({ level: { $gt: currentPlayer.level } });
        const myRank = higherCount + 1;
        text += '──────────────────\n' +
                '📍 *Tu Posición:* #' + myRank + ' (Nivel ' + currentPlayer.level + ' | ' + currentPlayer.gold + 'g)\n';
      }
    }

    return text;
  } catch (err) {
    console.error('Error generando ranking:', err);
    return '❌ Error al cargar el Salón de la Fama.';
  }
}

module.exports = { getRankingText };
