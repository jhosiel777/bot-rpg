const express = require('express');
const https = require('https');
const path = require('path');
const { Markup } = require('telegraf');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const { TonClient, WalletContractV4, internal, toNano } = require('@ton/ton');

const {
  Player,
  MAX_ENERGY,
  getTodayUtc,
  getYesterdayUtc,
  getDailyReward
} = require('./playerModel');
const { PlayerBounty, getTodayUtcString } = require('./bountyModel');

const ADMIN_WALLET_ADDRESS = 'UQACsFyGAD7F82-ta84_iLKmCyHsL3809ZmzRqHYZGTdXC1O';
const LOGS_GROUP_ID = -1004496297432;

let cachedBotWalletAddress = process.env.BOT_WALLET_ADDRESS || null;

// Obtiene o deriva automáticamente la dirección pública v4R2 de la billetera del bot
async function getBotWalletAddress() {
  if (cachedBotWalletAddress) return cachedBotWalletAddress;
  const mnemonic = process.env.BOT_WALLET_MNEMONIC;
  if (!mnemonic) return ADMIN_WALLET_ADDRESS;

  try {
    const words = mnemonic.trim().split(/\s+/);
    const keyPair = await mnemonicToPrivateKey(words);
    const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });
    cachedBotWalletAddress = wallet.address.toString({ bounceable: false });
    console.log('🤖 Billetera del bot identificada para depósitos:', cachedBotWalletAddress);
    return cachedBotWalletAddress;
  } catch (err) {
    console.error('Error calculando dirección del bot:', err.message);
    return ADMIN_WALLET_ADDRESS;
  }
}

// Transferencia desde la wallet v4R2 del bot
async function transferTonFromBot(messagesList) {
  const mnemonic = process.env.BOT_WALLET_MNEMONIC;
  if (!mnemonic) {
    throw new Error('BOT_WALLET_MNEMONIC no está configurado en las variables de entorno.');
  }

  const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: 'a251c1477baa2d17ace0208040e6e630ae127e0ed6bb319afc0c6245abd813dc'
  });

  const words = mnemonic.trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(words);
  const workchain = 0;
  const wallet = WalletContractV4.create({ workchain, publicKey: keyPair.publicKey });

  const walletContract = client.open(wallet);
  const seqno = await walletContract.getSeqno();

  const internalMessages = messagesList.map((m) =>
    internal({
      to: m.to,
      value: toNano(m.amount.toString()),
      bounce: false,
      body: m.body || 'Pago automático - Abyss RPG'
    })
  );

  await walletContract.sendTransfer({
    secretKey: keyPair.secretKey,
    seqno: seqno,
    messages: internalMessages
  });

  return true;
}

// Log general de pagos y compras para el grupo administrativo
async function sendPaymentLog(bot, { player, productName, amount, txHash }) {
  const now = new Date();
  const fechaHoraUtc = now.toISOString().replace('T', ' ').slice(0, 19);

  let walletDisplay = '`No vinculada`';
  let tonviewerLink = '';
  let inlineKeyboard = null;

  if (player.tonWalletAddress) {
    walletDisplay = '`' + player.tonWalletAddress + '`';
    const url = 'https://tonviewer.com/' + player.tonWalletAddress;
    tonviewerLink = '\n🔍 [Ver en Tonviewer](' + url + ')';
    inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.url('🔍 Ver en Tonviewer (Billetera)', url)]
    ]);
  }

  const hashDisplay = txHash ? '`' + txHash + '`' : '`N/A`';

  const logText = '💎 *¡TRANSACCIÓN DETECTADA!* 💎\n\n' +
                  '👤 *Aventurero:* ' + player.name + '\n' +
                  '🆔 *ID de Telegram:* `' + player.userId + '`\n' +
                  '💳 *Billetera:* ' + walletDisplay + '\n' +
                  '📦 *Concepto:* ' + productName + '\n' +
                  '💰 *Monto:* ' + amount + ' TON / GRAM\n' +
                  '🔗 *Hash / TxID:* ' + hashDisplay + '\n' +
                  '⏰ *Fecha y Hora:* ' + fechaHoraUtc + ' UTC' +
                  tonviewerLink;

  try {
    const extra = { parse_mode: 'Markdown' };
    if (inlineKeyboard) Object.assign(extra, inlineKeyboard);
    await bot.telegram.sendMessage(LOGS_GROUP_ID, logText, extra);
  } catch (err) {
    console.error('Error enviando log de compra a Telegram:', err.message);
  }
}

function startServer(bot) {
  const app = express();
  const PORT = process.env.PORT || 3000;
  const SERVER_URL = process.env.RENDER_EXTERNAL_URL || 'https://bot-rpg-wu42.onrender.com';

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // ==========================================
  // RUTAS Y API DE LA MINI APP PVP
  // ==========================================
  app.use('/api/pvp', require('./routes/pvpRoutes'));

  app.get('/', (req, res) => res.send('Servidor del bot RPG activo.'));
  app.get('/ping', (req, res) => res.status(200).send('pong'));

  // ==========================================
  // CONECTAR WALLET (TON CONNECT)
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
        body { font-family: 'Segoe UI', sans-serif; background: #121826; color: #f1f5f9; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; text-align: center; }
        .card { background: #1e293b; border: 1px solid #334155; padding: 24px; border-radius: 16px; max-width: 380px; width: 100%; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
        .icon { font-size: 50px; margin-bottom: 10px; }
        h2 { margin: 0 0 10px 0; color: #38bdf8; font-size: 22px; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 20px 0; }
        #ton-connect-btn { display: flex; justify-content: center; margin-bottom: 16px; }
        .status-box { background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 12px; font-size: 13px; color: #cbd5e1; word-break: break-all; margin-bottom: 16px; }
        .btn-close { background: #334155; color: white; border: none; padding: 12px 18px; font-size: 14px; font-weight: bold; border-radius: 10px; cursor: pointer; width: 100%; }
        .footer-note { font-size: 12px; color: #64748b; margin-top: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">💳💎</div>
        <h2>Billetera del Reino</h2>
        <p>Conecta tu billetera TON para vincular tu identidad en Abyss RPG y comerciar artefactos ancestrales.</p>
        <div id="ton-connect-btn"></div>
        <div id="statusBox" class="status-box">Esperando conexión con tu billetera...</div>
        <button class="btn-close" onclick="closeWebApp()">Listo / Cerrar</button>
        <div class="footer-note">Compatible con Tonkeeper, Telegram Wallet y MyTonWallet.</div>
      </div>
      <script>
        const tg = window.Telegram?.WebApp;
        if (tg) tg.expand();
        let userId = '${userId}';
        if (!userId && tg?.initDataUnsafe?.user?.id) userId = tg.initDataUnsafe.user.id;

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
            saveWalletToServer(wallet.account.address);
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

  app.post('/save-wallet', async (req, res) => {
    try {
      const { userId, walletAddress } = req.body;
      if (!userId || !walletAddress) return res.status(400).json({ success: false, msg: 'Datos incompletos.' });

      const uid = parseInt(userId, 10);
      const player = await Player.findOne({ userId: uid });
      if (!player) return res.status(404).json({ success: false, msg: 'Aventurero no encontrado.' });

      player.tonWalletAddress = walletAddress;
      await player.save();
      return res.json({ success: true, msg: 'Billetera vinculada correctamente.' });
    } catch (err) {
      return res.status(500).json({ success: false, msg: 'Error interno del servidor.' });
    }
  });

  // ==========================================
  // RECARGA DE FONDOS GRAM (/deposit-gram) -> LLEGA A LA WALLET DEL BOT
  // ==========================================
  app.get('/deposit-gram', async (req, res) => {
    const userId = req.query.userId || '';
    const depositTargetWallet = await getBotWalletAddress();

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Recarga de GRAM - Abyss RPG</title>
      <script src="https://telegram.org/js/telegram-web-app.js"></script>
      <script src="https://unpkg.com/@tonconnect/ui@latest/dist/tonconnect-ui.min.js"></script>
      <style>
        body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f1f5f9; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; text-align: center; }
        .card { background: #1e293b; border: 1px solid #38bdf8; padding: 24px; border-radius: 18px; max-width: 380px; width: 100%; box-shadow: 0 10px 30px rgba(56, 189, 248, 0.2); }
        .icon { font-size: 52px; margin-bottom: 8px; }
        h2 { margin: 0 0 6px 0; color: #38bdf8; font-size: 22px; }
        p { color: #94a3b8; font-size: 13px; line-height: 1.4; margin: 0 0 16px 0; }
        .grid-amounts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
        .btn-amt { background: #0f172a; border: 1px solid #334155; color: #f8fafc; padding: 10px; border-radius: 10px; font-weight: bold; cursor: pointer; transition: 0.2s; }
        .btn-amt.selected { border-color: #38bdf8; background: #0369a1; color: white; }
        .custom-input { width: 92%; padding: 10px; border-radius: 10px; border: 1px solid #334155; background: #0f172a; color: #fff; font-size: 14px; text-align: center; margin-bottom: 14px; }
        .btn-pay { background: #0284c7; color: white; border: none; padding: 14px; font-size: 16px; font-weight: bold; border-radius: 12px; cursor: pointer; width: 100%; display: none; }
        .btn-pay:hover { background: #0369a1; }
        .btn-pay:disabled { background: #475569; cursor: not-allowed; }
        .status-box { background: #020617; border: 1px solid #334155; border-radius: 10px; padding: 10px; font-size: 12px; color: #cbd5e1; margin-top: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">🔮💎</div>
        <h2>Añadir Fondos (GRAM)</h2>
        <p>Los fondos se acreditarán en tu balance interno para apostar en duelos de la Arena y participar en la economía Web3.</p>

        <div id="ton-connect-btn" style="display:flex; justify-content:center; margin-bottom:14px;"></div>

        <div class="grid-amounts">
          <button class="btn-amt selected" onclick="selectAmount(0.05, this)">0.05 GRAM</button>
          <button class="btn-amt" onclick="selectAmount(0.10, this)">0.10 GRAM</button>
          <button class="btn-amt" onclick="selectAmount(0.25, this)">0.25 GRAM</button>
          <button class="btn-amt" onclick="selectAmount(0.50, this)">0.50 GRAM</button>
        </div>

        <input type="number" id="customAmount" class="custom-input" placeholder="Monto personalizado (0.05 a 5)" min="0.05" max="5.0" step="0.01" oninput="onCustomChange()">

        <button id="payGramBtn" class="btn-pay" onclick="sendGramDeposit()">Recargar Fondos</button>
        <div id="statusText" class="status-box">Conecta tu billetera para recargar.</div>
      </div>

      <script>
        const tg = window.Telegram?.WebApp;
        if (tg) tg.expand();
        let userId = '${userId}';
        if (!userId && tg?.initDataUnsafe?.user?.id) userId = tg.initDataUnsafe.user.id;

        let selectedAmount = 0.05;

        const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
          manifestUrl: 'https://bot-rpg-wu42.onrender.com/tonconnect-manifest.json',
          buttonRootId: 'ton-connect-btn'
        });

        const payBtn = document.getElementById('payGramBtn');
        const statusText = document.getElementById('statusText');

        function selectAmount(val, btn) {
          selectedAmount = val;
          document.getElementById('customAmount').value = '';
          document.querySelectorAll('.btn-amt').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          updateButtonText();
        }

        function onCustomChange() {
          const val = parseFloat(document.getElementById('customAmount').value);
          if (!isNaN(val) && val >= 0.05 && val <= 5.0) {
            selectedAmount = val;
            document.querySelectorAll('.btn-amt').forEach(b => b.classList.remove('selected'));
          }
          updateButtonText();
        }

        function updateButtonText() {
          payBtn.innerText = 'Recargar ' + selectedAmount.toFixed(2) + ' GRAM';
        }

        tonConnectUI.onStatusChange((wallet) => {
          if (wallet) {
            payBtn.style.display = 'block';
            updateButtonText();
            statusText.innerText = 'Billetera lista. Pulsa el botón para autorizar la recarga.';
          } else {
            payBtn.style.display = 'none';
            statusText.innerText = 'Conecta tu billetera para recargar.';
          }
        });

        async function sendGramDeposit() {
          if (selectedAmount < 0.05 || selectedAmount > 5.0) {
            alert('El monto debe situarse entre 0.05 y 5.00 GRAM.');
            return;
          }

          payBtn.disabled = true;
          statusText.innerText = 'Abriendo confirmación en tu billetera...';

          const nanoAmount = Math.round(selectedAmount * 1e9).toString();

          const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 360,
            messages: [
              {
                address: '${depositTargetWallet}',
                amount: nanoAmount
              }
            ]
          };

          try {
            const result = await tonConnectUI.sendTransaction(transaction);
            statusText.innerText = 'Transacción firmada. Acreditando saldo en tu cuenta...';
            const userWallet = tonConnectUI.account?.address || '';

            const res = await fetch('/confirm-gram-deposit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: userId,
                boc: result.boc,
                amount: selectedAmount,
                walletAddress: userWallet
              })
            });

            const data = await res.json();
            if (data.success) {
              alert(data.msg);
              if (tg) tg.close();
            } else {
              alert(data.msg || 'No se pudo procesar la entrega.');
              payBtn.disabled = false;
            }
          } catch (err) {
            console.error('Error al recargar:', err);
            statusText.innerText = 'Recarga cancelada desde la billetera.';
            payBtn.disabled = false;
          }
        }
      </script>
    </body>
    </html>
    `;
    res.send(html);
  });

  app.post('/confirm-gram-deposit', async (req, res) => {
    try {
      const { userId, boc, amount, walletAddress } = req.body;
      const numAmount = parseFloat(amount);
      if (!userId || isNaN(numAmount) || numAmount < 0.05) {
        return res.status(400).json({ success: false, msg: 'Datos de recarga inválidos.' });
      }

      const uid = parseInt(userId, 10);
      const player = await Player.findOne({ userId: uid });
      if (!player) return res.status(404).json({ success: false, msg: 'Aventurero no encontrado.' });

      if (walletAddress) player.tonWalletAddress = walletAddress;

      player.gram = (player.gram || 0) + numAmount;
      await player.save();

      await sendPaymentLog(bot, {
        player,
        productName: 'Recarga de ' + numAmount + ' GRAM (A Billetera del Bot)',
        amount: numAmount.toString(),
        txHash: boc ? boc.slice(0, 32) + '...' : null
      });

      try {
        const walletTarget = player.tonWalletAddress || walletAddress;
        let depositReceipt = '💎 *¡RECARGA EXITOSA!* 💎\n\n' +
                             'Se han acreditado *+' + numAmount.toFixed(2) + ' GRAM* a tu saldo interno.\n' +
                             'Balance disponible: *' + player.gram.toFixed(3) + ' GRAM*.\n\n';

        let extraButtons = [];
        if (walletTarget) {
          depositReceipt += '🔍 [Ver en Tonviewer](https://tonviewer.com/' + walletTarget + ')\n\n';
          extraButtons.push([Markup.button.url('🔍 Ver en Tonviewer', 'https://tonviewer.com/' + walletTarget)]);
        }

        depositReceipt += '¡Ya puedes utilizarlo en la Arena de Duelos o gestionarlo en tu Hogar!';

        const extraOpts = { parse_mode: 'Markdown' };
        if (extraButtons.length > 0) {
          Object.assign(extraOpts, Markup.inlineKeyboard(extraButtons));
        }

        await bot.telegram.sendMessage(uid, depositReceipt, extraOpts);
      } catch (e) {
        console.error('Error enviando notificación de recarga al aventurero:', e.message);
      }

      return res.json({ success: true, msg: '¡Éxito! Se añadieron +' + numAmount + ' GRAM a tu cuenta.' });
    } catch (err) {
      return res.status(500).json({ success: false, msg: 'Error procesando la recarga.' });
    }
  });

  // ==========================================
  // COMPRA DE GEMA ANCESTRAL (/buy-web3) -> LLEGA A TU WALLET ADMIN
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
        body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #f1f5f9; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; text-align: center; }
        .card { background: #1e293b; border: 1px solid #38bdf8; padding: 24px; border-radius: 18px; max-width: 380px; width: 100%; box-shadow: 0 10px 30px rgba(56, 189, 248, 0.2); }
        .icon { font-size: 56px; margin-bottom: 8px; }
        h2 { margin: 0 0 6px 0; color: #38bdf8; font-size: 22px; }
        .tag { display: inline-block; background: #0369a1; color: #e0f2fe; font-size: 12px; font-weight: bold; padding: 4px 10px; border-radius: 12px; margin-bottom: 14px; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 16px 0; }
        .price-badge { background: #0f172a; border: 1px solid #f59e0b; color: #fbbf24; font-size: 18px; font-weight: bold; padding: 10px 16px; border-radius: 12px; margin-bottom: 18px; }
        #ton-connect-btn { display: flex; justify-content: center; margin-bottom: 14px; }
        .btn-buy { background: #0284c7; color: white; border: none; padding: 14px 20px; font-size: 16px; font-weight: bold; border-radius: 12px; cursor: pointer; width: 100%; display: none; }
        .btn-buy:hover { background: #0369a1; }
        .btn-buy:disabled { background: #475569; cursor: not-allowed; }
        .status-box { background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 12px; font-size: 13px; color: #cbd5e1; margin-top: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">🔮✨</div>
        <h2>Gema Ancestral</h2>
        <div class="tag">ARTEFACTO LEGENDARIO ÚNICO</div>
        <p>Aumenta permanentemente tu límite a <b>+2 Energía Máxima ⚡</b> y te otorga el título exclusivo <b>«Mecenas de Abyss»</b>.</p>
        <div class="price-badge">💎 0.15 TON</div>
        <div id="ton-connect-btn"></div>
        <button id="buyBtn" class="btn-buy" onclick="sendPayment()">Adquirir Gema Ancestral</button>
        <div id="statusText" class="status-box">Conecta tu billetera para continuar.</div>
      </div>
      <script>
        const tg = window.Telegram?.WebApp;
        if (tg) tg.expand();
        let userId = '${userId}';
        if (!userId && tg?.initDataUnsafe?.user?.id) userId = tg.initDataUnsafe.user.id;

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
                amount: '150000000'
              }
            ]
          };

          try {
            const result = await tonConnectUI.sendTransaction(transaction);
            statusText.innerText = 'Transacción firmada. Verificando en el reino...';
            const userWallet = tonConnectUI.account?.address || '';

            const res = await fetch('/confirm-ancestral-gem', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: userId,
                boc: result.boc,
                amount: '0.15',
                walletAddress: userWallet
              })
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

  app.post('/confirm-ancestral-gem', async (req, res) => {
    try {
      const { userId, boc, amount, walletAddress } = req.body;
      if (!userId) return res.status(400).json({ success: false, msg: 'ID de usuario ausente.' });

      const uid = parseInt(userId, 10);
      const player = await Player.findOne({ userId: uid });
      if (!player) return res.status(404).json({ success: false, msg: 'Aventurero no encontrado.' });

      if (player.hasAncestralGem) return res.status(400).json({ success: false, msg: 'Ya posees la Gema Ancestral.' });

      if (walletAddress) player.tonWalletAddress = walletAddress;

      player.hasAncestralGem = true;
      player.maxEnergy = (player.maxEnergy || 10) + 2;
      player.energy = player.maxEnergy;

      if (!player.unlockedTitles) player.unlockedTitles = ['Aventurero Novato'];
      if (!player.unlockedTitles.includes('Mecenas de Abyss')) {
        player.unlockedTitles.push('Mecenas de Abyss');
      }
      player.activeTitle = 'Mecenas de Abyss';
      await player.save();

      await sendPaymentLog(bot, {
        player,
        productName: 'Gema Ancestral (Pago a Creador)',
        amount: amount || '0.15',
        txHash: boc ? boc.slice(0, 32) + '...' : null
      });

      try {
        await bot.telegram.sendMessage(
          uid,
          '🔮✨ *¡FELICITACIONES, AVENTURERO!*\n\n' +
          'Has adquirido la legendaria *Gema Ancestral*.\n\n' +
          '⚡ Tu energía máxima ha aumentado en *+2* (Ahora tienes *' + player.maxEnergy + ' ⚡*).\n' +
          '🎖️ Se te ha conferido el título honorífico: «*Mecenas de Abyss*».\n\n' +
          '_El reino recuerda con gratitud a sus protectores y benefactores._',
          { parse_mode: 'Markdown' }
        );
      } catch (e) {}

      return res.json({ success: true, msg: '¡Éxito! Gema Ancestral activada (+2 ⚡). Tu energía máxima ahora es ' + player.maxEnergy + ' y recibiste el título «Mecenas de Abyss».' });
    } catch (err) {
      return res.status(500).json({ success: false, msg: 'Error procesando la entrega.' });
    }
  });

  // ==========================================
  // TEST DE TRANSACCIÓN (/test-pay)
  // ==========================================
  app.get('/test-pay', async (req, res) => {
    const userId = req.query.userId || '';

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Modo Creador - Test TON</title>
      <script src="https://telegram.org/js/telegram-web-app.js"></script>
      <script src="https://unpkg.com/@tonconnect/ui@latest/dist/tonconnect-ui.min.js"></script>
      <style>
        body { font-family: sans-serif; background: #0f172a; color: #f1f5f9; padding: 20px; text-align: center; }
        .card { background: #1e293b; border: 1px dashed #f59e0b; padding: 24px; border-radius: 16px; max-width: 380px; margin: 40px auto; }
        .btn-test { background: #f59e0b; color: #000; font-weight: bold; padding: 14px 20px; border: none; border-radius: 12px; cursor: pointer; width: 100%; display: none; }
        .status-box { background: #020617; border: 1px solid #334155; border-radius: 10px; padding: 12px; font-size: 13px; margin-top: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div style="font-size: 48px;">🧪⚡</div>
        <h2>Test de Pago (0.011 TON)</h2>
        <p>Prueba de depósitos Web3 en producción.</p>
        <div id="ton-connect-btn" style="margin-bottom: 14px;"></div>
        <button id="payTestBtn" class="btn-test" onclick="sendTestPayment()">Enviar 0.011 TON</button>
        <div id="statusText" class="status-box">Conecta tu billetera para autorizar el test.</div>
      </div>
      <script>
        const tg = window.Telegram?.WebApp;
        if (tg) tg.expand();
        let userId = '${userId}';
        if (!userId && tg?.initDataUnsafe?.user?.id) userId = tg.initDataUnsafe.user.id;

        const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
          manifestUrl: 'https://bot-rpg-wu42.onrender.com/tonconnect-manifest.json',
          buttonRootId: 'ton-connect-btn'
        });

        const payBtn = document.getElementById('payTestBtn');
        const statusText = document.getElementById('statusText');

        tonConnectUI.onStatusChange((wallet) => {
          if (wallet) {
            payBtn.style.display = 'block';
            statusText.innerText = 'Billetera conectada: ' + wallet.account.address.slice(0, 6) + '...';
          } else {
            payBtn.style.display = 'none';
            statusText.innerText = 'Conecta tu billetera para autorizar el test.';
          }
        });

        async function sendTestPayment() {
          payBtn.disabled = true;
          statusText.innerText = 'Abriendo tu billetera...';
          const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 360,
            messages: [{ address: '${ADMIN_WALLET_ADDRESS}', amount: '11000000' }]
          };

          try {
            const result = await tonConnectUI.sendTransaction(transaction);
            statusText.innerText = 'Firmado. Enviando registro de test al servidor...';
            const userWallet = tonConnectUI.account?.address || '';

            const res = await fetch('/confirm-test-pay', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId: userId, boc: result.boc, amount: '0.011', walletAddress: userWallet })
            });

            const data = await res.json();
            alert(data.msg || 'Test finalizado.');
            if (tg) tg.close();
          } catch (err) {
            statusText.innerText = 'Transacción de test cancelada.';
            payBtn.disabled = false;
          }
        }
      </script>
    </body>
    </html>
    `;
    res.send(html);
  });

  app.post('/confirm-test-pay', async (req, res) => {
    try {
      const { userId, boc, amount, walletAddress } = req.body;
      const uid = parseInt(userId, 10);
      const player = await Player.findOne({ userId: uid });

      if (player && walletAddress) {
        player.tonWalletAddress = walletAddress;
        await player.save();
      }

      await sendPaymentLog(bot, {
        player: player || { name: 'Admin', userId: uid, tonWalletAddress: walletAddress },
        productName: 'Test xd',
        amount: amount || '0.011',
        txHash: boc ? boc.slice(0, 32) + '...' : null
      });

      return res.json({ success: true, msg: '¡Test de 0.011 TON procesado y log emitido!' });
    } catch (err) {
      return res.status(500).json({ success: false, msg: 'Error al emitir el log de prueba.' });
    }
  });

  // ==========================================
  // PAGO / RETIRO AUTOMÁTICO (BOT -> DESTINATARIO + COMISIÓN DIFERIDA)
  // ==========================================
  app.post('/send-ton-payout', async (req, res) => {
    try {
      const { userId, toAddress, amountTon, isUserWithdrawal, fee, playerName } = req.body;
      const ADMIN_ID = 835648800;

      if (!isUserWithdrawal && parseInt(userId, 10) !== ADMIN_ID) {
        return res.status(403).json({ success: false, msg: 'Acceso no autorizado.' });
      }

      if (!toAddress) return res.status(400).json({ success: false, msg: 'Dirección de destino faltante.' });

      const payoutAmount = amountTon || 0.01;
      const numFee = fee ? parseFloat(fee) : 0;

      // 1. Enviar primero el retiro neto a la billetera del usuario
      await transferTonFromBot([
        {
          to: toAddress,
          amount: payoutAmount,
          body: isUserWithdrawal ? 'Retiro de saldo - Abyss RPG' : 'Pago automático - Abyss RPG'
        }
      ]);

      const now = new Date();
      const fechaHoraUtc = now.toISOString().replace('T', ' ').slice(0, 19);
      const headerText = isUserWithdrawal ? '📤 *¡RETIRO DE GRAM COMPLETADO!* 📤' : '📤 *¡PAGO AUTOMÁTICO EMITIDO (TEST)!* 📤';
      const userText = isUserWithdrawal ? (playerName || 'Aventurero') : 'Administrador';
      const feeNote = numFee > 0 ? ('\n💡 *Comisión al creador (programada):* ' + numFee + ' TON') : '';

      // Log para el grupo administrativo
      try {
        const logMsg = headerText + '\n\n' +
                       '👤 *Destinatario:* ' + userText + '\n' +
                       '🆔 *ID:* `' + userId + '`\n' +
                       '💳 *Billetera:* `' + toAddress + '`\n' +
                       '💰 *Monto Enviado:* ' + payoutAmount + ' TON' + feeNote + '\n' +
                       '⏰ *Fecha y Hora:* ' + fechaHoraUtc + ' UTC\n\n' +
                       '🔍 [Ver en Tonviewer](https://tonviewer.com/' + toAddress + ')';

        await bot.telegram.sendMessage(
          LOGS_GROUP_ID,
          logMsg,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.url('🔍 Ver en Tonviewer', 'https://tonviewer.com/' + toAddress)]
            ])
          }
        );
      } catch (logErr) {
        console.error('Error enviando log de payout:', logErr.message);
      }

      // 2. Transferencia de comisión diferida (15 seg para que TON actualice el seqno)
      if (isUserWithdrawal && numFee > 0) {
        setTimeout(async () => {
          try {
            await transferTonFromBot([
              {
                to: ADMIN_WALLET_ADDRESS,
                amount: numFee,
                body: 'Comisión retiro - Abyss RPG'
              }
            ]);
            console.log('✅ Comisión de ' + numFee + ' TON enviada exitosamente al creador.');
          } catch (feeErr) {
            console.error('Error enviando comisión diferida al creador:', feeErr.message);
          }
        }, 15000);
      }

      return res.json({ success: true, msg: 'Transferencia emitida exitosamente.' });
    } catch (err) {
      console.error('Error en /send-ton-payout:', err);
      return res.status(500).json({ success: false, msg: err.message });
    }
  });

  // ==========================================
  // PANTALLAS DE ANUNCIOS: BONO DIARIO Y RECOMPENSAS
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
      <script src="//libtl.com/sdk.js" data-zone="12000502" data-sdk="show_12000502"></script>
      <style>
        body { font-family: 'Segoe UI', sans-serif; background: #121826; color: #f1f5f9; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; text-align: center; }
        .card { background: #1e293b; border: 1px solid #334155; padding: 24px; border-radius: 16px; max-width: 380px; width: 100%; box-shadow: 0 8px 24px rgba(0,0,0,0.4); position: relative; }
        .story-bars { display: flex; gap: 8px; margin-bottom: 20px; width: 100%; }
        .bar { flex: 1; height: 4px; background: #334155; border-radius: 2px; transition: background 0.3s; }
        .bar.completed { background: #38bdf8; }
        .icon { font-size: 54px; margin-bottom: 12px; }
        h2 { margin: 0 0 10px 0; color: #38bdf8; font-size: 22px; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 18px 0; }
        .btn { background: #0284c7; color: white; border: none; padding: 14px 20px; font-size: 16px; font-weight: bold; border-radius: 12px; cursor: pointer; width: 100%; transition: background 0.2s; }
        .btn:hover { background: #0369a1; }
        .btn:disabled { background: #475569; cursor: not-allowed; }
        .footer-note { font-size: 12px; color: #64748b; margin-top: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="story-bars">
          <div id="bar-1" class="bar"></div>
          <div id="bar-2" class="bar"></div>
        </div>
        <div class="icon">🎁✨</div>
        <h2>Bono Diario del Reino</h2>
        <p id="descText">Mira 2 breves anuncios patrocinados para respaldar el desarrollo de Abyss y recibir tu botín diario.</p>
        <button class="btn" id="watchBtn" onclick="watchStepAd()">📺 Ver Anuncio (1/2)</button>
        <div class="footer-note" id="noteText">Mira el primer anuncio para avanzar en la barra.</div>
      </div>
      <script>
        const tg = window.Telegram?.WebApp;
        if (tg) tg.expand();
        let userId = '${userId}';
        if (!userId && tg?.initDataUnsafe?.user?.id) userId = tg.initDataUnsafe.user.id;

        let adsWatched = 0;
        const totalAds = 2;
        let stepAdActive = false;
        let stepAdStartTime = 0;

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
              btn.innerText = 'Reintentar Reclamo';
            }
          } catch (err) {
            alert('Error conectando con el servidor.');
            btn.disabled = false;
            btn.innerText = 'Reintentar Reclamo';
          }
        }

        function handleStepAdSuccess() {
          const btn = document.getElementById('watchBtn');
          adsWatched++;
          const bar = document.getElementById('bar-' + adsWatched);
          if (bar) bar.classList.add('completed');

          if (adsWatched < totalAds) {
            btn.disabled = false;
            btn.innerText = '📺 Ver Anuncio (2/2)';
            document.getElementById('noteText').innerText = '¡Falta 1 anuncio! Toca para ver el último.';
          } else {
            btn.innerText = '¡Completado! Entregando botín...';
            document.getElementById('noteText').innerText = '¡Secuencia completada con éxito!';
            triggerDailyClaim();
          }
        }

        function watchStepAd() {
          const btn = document.getElementById('watchBtn');
          btn.disabled = true;

          if (typeof show_12000502 !== 'function') {
            alert('El proveedor de anuncios se está cargando. Espera unos segundos.');
            btn.disabled = false;
            return;
          }

          stepAdActive = true;
          stepAdStartTime = Date.now();
          btn.innerText = 'Cargando anuncio...';

          const safetyTimeout = setTimeout(() => {
            if (stepAdActive) {
              stepAdActive = false;
              btn.disabled = false;
              btn.innerText = adsWatched === 0 ? '📺 Ver Anuncio (1/2)' : '📺 Ver Anuncio (2/2)';
            }
          }, 35000);

          const onReturnFocus = () => {
            if (!stepAdActive) return;
            const elapsed = (Date.now() - stepAdStartTime) / 1000;
            if (elapsed >= 10) {
              stepAdActive = false;
              clearTimeout(safetyTimeout);
              window.removeEventListener('focus', onReturnFocus);
              document.removeEventListener('visibilitychange', onReturnFocus);
              handleStepAdSuccess();
            }
          };

          window.addEventListener('focus', onReturnFocus);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') onReturnFocus();
          });

          try {
            Promise.resolve(show_12000502())
              .then(() => {
                if (stepAdActive) {
                  stepAdActive = false;
                  clearTimeout(safetyTimeout);
                  window.removeEventListener('focus', onReturnFocus);
                  handleStepAdSuccess();
                }
              })
              .catch(() => {
                const elapsed = (Date.now() - stepAdStartTime) / 1000;
                if (elapsed >= 10 && stepAdActive) {
                  stepAdActive = false;
                  clearTimeout(safetyTimeout);
                  window.removeEventListener('focus', onReturnFocus);
                  handleStepAdSuccess();
                } else {
                  stepAdActive = false;
                  clearTimeout(safetyTimeout);
                  window.removeEventListener('focus', onReturnFocus);
                  alert('Debes ver el anuncio completo para avanzar.');
                  btn.disabled = false;
                  btn.innerText = adsWatched === 0 ? '📺 Ver Anuncio (1/2)' : '📺 Ver Anuncio (2/2)';
                }
              });
          } catch (e) {
            btn.disabled = false;
            btn.innerText = adsWatched === 0 ? '📺 Ver Anuncio (1/2)' : '📺 Ver Anuncio (2/2)';
          }
        }
      </script>
    </body>
    </html>
    `;
    res.send(html);
  });

  app.post('/claim-daily', async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ success: false, msg: 'Identificador ausente.' });

      const uid = parseInt(userId, 10);
      const player = await Player.findOne({ userId: uid });
      if (!player) return res.status(404).json({ success: false, msg: 'Aventurero no registrado.' });

      const today = getTodayUtc();
      const yesterday = getYesterdayUtc();

      if (player.lastDailyClaimDate === today) {
        return res.status(400).json({ success: false, msg: 'Ya reclamaste tu bono de hoy. Vuelve tras las 00:00 UTC.' });
      }

      if (player.lastDailyClaimDate === yesterday) {
        player.dailyStreak = (player.dailyStreak || 0) + 1;
      } else {
        player.dailyStreak = 1;
      }

      player.lastDailyClaimDate = today;
      const reward = getDailyReward(player.dailyStreak);
      player.gold = (player.gold || 0) + reward.gold;

      if (reward.givesElixir) player.potionsEnergy = (player.potionsEnergy || 0) + 1;
      player.totalAdsClaimed = (player.totalAdsClaimed || 0) + 1;
      await player.save();

      let rewardText = '🎉 ¡Bono del Día ' + player.dailyStreak + ' reclamado!\n+' + reward.gold + ' de Oro';
      if (reward.givesElixir) rewardText += ' y +1 Elixir de Energía (⚡)';

      return res.json({ success: true, msg: rewardText });
    } catch (err) {
      return res.status(500).json({ success: false, msg: 'Error interno del servidor.' });
    }
  });

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
      <script src="//libtl.com/sdk.js" data-zone="12000502" data-sdk="show_12000502"></script>
      <style>
        body { font-family: 'Segoe UI', sans-serif; background: #121826; color: #f1f5f9; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 90vh; text-align: center; }
        .card { background: #1e293b; border: 1px solid #334155; padding: 24px; border-radius: 16px; max-width: 380px; width: 100%; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
        .icon { font-size: 54px; margin-bottom: 12px; }
        h2 { margin: 0 0 10px 0; color: #38bdf8; font-size: 22px; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 18px 0; }
        .counter-badge { background: #0f172a; color: #fbbf24; font-weight: bold; font-size: 16px; padding: 8px 16px; border-radius: 20px; border: 1px solid #f59e0b; display: inline-block; margin-bottom: 18px; }
        .btn { background: #0284c7; color: white; border: none; padding: 14px 20px; font-size: 16px; font-weight: bold; border-radius: 12px; cursor: pointer; width: 100%; transition: background 0.2s; }
        .btn:hover { background: #0369a1; }
        .btn:disabled { background: #475569; cursor: not-allowed; }
        .footer-note { font-size: 12px; color: #64748b; margin-top: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">${purpose === 'bounty_plus' ? '⚡🎯' : '🥤⚡'}</div>
        <h2 id="title">${purpose === 'bounty_plus' ? 'Caza Diaria: Modo Auto Plus' : 'Suministro: Bebida Energética'}</h2>
        <p id="desc">${purpose === 'bounty_plus' ? 'Mira un anuncio patrocinado para respaldar el reino y desbloquear el cupo ampliado de pociones para la caza de hoy.' : 'Apoya al creador viendo este anuncio patrocinado y recibe 1x Bebida Energética (+2 ⚡) en tu inventario.'}</p>
        ${purpose === 'bounty_plus' ? '<div class="counter-badge" id="bountyCounter">Anuncios hoy: ' + bountyAdsCount + ' / 2</div>' : ''}
        <button class="btn" id="watchBtn" onclick="watchAd()">📺 Ver Anuncio</button>
        <div class="footer-note">Al finalizar el anuncio se acreditará el beneficio automáticamente.</div>
      </div>
      <script>
        const tg = window.Telegram?.WebApp;
        if (tg) tg.expand();
        let userId = '${userId}';
        const purpose = '${purpose}';
        if (!userId && tg?.initDataUnsafe?.user?.id) userId = tg.initDataUnsafe.user.id;

        let adActive = false;
        let adStartTime = 0;

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
                counter.innerText = 'Anuncios hoy: ' + Math.min(2, currentCount + 1) + ' / 2';
              }
              if (tg) tg.close();
            } else {
              alert(data.msg || 'No se pudo entregar la recompensa.');
              btn.disabled = false;
              btn.innerText = '📺 Ver Anuncio';
            }
          } catch (err) {
            btn.disabled = false;
            btn.innerText = '📺 Ver Anuncio';
          }
        }

        function watchAd() {
          const btn = document.getElementById('watchBtn');
          btn.disabled = true;
          btn.innerText = 'Cargando anuncio...';

          if (typeof show_12000502 !== 'function') {
            alert('El proveedor de anuncios aún no está listo. Espera unos segundos e intenta nuevamente.');
            btn.disabled = false;
            btn.innerText = '📺 Ver Anuncio';
            return;
          }

          adActive = true;
          adStartTime = Date.now();

          const safetyTimeout = setTimeout(() => {
            if (adActive) {
              adActive = false;
              btn.disabled = false;
              btn.innerText = '📺 Ver Anuncio';
            }
          }, 35000);

          const onReturnFocus = () => {
            if (!stepAdActive) return;
            const elapsed = (Date.now() - adStartTime) / 1000;
            if (elapsed >= 10) {
              adActive = false;
              clearTimeout(safetyTimeout);
              window.removeEventListener('focus', onReturnFocus);
              document.removeEventListener('visibilitychange', onReturnFocus);
              triggerRewardClaim();
            }
          };

          window.addEventListener('focus', onReturnFocus);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') onReturnFocus();
          });

          try {
            Promise.resolve(show_12000502())
              .then(() => {
                if (adActive) {
                  adActive = false;
                  clearTimeout(safetyTimeout);
                  window.removeEventListener('focus', onReturnFocus);
                  triggerRewardClaim();
                }
              })
              .catch(() => {
                const elapsed = (Date.now() - stepAdStartTime) / 1000;
                if (elapsed >= 10 && adActive) {
                  adActive = false;
                  clearTimeout(safetyTimeout);
                  window.removeEventListener('focus', onReturnFocus);
                  triggerRewardClaim();
                } else {
                  adActive = false;
                  clearTimeout(safetyTimeout);
                  window.removeEventListener('focus', onReturnFocus);
                  alert('Debes ver el anuncio completo para recibir la recompensa.');
                  btn.disabled = false;
                  btn.innerText = '📺 Ver Anuncio';
                }
              });
          } catch (e) {
            btn.disabled = false;
            btn.innerText = '📺 Ver Anuncio';
          }
        }
      </script>
    </body>
    </html>
    `;
    res.send(html);
  });

  app.post('/claim-reward', async (req, res) => {
    try {
      const { userId, purpose } = req.body;
      if (!userId) return res.status(400).json({ success: false, msg: 'Identificador ausente.' });

      const uid = parseInt(userId, 10);
      const player = await Player.findOne({ userId: uid });
      if (!player) return res.status(404).json({ success: false, msg: 'Aventurero no registrado.' });

      const todayUtc = getTodayUtcString();

      if (purpose === 'bounty_plus') {
        let bounty = await PlayerBounty.findOne({ userId: uid, bountyDateUtc: todayUtc });
        if (!bounty) return res.status(400).json({ success: false, msg: 'No tienes un contrato de caza activo hoy.' });

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

      const today = new Date().toISOString().slice(0, 10);
      if (player.lastAdClaimDate !== today) {
        player.adsClaimedToday = 0;
        player.lastAdClaimDate = today;
      }

      if ((player.adsClaimedToday || 0) >= 3) {
        return res.status(400).json({ success: false, msg: 'Alcanzaste el límite de 3 bebidas energéticas por hoy.' });
      }

      if ((player.potionsEnergyDrink || 0) >= 5) {
        return res.status(400).json({ success: false, msg: 'Tu mochila ya tiene el tope de 5 bebidas energéticas.' });
      }

      player.adsClaimedToday = (player.adsClaimedToday || 0) + 1;
      player.totalAdsClaimed = (player.totalAdsClaimed || 0) + 1;
      player.potionsEnergyDrink = (player.potionsEnergyDrink || 0) + 1;
      await player.save();

      return res.json({ success: true, msg: '🥤 ¡Bebida Energética recibida en tu mochila! (+2 ⚡)' });
    } catch (err) {
      res.status(500).json({ success: false, msg: 'Error interno del servidor.' });
    }
  });

  app.listen(PORT, () => {
    console.log(`🌐 Servidor WebApp escuchando en el puerto ${PORT}`);

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
