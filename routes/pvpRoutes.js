const express = require('express');
const router = express.Router();
const { Duel } = require('../duelModel');
const { Player } = require('../playerModel');

const WEAPON_STATS = {
  iron_sword: { baseDmg: 45, crit: 0.15, type: 'weapon' },
  khazur_pickaxe: { baseDmg: 32, crit: 0.18, type: 'pickaxe', shieldMult: 1.2 },
  obsidian_blade: { baseDmg: 55, crit: 0.35, type: 'weapon' },
  malakor_scepter: { baseDmg: 52, crit: 0.22, type: 'weapon', lifesteal: 0.30 },
  dagger: { baseDmg: 20, crit: 0.10, type: 'tool' }
};

const ARMOR_STATS = {
  cloth_tunic: { reduction: 0.05, startShield: 15 },
  iron_cuirass: { reduction: 0.12, startShield: 35 },
  vaelgathar_scales: { reduction: 0.20, startShield: 50 },
  none: { reduction: 0, startShield: 0 }
};

function calculatePvPStats(playerDoc) {
  try {
    const getStats = typeof playerDoc.getCombatStats === 'function' ? playerDoc.getCombatStats : null;
    const stats = getStats ? getStats.call(playerDoc) : { maxHp: playerDoc.maxHp, str: playerDoc.strength };
    
    // Forzamos números para evitar crasheos de NaN
    const safeMaxHp = Number(stats.maxHp) || 100;
    const safeStr = Number(stats.str) || 10;
    
    const pvpHp = Math.round(200 + (Math.sqrt(Math.max(0, safeMaxHp)) * 3.5));
    
    const eq = playerDoc.equipment || {};
    let weaponKey = eq.weapon || (eq.tool === 'tool_pickaxe' ? 'khazur_pickaxe' : 'dagger');
    if (!WEAPON_STATS[weaponKey]) weaponKey = 'dagger';
    
    let armorKey = eq.armor || 'none';
    if (!ARMOR_STATS[armorKey]) armorKey = 'none';

    const wStats = WEAPON_STATS[weaponKey];
    const aStats = ARMOR_STATS[armorKey];
    const strBonus = Math.round(Math.pow(Math.max(0, safeStr), 0.6) * 1.8);

    return {
      id: String(playerDoc.userId), // CRÍTICO: Todo a String para comparaciones perfectas
      name: playerDoc.name || 'Gladiador',
      level: Number(playerDoc.level) || 1,
      hp: pvpHp,
      maxHp: pvpHp,
      shield: aStats.startShield || 0,
      mana: 5,
      maxMana: 5,
      weapon: weaponKey,
      armor: armorKey,
      pvpDmg: wStats.baseDmg + strBonus,
      critChance: wStats.crit,
      dmgReduction: aStats.reduction,
      shieldMult: wStats.shieldMult || 1,
      lifesteal: wStats.lifesteal || 0,
      accessory: eq.accessory || 'none'
    };
  } catch(e) {
    console.error("Error parseando stats:", e);
    return {
      id: String(playerDoc.userId || Date.now()), name: 'Gladiador', level: 1, hp: 200, maxHp: 200, shield: 0,
      mana: 5, maxMana: 5, weapon: 'dagger', armor: 'none', pvpDmg: 25, critChance: 0.1, dmgReduction: 0, shieldMult: 1, lifesteal: 0, accessory: 'none'
    };
  }
}

module.exports = (bot) => {
  
  router.get('/duel-data', async (req, res) => {
    try {
      const { duelId, userId } = req.query;
      const uid = String(userId);
      
      // lean() extrae datos puros y elimina las bloqueos de Mongoose
      let duel = await Duel.findById(duelId).lean();
      if (!duel) return res.status(404).json({ error: 'Duelo no encontrado en la base de datos' });
      
      if (duel.status === 'completed' || duel.status === 'cancelled') {
        return res.json({ status: duel.status, gameState: duel.gameState });
      }

      if (duel.status === 'open' || !duel.gameState) {
        let creator = await Player.findOne({ userId: duel.creatorId }).lean().catch(()=>null);
        if (!creator) creator = await Player.findOne({ userId: Number(duel.creatorId) }).lean().catch(()=>null);
        
        let opponent = await Player.findOne({ userId: duel.opponentId }).lean().catch(()=>null);
        if (!opponent) opponent = await Player.findOne({ userId: Number(duel.opponentId) }).lean().catch(()=>null);
        
        const newGameState = {
          turn: duel.creatorId,
          p1: calculatePvPStats(creator || { userId: duel.creatorId, name: duel.creatorName || 'Retador' }),
          p2: calculatePvPStats(opponent || { userId: duel.opponentId, name: duel.opponentName || 'Oponente' }),
          log: ['⚔️ ¡La batalla ha comenzado automáticamente!']
        };
        
        // updateOne fuerza la inserción sin verificar esquemas
        await Duel.updateOne({ _id: duelId }, {
          $set: { status: 'active', gameState: newGameState }
        });
        
        duel.status = 'active';
        duel.gameState = newGameState;
      }

      const isP1 = String(uid) === String(duel.gameState.p1.id);
      res.json({
        duelId: duel._id,
        status: duel.status,
        turn: duel.gameState.turn,
        hero: isP1 ? duel.gameState.p1 : duel.gameState.p2,
        enemy: isP1 ? duel.gameState.p2 : duel.gameState.p1,
        log: duel.gameState.log
      });
    } catch (err) {
      console.error("Error en /duel-data:", err);
      res.status(500).json({ error: 'Error interno de Arena: ' + err.message });
    }
  });

  router.post('/action', async (req, res) => {
    try {
      const { duelId, userId, actionType } = req.body;
      const duel = await Duel.findById(duelId).lean();
      
      if (!duel || duel.status !== 'active') return res.status(400).json({ error: 'Duelo inactivo' });
      
      const state = duel.gameState;
      if (String(state.turn) !== String(userId)) return res.status(403).json({ error: 'No es tu turno' });

      const isP1 = String(userId) === String(state.p1.id);
      const attacker = isP1 ? state.p1 : state.p2;
      const defender = isP1 ? state.p2 : state.p1;

      let dmg = 0; let logMsg = ''; let manaCost = 0;

      if (actionType === 'basic') {
        manaCost = 1; dmg = Math.round(attacker.pvpDmg * 0.5);
        logMsg = `⚔️ ${attacker.name} usó Golpe Rápido.`;
      } else if (actionType === 'weapon') {
        manaCost = 2; dmg = attacker.pvpDmg;
        logMsg = `🗡️ ${attacker.name} atacó con su arma.`;
      } else if (actionType === 'skill') {
        manaCost = 3; dmg = Math.round(attacker.pvpDmg * 1.5);
        logMsg = `💥 ${attacker.name} ejecutó Golpe Fuerte.`;
      } else if (actionType === 'accessory') {
        if (attacker.accessory === 'none') return res.status(400).json({ error: 'No tienes accesorio' });
        manaCost = 2; attacker.shield += 30; attacker.hp = Math.min(attacker.maxHp, attacker.hp + 20);
        logMsg = `💍 ${attacker.name} activó su accesorio (+30 Escudo, +20 HP).`;
      } else if (actionType === 'pass') {
        logMsg = `⏳ ${attacker.name} pasó su turno.`;
      }

      if (attacker.mana < manaCost) return res.status(400).json({ error: 'Maná insuficiente' });
      attacker.mana -= manaCost;

      if (dmg > 0) {
        let isCrit = Math.random() < attacker.critChance;
        if (isCrit) { dmg = Math.round(dmg * 1.4); logMsg += ' ¡CRÍTICO!'; }
        
        let finalDmg = Math.round(dmg * (1 - defender.dmgReduction));

        if (defender.shield > 0) {
          const shieldDmg = Math.round(finalDmg * attacker.shieldMult);
          if (defender.shield >= shieldDmg) { defender.shield -= shieldDmg; finalDmg = 0; }
          else {
            const absorbed = Math.ceil(defender.shield / attacker.shieldMult);
            finalDmg = Math.max(0, finalDmg - absorbed); defender.shield = 0;
          }
        }

        if (finalDmg > 0) defender.hp = Math.max(0, defender.hp - finalDmg);
        
        if (attacker.lifesteal > 0 && finalDmg > 0) {
          attacker.hp = Math.min(attacker.maxHp, attacker.hp + Math.round(finalDmg * attacker.lifesteal));
        }
      }

      state.log.push(logMsg);

      if (defender.hp <= 0) {
        duel.status = 'completed';
        duel.winnerId = attacker.id;
        state.log.push(`🏆 ¡${attacker.name} ha ganado!`);

        const winnerDoc = await Player.findOne({ userId: attacker.id });
        let rewardText = "Victoria amistosa.";
        
        if (duel.mode !== 'friendly' && winnerDoc) {
          const totalPot = duel.betAmount * 2;
          if (duel.mode === 'gold') {
            const net = Math.floor(totalPot * 0.95);
            winnerDoc.gold = (winnerDoc.gold || 0) + net;
            rewardText = `Ganó ${net} de Oro (Pozo con 5% de quema).`;
          } else if (duel.mode === 'gram') {
            let fee = totalPot * 0.08;
            if (fee < 0.02 && totalPot > 0) fee = 0.02;
            const net = totalPot - fee;
            winnerDoc.gram = (winnerDoc.gram || 0) + net;
            rewardText = `Ganó ${net.toFixed(3)} GRAM (Comisión aplicada).`;
          }
          await winnerDoc.save();
        }

        try {
          const msg = `🏆 *RESULTADO DE LA ARENA*\n\n👑 *Ganador:* ${attacker.name}\n💀 *Derrotado:* ${defender.name}\n💰 *Botín:* ${rewardText}`;
          bot.telegram.sendMessage(attacker.id, msg, { parse_mode: 'Markdown' });
          bot.telegram.sendMessage(defender.id, msg, { parse_mode: 'Markdown' });
        } catch(e) {}

      } else if (actionType === 'pass' || attacker.mana === 0) {
        state.turn = defender.id; defender.mana = defender.maxMana;
      }

      // updateOne forzado para evitar fallos de guardado
      let updatePayload = { gameState: state, status: duel.status };
      if (duel.winnerId) updatePayload.winnerId = duel.winnerId;

      await Duel.updateOne({ _id: duelId }, { $set: updatePayload });

      res.json({ success: true, gameState: state, status: duel.status });
    } catch (err) {
      console.error("Error procesando acción:", err);
      res.status(500).json({ error: 'Error procesando ataque: ' + err.message });
    }
  });

  return router;
};
