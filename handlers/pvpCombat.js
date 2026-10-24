const { Markup } = require('telegraf');
const { Duel } = require('../duelModel');
const { Player } = require('../playerModel');

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

  if (duel.status === 'completed') {
    return { text, buttons: [] };
  }

  text += `Es el turno de: *${activePlayer.name}*`;

  const buttons = [
    [
      Markup.button.callback('⚔️ Atacar (1💧)', `pvp_act_${duel._id}_basic`),
      Markup.button.callback('🔥 Habilidad (3💧)', `pvp_act_${duel._id}_skill`)
    ],
    [Markup.button.callback('⏭️ Pasar Turno (+2💧)', `pvp_act_${duel._id}_pass`)]
  ];

  return { text, buttons };
}

function registerPvPCombat(bot, { getPlayer }) {
  
  bot.action(/pvp_accept_([a-f0-9]{24})/, async (ctx) => {
    const duelId = ctx.match[1];
    const opponent = await getPlayer(ctx.from.id, ctx.from.first_name);
    
    const duel = await Duel.findById(duelId);
    if (!duel || duel.status !== 'open') return ctx.answerCbQuery('El duelo ya no está disponible.', true);
    if (duel.creatorId === opponent.userId) return ctx.answerCbQuery('No puedes batirte contra ti mismo.', true);
    if ((opponent.level || 1) < 5 || !opponent.tonWalletAddress) return ctx.answerCbQuery('Requieres nivel 5 y billetera TON.', true);

    if (duel.mode === 'gold' && (opponent.gold || 0) < duel.betAmount) return ctx.answerCbQuery('Oro insuficiente.', true);
    if (duel.mode === 'gram' && (opponent.gram || 0) < duel.betAmount) return ctx.answerCbQuery('GRAM insuficiente.', true);

    if (duel.mode === 'gold') opponent.gold -= duel.betAmount;
    if (duel.mode === 'gram') opponent.gram = Math.max(0, opponent.gram - duel.betAmount);
    await opponent.save();

    const creator = await Player.findOne({ userId: duel.creatorId });
    
    duel.status = 'active';
    duel.opponentId = opponent.userId;
    duel.opponentName = opponent.name;
    duel.opponentTitle = opponent.activeTitle;
    duel.gameState = {
      turn: creator.userId,
      p1: initPlayerStats(creator),
      p2: initPlayerStats(opponent),
      log: ['¡Ambos gladiadores están listos! El combate ha comenzado.']
    };

    const ui = getCombatInterface(duel);
    
    // Sincronizar mensajes en ambos chats
    const oppMsg = await ctx.editMessageText(ui.text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(ui.buttons) });
    const creatorMsg = await bot.telegram.sendMessage(creator.userId, ui.text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(ui.buttons) }).catch(()=>{});

    duel.gameState.p1MsgId = creatorMsg ? creatorMsg.message_id : null;
    duel.gameState.p2MsgId = oppMsg ? oppMsg.message_id : ctx.callbackQuery.message.message_id;
    
    duel.markModified('gameState');
    await duel.save();
  });

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

    let dmg = 0; let cost = 0; let logMsg = '';

    if (action === 'basic') { cost = 1; dmg = attacker.pvpDmg; logMsg = `⚔️ ${attacker.name} atacó.`; }
    if (action === 'skill') { cost = 3; dmg = Math.round(attacker.pvpDmg * 1.5); logMsg = `🔥 ${attacker.name} usó una habilidad.`; }
    if (action === 'pass') { logMsg = `⏳ ${attacker.name} se defendió.`; }

    if (attacker.mana < cost) return ctx.answerCbQuery('Maná insuficiente.', true);
    attacker.mana -= cost;

    if (dmg > 0) {
      if (Math.random() < attacker.crit) { dmg = Math.round(dmg * 1.5); logMsg += ' ¡CRÍTICO!'; }
      const finalDmg = Math.round(dmg * (1 - defender.reduction));
      
      if (defender.shield > 0) {
        if (defender.shield >= finalDmg) {
          defender.shield -= finalDmg; logMsg += ` (Escudo absorbió el daño)`;
        } else {
          const res = finalDmg - defender.shield; defender.shield = 0; defender.hp -= res; logMsg += ` (Escudo roto)`;
        }
      } else {
        defender.hp -= finalDmg;
      }
    }

    if (defender.hp <= 0) {
      duel.status = 'completed';
      duel.winnerId = attacker.id;
      state.log.push(`🏆 ¡${attacker.name} ha destrozado a su rival y ganado!`);
      
      const winnerDoc = await Player.findOne({ userId: attacker.id });
      if (winnerDoc && duel.mode !== 'friendly') {
          const totalPot = duel.betAmount * 2;
          if (duel.mode === 'gold') winnerDoc.gold += Math.floor(totalPot * 0.95);
          else if (duel.mode === 'gram') {
              let fee = totalPot * 0.08; if (fee < 0.02 && totalPot > 0) fee = 0.02;
              winnerDoc.gram += (totalPot - fee);
          }
          await winnerDoc.save();
      }
    } else {
      state.turn = defender.id;
      defender.mana = Math.min(defender.maxMana, defender.mana + 2);
      state.log.push(logMsg);
    }

    duel.markModified('gameState');
    await duel.save();

    const ui = getCombatInterface(duel);
    const opts = { parse_mode: 'Markdown' };
    if (duel.status !== 'completed') opts.reply_markup = Markup.inlineKeyboard(ui.buttons).reply_markup;

    // Actualiza ambas pantallas en tiempo real
    try { await bot.telegram.editMessageText(state.p1.id, state.p1MsgId, null, ui.text, opts); } catch(e){}
    try { await bot.telegram.editMessageText(state.p2.id, state.p2MsgId, null, ui.text, opts); } catch(e){}
  });
}

module.exports = { registerPvPCombat };
