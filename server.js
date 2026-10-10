const express = require('express');
const https = require('https');
const { Markup } = require('telegraf');
const { Player } = require('./playerModel');

const app = express();
const PORT = process.env.PORT || 10000;
const APP_URL = 'https://bot-rpg-wu42.onrender.com';
const ADMIN_ID = 835648800;

let botInstance = null;

app.use(express.json());

// Ruta raíz para health checks de Render
app.get('/', (req, res) => {
  res.status(200).send('OK - Bot activo y despierto');
});

// Ruta de la Mini App de Telegram para ver el anuncio con Monetag
app.get('/ad-reward', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recompensa Diaria</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="https://libtl.com/sdk.js" data-zone="12000502" data-sdk="show_12000502"></script>
  <style>
    body {
      background-color: #121212;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 90vh;
      margin: 0;
      padding: 16px;
      box-sizing: border-box;
      text-align: center;
    }
    .card {
      background: #1e1e1e;
      border: 1px solid #2d2d2d;
      border-radius: 16px;
      padding: 24px;
      max-width: 320px;
      width: 100%;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }
    h2 { margin: 0 0 10px 0; font-size: 20px; }
    p { font-size: 14px; color: #bbb; line-height: 1.4; margin: 8px 0; }
    .rules {
      font-size: 12px;
      color: #888;
      background: #181818;
      padding: 10px;
      border-radius: 8px;
      margin: 14px 0;
    }
    button {
      background: #2ea043;
      color: #fff;
      border: none;
      padding: 14px 20px;
      font-size: 16px;
      font-weight: bold;
      border-radius: 10px;
      cursor: pointer;
      width: 100%;
      transition: background 0.2s;
    }
    button:disabled {
      background: #555;
      cursor: not-allowed;
    }
    #msg {
      margin-top: 14px;
      font-size: 13px;
      line-height: 1.4;
      min-height: 18px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h2>🥤 Bebida Energética</h2>
    <p>Mira un breve anuncio patrocinado para obtener <b>1x Bebida (+2 ⚡)</b> directo a tu mochila.</p>
    
    <div class="rules">
      • Límite: 3 bebidas al día<br>
      • Máximo en mochila: 5 unidades
    </div>

    <button id="adBtn" onclick="playAd()">Ver Anuncio</button>
    <div id="msg"></div>
  </div>

  <script>
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }

    async function claimReward() {
      const msg = document.getElementById('msg');
      const btn = document.getElementById('adBtn');
      msg.style.color = '#bbb';
      msg.innerText = "¡Completado! Entregando bebida...";

      const userId = tg?.initDataUnsafe?.user?.id;
      if (!userId) {
        msg.style.color = '#ff4d4d';
        msg.innerText = "Error: no se pudo identificar tu cuenta de Telegram.";
        btn.disabled = false;
        return;
      }

      try {
        const res = await fetch('/api/claim-ad-drink', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        });

        const data = await res.json();
        if (data.success) {
          msg.style.color = '#4cd964';
          msg.innerText = data.msg;
          setTimeout(() => tg?.close(), 1800);
        } else {
          msg.style.color = '#ff9900';
          msg.innerText = data.msg;
          btn.disabled = false;
        }
      } catch (e) {
        msg.style.color = '#ff4d4d';
        msg.innerText = "Error al contactar con el servidor.";
        btn.disabled = false;
      }
    }

    async function playAd() {
      const btn = document.getElementById('adBtn');
      const msg = document.getElementById('msg');
      btn.disabled = true;
      msg.style.color = '#bbb';
      msg.innerText = "Cargando anuncio...";

      let attempts = 0;
      while (typeof show_12000502 !== 'function' && attempts < 8) {
        await new Promise(r => setTimeout(r, 500));
        attempts++;
      }

      if (typeof show_12000502 !== 'function') {
        msg.style.color = '#ff4d4d';
        msg.innerText = "⚠️ Si tienes un DNS privado o bloqueador de anuncios activo en tu móvil, desactívalo para poder obtener la recompensa.";
        btn.disabled = false;
        return;
      }

      let navigatedOut = false;
      const startTime = Date.now();

      const onVisibilityChange = () => {
        if (document.hidden) navigatedOut = true;
      };
      const onWindowBlur = () => {
        navigatedOut = true;
      };

      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('blur', onWindowBlur);

      show_12000502().then(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('blur', onWindowBlur);
        claimReward();
      }).catch((err) => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('blur', onWindowBlur);

        const duration = Date.now() - startTime;

        // Solo se valida si salió al navegador externo (clic) y no fue un cierre instantáneo
        if (navigatedOut && duration > 2000) {
          claimReward();
        } else {
          msg.style.color = '#ff4d4d';
          msg.innerText = "El anuncio se cerró antes de tiempo. Debes completarlo para recibir la recompensa.";
          btn.disabled = false;
        }
      });
    }
  </script>
</body>
</html>
  `);
});

// Endpoint para validar reglas y acreditar la bebida en MongoDB
app.post('/api/claim-ad-drink', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, msg: 'Falta identificador de usuario.' });

    const player = await Player.findOne({ userId });
    if (!player) return res.status(404).json({ success: false, msg: 'Jugador no encontrado.' });

    const isCreator = (Number(userId) === ADMIN_ID);

    // Regla 1: Máximo 5 bebidas en mochila
    const currentDrinks = player.potionsEnergyDrink || 0;
    if (currentDrinks >= 5) {
      if (isCreator && botInstance) {
        try {
          await botInstance.telegram.sendMessage(
            ADMIN_ID,
            `👑 *Atención Creador:*\nViste un anuncio pero tu mochila ya tiene el tope de *${currentDrinks}/5* bebidas.\n\n¿Deseas agregar la bebida a tu inventario igualmente?`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🥤 Sí, agregar a mi inventario', 'adm_claim_overflow_drink')]
              ])
            }
          );
        } catch (e) {}

        return res.json({
          success: false,
          msg: '👑 Límite alcanzado. Revisa tu chat con el bot para confirmar si la agregas.'
        });
      }

      return res.json({
        success: false,
        msg: '⚠️ Ya tienes el máximo de 5 Bebidas en tu inventario.'
      });
    }

    // Regla 2: Máximo 3 al día
    const today = new Date().toISOString().slice(0, 10);
    if (player.lastAdClaimDate !== today) {
      player.lastAdClaimDate = today;
      player.adsClaimedToday = 0;
    }

    if (player.adsClaimedToday >= 3) {
      if (isCreator && botInstance) {
        try {
          await botInstance.telegram.sendMessage(
            ADMIN_ID,
            `👑 *Atención Creador:*\nViste un anuncio pero alcanzaste tus *3/3* bebidas de hoy.\n\n¿Deseas agregar la bebida a tu inventario igualmente?`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('🥤 Sí, agregar a mi inventario', 'adm_claim_overflow_drink')]
              ])
            }
          );
        } catch (e) {}

        return res.json({
          success: false,
          msg: '👑 Límite diario alcanzado. Revisa tu chat con el bot para confirmar si la agregas.'
        });
      }

      return res.json({
        success: false,
        msg: '⚠️ Ya reclamaste tus 3 bebidas de hoy. Vuelve mañana.'
      });
    }

    // Acreditar bebida normalmente
    player.potionsEnergyDrink = currentDrinks + 1;
    player.adsClaimedToday += 1;
    await player.save();

    const remainingToday = 3 - player.adsClaimedToday;
    return res.json({
      success: true,
      msg: `✅ ¡Recibiste 1x Bebida Energética! (Te quedan ${remainingToday} hoy)`
    });
  } catch (err) {
    console.error('Error al procesar recompensa de anuncio:', err);
    return res.status(500).json({ success: false, msg: 'Error interno en el servidor.' });
  }
});

function startServer(bot) {
  if (bot) botInstance = bot;

  app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP activo en puerto ${PORT}`);

    // Auto-ping cada 8 minutos para evitar suspensión en Render
    setInterval(() => {
      https.get(APP_URL, () => {}).on('error', () => {});
    }, 8 * 60 * 1000);
  });
}

module.exports = startServer;
