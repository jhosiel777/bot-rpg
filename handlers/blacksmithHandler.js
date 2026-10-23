// handlers/blacksmithHandler.js
const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');

function registerBlacksmithHandlers(bot, { Player, getPlayer }) {

  // ==========================================
  // MENÚ PRINCIPAL DE LA HERRERÍA REAL
  // ==========================================
  bot.action('menu_blacksmith', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = '⚒️ *HERRERÍA REAL DE LA CIUDADELA* ⚒️\n\n' +
               'El calor de las forjas golpea tu rostro mientras el maestro herrero martilla una pieza de acero candente.\n\n' +
               '— *"¿Vienes buscando equipo de calidad, revisar mis planos o necesitas los papeles para cruzar la empalizada?"*\n\n' +
               '💰 *Tu Oro:* ' + (player.gold || 0) + 'g\n\n' +
               '*Servicios y Artículos:*\n';

    const buttons = [
      [Markup.button.callback('📜 Catálogo de Forja y Recetas', 'bs_catalog')]
    ];

    if (!player.hasBorderPermit) {
      text += '• 📜 *Permiso de Exploración Fronteriza*\n' +
              '  _Autorización oficial para acceder a las zonas prohibidas fuera de los muros._\n' +
              '  Precio: *5,000g*\n\n';
      buttons.push([Markup.button.callback('📜 Comprar Permiso (5,000g)', 'buy_border_permit')]);
    } else {
      text += '• 📜 *Permiso Fronterizo:* ✅ Adquirido\n\n';

      if (!player.hasKhazurPickaxe) {
        text += '• ⛏️ *Pico de Khazur*\n' +
                '  _"Antiguo pico del legendario herrero Khazur, dicen que puede minar lo que sea."_\n' +
                '  Precio: *15,000g*\n\n';
        buttons.push([Markup.button.callback('⛏️ Comprar Pico de Khazur (15,000g)', 'buy_pickaxe_khazur')]);
      } else {
        text += '• ⛏️ *Pico de Khazur:* ✅ Comprado _(Equípalo en Hogar > Equipamiento)_\n\n';
      }
    }

    buttons.push([Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]);

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // ==========================================
  // MENÚ DE CATÁLOGO DE RECETAS
  // ==========================================
  bot.action('bs_catalog', async (ctx) => {
    await safeAnswerCb(ctx);
    const text = '📜 *CATÁLOGO DE FORJA Y RECETAS*\n\n' +
                 '— *"Aquí tienes los planos. Reúne los materiales en tus expediciones o paga su equivalente en oro donde aplique. ¿Qué estilo de combate prefieres revisar?"*';

    const buttons = [
      [
        Markup.button.callback('🗡️ Guerrero (Hierro)', 'bs_warrior'),
        Markup.button.callback('🧙‍♂️ Mago (Tela)', 'bs_mage')
      ],
      [
        Markup.button.callback('🦊 Cazador (Cuero)', 'bs_hunter'),
        Markup.button.callback('💍 Accesorios', 'bs_accs')
      ],
      [Markup.button.callback('⬅️ Volver a la Herrería', 'menu_blacksmith')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  // ==========================================
  // RECETAS: GUERRERO
  // ==========================================
  bot.action('bs_warrior', async (ctx) => {
    await safeAnswerCb(ctx);
    const text = '🗡️ *FORJA DE GUERRERO (HIERRO)* 🗡️\n\n' +
                 '*⚔️ ESPADAS*\n' +
                 '• *T1 (Espada de Hierro):* 5x Mena de Hierro *(O pago de 6,000g)*\n' +
                 '• *T2 (Hoja Rúnica):* Espada T1 + 3x Mena Ancestral\n' +
                 '• *T3 (Mandoble Obsidiana):* Espada T2 + 1x Mena Ancestral + 1x Esencia de Dragón\n\n' +
                 '*🪖 ARMADURA PESADA (Física)*\n' +
                 '• *T1:* Pechera (4x Hierro) | Casco (2x Hierro) | Grebas (3x Hierro)\n' +
                 '• *T2:* Pieza T1 + Pechera (4x Hierro, 2x Ancestral) | Casco (2x Hierro, 1x Ancestral) | Grebas (3x Hierro, 1x Ancestral)\n' +
                 '• *T3:* Pieza T2 + Pechera (4x Ancestral, 2x Escama Dragón) | Casco (2x Ancestral, 1x Escama) | Grebas (3x Ancestral, 1x Escama)\n';

    const buttons = [
      [Markup.button.callback('🛠️ (La forja se habilitará pronto)', 'noop')],
      [Markup.button.callback('⬅️ Volver a Catálogos', 'bs_catalog')]
    ];
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  // ==========================================
  // RECETAS: MAGO
  // ==========================================
  bot.action('bs_mage', async (ctx) => {
    await safeAnswerCb(ctx);
    const text = '🧙‍♂️ *FORJA DE MAGO (ARCANO)* 🧙‍♂️\n\n' +
                 '*🦯 BASTONES*\n' +
                 '• *T1 (Bastón Místico):* 5x Madera Mística *(O pago de 6,000g)*\n' +
                 '• *T2 (Cetro Susurros):* Bastón T1 + 3x Seda Espectral\n' +
                 '• *T3 (Báculo del Vacío):* Bastón T2 + 1x Seda Espectral + 1x Esencia de Dragón\n\n' +
                 '*👘 TÚNICA MÁGICA (Mágica)*\n' +
                 '• *T1:* Túnica (4x Tela) | Sombrero (2x Tela) | Botas (3x Tela)\n' +
                 '• *T2:* Pieza T1 + Túnica (4x Tela, 2x Hilo Mágico) | Sombrero (2x Tela, 1x Hilo) | Botas (3x Tela, 1x Hilo)\n' +
                 '• *T3:* Pieza T2 + Túnica (4x Hilo, 2x Seda Espectral) | Sombrero (2x Hilo, 1x Seda) | Botas (3x Hilo, 1x Seda)\n';

    const buttons = [
      [Markup.button.callback('🛠️ (La forja se habilitará pronto)', 'noop')],
      [Markup.button.callback('⬅️ Volver a Catálogos', 'bs_catalog')]
    ];
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  // ==========================================
  // RECETAS: CAZADOR
  // ==========================================
  bot.action('bs_hunter', async (ctx) => {
    await safeAnswerCb(ctx);
    const text = '🦊 *FORJA DE CAZADOR (CUERO)* 🦊\n\n' +
                 '*🏹 ARCOS*\n' +
                 '• *T1 (Arco de Tejo):* 5x Rama de Tejo Oscuro *(O pago de 6,000g)*\n' +
                 '• *T2 (Arco Largo):* Arco T1 + 3x Colmillo Alfa\n' +
                 '• *T3 (Perforador de Cenizas):* Arco T2 + 1x Colmillo Alfa + 1x Esencia de Dragón\n\n' +
                 '*🦊 ARMADURA DE CUERO (Equilibrada)*\n' +
                 '• *T1:* Pechera (4x Cuero) | Capucha (2x Cuero) | Botas (3x Cuero)\n' +
                 '• *T2:* Pieza T1 + Pechera (4x Cuero, 2x Colmillo Alfa) | Capucha (2x Cuero, 1x Colmillo) | Botas (3x Cuero, 1x Colmillo)\n' +
                 '• *T3:* Pieza T2 + Pechera (4x Colmillo, 2x Piel Quimera) | Capucha (2x Colmillo, 1x Piel) | Botas (3x Colmillo, 1x Piel)\n';

    const buttons = [
      [Markup.button.callback('🛠️ (La forja se habilitará pronto)', 'noop')],
      [Markup.button.callback('⬅️ Volver a Catálogos', 'bs_catalog')]
    ];
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  // ==========================================
  // RECETAS: ACCESORIOS
  // ==========================================
  bot.action('bs_accs', async (ctx) => {
    await safeAnswerCb(ctx);
    const text = '💍 *FORJA DE ACCESORIOS* 💍\n\n' +
                 '— *"Los objetos arcanos de bolsillo otorgan ventajas únicas en el combate PvP y se pueden adquirir con oro puro o mediante rituales complejos."*\n\n' +
                 '*🔥 Sello de Poder (Fuego)*\n' +
                 '• Efecto: Aumenta daño del próximo ataque.\n' +
                 '• Precio: *5,000g*\n\n' +
                 '*❄️ Talismán Glacial (Hielo)*\n' +
                 '• Efecto: Reduce el daño del oponente.\n' +
                 '• Precio: *5,000g*\n\n' +
                 '*🛡️ Reliquia de Baluarte*\n' +
                 '• Efecto: Otorga armadura/escudo temporal.\n' +
                 '• Precio: *10,000g*\n\n' +
                 '*🎯 Amuleto de Precisión*\n' +
                 '• Efecto: Aumenta la probabilidad de crítico.\n' +
                 '• Precio: *10,000g*\n\n' +
                 '*🩸 Cáliz Vampírico*\n' +
                 '• Efecto: Drena 30% del daño como salud.\n' +
                 '• Precio: *10,000g*\n\n' +
                 '*🌌 Orbe de Drenaje Abisal*\n' +
                 '• Efecto: Roba 1 cristal de maná al rival.\n' +
                 '• Requisitos: 2x Mena Ancestral + 2x Seda Espectral + 2x Piel de Quimera + 2x Hilo Mágico.\n';

    const buttons = [
      [Markup.button.callback('🛠️ (La compra/forja se habilitará pronto)', 'noop')],
      [Markup.button.callback('⬅️ Volver a Catálogos', 'bs_catalog')]
    ];
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('noop', async (ctx) => {
    return await safeAnswerCb(ctx, '🛠️ Estamos encendiendo las forjas. Las recetas se habilitarán pronto.', true);
  });

  // ==========================================
  // COMPRA DEL PERMISO DE EXPLORACIÓN
  // ==========================================
  bot.action('buy_border_permit', async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (player.hasBorderPermit) {
      return await safeAnswerCb(ctx, 'Ya posees el Permiso de Exploración Fronteriza.', true);
    }

    if ((player.gold || 0) < 5000) {
      return await safeAnswerCb(ctx, 'Oro insuficiente. Necesitas 5,000g.', true);
    }

    player.gold -= 5000;
    player.hasBorderPermit = true;
    await player.save();

    await safeAnswerCb(ctx, '📜 ¡Compraste el Permiso de Exploración!', true);

    return bot.handleUpdate({
      ...ctx.update,
      callback_query: { ...ctx.callbackQuery, data: 'menu_blacksmith' }
    });
  });

  // ==========================================
  // COMPRA DEL PICO DE KHAZUR
  // ==========================================
  bot.action('buy_pickaxe_khazur', async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    if (!player.hasBorderPermit) {
      return await safeAnswerCb(ctx, 'Requieres primero el Permiso de Exploración.', true);
    }

    if (player.hasKhazurPickaxe) {
      return await safeAnswerCb(ctx, 'Ya posees el Pico de Khazur.', true);
    }

    if ((player.gold || 0) < 15000) {
      return await safeAnswerCb(ctx, 'Oro insuficiente. Necesitas 15,000g.', true);
    }

    player.gold -= 15000;
    player.hasKhazurPickaxe = true;
    await player.save();

    await safeAnswerCb(ctx, '⛏️ ¡Has adquirido el Pico de Khazur!');

    const narrativeText = '⚒️ *El herrero mira el pico antes de entregártelo, suspira y dice:*\n\n' +
                          '— *"Ahh, mi viejo amigo Khazur, falleció hace 45 años en ese yacimiento... ' +
                          'era el mejor herrero del reino, ¿sabes? También fue mi maestro.\n\n' +
                          'Desde entonces nadie ha vuelto a ese lugar. Hay grandes y valiosas menas, ' +
                          'pero ten cuidado: al portar un pico, el yacimiento se pone aún más agresivo."*\n\n' +
                          '⛏️ _El Pico de Khazur ha sido añadido a tus posesiones. Puedes equiparlo desde tu Hogar > Equipamiento._';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('⚒️ Seguir en la Herrería', 'menu_blacksmith')],
      [Markup.button.callback('⬅️ Volver a Explorar', 'menu_explore')]
    ]);

    return await safeEditMessage(ctx, narrativeText, {
      parse_mode: 'Markdown',
      ...keyboard
    });
  });
}

module.exports = { registerBlacksmithHandlers };
