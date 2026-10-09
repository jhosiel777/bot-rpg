const express = require('express');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 10000;

// Tu URL pública exacta de Render
const APP_URL = 'https://bot-rpg-wu42.onrender.com';

// Ruta raíz para responder con 200 OK a Render y al monitor
app.get('/', (req, res) => {
  res.status(200).send('OK - Bot activo y despierto');
});

function startServer() {
  app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP activo en puerto ${PORT}`);

    // Auto-ping cada 8 minutos hacia la URL pública
    // Esto genera tráfico web entrante real en Render y evita que se duerma
    setInterval(() => {
      https.get(APP_URL, (res) => {
        // Ping exitoso registrado internamente
      }).on('error', (err) => {
        console.error('Aviso auto-ping:', err.message);
      });
    }, 8 * 60 * 1000); // 8 minutos (Render se duerme a los 15)
  });
}

module.exports = startServer;
