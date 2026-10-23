// routes/pvpRoutes.js
const express = require('express');
const router = express.Router();
const { Duel } = require('../duelModel');
const { Player } = require('../playerModel');

// Constantes de equipamiento para el balance
const WEAPON_STATS = {
  iron_sword: { baseDmg: 45, crit: 0.15, type: 'weapon' },
  khazur_pickaxe: { baseDmg: 32, crit: 0.18, type: 'pickaxe', shieldMult: 1.2 },
  obsidian_blade: { baseDmg: 55, crit: 0.35, type: 'weapon' },
  malakor_scepter: { baseDmg: 52, crit: 0.22, type: 'weapon', lifesteal: 0.30 },
  dagger: { baseDmg: 20, crit: 0.10, type: 'tool' }, // Arma por defecto
};

const ARMOR_STATS = {
  cloth_tunic: { reduction: 0.05, startShield: 15 },
  iron_cuirass: { reduction: 0.12, startShield: 35 },
  vaelgathar_scales: { reduction: 0.20, startShield: 50 },
  none: { reduction: 0, startShield: 0 }
};

// Fórmula de compresión PvP
function calculatePvPStats(playerDoc) {
  const stats = typeof playerDoc.getCombatStats === 'function' ? playerDoc.getCombatStats() : { maxHp: playerDoc.maxHp, str: playerDoc.strength || 0 };
  
  // Compresión de Vida: Base 200 + (Raíz cuadrada del HP real * 3.5)
  const pvpHp = Math.round(200 + (Math.sqrt(stats.maxHp) * 3.5));
  
  // Identificar arma y armadura (asumiendo que el modelo Player tiene equipment)
  const eq = playerDoc.equipment || {};
  let weaponKey = eq.weapon || (eq.tool === 'tool_pickaxe' ? 'khazur_pickaxe' : 'dagger');
  if (!WEAPON_STATS[weaponKey]) weaponKey = 'dagger';
  
  let armorKey = eq.armor || 'none';
  if (!ARMOR_STATS[armorKey]) armorKey = 'none';

  const wStats = WEAPON_STATS[weaponKey];
  const aStats = ARMOR_STATS[armorKey];

  // Compresión de Daño: Daño Base del Arma + (Fuerza^0.6 * 1.8)
  const strBonus = Math.round(Math.pow(stats.str, 0.6) * 1.8);
  const pvpDmg = wStats.baseDmg + strBonus;

  return {
    id: playerDoc.userId,
    name: playerDoc.name,
    level: playerDoc.level,
    hp: pvpHp,
    maxHp: pvpHp,
    shield: aStats.startShield,
    mana: 5,
    maxMana: 5,
    weapon: weaponKey,
    armor: armorKey,
    pvpDmg: pvpDmg,
    critChance: wStats.crit,
    dmgReduction: aStats.reduction,
    shieldMult: wStats.shieldMult || 1,
    lifesteal: wStats.lifesteal || 0,
    accessory: eq.accessory || 'none'
  };
}

// ==========================================
// OBTENER DATOS DEL DUELO E INICIALIZAR
// ==========================================
router.get('/duel-data', async (req, res) => {
  try {
    const { duelId, userId } = req.query;
    if (!duelId || !userId) return res.status(400).json({ error: 'Faltan parámetros' });

    const duel = await Duel.findById(duelId);
    if (!duel) return res.status(404).json({ error: 'Duelo no encontrado' });

    if (duel.status === 'open' || duel.status === 'cancelled') {
      return res.status(400).json({ error: 'El duelo no está activo' });
    }

    // Inicializar el estado de combate si no existe
    if (!duel.gameState) {
      const creator = await Player.findOne({ userId: duel.creatorId });
      const opponent = await Player.findOne({ userId: duel.opponentId });

      if (!creator || !opponent) return res.status(404).json({ error: 'Jugador no encontrado' });

      duel.gameState = {
        turn: duel.creatorId, // El creador empieza
        p1: calculatePvPStats(creator),
        p2: calculatePvPStats(opponent),
        log: ['⚔️ ¡El duelo ha comenzado!']
      };
      await duel.save();
    }

    // Determinar quién es el jugador local y quién el rival para el frontend
    const isP1 = parseInt(userId) === duel.gameState.p1.id;
    const hero = isP1 ? duel.gameState.p1 : duel.gameState.p2;
    const enemy = isP1 ? duel.gameState.p2 : duel.gameState.p1;

    res.json({
      duelId: duel._id,
      status: duel.status,
      turn: duel.gameState.turn,
      hero,
      enemy,
      log: duel.gameState.log
    });
  } catch (err) {
    console.error('Error en /duel-data:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ==========================================
// PROCESAR TURNO Y ATAQUES
// ==========================================
router.post('/action', async (req, res) => {
  try {
    const { duelId, userId, actionType } = req.body;
    const duel = await Duel.findById(duelId);
    
    if (!duel || duel.status !== 'active') {
      return res.status(400).json({ error: 'Duelo no válido o ya finalizado' });
    }

    const state = duel.gameState;
    if (state.turn !== parseInt(userId)) {
      return res.status(403).json({ error: 'No es tu turno' });
    }

    const isP1 = parseInt(userId) === state.p1.id;
    const attacker = isP1 ? state.p1 : state.p2;
    const defender = isP1 ? state.p2 : state.p1;

    let dmg = 0;
    let logMsg = '';
    let manaCost = 0;
    let isCrit = false;

    // Lógica de acciones
    if (actionType === 'basic') {
      manaCost = 1;
      dmg = Math.round(attacker.pvpDmg * 0.5); // Básico hace la mitad del daño PvP
      logMsg = `⚔️ ${attacker.name} usó Ataque Básico.`;
    } else if (actionType === 'weapon') {
      manaCost = 2;
      dmg = attacker.pvpDmg;
      logMsg = `🗡️ ${attacker.name} usó el ataque de su arma.`;
    } else if (actionType === 'skill') {
      manaCost = 3;
      dmg = Math.round(attacker.pvpDmg * 1.5);
      logMsg = `🔥 ${attacker.name} desató su Habilidad Especial.`;
    } else if (actionType === 'accessory') {
      manaCost = 2;
      attacker.shield += 30;
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + 20);
      logMsg = `💍 ${attacker.name} activó su accesorio (+30 Escudo, +20 HP).`;
    } else if (actionType === 'pass') {
      logMsg = `⏳ ${attacker.name} pasó su turno.`;
    }

    if (attacker.mana < manaCost) {
      return res.status(400).json({ error: 'Maná insuficiente' });
    }

    // Aplicar costos e impactos
    attacker.mana -= manaCost;

    if (dmg > 0) {
      // Críticos
      if (Math.random() < attacker.critChance) {
        dmg = Math.round(dmg * 1.4);
        isCrit = true;
        logMsg += ' ¡CRÍTICO!';
      }

      // Mitigación de armadura
      let finalDmg = Math.round(dmg * (1 - defender.dmgReduction));

      // Escudo con multiplicador de Quiebra-Escudos (Pico)
      if (defender.shield > 0) {
        const shieldDmg = Math.round(finalDmg * attacker.shieldMult);
        if (defender.shield >= shieldDmg) {
          defender.shield -= shieldDmg;
          finalDmg = 0;
        } else {
          const absorbed = Math.ceil(defender.shield / attacker.shieldMult);
          finalDmg = Math.max(0, finalDmg - absorbed);
          defender.shield = 0;
        }
      }

      // Daño final a HP
      if (finalDmg > 0) {
        defender.hp = Math.max(0, defender.hp - finalDmg);
      }

      // Robo de vida (Cetro de Malakor)
      if (attacker.lifesteal > 0 && finalDmg > 0) {
        const heal = Math.round(finalDmg * attacker.lifesteal);
        attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
      }
    }

    state.log.push(logMsg);

    // Revisar fin del combate
    if (defender.hp <= 0) {
      duel.status = 'completed';
      duel.winnerId = attacker.id;
      state.log.push(`🏆 ¡${attacker.name} ha ganado el duelo!`);
      // Nota: La distribución de oro/GRAM se debe hacer aquí o mediante un webhook interno
    } else {
      // Cambio de turno si el jugador pasa, o si se queda en 0 mana
      if (actionType === 'pass' || attacker.mana === 0) {
        state.turn = defender.id;
        defender.mana = defender.maxMana; // Recargar maná del defensor al iniciar su turno
      }
    }

    // Guardar cambios forzando a Mongoose a notar el cambio en el objeto
    duel.markModified('gameState');
    await duel.save();

    res.json({ success: true, gameState: duel.gameState, status: duel.status });
  } catch (err) {
    console.error('Error en /action:', err);
    res.status(500).json({ error: 'Error al procesar la acción' });
  }
});

module.exports = router;
