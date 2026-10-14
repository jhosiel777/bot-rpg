// handlers/adminHandler.js
const { Markup } = require('telegraf');
const Maintenance = require('../maintenanceModel');
const { safeAnswerCb, safeEditMessage, formatHoursMinutes, broadcastToAll } = require('../utils/telegramUtils');

function registerAdminHandlers(bot, deps) {
  const {
    ADMIN_ID,
    MAX_LEVEL,
    Player,
    getPlayer,
    getRequiredExp,
    getGlobalStats,
    getMarketHistory,
    maintenanceState,
    adminFlags
  } = deps;

  function getAdminHomeView() {
    const statusStr = maintenanceState.enabled ? '🔴 ACTIVO' : '🟢 APAGADO';

    const text = '👑 *Panel de Creador (Admin)*\n\n' +
                 '🛠️ Modo Mantenimiento: *' + statusStr + '*\n' +
                 '👥 Testers en Whitelist: *' + maintenanceState.whitelist.length + ' autorizado(s)*\n\n' +
                 'Opciones de gestión:';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(maintenanceState.enabled ? '🟢 Reabrir Reino (Fin Mantenimiento)' : '🔴 Cerrar Reino (Modo Mantenimiento)', 'adm_toggle_maint')],
      [Markup.button.callback('👥 Gestionar Whitelist de Testers', 'adm_whitelist_menu')],
      [Markup.button.callback('⭐ Cambiar Mi Propio Nivel', 'adm_change_lvl_' + ADMIN_ID)],
      [Markup.button.callback('🐲 Gestión del Jefe Mundial', 'adm_boss_panel')],
      [Markup.button.callback('📊 Estadísticas de Drops', 'adm_drops')],
      [Markup.button.callback('🛡️ Aspirantes No Verificados', 'adm_unverified')],
      [Markup.button.callback('👥 Lista de Usuarios (Paginada)', 'adm_users_page_1')],
      [Markup.button.callback('📜 Historial P2P', 'adm_mkt_page_1')],
      [Markup.button.callback('📢 Transmitir Mensaje Global', 'adm_prompt_broadcast')],
      [Markup.button.callback('❤️‍🩹 Revivir / Quitar Inconsciente (Propio)', 'adm_revive_self')],
      [Markup.button.callback('🥤 Auto-conceder +1 Bebida Energética', 'adm_give_drink')],
      [Markup.button.callback('🩸 Auto-conceder +1 Elixir Dragón', 'adm_give_dragon_blood')],
      [Markup.button.callback('🏕️ Volver al Campamento', 'status')]
    ]);

    return { text, keyboard };
  }

  async function renderUserDetails(ctx, u, backPage) {
    const now = Date.now();

    if (u.knockedOutUntil && u.knockedOutUntil <= now) {
      u.knockedOutUntil = 0;
      if (u.hp <= 0) u.hp = 1;
      await u.save();
    } else if (u.hp <= 0 && !u.knockedOutUntil) {
      u.hp = 1;
      await u.save();
    }

    const hpPoints = Math.max(0, Math.floor(((u.maxHp || 50) - 50) / 5));
    const isKO = Boolean(u.knockedOutUntil && u.knockedOutUntil > now);

    const today = new Date().toISOString().slice(0, 10);
    const adsToday = (u.lastAdClaimDate === today) ? (u.adsClaimedToday || 0) : 0;
    const adsTotal = Math.max(u.totalAdsClaimed || 0, adsToday);

    let text = '👤 *Detalles del Jugador: ' + u.name + '*\n\n' +
               '🆔 Telegram ID: ' + u.userId + '\n' +
               '⭐ Nivel: ' + u.level + '/' + MAX_LEVEL + '\n' +
               '🔮 EXP: ' + u.exp + '/' + getRequiredExp(u.level) + '\n' +
               '❤️ Salud: ' + u.hp + '/' + u.maxHp + ' HP\n' +
               '⚡ Energía: ' + u.energy + '/10\n' +
               '💰 Oro: ' + u.gold + '\n\n';

    if (isKO) {
      const secKO = Math.max(0, Math.ceil((u.knockedOutUntil - now) / 1000));
      text += '💀 *Estado:* Inconsciente (' + formatHoursMinutes(secKO) + ' restante)\n\n';
    }

    text += '📊 *Atributos:*\n' +
            '• Fuerza: ' + u.strength + '\n' +
            '• Salud Invertida: +' + (hpPoints * 5) + ' HP (' + hpPoints + ' pts asignados)\n' +
            '• Agilidad: ' + (u.agility || 0) + '\n' +
            '• Suerte: ' + (u.luck || 0) + '\n' +
            '• Puntos sin asignar: ' + u.statPoints + '\n\n' +
            '🎒 *Inventario de Pociones:*\n' +
            '• Pociones Menores (+10 HP): ' + (u.potionsSmall || 0) + '\n' +
            '• Pociones Mayores (+35 HP): ' + (u.potionsMedium || 0) + '\n' +
            '• Elixires de Energía (+1 ⚡): ' + (u.potionsEnergy || 0) + '\n' +
            '• 🥤 Bebidas Energéticas (+2 ⚡): ' + (u.potionsEnergyDrink || 0) + '/5\n' +
            '• 🩸 Elixir Sangre Dragón: ' + (u.potionsDragonBlood || 0) + '\n\n' +
            '🔑 *Reclutamiento:*\n' +
            '• Código propio: `' + (u.referralCode || 'N/A') + '`\n' +
            '• Reclutas: ' + (u.recruitsCount || 0) + '\n' +
            '• Estado Verificado: ' + (u.isVerified ? '✅ Sí' : '❌ No (En puerta)') + '\n\n' +
            '📺 *Anuncios Vistos:*\n' +
            '• Hoy: *' + adsToday + '*\n' +
            '• Total Histórico: *' + adsTotal + '*';

    const buttons = [];
    buttons.push([Markup.button.callback('⭐ Cambiar Nivel (Admin)', 'adm_change_lvl_' + u.userId)]);

    if (isKO) {
      buttons.push([Markup.button.callback('✨ Revivir / Curar al 100%', 'adm_revive_target_' + u.userId + '_' + backPage)]);
      buttons.push([
        Markup.button.callback('⏳ -15 min', 'adm_reduce_ko_' + u.userId + '_15_' + backPage),
        Markup.button.callback('⏳ -30 min', 'adm_reduce_ko_' + u.userId + '_30_' + backPage),
        Markup.button.callback('⏳ -1 hora', 'adm_reduce_ko_' + u.userId + '_60_' + backPage)
      ]);
    }

    buttons.push([Markup.button.callback('⬅️ Volver a la Lista (Pág. ' + backPage + ')', 'adm_users_page_' + backPage)]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }

  bot.command('admin', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    adminFlags.broadcastWaiting = false;
    adminFlags.targetLevelChangeId = null;
    adminFlags.whitelistAddWaiting = false;
    adminFlags.maintenanceEndWaiting = false;
    const view = getAdminHomeView();
    await ctx.reply(view.text, { parse_mode: 'Markdown', ...view.keyboard });
  });

  bot.action('adm_home', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    adminFlags.broadcastWaiting = false;
    adminFlags.targetLevelChangeId = null;
    adminFlags.whitelistAddWaiting = false;
    adminFlags.maintenanceEndWaiting = false;
    const view = getAdminHomeView();
    return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
  });

  bot.action('adm_toggle_maint', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);

    if (!maintenanceState.enabled) {
      maintenanceState.enabled = true;
      await Maintenance.updateOne({ key: 'global_config' }, { enabled: true });
      await safeAnswerCb(ctx, '🔴 Modo mantenimiento ACTIVADO.');

      const globalAlert = '⚠️🔔 *COMUNICADO DEL GREMIO: RECONSTRUCCIÓN DEL REINO*\n\n' +
                          'Aventureros de Abyss: Las campanas de la ciudadela anuncian que en unos momentos el reino entrará en un periodo de reconstrucción y mantenimiento programado.\n\n' +
                          '⚒️ _Los accesos se cerrarán brevemente mientras se implementan mejoras y reformas. Sus datos están a salvo._';
      await broadcastToAll(bot, Player, globalAlert);

      const view = getAdminHomeView();
      return await safeEditMessage(ctx, view.text, { parse_mode: 'Markdown', ...view.keyboard });
    } else {
      await safeAnswerCb(ctx);
      adminFlags.maintenanceEndWaiting = true;

      const promptText = '📝 *FINALIZAR MANTENIMIENTO Y REABRIR REINO*\n\n' +
                         'Escribe a continuación en el chat cuáles fueron las mejoras, correcciones o novedades aplicadas.\n\n' +
                         'Al enviarlas, el mantenimiento se apagará y se proclamará el comunicado a todos los jugadores con las notas de actualización.\n\n' +
                         '_Si no deseas añadir detalles, puedes escribir "Sin notas" o tocar Cancelar._';

      return await safeEditMessage(ctx, promptText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancelar', 'adm_home')]])
      });
    }
  });

  bot.action('adm_whitelist_menu', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    adminFlags.whitelistAddWaiting = false;

    let text = '👥 *GESTIÓN DE WHITELIST DE TESTERS*\n\n' +
               'Los siguientes IDs de Telegram tienen autorización para ingresar al reino aun cuando el modo mantenimiento esté activado:\n\n' +
               '👑 Creador: `' + ADMIN_ID + '` (Permanente)\n';

    if (!maintenanceState.whitelist.length) {
      text += '_No hay testers adicionales autorizados._\n';
    } else {
      maintenanceState.whitelist.forEach((uid, idx) => {
        text += (idx + 1) + '. ID: `' + uid + '`\n';
      });
    }

    text += '\n¿Qué deseas hacer?';

    const buttons = [
      [Markup.button.callback('➕ Añadir Tester por ID', 'adm_wl_add')],
      [Markup.button.callback('🗑️ Limpiar Toda la Whitelist', 'adm_wl_clear')],
      [Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('adm_wl_add', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    adminFlags.whitelistAddWaiting = true;

    const text = '➕ *Añadir Usuario a la Whitelist*\n\n' +
                 'Escribe en el chat el **Telegram ID** (número) de la persona que deseas autorizar durante los periodos de mantenimiento.';

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancelar', 'adm_whitelist_menu')]])
    });
  });

  bot.action('adm_wl_clear', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    maintenanceState.whitelist = [];
    await Maintenance.updateOne({ key: 'global_config' }, { whitelist: [] });
    await safeAnswerCb(ctx, 'Whitelist vaciada.');

    let text = '👥 *GESTIÓN DE WHITELIST DE TESTERS*\n\n' +
               'Los siguientes IDs de Telegram tienen autorización para ingresar al reino:\n\n' +
               '👑 Creador: `' + ADMIN_ID + '` (Permanente)\n' +
               '_No hay testers adicionales autorizados._\n\n' +
               '¿Qué deseas hacer?';

    const buttons = [
      [Markup.button.callback('➕ Añadir Tester por ID', 'adm_wl_add')],
      [Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('adm_unverified', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const pending = await Player.find({ isVerified: false });
    let text = '🛡️ *Aspirantes Detenidos en las Puertas*\n\n' +
               'Usuarios que abrieron el bot pero no han canjeado un código de recluta:\n\n';

    if (!pending.length) {
      text += '_No hay ningún aspirante esperando en los muros actualmente._';
    } else {
      pending.forEach((p, idx) => {
        text += (idx + 1) + '. *' + p.name + '* (ID: `' + p.userId + '`) — Código propio: `' + p.referralCode + '`\n';
      });
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Actualizar', 'adm_unverified')],
      [Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action(/adm_change_lvl_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    const targetId = parseInt(ctx.match[1], 10);
    adminFlags.targetLevelChangeId = targetId;

    const u = await Player.findOne({ userId: targetId });
    const name = u ? u.name : 'Usuario';

    const text = '⭐ *Cambiar Nivel de ' + name + '*\n\n' +
                 'Nivel actual: *' + (u ? u.level : 'N/A') + '*\n\n' +
                 '💬 *Escribe en el chat el nuevo nivel (1 - ' + MAX_LEVEL + ')* que deseas asignarle.\n' +
                 '_Nota: Su EXP se reseteará a 1 / reqExp de ese nivel._';

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancelar', 'adm_home')]])
    });
  });

  bot.action(/adm_users_page_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const page = parseInt(ctx.match[1], 10) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const totalUsers = await Player.countDocuments();
    const totalPages = Math.ceil(totalUsers / limit) || 1;

    const users = await Player.find()
      .sort({ level: -1, exp: -1 })
      .skip(skip)
      .limit(limit);

    let text = '👥 *Lista de Usuarios Registrados* (Pág. ' + page + '/' + totalPages + ')\n' +
               'Total de jugadores: *' + totalUsers + '*\n\n' +
               'Toca cualquier aventurero para ver sus datos y mochila:';

    const buttons = [];
    for (const u of users) {
      buttons.push([
        Markup.button.callback(
          '⭐ Lv.' + u.level + ' | ' + u.name.substring(0, 18) + ' (ID: ' + u.userId + ')',
          'adm_user_' + u.userId + '_' + page
        )
      ]);
    }

    const navRow = [];
    if (page > 1) navRow.push(Markup.button.callback('⬅️ Anterior', 'adm_users_page_' + (page - 1)));
    if (page < totalPages) navRow.push(Markup.button.callback('Siguiente ➡️', 'adm_users_page_' + (page + 1)));
    if (navRow.length) buttons.push(navRow);

    buttons.push([Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]);
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/adm_user_(\d+)_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const targetId = parseInt(ctx.match[1], 10);
    const backPage = parseInt(ctx.match[2], 10) || 1;

    const u = await Player.findOne({ userId: targetId });
    if (!u) return await safeAnswerCb(ctx, 'Usuario no encontrado.', true);

    return await renderUserDetails(ctx, u, backPage);
  });

  bot.action(/adm_reduce_ko_(\d+)_(\d+)_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);

    const targetId = parseInt(ctx.match[1], 10);
    const minutesToReduce = parseInt(ctx.match[2], 10);
    const backPage = parseInt(ctx.match[3], 10) || 1;

    const u = await Player.findOne({ userId: targetId });
    if (!u) return await safeAnswerCb(ctx, 'Usuario no encontrado.', true);

    const now = Date.now();
    if (!u.knockedOutUntil || u.knockedOutUntil <= now) {
      u.knockedOutUntil = 0;
      if (u.hp <= 0) u.hp = Math.max(1, Math.round(u.maxHp * 0.3));
      await u.save();
      await safeAnswerCb(ctx, 'El aventurero ya no está inconsciente.', true);
    } else {
      const msToSubtract = minutesToReduce * 60 * 1000;
      u.knockedOutUntil -= msToSubtract;

      if (u.knockedOutUntil <= now) {
        u.knockedOutUntil = 0;
        if (u.hp <= 0) u.hp = Math.max(1, Math.round(u.maxHp * 0.3));
        await safeAnswerCb(ctx, '⏳ Tiempo reducido. ¡' + u.name + ' ha despertado!', true);
      } else {
        const remainingSec = Math.ceil((u.knockedOutUntil - now) / 1000);
        await safeAnswerCb(ctx, '⏳ Se restaron ' + minutesToReduce + ' min. Le quedan ' + formatHoursMinutes(remainingSec) + '.', true);
      }
      await u.save();
    }

    return await renderUserDetails(ctx, u, backPage);
  });

  bot.action('adm_revive_self', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    const p = await getPlayer(ADMIN_ID);
    p.knockedOutUntil = 0;
    p.hp = p.maxHp;
    await p.save();
    await safeAnswerCb(ctx, '❤️‍🩹 ¡Has revivido! Salud restaurada a ' + p.maxHp + ' HP.', true);
    const view = getAdminHomeView();
    return await safeEditMessage(ctx, view.text, view.keyboard);
  });

  bot.action(/adm_revive_target_(\d+)_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    const targetId = parseInt(ctx.match[1], 10);
    const backPage = parseInt(ctx.match[2], 10) || 1;

    const u = await Player.findOne({ userId: targetId });
    if (u) {
      u.knockedOutUntil = 0;
      u.hp = u.maxHp;
      await u.save();
      await safeAnswerCb(ctx, '✨ ' + u.name + ' ha sido revivido con éxito.', true);
      return await renderUserDetails(ctx, u, backPage);
    }
  });

  bot.action(/adm_mkt_page_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const page = parseInt(ctx.match[1], 10) || 1;
    const { logs, total, totalPages } = await getMarketHistory(page, 5);

    let text = '📜 *Historial Global de Mercado P2P* (Pág. ' + page + '/' + totalPages + ')\n' +
               'Total de transacciones: *' + total + '*\n\n';

    if (!logs.length) {
      text += '_Aún no se han realizado transacciones en el mercado._';
    } else {
      logs.forEach((log, idx) => {
        const dateStr = new Date(log.createdAt).toLocaleString('es-VE', {
          timeZone: 'America/Caracas',
          dateStyle: 'short',
          timeStyle: 'short'
        });
        text += '*#' + ((page - 1) * 5 + idx + 1) + ' • ' + log.itemName + '*\n' +
                '• Comprador: ' + log.buyerName + ' (' + log.buyerId + ')\n' +
                '• Vendedor: ' + log.sellerName + ' (' + log.sellerId + ')\n' +
                '• Precio: 💰 ' + log.price + 'g (Comisión: ' + log.tax + 'g | Neto: ' + log.sellerProfit + 'g)\n' +
                '• Fecha: ' + dateStr + '\n\n';
      });
    }

    const buttons = [];
    const navRow = [];
    if (page > 1) navRow.push(Markup.button.callback('⬅️ Anterior', 'adm_mkt_page_' + (page - 1)));
    if (page < totalPages) navRow.push(Markup.button.callback('Siguiente ➡️', 'adm_mkt_page_' + (page + 1)));
    if (navRow.length) buttons.push(navRow);

    buttons.push([
      Markup.button.callback('🔄 Actualizar', 'adm_mkt_page_' + page),
      Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('adm_drops', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const stats = await getGlobalStats();
    const text = '📊 *Estadísticas Globales de Drops*\n\n' +
                 'Cantidad total de ítems caídos en expediciones:\n\n' +
                 '• 🧪 *Pociones Menores de Vida:* ' + stats.totalDropsSmall + '\n' +
                 '• 🧪 *Pociones Mayores de Vida:* ' + stats.totalDropsMedium + '\n' +
                 '• ⚡ *Elixires de Energía:* ' + stats.totalDropsEnergy + '\n\n' +
                 '*Total histórico de objetos dropeados:* ' + (stats.totalDropsSmall + stats.totalDropsMedium + stats.totalDropsEnergy);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Actualizar', 'adm_drops')],
      [Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action('adm_prompt_broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    adminFlags.broadcastWaiting = true;

    const text = '📢 *Transmisión Global del Creador*\n\n' +
                 'Escribe ' + ADMIN_ID + '` (Permanente)\n' +
               '_No hay testers adicionales autorizados._\n\n' +
               '¿Qué deseas hacer?';

    const buttons = [
      [Markup.button.callback('➕ Añadir Tester por ID', 'adm_wl_add')],
      [Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]
    ];

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('adm_unverified', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const pending = await Player.find({ isVerified: false });
    let text = '🛡️ *Aspirantes Detenidos en las Puertas*\n\n' +
               'Usuarios que abrieron el bot pero no han canjeado un código de recluta:\n\n';

    if (!pending.length) {
      text += '_No hay ningún aspirante esperando en los muros actualmente._';
    } else {
      pending.forEach((p, idx) => {
        text += (idx + 1) + '. *' + p.name + '* (ID: `' + p.userId + '`) — Código propio: `' + p.referralCode + '`\n';
      });
    }

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Actualizar', 'adm_unverified')],
      [Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action(/adm_change_lvl_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    const targetId = parseInt(ctx.match[1], 10);
    adminFlags.targetLevelChangeId = targetId;

    const u = await Player.findOne({ userId: targetId });
    const name = u ? u.name : 'Usuario';

    const text = '⭐ *Cambiar Nivel de ' + name + '*\n\n' +
                 'Nivel actual: *' + (u ? u.level : 'N/A') + '*\n\n' +
                 '💬 *Escribe en el chat el nuevo nivel (1 - ' + MAX_LEVEL + ')* que deseas asignarle.\n' +
                 '_Nota: Su EXP se reseteará a 1 / reqExp de ese nivel._';

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancelar', 'adm_home')]])
    });
  });

  bot.action(/adm_users_page_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const page = parseInt(ctx.match[1], 10) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const totalUsers = await Player.countDocuments();
    const totalPages = Math.ceil(totalUsers / limit) || 1;

    const users = await Player.find()
      .sort({ level: -1, exp: -1 })
      .skip(skip)
      .limit(limit);

    let text = '👥 *Lista de Usuarios Registrados* (Pág. ' + page + '/' + totalPages + ')\n' +
               'Total de jugadores: *' + totalUsers + '*\n\n' +
               'Toca cualquier aventurero para ver sus datos y mochila:';

    const buttons = [];
    for (const u of users) {
      buttons.push([
        Markup.button.callback(
          '⭐ Lv.' + u.level + ' | ' + u.name.substring(0, 18) + ' (ID: ' + u.userId + ')',
          'adm_user_' + u.userId + '_' + page
        )
      ]);
    }

    const navRow = [];
    if (page > 1) navRow.push(Markup.button.callback('⬅️ Anterior', 'adm_users_page_' + (page - 1)));
    if (page < totalPages) navRow.push(Markup.button.callback('Siguiente ➡️', 'adm_users_page_' + (page + 1)));
    if (navRow.length) buttons.push(navRow);

    buttons.push([Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]);
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action(/adm_user_(\d+)_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const targetId = parseInt(ctx.match[1], 10);
    const backPage = parseInt(ctx.match[2], 10) || 1;

    const u = await Player.findOne({ userId: targetId });
    if (!u) return await safeAnswerCb(ctx, 'Usuario no encontrado.', true);

    return await renderUserDetails(ctx, u, backPage);
  });

  bot.action(/adm_reduce_ko_(\d+)_(\d+)_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);

    const targetId = parseInt(ctx.match[1], 10);
    const minutesToReduce = parseInt(ctx.match[2], 10);
    const backPage = parseInt(ctx.match[3], 10) || 1;

    const u = await Player.findOne({ userId: targetId });
    if (!u) return await safeAnswerCb(ctx, 'Usuario no encontrado.', true);

    const now = Date.now();
    if (!u.knockedOutUntil || u.knockedOutUntil <= now) {
      u.knockedOutUntil = 0;
      if (u.hp <= 0) u.hp = Math.max(1, Math.round(u.maxHp * 0.3));
      await u.save();
      await safeAnswerCb(ctx, 'El aventurero ya no está inconsciente.', true);
    } else {
      const msToSubtract = minutesToReduce * 60 * 1000;
      u.knockedOutUntil -= msToSubtract;

      if (u.knockedOutUntil <= now) {
        u.knockedOutUntil = 0;
        if (u.hp <= 0) u.hp = Math.max(1, Math.round(u.maxHp * 0.3));
        await safeAnswerCb(ctx, '⏳ Tiempo reducido. ¡' + u.name + ' ha despertado!', true);
      } else {
        const remainingSec = Math.ceil((u.knockedOutUntil - now) / 1000);
        await safeAnswerCb(ctx, '⏳ Se restaron ' + minutesToReduce + ' min. Le quedan ' + formatHoursMinutes(remainingSec) + '.', true);
      }
      await u.save();
    }

    return await renderUserDetails(ctx, u, backPage);
  });

  bot.action('adm_revive_self', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    const p = await getPlayer(ADMIN_ID);
    p.knockedOutUntil = 0;
    p.hp = p.maxHp;
    await p.save();
    await safeAnswerCb(ctx, '❤️‍🩹 ¡Has revivido! Salud restaurada a ' + p.maxHp + ' HP.', true);
    const view = getAdminHomeView();
    return await safeEditMessage(ctx, view.text, view.keyboard);
  });

  bot.action(/adm_revive_target_(\d+)_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    const targetId = parseInt(ctx.match[1], 10);
    const backPage = parseInt(ctx.match[2], 10) || 1;

    const u = await Player.findOne({ userId: targetId });
    if (u) {
      u.knockedOutUntil = 0;
      u.hp = u.maxHp;
      await u.save();
      await safeAnswerCb(ctx, '✨ ' + u.name + ' ha sido revivido con éxito.', true);
      return await renderUserDetails(ctx, u, backPage);
    }
  });

  bot.action(/adm_mkt_page_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const page = parseInt(ctx.match[1], 10) || 1;
    const { logs, total, totalPages } = await getMarketHistory(page, 5);

    let text = '📜 *Historial Global de Mercado P2P* (Pág. ' + page + '/' + totalPages + ')\n' +
               'Total de transacciones: *' + total + '*\n\n';

    if (!logs.length) {
      text += '_Aún no se han realizado transacciones en el mercado._';
    } else {
      logs.forEach((log, idx) => {
        const dateStr = new Date(log.createdAt).toLocaleString('es-VE', {
          timeZone: 'America/Caracas',
          dateStyle: 'short',
          timeStyle: 'short'
        });
        text += '*#' + ((page - 1) * 5 + idx + 1) + ' • ' + log.itemName + '*\n' +
                '• Comprador: ' + log.buyerName + ' (' + log.buyerId + ')\n' +
                '• Vendedor: ' + log.sellerName + ' (' + log.sellerId + ')\n' +
                '• Precio: 💰 ' + log.price + 'g (Comisión: ' + log.tax + 'g | Neto: ' + log.sellerProfit + 'g)\n' +
                '• Fecha: ' + dateStr + '\n\n';
      });
    }

    const buttons = [];
    const navRow = [];
    if (page > 1) navRow.push(Markup.button.callback('⬅️ Anterior', 'adm_mkt_page_' + (page - 1)));
    if (page < totalPages) navRow.push(Markup.button.callback('Siguiente ➡️', 'adm_mkt_page_' + (page + 1)));
    if (navRow.length) buttons.push(navRow);

    buttons.push([
      Markup.button.callback('🔄 Actualizar', 'adm_mkt_page_' + page),
      Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('adm_drops', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);

    const stats = await getGlobalStats();
    const text = '📊 *Estadísticas Globales de Drops*\n\n' +
                 'Cantidad total de ítems caídos en expediciones:\n\n' +
                 '• 🧪 *Pociones Menores de Vida:* ' + stats.totalDropsSmall + '\n' +
                 '• 🧪 *Pociones Mayores de Vida:* ' + stats.totalDropsMedium + '\n' +
                 '• ⚡ *Elixires de Energía:* ' + stats.totalDropsEnergy + '\n\n' +
                 '*Total histórico de objetos dropeados:* ' + (stats.totalDropsSmall + stats.totalDropsMedium + stats.totalDropsEnergy);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Actualizar', 'adm_drops')],
      [Markup.button.callback('⬅️ Volver al Panel Admin', 'adm_home')]
    ]);

    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  });

  bot.action('adm_prompt_broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    await safeAnswerCb(ctx);
    adminFlags.broadcastWaiting = true;

    const text = '📢 *Transmisión Global del Creador*\n\n' +
                 'Escribe a continuación en el chat el mensaje que deseas enviar a todos los aventureros del reino.';

    return await safeEditMessage(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Cancelar', 'adm_home')]])
    });
  });

  bot.action('adm_give_drink', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    const p = await getPlayer(ADMIN_ID);
    p.potionsEnergyDrink = (p.potionsEnergyDrink || 0) + 1;
    await p.save();
    await safeAnswerCb(ctx, '🥤 Te añadiste 1x Bebida Energética (Total: ' + p.potionsEnergyDrink + ')', true);
  });

  bot.action('adm_give_dragon_blood', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return await safeAnswerCb(ctx, 'Acceso denegado.', true);
    const p = await getPlayer(ADMIN_ID);
    p.potionsDragonBlood = (p.potionsDragonBlood || 0) + 1;
    await p.save();
    await safeAnswerCb(ctx, '🩸 Te añadiste 1x Elixir de Sangre de Dragón (Total: ' + p.potionsDragonBlood + ')', true);
  });
}

module.exports = {
  registerAdminHandlers
};
