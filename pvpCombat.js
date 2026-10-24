const { Markup } = require('telegraf');
const { Duel } = require('../duelModel');
const { Player } = require('../playerModel');

// Estadísticas base para el balance
const WEAPON_STATS = {
  iron_sword: { baseDmg: 45, crit: 0.15 },
  khazur_pickaxe: { baseDmg: 32, crit: 0.18, shieldMult: 1.2 },
  obsidian_blade: { baseDmg: 55, crit: 0.35 },
  malakor_scepter: { baseDmg: 52, crit: 0.22, lifesteal: 0.30 },
  dagger: { baseDmg: 20, crit: 0.10 }
};

const ARMOR_STATS = {
  cloth_tunic: { reduction: 0.05, startShield: 15 },
  iron_cuirass: { reduction: 0.12, startShield: 35 },
  vaelgathar_scales: { reduction: 0.20, startShield: 50 },
  none: { reduction: 0, startShield: 0 }
};

function initPlayerStats(playerDoc) {
  const hp = Math.round(200 + (Math.sqrt(playerDoc.maxHp || 100) * 3.5));
  const eq = playerDoc.equipment || {};
  const wKey = WEAPON_STATS[eq.weapon] ? eq.weapon : 'dagger';
  const aKey = ARMOR_STATS[eq.armor] ? eq.armor : 'none';
  const strBonus = Math.round(Math.pow((playerDoc.strength || 10), 0.6) * 1.8);

  return {
    id: playerDoc.userId,
    name: playerDoc.name,
    hp: hp,
    maxHp: hp,
    shield: ARMOR_STATS[aKey].startShield,
    mana: 5,
    maxMana: 5,
    pvpDmg: WEAPON_STATS[wKey].baseDmg + strBonus,
    crit: WEAPON_STATS[wKey].crit,
    reduction: ARMOR_STATS[aKey].reduction
  };
}

function getCombatInterface(duel) {
  const p1 = duel.gameState.p1;
  const p2 = duel.gameState.p2;
  const isP1Turn = duel.gameState.turn === p1.id;
  const activePlayer = isP1Turn ? p1 : p2;
  
  let text = `⚔️ *ARENA DE COMBATE* ⚔️\n\n`;
  text += `🛡️ *${p1.name}*: ❤️ ${p1.hp}/${p1.maxHp} | 🔷 Escudo: ${p1.shield} | 💧 Maná: ${p1.mana}\n`;
  text += `⚡ *VS*\n`;
  text += `🛡️ *${p2.name}*: ❤️ ${p2.hp}/${p2.maxHp} | 🔷 Escudo: ${p2.shield} | 💧 Maná: ${p2.mana}\n\n`;
  
  text += `📜 *Registro:* ${duel.gameState.log[duel.gameState.log.length - 1]}\n\n`;
  text += `Es el turno de: *${activePlayer.name}*`;

  // Botones de acción. Solo el jugador en turno debería pulsarlos (se valida en el callback)
  const buttons = [
    [
      Markup.button.callback('⚔️ Atacar (1💧)', `pvp_act_${duel._id}_basic`),
      Markup.button.callback('🔥 Habilidad (3💧)', `pvp_act_${duel._id}_skill`)
    ],
    [
      Markup.button.callback('⏭️ Pasar Turno (+Maná)', `pvp_act_${duel._id}_pass`)
    ]
  ];

  return { text, buttons };
}

module.exports = (bot) => {
  // Cuando alguien acepta el duelo desde la taberna
  bot.action(/pvp_accept_([a-f0-9]{24})/, async (ctx) => {
    const duelId = ctx.match[1];
    const opponent = await Player.findOne({ userId: ctx.from.id });
    const duel = await Duel.findById(duelId);
    
    if (!duel || duel.status !== 'open') return ctx.answerCbQuery('Duelo no disponible.', true);
    
    // Configurar estado inicial
    const creator = await Player.findOne({ userId: duel.creatorId });
    duel.status = 'active';
    duel.opponentId = opponent.userId;
    duel.gameState = {
      turn: creator.userId,
      p1: initPlayerStats(creator),
      p2: initPlayerStats(opponent),
      log: ['¡El combate ha comenzado!']
    };
    await duel.save();

    const ui = getCombatInterface(duel);
    // Borrar el mensaje anterior del tablón y enviar la arena
    await ctx.deleteMessage().catch(() => {});
    
    const sentMsg = await ctx.reply(ui.text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(ui.buttons)
    });

    // Enviar notificación al creador para que sepa dónde pelear
    bot.telegram.sendMessage(creator.userId, `⚔️ ¡Tu duelo ha sido aceptado! El combate está ocurriendo en el chat.`).catch(() => {});
  });

  // Manejar acciones del combate
  bot.action(/pvp_act_([a-f0-9]{24})_(basic|skill|pass)/, async (ctx) => {
    const duelId = ctx.match[1];
    const action = ctx.match[2];
    const userId = ctx.from.id;

    const duel = await Duel.findById(duelId);
    if (!duel || duel.status !== 'active') return ctx.answerCbQuery('El duelo ha terminado.', true);
    
    const state = duel.gameState;
    if (state.turn !== userId) return ctx.answerCbQuery('¡No es tu turno!', true);

    const isP1 = state.p1.id === userId;
    const attacker = isP1 ? state.p1 : state.p2;
    const defender = isP1 ? state.p2 : state.p1;

    let dmg = 0;
    let cost = 0;
    let logMsg = '';

    if (action === 'basic') { cost = 1; dmg = attacker.pvpDmg; logMsg = `${attacker.name} atacó con furia.`; }
    if (action === 'skill') { cost = 3; dmg = attacker.pvpDmg * 1.5; logMsg = `${attacker.name} usó una habilidad especial.`; }
    if (action === 'pass') { logMsg = `${attacker.name} se defendió y recuperó maná.`; }

    if (attacker.mana < cost) return ctx.answerCbQuery('Maná insuficiente.', true);
    
    attacker.mana -= cost;

    if (dmg > 0) {
      if (Math.random() < attacker.crit) { dmg *= 1.5; logMsg += ' ¡GOLPE CRÍTICO!'; }
      const finalDmg = Math.round(dmg * (1 - defender.reduction));
      
      if (defender.shield > 0) {
        if (defender.shield >= finalDmg) {
          defender.shield -= finalDmg;
          logMsg += ` (El escudo absorbió el daño)`;
        } else {
          const res = finalDmg - defender.shield;
          defender.shield = 0;
          defender.hp -= res;
          logMsg += ` (Escudo roto)`;
        }
      } else {
        defender.hp -= finalDmg;
      }
    }

    if (defender.hp <= 0) {
      duel.status = 'completed';
      duel.winnerId = attacker.id;
      state.log.push(`🏆 ¡${attacker.name} ha aplastado a su rival y ganado el duelo!`);
      // Aquí añades la lógica de entregar el oro/gram al ganador
    } else {
      // Cambiar turno y regenerar maná
      state.turn = defender.id;
      defender.mana = Math.min(defender.maxMana, defender.mana + 2);
      state.log.push(logMsg);
    }

    duel.markModified('gameState');
    await duel.save();

    const ui = getCombatInterface(duel);
    if (duel.status === 'completed') {
      await ctx.editMessageText(ui.text, { parse_mode: 'Markdown' }); // Sin botones
    } else {
      await ctx.editMessageText(ui.text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(ui.buttons) });
    }
  });
};
