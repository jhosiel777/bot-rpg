const express = require('express');
const https = require('https');
const path = require('path');
const {
  Player,
  MAX_ENERGY,
  getTodayUtc,
  getYesterdayUtc,
  getDailyReward
} = require('./playerModel');
const { PlayerBounty, getTodayUtcString } = require('./bountyModel');

const ADMIN_WALLET_ADDRESS = 'UQACsFyGAD7F82-ta84_iLKmCyHsL3809ZmzRqHYZGTdXC1O';

function startServer(bot) {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://bot-rpg-wu42.onrender.com';

  app.use(express.json());

  // Servir archivos estáticos de la carpeta public (manifiesto, icono, etc.)
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/', (req, res) => {
    res.send('Servidor del bot RPG activo.');
  });

  // Endpoint de latido para el auto-ping
  app.get('/ping', (req, res) => {
    res.status(200).send('pong');
  });

  // ==========================================
  // PANTALLA: CONECTAR WALLET (TON CONNECT)
  // ==========================================
  app.get('/connect-wallet', async (req, res) => {
    const userId = req.query.userId || '';

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Vincular Billetera TON</title>
      <script src="https://telegram.org/js/telegram-web-app.js"></script>
      <script src="https://unpkg.com/@tonconnect/ui@latest/dist/tonconnect-ui.min.js"></script>

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
        .icon { font-size: 50px; margin-bottom: 10px; }
        h2 { margin: 0 0 10px 0; color: #38bdf8; font-size: 22px; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 20px 0; }
        #ton-connect-btn {
          display: flex;
          justify-content: center;
          margin-bottom: 16px;
        }
        .status-box {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 12px;
          font-size: 13px;
          color: #cbd5e1;
          word-break: break-all;
          margin-bottom: 16px;
        }
        .btn-close {
          background: #334155;
          color: white;
          border: none;
          padding: 12px 18px;
          font-size: 14px;
          font-weight: bold;
          border-radius: 10px;
          cursor: pointer;
          width: 100%;
        }
        .btn-close:hover { background: #475569; }
        .footer-note { font-size: 12px; color: #64748b; margin-top: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">💳💎</div>
        <h2>Billetera del Reino</h2>
        <p>Conecta tu billetera TON para vincular tu identidad en Abyss RPG y comerciar artefactos ancestrales.</p>

        <div id="ton-connect-btn"></div>

        <div id="statusBox" class="status-box">
          Esperando conexión con tu billetera...
        </div>

        <button class="btn-close" onclick="closeWebApp()">Listo / Cerrar</button>
        <div class="footer-note">Compatible con Tonkeeper, Telegram Wallet y MyTonWallet.</div>
      </div>

      <script>
        const tg = window.Telegram?.WebApp;
        if (tg) tg.expand();

        let userId = '${userId}';
        if (!userId && tg?.initDataUnsafe?.user?.id) {
          userId = tg.initDataUnsafe.user.id;
        }

        const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
          manifestUrl: 'https://bot-rpg-wu42.onrender.com/tonconnect-manifest.json',
          buttonRootId: 'ton-connect-btn'
        });

        async function saveWalletToServer(address) {
          const statusBox = document.getElementById('statusBox');
          statusBox.innerText = 'Guardando dirección en tu perfil...';

          try {
            const res = await fetch('/save-wallet', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: userId, walletAddress: address })
            });
            const data = await res.json();

            if (data.success) {
              statusBox.innerHTML = '✅ <b>Billetera vinculada:</b><br><code>' + address.slice(0, 6) + '...' + address.slice(-6) + '</code>';
            } else {
              statusBox.innerText = '⚠️ ' + (data.msg || 'Error al guardar la billetera.');
            }
          } catch (e) {
            statusBox.innerText = '❌ Error de comunicación con el servidor.';
          }
        }

        tonConnectUI.onStatusChange((wallet) => {
          const statusBox = document.getElementById('statusBox');
          if (wallet) {
            const userFriendlyAddress = wallet.account.address;
            saveWalletToServer(userFriendlyAddress);
          } else {
            statusBox.innerText = 'Billetera desconectada. Toca el botón de arriba para conectar.';
          }
        });

        function closeWebApp() {
          if (tg) tg.close();
        }
      </script>
    </body>
    </html>
    `;

    res.send(html);
  });

  // Endpoint para guardar la wallet del aventurero
  app.post('/save-wallet', async (req, res) => {
    try {
      const { userId, walletAddress } = req.body;
      if (!userId || !walletAddress) {
        return res.status(400).json({ success: false, msg: 'Datos incompletos.' });
      }

      const uid = parseInt(userId, 10);
      const player = await Player.findOne({ userId: uid });
      if (!player) {
        return res.status(404).json({ success: false, msg: 'Aventurero no encontrado.' });
      }

      player.tonWalletAddress = walletAddress;
      await player.save();

      return res.json({ success: true, msg: 'Billetera vinculada correctamente.' });
    } catch (err) {
      console.error('Error en /save-wallet:', err);
      return res.status(500).json({ success: false, msg: 'Error interno del servidor.' });
    }
  });

  // ==========================================
  // PANTALLA: COMPRA DE GEMA ANCESTRAL (/buy-web3)
  // ==========================================
  app.get('/buy-web3', async (req, res) => {
    const userId = req.query.userId || '';

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Mercader Misterioso - Gema Ancestral</title>
      <script src="https://telegram.org/js/telegram-web-app.js"></script>
      <script src="https://unpkg.com/@tonconnect/ui@latest/dist/tonconnect-ui.min.js"></script>

      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: #0f172a;
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
          border: 1px solid #38bdf8;
          padding: 24px;
          border-radius: 18px;
          max-width: 380px;
          width: 100%;
          box-shadow: 0 10px 30px rgba(56, 189, 248, 0.2);
        }
        .icon { font-size: 56px; margin-bottom: 8px; }
        h2 { margin: 0 0 6px 0; color: #38bdf8; font-size: 22px; }
        .tag {
          display: inline-block;
          background: #0369a1;
          color: #e0f2fe;
          font-size: 12px;
          font-weight: bold;
          padding: 4px 10px;
          border-radius: 12px;
          margin-bottom: 14px;
        }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 16px 0; }
        .price-badge {
          background: #0f172a;
          border: 1px solid #f59e0b;
          color: #fbbf24;
          font-size: 18px;
          font-weight: bold;
          padding: 10px 16px;
          border-radius: 12px;
          margin-bottom: 18px;
        }
        #ton-connect-btn {
          display: flex;
          justify-content: center;
          margin-bottom: 14px;
        }
        .btn-buy {
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
          display: none;
        }
        .btn-buy:hover { background: #0369a1; }
        .btn-buy:disabled { background: #475569; cursor: not-allowed; }
        .status-box {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 12px;
          font-size: 13px;
          color: #cbd5e1;
          margin-top: 14px;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">🔮✨</div>
        <h2>Gema Ancestral</h2>
        <div class="tag">ARTEFACTO LEGENDARIO ÚNICO</div>
        <p>Aumenta permanentemente tu límite a <b>+1 Energía Máxima</b> y te otorga el título exclusivo <b>«Mecenas de Abyss»</b>.</p>

        <div class="price-badge">💎 0.15 TON</div>

        <div id="ton-connect-btn"></div>

        <button id="buyBtn" class="btn-buy" onclick="sendPayment()">Adquirir Gema Ancestral</button>

        <div id="statusText" class="status-box">Conecta tu billetera para continuar.</div>
      </div>

      <script>
        const tg = window.Telegram?.WebApp;
        if (tg) tg.expand();

        let userId = '${userId}';
        if (!userId && tg?.initDataUnsafe?.user?.id) {
          userId = tg.initDataUnsafe.user.id;
        }

        const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
          manifestUrl: 'https://bot-rpg-wu42.onrender.com/tonconnect-manifest.json',
          buttonRootId: 'ton-connect-btn'
        });

        const buyBtn = document.getElementById('buyBtn');
        const statusText = document.getElementById('statusText');

        tonConnectUI.onStatusChange((wallet) => {
          if (wallet) {
            buyBtn.style.display = 'block';
            statusText.innerText = 'Billetera lista. Pulsa el botón para autorizar la compra.';
          } else {
            buyBtn.style.display = 'none';
            statusText.innerText = 'Conecta tu billetera para continuar.';
          }
        });

        async function sendPayment() {
          buyBtn.disabled = true;
          statusText.innerText = 'Abriendo confirmación en tu billetera...';

          const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 360,
            messages: [
              {
                address: '${ADMIN_WALLET_ADDRESS}',
                amount: '150000000' // 0.15 TON en nanotons
              }
            ]
          };

          try {
            const result = await tonConnectUI.sendTransaction(transaction);
            statusText.innerText = 'Transacción firmada. Verificando en el reino...';

            const res = await fetch('/confirm-ancestral-gem', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: userId, boc: result.boc })
            });

            const data = await res.json();
            if (data.success) {
              alert(data.msg);
              if (tg) tg.close();
            } else {
              alert(data.msg || 'No se pudo validar la entrega.');
              buyBtn.disabled = false;
            }
          } catch (err) {
            console.error('Error al pagar:', err);
            statusText.innerText = 'Pago cancelado o rechazado desde la billetera.';
            buyBtn.disabled = false;
          }
        }
      </script>
    </body>
    </html>
    `;

    res.send(html);
  });

  // Endpoint para acreditar la Gema Ancestral y el Título
  app.post('/confirm-ancestral-gem', async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, msg: 'ID de usuario ausente.' });
      }

      const uid = parseInt(userId, 10);
      const player = await Player.findOne({ userId: uid });
      if (!player) {
        return res.status(404).json({ success: false, msg: 'Aventurero no encontrado.' });
      }

      if (player.hasAncestralGem) {
        return res.status(400).json({ success: false, msg: 'Ya posees la Gema Ancestral en tu inventario.' });
      }

      player.hasAncestralGem = true;
      player.maxEnergy = (player.maxEnergy || 12) + 1;
      player.energy = player.maxEnergy;

      if (!player.unlockedTitles) player.unlockedTitles = ['Aventurero Novato'];
      if (!player.unlockedTitles.includes('Mecenas de Abyss')) {
        player.unlockedTitles.push('Mecenas de Abyss');
      }
      player.activeTitle = 'Mecenas de Abyss';

      await player.save();

      try {
        await bot.telegram.sendMessage(
          uid,
          `🔮✨ *¡FELICITACIONES, AVENTURERO!*\n\n` +
          `Has adquirido la legendaria *Gema Ancestral*.\n\n` +
          `⚡ Tu energía máxima ha aumentado a *${player.maxEnergy} ⚡*.\n` +
          `🎖️ Se te ha conferido el título honorífico: «*Mecenas de Abyss*».\n\n` +
          `_El reino recuerda con gratitud a sus protectores y benefactores._`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        console.error('No se pudo enviar mensaje de confirmación al bot:', e.message);
      }

      return res.json({
        success: true,
        msg: `¡Éxito! Gema Ancestral activada. Tu energía máxima ahora es ${player.maxEnergy} y recibiste el título «Mecenas de Abyss».`
      });
    } catch (err) {
      console.error('Error en /confirm-ancestral-gem:', err);
      return res.status(500).json({ success: false, msg: 'Error procesando la entrega.' });
    }
  });

  // ==========================================
  // PANTALLA DE ANUNCIO: BONO DIARIO
  // ==========================================
  app.get('/ad-daily', async (req, res) => {
    const userId = req.query.userId || '';

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Bono Diario del Reino</title>
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
        <div class="icon">🎁✨</div>
        <h2>Bono Diario del Reino</h2>
        <p>
          Mira este breve anuncio para respaldar el desarrollo del reino y acreditar tu oro y elixires del día.
        </p>

        <button class="btn" id="watchBtn" onclick="watchAd()">📺 Ver Anuncio y Reclamar</button>
        <div class="footer-note">Al finalizar el anuncio se entregará tu recompensa automáticamente.</div>
      </div>

      <script>
        const tg = window.Telegram?.WebApp;
        if (tg) tg.expand();

        let userId = '${userId}';
        if (!userId && tg?.initDataUnsafe?.user?.id) {
          userId = tg.initDataUnsafe.user.id;
        }

        async function triggerDailyClaim() {
          const btn = document.getElementById('watchBtn');
          btn.innerText = 'Acreditando botín...';

          try {
            const res = await fetch('/claim-daily', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: userId })
            });
            const data = await res.json();

            if (data.success) {
              alert(data.msg);
              if (tg) tg.close();
            } else {
              alert(data.msg || 'No se pudo reclamar el bono.');
              btn.disabled = false;
              btn.innerText = 'Intentar de nuevo';
            }
          } catch (err) {
            alert('Error conectando con el servidor.');
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
              triggerDailyClaim();
            }).catch((err) => {
              console.error('Error en anuncio Monetag:', err);
              alert('Debes ver el anuncio completo para recibir la recompensa.');
              btn.disabled = false;
              btn.innerText = 'Intentar de nuevo';
            });
          } else {
            setTimeout(() => {
              if (typeof show_12000502 === 'function') {
                show_12000502().then(() => {
                  triggerDailyClaim();
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

  // Endpoint para procesar el Bono Diario
  app.post('/claim-daily', async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({ success: false, msg: 'Identificador de usuario faltante.' });
      }

      const uid = parseInt(userId, 10);
      const player = await Player.findOne({ userId: uid });
      if (!player) {
        return res.status(404).json({ success: false, msg: 'Aventurero no registrado.' });
      }

      const today = getTodayUtc();
      const yesterday = getYesterdayUtc();

      if (player.lastDailyClaimDate === today) {
        return res.status(400).json({
          success: false,
          msg: 'Ya reclamaste tu bono diario de hoy. Vuelve tras las 00:00 UTC.'
        });
      }

      if (player.lastDailyClaimDate === yesterday) {
        player.dailyStreak = (player.dailyStreak || 0) + 1;
      } else {
        player.dailyStreak = 1;
      }

      player.lastDailyClaimDate = today;

      const reward = getDailyReward(player.dailyStreak);
      player.gold = (player.gold || 0) + reward.gold;

      if (reward.givesElixir) {
        player.potionsEnergy = (player.potionsEnergy || 0) + 1;
      }

      player.totalAdsClaimed = (player.totalAdsClaimed || 0) + 1;
      await player.save();

      let rewardText = `🎉 ¡Bono del Día ${player.dailyStreak} reclamado!\n+${reward.gold} de Oro`;
      if (reward.givesElixir) {
        rewardText += ' y +1 Elixir de Energía (⚡)';
      }

      return res.json({ success: true, msg: rewardText });
    } catch (err) {
      console.error('Error en /claim-daily:', err);
      return res.status(500).json({ success: false, msg: 'Error interno del servidor.' });
    }
  });

  // ==========================================
  // PANTALLA DE ANUNCIOS: TIENDA Y CAZA
  // ==========================================
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

  // Reclamo de recompensas generales
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

    // Auto-ping cada 10 minutos (600,000 ms) para evitar que Render duerma la instancia
    setInterval(() => {
      https.get(`${SERVER_URL}/ping`, (pingRes) => {
        console.log(`💓 Auto-ping enviado a ${SERVER_URL}/ping (Status: ${pingRes.statusCode})`);
      }).on('error', (err) => {
        console.error('⚠️ Error en auto-ping para Render:', err.message);
      });
    }, 10 * 60 * 1000);
  });
}

module.exports = startServer;
