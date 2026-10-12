const express = require('express');
const { Player, MAX_ENERGY } = require('./playerModel');
const { PlayerBounty, getTodayUtcString } = require('./bountyModel');

function startServer(bot) {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  app.get('/', (req, res) => {
    res.send('Servidor del bot RPG activo.');
  });

  // Pantalla de anuncios interactiva según propósito
  app.get('/ad-reward', async (req, res) => {
    const userId = req.query.userId || '';
    const purpose = req.query.purpose || 'energy_drink';

    let bountyAdsCount = 0;
    if (userId && purpose === 'bounty_plus') {
      try {
        const todayUtc = getTodayUtcString();
        const bounty = await PlayerBounty.findOne({ userId: parseInt(userId, 10), bountyDateUtc: todayUtc });
        if (bounty) bountyAdsCount = bounty.adsClaimedForBounty || 0;
      } catch (e) {}
    }

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Recompensa del Reino</title>
      <script src="https://telegram.org/js/telegram-web-app.js"></script>

      <!-- SDK MONETAG (REWARDED INTERSTITIAL) -->
      <script src="//libtl.com/sdk.js" data-zone="12000502" data-sdk="show_12000502"></script>

      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: #121826;
          color: #f1f5f9;
          margin: 0;
          padding: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 90vh;
          text-align: center;
        }
        .card {
          background: #1e293b;
          border: 1px solid #334155;
          padding: 24px;
          border-radius: 16px;
          max-width: 380px;
          width: 100%;
          box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
        .icon { font-size: 54px; margin-bottom: 12px; }
        h2 { margin: 0 0 10px 0; color: #38bdf8; font-size: 22px; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 18px 0; }
        .counter-badge {
          background: #0f172a;
          color: #fbbf24;
          font-weight: bold;
          font-size: 16px;
          padding: 8px 16px;
          border-radius: 20px;
          border: 1px solid #f59e0b;
          display: inline-block;
          margin-bottom: 18px;
        }
        .btn {
          background: #0284c7;
          color: white;
          border: none;
          padding: 14px 20px;
          font-size: 16px;
          font-weight: bold;
          border-radius: 12px;
          cursor: pointer;
          width: 100%;
          transition: background 0.2s;
        }
        .btn:hover { background: #0369a1; }
        .btn:disabled { background: #475569; cursor: not-allowed; }
        .footer-note { font-size: 12px; color: #64748b; margin-top: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">${purpose === 'bounty_plus' ? '⚡🎯' : '🥤⚡'}</div>
        <h2 id="title">
          ${purpose === 'bounty_plus' ? 'Caza Diaria: Modo Auto Plus' : 'Suministro: Bebida Energética'}
        </h2>
        <p id="desc">
          ${purpose === 'bounty_plus' 
            ? 'Mira un anuncio patrocinado para respaldar el desarrollo del reino y desbloquear el cupo ampliado de pociones automáticas para la caza de hoy.' 
            : 'Apoya al creador viendo este anuncio patrocinado y recibe 1x Bebida Energética (+2 ⚡) en tu inventario.'}
        </p>

        ${purpose === 'bounty_plus' ? '<div class="counter-badge" id="bountyCounter">Anuncios hoy: ' + bountyAdsCount + ' / 2</div>' : ''}

        <button class="btn" id="watchBtn" onclick="watchAd()">📺 Ver Anuncio</button>
        <div class="footer-note">Al finalizar el anuncio se acreditará el beneficio automáticamente.</div>
      </div>

      <script>
        const tg = window.Telegram?.WebApp;
        if (tg) tg.expand();

        let userId = '${userId}';
        const purpose = '${purpose}';

        if (!userId && tg?.initDataUnsafe?.user?.id) {
          userId = tg.initDataUnsafe.user.id;
        }

        async function triggerRewardClaim() {
          const btn = document.getElementById('watchBtn');
          btn.innerText = 'Registrando recompensa...';
          try {
            const res = await fetch('/claim-reward', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: userId, purpose: purpose })
            });
            const data = await res.json();
            if (data.success) {
              alert(data.msg);
              const counter = document.getElementById('bountyCounter');
              if (counter) {
                const currentCount = parseInt(counter.innerText.match(/\\d+/)?.[0] || '0', 10);
                const nextCount = Math.min(2, currentCount + 1);
                counter.innerText = 'Anuncios hoy: ' + nextCount + ' / 2';
              }
              if (tg) tg.close();
            } else {
              alert(data.msg || 'No se pudo entregar la recompensa.');
              btn.disabled = false;
              btn.innerText = 'Intentar de nuevo';
            }
          } catch (err) {
            alert('Error al conectar con el servidor.');
            btn.disabled = false;
            btn.innerText = 'Reintentar';
          }
        }

        function watchAd() {
          const btn = document.getElementById('watchBtn');
          btn.disabled = true;
          btn.innerText = 'Cargando anuncio...';

          if (typeof show_12000502 === 'function') {
            show_12000502().then(() => {
              triggerRewardClaim();
            }).catch((err) => {
              console.error('Error mostrando anuncio Monetag:', err);
              alert('Debes ver el anuncio completo para recibir la recompensa.');
              btn.disabled = false;
              btn.innerText = 'Intentar de nuevo';
            });
          } else {
            console.warn('SDK de Monetag no disponible aún, reintentando...');
            setTimeout(() => {
              if (typeof show_12000502 === 'function') {
                show_12000502().then(() => {
                  triggerRewardClaim();
                }).catch(() => {
                  btn.disabled = false;
                  btn.innerText = 'Intentar de nuevo';
                });
              } else {
                alert('No se pudo cargar el anuncio. Comprueba tu conexión e intenta de nuevo.');
                btn.disabled = false;
                btn.innerText = 'Intentar de nuevo';
              }
            }, 1500);
          }
        }
      </script>
    </body>
    </html>
    `;

    res.send(html);
  });

  // Reclamo de recompensas
  app.post('/claim-reward', async (req, res) => {
    try {
      const { userId, purpose } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, msg: 'Identificador de usuario faltante.' });
      }

      const uid = parseInt(userId, 10);
      const player = await Player.findOne({ userId: uid });
      if (!player) {
        return res.status(404).json({ success: false, msg: 'Aventurero no registrado en el reino.' });
      }

      const todayUtc = getTodayUtcString();

      // Flujo de desbloqueo Caza Auto Plus
      if (purpose === 'bounty_plus') {
        let bounty = await PlayerBounty.findOne({ userId: uid, bountyDateUtc: todayUtc });
        if (!bounty) {
          return res.status(400).json({ success: false, msg: 'No tienes un contrato de caza activo hoy.' });
        }

        bounty.adsClaimedForBounty = (bounty.adsClaimedForBounty || 0) + 1;
        await bounty.save();

        player.totalAdsClaimed = (player.totalAdsClaimed || 0) + 1;
        await player.save();

        const currentCount = bounty.adsClaimedForBounty;
        const msg = currentCount >= 2
          ? '🎉 ¡Completaste los 2 anuncios! El Modo Auto Plus ha quedado activado en tu Tablón.'
          : '✅ Anuncio completado (' + currentCount + '/2). Mira 1 más para desbloquear el Modo Plus.';

        return res.json({ success: true, msg });
      }

      // Flujo tradicional: Bebida Energética
      const today = new Date().toISOString().slice(0, 10);
      if (player.lastAdClaimDate !== today) {
        player.adsClaimedToday = 0;
        player.lastAdClaimDate = today;
      }

      if ((player.adsClaimedToday || 0) >= 3) {
        return res.status(400).json({
          success: false,
          msg: 'Alcanzaste el límite de 3 bebidas energéticas por anuncios por hoy.'
        });
      }

      if ((player.potionsEnergyDrink || 0) >= 5) {
        return res.status(400).json({
          success: false,
          msg: 'Tu mochila ya tiene el tope máximo de 5 bebidas energéticas.'
        });
      }

      player.adsClaimedToday = (player.adsClaimedToday || 0) + 1;
      player.totalAdsClaimed = (player.totalAdsClaimed || 0) + 1;
      player.potionsEnergyDrink = (player.potionsEnergyDrink || 0) + 1;
      await player.save();

      return res.json({
        success: true,
        msg: '🥤 ¡Bebida Energética recibida en tu mochila! (+2 ⚡)'
      });
    } catch (err) {
      console.error('Error en /claim-reward:', err);
      res.status(500).json({ success: false, msg: 'Error interno del servidor.' });
    }
  });

  app.listen(PORT, () => {
    console.log(`🌐 Servidor WebApp escuchando en el puerto ${PORT}`);
  });
}

module.exports = startServer;
