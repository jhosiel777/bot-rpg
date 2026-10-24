const { Markup } = require('telegraf');
const { Duel } = require('../duelModel');
const { Player } = require('../playerModel');

const WEAPON_STATS = {
  sword_t1: { name: 'Espada T1', type: 'Cortante', baseDmg: 40, crit: 0.15 },
  sword_t2: { name: 'Espada T2', type: 'Cortante', baseDmg: 60, crit: 0.18 },
  sword_t3: { name: 'Espada T3', type: 'Cortante', baseDmg: 85, crit: 0.22 },
  staff_t1: { name: 'Bastón T1', type: 'Mágico', baseDmg: 42, crit: 0.15 },
  staff_t2: { name: 'Bastón T2', type: 'Mágico', baseDmg: 63, crit: 0.20 },
  staff_t3: { name: 'Bastón T3', type: 'Mágico', baseDmg: 90, crit: 0.25 },
  bow_t1: { name: 'Arco T1', type: 'Distancia', baseDmg: 35, crit: 0.25 },
  bow_t2: { name: 'Arco T2', type: 'Distancia', baseDmg: 52, crit: 0.32 },
  bow_t3: { name: 'Arco T3', type: 'Distancia', baseDmg: 75, crit: 0.40 },
  khazur_pickaxe: { name: 'Pico de Khazur', type: 'Perforante', baseDmg: 25, crit: 0.10 },
  dagger: { name: 'Cuchillo', type: 'Físico', baseDmg: 18, crit: 0.10 }
};

function cleanName(name) {
  if (!name) return 'Aventurero';
  let clean = name.replace(/(#|@)\S+/g, ''); 
  clean = clean.replace(/[^\p{L}\p{N}\s]/gu, '').trim(); 
  return clean.split(/\s+/)[0] || 'Aventurero'; 
}

function initPlayerStats(playerDoc) {
  const eq = playerDoc.equipment || {};
  const wKey = WEAPON_STATS[eq.weapon] ? eq.weapon : 'dagger';
  const weapon = WEAPON_STATS[wKey];

  const strBonus = Math.round(Math.pow((playerDoc.strength || 10), 0.6) * 1.8);
  let maxHp = Math.round(200 + (Math.sqrt(playerDoc.maxHp || 100) * 3.5));
  let crit = weapon.crit + ((playerDoc.luck || 0) * 0.002);
  let armorReduction = 0.05;
  let startShield = 15;

  const armorPieces = eq.armorPieces || {};
  const setType = eq.armorSetType; 
  const tier = eq.armorTier || 1; 

  let piecesCount = Object.values(armorPieces).filter(Boolean).length;
  if (piecesCount >= 3) {
    if (setType === 'heavy') {
      const hpBonuses = { 1: 0.02, 2: 0.05, 3: 0.08 };
      maxHp = Math.round(maxHp * (1 + (hpBonuses[tier] || 0.02)));
      armorReduction = 0.15 + (tier * 0.03);
      startShield = 30 + (tier * 15);
    } else if (setType === 'mage') {
      const critBonuses = { 1: 0.03, 2: 0.06, 3: 0.10 };
      crit += (critBonuses[tier] || 0.03);
      armorReduction = 0.08;
      startShield = 20;
    } else if (setType === 'hunter') {
      const statBonuses = { 1: 2, 2: 4, 3: 7 };
      const bonus = statBonuses[tier] || 2;
      playerDoc.agility = (playerDoc.agility || 0) + bonus;
      playerDoc.luck = (playerDoc.luck || 0) + bonus;
      armorReduction = 0.10;
      startShield = 25;
    }
  }

  return {
    id: playerDoc.userId,
    name: cleanName(playerDoc.name),
    hp: maxHp,
    maxHp: maxHp,
    shield: startShield,
    mana: 5,
    maxMana: 5,
    pvpDmg: weapon.baseDmg + strBonus,
    crit: crit,
    reduction: armorReduction,
    weaponName: weapon.name,
    weaponType: weapon.type,
    accessory: eq.accessory || playerDoc.equippedAccessory || playerDoc.accessory || 'none',
    accessoryUsedThisTurn: false,
    burnTurns: 0,
    attackDebuff: 0
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
    [
      Markup.button.callback('💍 Accesorio (3💧)', `pvp_act_${duel._id}_accessory`),
      Markup.button.callback('⏭️ Pasar Turno (+2💧)', `pvp_act_${duel._id}_pass`)
    ]
  ];

  return { text, buttons };
}

function registerPvPCombat(bot, { getPlayer }) {
  bot.action(/pvp_accept_([a-f0-9]{24})/, async (ctx) => {
    const duelId = ctx.match[1];
    const opponent = await getPlayer(ctx.from.id, ctx.from.first_name);
    const duel = await Duel.findById(duelId);
    
    if (!duel || duel.status !== 'open') return ctx.answerCbQuery('Duelo no disponible.', true);

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
    await ctx.deleteMessage().catch(() => {});
    
    const oppMsg = await ctx.reply(ui.text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(ui.buttons) });
    const creatorMsg = await bot.telegram.sendMessage(creator.userId, ui.text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(ui.buttons) }).catch(() => {});

    duel.gameState.p1MsgId = creatorMsg ? creatorMsg.message_id : null;
    duel.gameState.p2MsgId = oppMsg ? oppMsg.message_id : null;
    duel.markModified('gameState');
    await duel.save();
  });

  bot.action(/pvp_act_([a-f0-9]{24})_(basic|skill|accessory|pass)/, async (ctx) => {
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

    if (attacker.burnTurns > 0) {
      attacker.hp -= 15;
      attacker.burnTurns--;
      state.log.push(`🔥 ${attacker.name} sufre 15 de daño por quemadura.`);
    }

    let logMsg = '';
    let endTurn = false;

    if (action === 'basic' || action === 'skill') {
      const cost = action === 'basic' ? 1 : 3;
      if (attacker.mana < cost) return ctx.answerCbQuery(`Maná insuficiente (${cost}💧).`, true);
      attacker.mana -= cost;

      let dmg = action === 'basic' ? attacker.pvpDmg : Math.round(attacker.pvpDmg * 1.5);
      
      if (attacker.attackDebuff > 0) {
        dmg = Math.round(dmg * 0.8);
        attacker.attackDebuff--;
      }

      if (Math.random() < attacker.crit) {
        dmg = Math.round(dmg * 1.4);
        logMsg = action === 'basic' 
          ? `⚔️ ${attacker.name} atacó con ${attacker.weaponName} ¡CRÍTICO!`
          : `🔥 ${attacker.name} usó Habilidad Especial ¡CRÍTICO!`;
      } else {
        logMsg = action === 'basic' 
          ? `⚔️ ${attacker.name} atacó con ${attacker.weaponName}.`
          : `🔥 ${attacker.name} usó Habilidad Especial.`;
      }

      const finalDmg = Math.round(dmg * (1 - defender.reduction));
      if (defender.shield > 0) {
        if (defender.shield >= finalDmg) {
          defender.shield -= finalDmg;
          logMsg += ` (Escudo absorbió el daño)`;
        } else {
          const res = finalDmg - defender.shield;
          defender.shield = 0;
          defender.hp -= res;
          logMsg += ` (¡Escudo roto!)`;
        }
      } else {
        defender.hp -= finalDmg;
      }
      endTurn = true;

    } else if (action === 'accessory') {
      if (attacker.accessoryUsedThisTurn) return ctx.answerCbQuery('⚠️ Solo puedes usar un accesorio por turno.', true);
      if (attacker.accessory === 'none') return ctx.answerCbQuery('No tienes ningún accesorio equipado.', true);
      if (attacker.mana < 3) return ctx.answerCbQuery('Maná insuficiente (requiere 3💧).', true);

      attacker.mana -= 3;
      attacker.accessoryUsedThisTurn = true;
      const acc = attacker.accessory;

      if (acc === 'shield') { attacker.shield += 20; logMsg = `🛡️ ${attacker.name} activó Escudo (+20).`; } 
      else if (acc === 'critical') { attacker.crit += 0.25; logMsg = `🎯 ${attacker.name} aumentó su crítico temporalmente.`; } 
      else if (acc === 'vampiric') { defender.hp -= 30; attacker.hp = Math.min(attacker.maxHp, attacker.hp + 30); logMsg = `🩸 ${attacker.name} drenó 30 HP al rival.`; } 
      else if (acc === 'fire') { defender.burnTurns = 3; logMsg = `🔥 ${attacker.name} quemó al rival (3 turnos).`; } 
      else if (acc === 'ice') { defender.attackDebuff = 2; logMsg = `❄️ ${attacker.name} congeló y bajó el ataque rival.`; } 
      else if (acc === 'abyssal') {
        if (defender.mana > 0) {
          defender.mana--; attacker.mana = Math.min(attacker.maxMana, attacker.mana + 1);
          logMsg = `🌌 ${attacker.name} robó 1 cristal de maná al rival.`;
        } else {
          logMsg = `🌌 ${attacker.name} intentó usar Orbe Abisal, pero el rival no tenía maná.`;
        }
      }

    } else if (action === 'pass') {
      logMsg = `⏳ ${attacker.name} pasó su turno.`;
      endTurn = true;
    }

    if (defender.hp <= 0) {
      duel.status = 'completed';
      duel.winnerId = attacker.id;
      state.log.push(`🏆 ¡${attacker.name} ha ganado el duelo!`);
    } else if (endTurn) {
      state.turn = defender.id;
      defender.mana = Math.min(defender.maxMana, defender.mana + 2);
      attacker.accessoryUsedThisTurn = false;
      state.log.push(logMsg);
    } else {
      state.log.push(logMsg); 
    }

    duel.markModified('gameState');
    await duel.save();

    const ui = getCombatInterface(duel);
    const opts = { parse_mode: 'Markdown' };
    if (duel.status !== 'completed') opts.reply_markup = Markup.inlineKeyboard(ui.buttons).reply_markup;

    try { await bot.telegram.editMessageText(state.p1.id, state.p1MsgId, null, ui.text, opts); } catch (e) {}
    try { await bot.telegram.editMessageText(state.p2.id, state.p2MsgId, null, ui.text, opts); } catch (e) {}
  });
}

module.exports = { registerPvPCombat };
