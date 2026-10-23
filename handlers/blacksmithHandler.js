// handlers/blacksmithHandler.js
const { Markup } = require('telegraf');
const { safeAnswerCb, safeEditMessage } = require('../utils/telegramUtils');

// ==========================================
// DICCIONARIO DE MATERIALES Y RECETAS
// ==========================================
const MAT_NAMES = {
  ironOre: 'Mena de Hierro', ancestralIronOre: 'Mena Ancestral', obsidianScale: 'Escama de Obsidiana',
  mysticWood: 'Madera Mística', spectralSilk: 'Seda Espectral', magicThread: 'Hilo Mágico',
  darkYewBranch: 'Rama de Tejo', alphaFang: 'Colmillo Alfa', chimeraHide: 'Piel de Quimera',
  dragonEssence: 'Esencia de Dragón', gold: 'Oro', cloth: 'Tela'
};

const RECIPES = {
  // GUERRERO
  sword_t1: { name: 'Espada de Hierro (T1)', costs: { ironOre: 5 }, altGold: 6000 },
  sword_t2: { name: 'Hoja Rúnica (T2)', req: 'sword_t1', costs: { ancestralIronOre: 3 } },
  sword_t3: { name: 'Mandoble Obsidiana (T3)', req: 'sword_t2', costs: { ancestralIronOre: 1, dragonEssence: 1 } },
  chest_heavy_t1: { name: 'Pechera de Hierro (T1)', costs: { ironOre: 4 } },
  head_heavy_t1: { name: 'Casco de Hierro (T1)', costs: { ironOre: 2 } },
  legs_heavy_t1: { name: 'Grebas de Hierro (T1)', costs: { ironOre: 3 } },
  chest_heavy_t2: { name: 'Pechera Rúnica (T2)', req: 'chest_heavy_t1', costs: { ironOre: 4, ancestralIronOre: 2 } },
  head_heavy_t2: { name: 'Casco Rúnico (T2)', req: 'head_heavy_t1', costs: { ironOre: 2, ancestralIronOre: 1 } },
  legs_heavy_t2: { name: 'Grebas Rúnicas (T2)', req: 'legs_heavy_t1', costs: { ironOre: 3, ancestralIronOre: 1 } },
  chest_heavy_t3: { name: 'Pechera Obsidiana (T3)', req: 'chest_heavy_t2', costs: { ancestralIronOre: 4, obsidianScale: 2 } },
  head_heavy_t3: { name: 'Casco Obsidiana (T3)', req: 'head_heavy_t2', costs: { ancestralIronOre: 2, obsidianScale: 1 } },
  legs_heavy_t3: { name: 'Grebas Obsidiana (T3)', req: 'legs_heavy_t2', costs: { ancestralIronOre: 3, obsidianScale: 1 } },

  // MAGO
  staff_t1: { name: 'Bastón Místico (T1)', costs: { mysticWood: 5 }, altGold: 6000 },
  staff_t2: { name: 'Cetro Susurros (T2)', req: 'staff_t1', costs: { spectralSilk: 3 } },
  staff_t3: { name: 'Báculo del Vacío (T3)', req: 'staff_t2', costs: { spectralSilk: 1, dragonEssence: 1 } },
  chest_mage_t1: { name: 'Túnica Mágica (T1)', costs: { cloth: 4 } },
  head_mage_t1: { name: 'Sombrero Mágico (T1)', costs: { cloth: 2 } },
  legs_mage_t1: { name: 'Botas Mágicas (T1)', costs: { cloth: 3 } },
  chest_mage_t2: { name: 'Túnica de Hilos (T2)', req: 'chest_mage_t1', costs: { cloth: 4, magicThread: 2 } },
  head_mage_t2: { name: 'Sombrero de Hilos (T2)', req: 'head_mage_t1', costs: { cloth: 2, magicThread: 1 } },
  legs_mage_t2: { name: 'Botas de Hilos (T2)', req: 'legs_mage_t1', costs: { cloth: 3, magicThread: 1 } },
  chest_mage_t3: { name: 'Túnica Espectral (T3)', req: 'chest_mage_t2', costs: { magicThread: 4, spectralSilk: 2 } },
  head_mage_t3: { name: 'Sombrero Espectral (T3)', req: 'head_mage_t2', costs: { magicThread: 2, spectralSilk: 1 } },
  legs_mage_t3: { name: 'Botas Espectrales (T3)', req: 'legs_mage_t2', costs: { magicThread: 3, spectralSilk: 1 } },

  // CAZADOR
  bow_t1: { name: 'Arco de Tejo (T1)', costs: { darkYewBranch: 5 }, altGold: 6000 },
  bow_t2: { name: 'Arco Largo (T2)', req: 'bow_t1', costs: { alphaFang: 3 } },
  bow_t3: { name: 'Perforador Cenizas (T3)', req: 'bow_t2', costs: { alphaFang: 1, dragonEssence: 1 } },
  chest_hunter_t1: { name: 'Pechera de Caza (T1)', costs: { darkYewBranch: 4 } },
  head_hunter_t1: { name: 'Capucha de Caza (T1)', costs: { darkYewBranch: 2 } },
  legs_hunter_t1: { name: 'Botas de Caza (T1)', costs: { darkYewBranch: 3 } },
  chest_hunter_t2: { name: 'Pechera Alfa (T2)', req: 'chest_hunter_t1', costs: { darkYewBranch: 4, alphaFang: 2 } },
  head_hunter_t2: { name: 'Capucha Alfa (T2)', req: 'head_hunter_t1', costs: { darkYewBranch: 2, alphaFang: 1 } },
  legs_hunter_t2: { name: 'Botas Alfa (T2)', req: 'legs_hunter_t1', costs: { darkYewBranch: 3, alphaFang: 1 } },
  chest_hunter_t3: { name: 'Pechera Quimera (T3)', req: 'chest_hunter_t2', costs: { alphaFang: 4, chimeraHide: 2 } },
  head_hunter_t3: { name: 'Capucha Quimera (T3)', req: 'head_hunter_t2', costs: { alphaFang: 2, chimeraHide: 1 } },
  legs_hunter_t3: { name: 'Botas Quimera (T3)', req: 'legs_hunter_t2', costs: { alphaFang: 3, chimeraHide: 1 } },

  // ACCESORIOS
  acc_fire: { name: 'Sello de Poder', costs: { gold: 5000 } },
  acc_ice: { name: 'Talismán Glacial', costs: { gold: 5000 } },
  acc_shield: { name: 'Reliquia de Baluarte', costs: { gold: 10000 } },
  acc_crit: { name: 'Amuleto de Precisión', costs: { gold: 10000 } },
  acc_vamp: { name: 'Cáliz Vampírico', costs: { gold: 10000 } },
  acc_void: { name: 'Orbe de Drenaje Abisal', costs: { ancestralIronOre: 2, spectralSilk: 2, chimeraHide: 2, magicThread: 2 } }
};

function registerBlacksmithHandlers(bot, { Player, getPlayer }) {

  // ==========================================
  // MENÚ PRINCIPAL DE LA HERRERÍA REAL
  // ==========================================
  bot.action('menu_blacksmith', async (ctx) => {
    await safeAnswerCb(ctx);
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);

    let text = '⚒️ *HERRERÍA REAL DE LA CIUDADELA* ⚒️\n\n' +
               'El calor de las forjas golpea tu rostro mientras el maestro herrero martilla una pieza de acero candente.\n\n' +
               '— *"¿Vienes buscando equipo, planos o los papeles para cruzar la empalizada?"*\n\n' +
               '💰 *Tu Oro:* ' + (player.gold || 0) + 'g\n\n' +
               '*Servicios y Artículos:*\n';

    const buttons = [
      [Markup.button.callback('📜 Catálogo de Forja y Recetas', 'bs_catalog')]
    ];

    if (!player.hasBorderPermit) {
      text += '• 📜 *Permiso Fronterizo:* Autorización para explorar zonas prohibidas (5,000g)\n\n';
      buttons.push([Markup.button.callback('📜 Comprar Permiso (5,000g)', 'buy_border_permit')]);
    } else {
      text += '• 📜 *Permiso Fronterizo:* ✅ Adquirido\n\n';

      if (!player.hasKhazurPickaxe) {
        text += '• ⛏️ *Pico de Khazur:* Extrae minerales pesados del yacimiento (10,000g)\n\n';
        buttons.push([Markup.button.callback('⛏️ Comprar Pico (10,000g)', 'buy_pickaxe_khazur')]);
      }
      
      if (!player.hasHuntingKnife) {
        text += '• 🔪 *Cuchillo de Desuello:* Extrae botánica y pieles intactas (10,000g)\n\n';
        buttons.push([Markup.button.callback('🔪 Comprar Cuchillo (10,000g)', 'buy_hunting_knife')]);
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
                 '— *"Reúne los materiales en tus expediciones o paga su equivalente en oro donde aplique. ¿Qué estilo de combate prefieres?"*';

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
                 '• *T1:* 5x Mena de Hierro *(O 6,000g)*\n' +
                 '• *T2:* Espada T1 + 3x Mena Ancestral\n' +
                 '• *T3:* Espada T2 + 1x Mena Ancestral + 1x Esencia de Dragón\n\n' +
                 '*🪖 ARMADURA PESADA*\n' +
                 '• *T1:* Pechera (4x Hierro) | Casco (2x Hierro) | Grebas (3x Hierro)\n' +
                 '• *T2:* Pieza T1 + Pechera (4x Hierro, 2x Ancestral) | Casco (2x Hierro, 1x Ancestral) | Grebas (3x Hierro, 1x Ancestral)\n' +
                 '• *T3:* Pieza T2 + Pechera (4x Ancestral, 2x Escama) | Casco (2x Ancestral, 1x Escama) | Grebas (3x Ancestral, 1x Escama)\n';

    const buttons = [
      [Markup.button.callback('🗡️ Espada T1 (Mats)', 'craft_sword_t1'), Markup.button.callback('💰 Espada T1 (6k)', 'buy_gold_sword_t1')],
      [Markup.button.callback('🗡️ Espada T2', 'craft_sword_t2'), Markup.button.callback('🗡️ Espada T3', 'craft_sword_t3')],
      [Markup.button.callback('🪖 Pechera T1', 'craft_chest_heavy_t1'), Markup.button.callback('🪖 Casco T1', 'craft_head_heavy_t1'), Markup.button.callback('🪖 Grebas T1', 'craft_legs_heavy_t1')],
      [Markup.button.callback('🪖 Pechera T2', 'craft_chest_heavy_t2'), Markup.button.callback('🪖 Casco T2', 'craft_head_heavy_t2'), Markup.button.callback('🪖 Grebas T2', 'craft_legs_heavy_t2')],
      [Markup.button.callback('🪖 Pechera T3', 'craft_chest_heavy_t3'), Markup.button.callback('🪖 Casco T3', 'craft_head_heavy_t3'), Markup.button.callback('🪖 Grebas T3', 'craft_legs_heavy_t3')],
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
                 '• *T1:* 5x Madera Mística *(O 6,000g)*\n' +
                 '• *T2:* Bastón T1 + 3x Seda Espectral\n' +
                 '• *T3:* Bastón T2 + 1x Seda Espectral + 1x Esencia de Dragón\n\n' +
                 '*👘 TÚNICA MÁGICA*\n' +
                 '• *T1:* Túnica (4x Tela) | Sombrero (2x Tela) | Botas (3x Tela)\n' +
                 '• *T2:* Pieza T1 + Túnica (4x Tela, 2x Hilo) | Sombrero (2x Tela, 1x Hilo) | Botas (3x Tela, 1x Hilo)\n' +
                 '• *T3:* Pieza T2 + Túnica (4x Hilo, 2x Seda) | Sombrero (2x Hilo, 1x Seda) | Botas (3x Hilo, 1x Seda)\n';

    const buttons = [
      [Markup.button.callback('🦯 Bastón T1 (Mats)', 'craft_staff_t1'), Markup.button.callback('💰 Bastón T1 (6k)', 'buy_gold_staff_t1')],
      [Markup.button.callback('🦯 Bastón T2', 'craft_staff_t2'), Markup.button.callback('🦯 Bastón T3', 'craft_staff_t3')],
      [Markup.button.callback('👘 Túnica T1', 'craft_chest_mage_t1'), Markup.button.callback('👘 Sombrero T1', 'craft_head_mage_t1'), Markup.button.callback('👘 Botas T1', 'craft_legs_mage_t1')],
      [Markup.button.callback('👘 Túnica T2', 'craft_chest_mage_t2'), Markup.button.callback('👘 Sombrero T2', 'craft_head_mage_t2'), Markup.button.callback('👘 Botas T2', 'craft_legs_mage_t2')],
      [Markup.button.callback('👘 Túnica T3', 'craft_chest_mage_t3'), Markup.button.callback('👘 Sombrero T3', 'craft_head_mage_t3'), Markup.button.callback('👘 Botas T3', 'craft_legs_mage_t3')],
      [Markup.button.callback('⬅️ Volver a Catálogos', 'bs_catalog')]
    ];
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  // ==========================================
  // RECETAS: CAZADOR
  // ==========================================
  bot.action('bs_hunter', async (ctx) => {
    await safeAnswerCb(ctx);
    const text = '🦊 *FORJA DE CAZADOR (CUERO/TEJO)* 🦊\n\n' +
                 '*🏹 ARCOS*\n' +
                 '• *T1:* 5x Rama de Tejo *(O 6,000g)*\n' +
                 '• *T2:* Arco T1 + 3x Colmillo Alfa\n' +
                 '• *T3:* Arco T2 + 1x Colmillo Alfa + 1x Esencia de Dragón\n\n' +
                 '*🦊 ARMADURA DE CAZA*\n' +
                 '• *T1:* Pechera (4x Rama Tejo) | Capucha (2x Rama Tejo) | Botas (3x Rama Tejo)\n' +
                 '• *T2:* Pieza T1 + Pechera (4x Tejo, 2x Colmillo) | Capucha (2x Tejo, 1x Colmillo) | Botas (3x Tejo, 1x Colmillo)\n' +
                 '• *T3:* Pieza T2 + Pechera (4x Colmillo, 2x Quimera) | Capucha (2x Colmillo, 1x Quimera) | Botas (3x Colmillo, 1x Quimera)\n';

    const buttons = [
      [Markup.button.callback('🏹 Arco T1 (Mats)', 'craft_bow_t1'), Markup.button.callback('💰 Arco T1 (6k)', 'buy_gold_bow_t1')],
      [Markup.button.callback('🏹 Arco T2', 'craft_bow_t2'), Markup.button.callback('🏹 Arco T3', 'craft_bow_t3')],
      [Markup.button.callback('🦊 Pechera T1', 'craft_chest_hunter_t1'), Markup.button.callback('🦊 Capucha T1', 'craft_head_hunter_t1'), Markup.button.callback('🦊 Botas T1', 'craft_legs_hunter_t1')],
      [Markup.button.callback('🦊 Pechera T2', 'craft_chest_hunter_t2'), Markup.button.callback('🦊 Capucha T2', 'craft_head_hunter_t2'), Markup.button.callback('🦊 Botas T2', 'craft_legs_hunter_t2')],
      [Markup.button.callback('🦊 Pechera T3', 'craft_chest_hunter_t3'), Markup.button.callback('🦊 Capucha T3', 'craft_head_hunter_t3'), Markup.button.callback('🦊 Botas T3', 'craft_legs_hunter_t3')],
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
                 '— *"Los objetos arcanos de bolsillo otorgan ventajas únicas en el combate PvP."*\n\n' +
                 '*🔥 Fuego (5k):* +Daño | *❄️ Hielo (5k):* -Daño enemigo\n' +
                 '*🛡️ Escudo (10k):* Armadura | *🎯 Crítico (10k):* +Prob Crítico\n' +
                 '*🩸 Vampírico (10k):* Drena vida (30%)\n' +
                 '*🌌 Orbe Abisal:* Roba Maná (Pide 2x Mena Ancestral, 2x Seda, 2x Quimera, 2x Hilo).\n';

    const buttons = [
      [Markup.button.callback('🔥 Fuego (5k)', 'craft_acc_fire'), Markup.button.callback('❄️ Hielo (5k)', 'craft_acc_ice')],
      [Markup.button.callback('🛡️ Escudo (10k)', 'craft_acc_shield'), Markup.button.callback('🎯 Crítico (10k)', 'craft_acc_crit')],
      [Markup.button.callback('🩸 Vampírico (10k)', 'craft_acc_vamp'), Markup.button.callback('🌌 Orbe Abisal (Mats)', 'craft_acc_void')],
      [Markup.button.callback('⬅️ Volver a Catálogos', 'bs_catalog')]
    ];
    return await safeEditMessage(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  // ==========================================
  // LÓGICA DE CRAFTEO (MATERIALES)
  // ==========================================
  bot.action(/^craft_(.+)$/, async (ctx) => {
    const itemId = ctx.match[1];
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const recipe = RECIPES[itemId];

    if (!recipe) return await safeAnswerCb(ctx, '⚠️ Receta desconocida.', true);
    
    // Validar si ya lo tiene
    if (player.unlockedGear.includes(itemId)) {
      return await safeAnswerCb(ctx, `✅ Ya posees: ${recipe.name}. Búscalo en tu Hogar.`, true);
    }
    
    // Validar requerimiento de Tier anterior
    if (recipe.req && !player.unlockedGear.includes(recipe.req)) {
      return await safeAnswerCb(ctx, `⚠️ Requieres forjar primero: ${RECIPES[recipe.req].name}`, true);
    }

    // Validar que tenga todos los materiales/oro
    for (const [mat, amount] of Object.entries(recipe.costs)) {
      if ((player[mat] || 0) < amount) {
        return await safeAnswerCb(ctx, `❌ Te falta: ${MAT_NAMES[mat] || mat} (Necesitas ${amount})`, true);
      }
    }

    // Descontar materiales
    for (const [mat, amount] of Object.entries(recipe.costs)) {
      player[mat] -= amount;
    }

    // Entregar el objeto
    player.unlockedGear.push(itemId);
    await player.save();

    return await safeAnswerCb(ctx, `⚒️ ¡Forjaste con éxito: ${recipe.name}! Ya está en tu baúl.`, true);
  });

  // ==========================================
  // LÓGICA DE COMPRA ALTERNATIVA (ORO PARA T1)
  // ==========================================
  bot.action(/^buy_gold_(.+)$/, async (ctx) => {
    const itemId = ctx.match[1];
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    const recipe = RECIPES[itemId];

    if (!recipe || !recipe.altGold) return await safeAnswerCb(ctx, '⚠️ Opción de oro no disponible.', true);
    
    if (player.unlockedGear.includes(itemId)) {
      return await safeAnswerCb(ctx, `✅ Ya posees: ${recipe.name}`, true);
    }

    if ((player.gold || 0) < recipe.altGold) {
      return await safeAnswerCb(ctx, `❌ Oro insuficiente. Necesitas ${recipe.altGold}g.`, true);
    }

    player.gold -= recipe.altGold;
    player.unlockedGear.push(itemId);
    await player.save();

    return await safeAnswerCb(ctx, `💰 ¡Compraste: ${recipe.name}!`, true);
  });

  // ==========================================
  // COMPRAS DE MENÚ PRINCIPAL
  // ==========================================
  bot.action('buy_border_permit', async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (player.hasBorderPermit) return await safeAnswerCb(ctx, 'Ya posees el Permiso de Exploración.', true);
    if ((player.gold || 0) < 5000) return await safeAnswerCb(ctx, 'Oro insuficiente. Necesitas 5,000g.', true);

    player.gold -= 5000;
    player.hasBorderPermit = true;
    await player.save();
    await safeAnswerCb(ctx, '📜 ¡Compraste el Permiso de Exploración!', true);
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'menu_blacksmith' } });
  });

  bot.action('buy_pickaxe_khazur', async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (!player.hasBorderPermit) return await safeAnswerCb(ctx, 'Requieres primero el Permiso de Exploración.', true);
    if (player.hasKhazurPickaxe) return await safeAnswerCb(ctx, 'Ya posees el Pico de Khazur.', true);
    if ((player.gold || 0) < 10000) return await safeAnswerCb(ctx, 'Oro insuficiente. Necesitas 10,000g.', true);

    player.gold -= 10000;
    player.hasKhazurPickaxe = true;
    await player.save();
    await safeAnswerCb(ctx, '⛏️ ¡Adquiriste el Pico de Khazur!', true);
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'menu_blacksmith' } });
  });

  bot.action('buy_hunting_knife', async (ctx) => {
    const player = await getPlayer(ctx.from.id, ctx.from.first_name);
    if (!player.hasBorderPermit) return await safeAnswerCb(ctx, 'Requieres primero el Permiso de Exploración.', true);
    if (player.hasHuntingKnife) return await safeAnswerCb(ctx, 'Ya posees el Cuchillo de Desuello.', true);
    if ((player.gold || 0) < 10000) return await safeAnswerCb(ctx, 'Oro insuficiente. Necesitas 10,000g.', true);

    player.gold -= 10000;
    player.hasHuntingKnife = true;
    await player.save();
    await safeAnswerCb(ctx, '🔪 ¡Adquiriste el Cuchillo de Desuello!', true);
    return bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'menu_blacksmith' } });
  });
}

module.exports = { registerBlacksmithHandlers };
