const express = require('express');

function startServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  app.get('/', (req, res) => res.send('Bot funcionando'));
  
  app.listen(port, () => {
    console.log(`Servidor activo en puerto ${port}`);
  });
}

module.exports = startServer;
