// Motor de combate automático para duelos PvP (Abyss RPG)

function getEquipmentAndMitigation(player, incomingDamageType = 'physical') {
  // 1. Mitigación base por Fuerza (Escala hasta un tope de 25% a nivel/stat máximo)
  const strengthMitigation = Math.min(0.25, ((player.strength || 0) / 100) * 0.25);

  // 2. Estructura modular de equipo (Preparada para Cabeza, Coraza, Pantalones y Arma)
  const equipment = player.equipped || {
    weapon: player.equippedWeapon || null,
    head: player.equippedHead || null,
    chest: player.equippedChest || null,
    legs: player.equippedLegs || null
  };

  const weapon = equipment.weapon || {
    type: player.equippedWeaponType || 'none', // 'espada', 'arco', 'baston', 'none'
    bonusDmg: player.weaponBonusDmg || 0,
    bonusCrit: player.weaponBonusCrit || 0
  };

  // Configuración de arma y tipo de daño infligido
  let damageType = 'physical';
  let weaponDmg = weapon.bonusDmg || 0;
  let weaponCrit = weapon.bonusCrit || 0;

  if (weapon.type === 'espada') {
    damageType = 'physical';
    weaponDmg += 4;
  } else if (weapon.type === 'arco') {
    damageType = 'physical';
    weaponDmg += 1;
    weaponCrit += 10; // +10% de probabilidad crítica
  } else if (weapon.type === 'baston') {
    damageType = 'elemental';
    weaponDmg += 3;
  }

  // 3. Mitigación porcentual de piezas de armadura
  const pieces = [equipment.head, equipment.chest, equipment.legs].filter(Boolean);
  let gearMitigation = 0;

  let metalCount = 0;
  let leatherCount = 0;
  let clothCount = 0;

  for (const piece of pieces) {
    const material = piece.material; // 'metal', 'cuero', 'tela'
    const tierPct = piece.mitigationPct || 0.05; // % de mitigación según tier

    if (material === 'metal') {
      metalCount++;
      if (incomingDamageType === 'physical') gearMitigation += tierPct;
    } else if (material === 'tela') {
      clothCount++;
      if (incomingDamageType === 'elemental') gearMitigation += tierPct;
    } else if (material === 'cuero') {
      leatherCount++;
      gearMitigation += tierPct * 0.5; // Balanceado para ambos daños
    }
  }

  // 4. Bonos por Set Completo (3 piezas del mismo tipo)
  const setBonuses = {
    hpMultiplier: metalCount === 3 ? 1.05 : 1.0,     // Full Metal: +5% HP
    extraDodge: leatherCount === 3 ? 5 : 0,           // Full Cuero: +5% Esquive
    extraCritDmg: clothCount === 3 ? 0.05 : 0.0       // Full Tela: +5% Daño Crítico
  };

  // 5. Total de mitigación con Hard Cap del 60% en PvP
  const totalMitigation = Math.min(0.60, strengthMitigation + gearMitigation);

  return {
    damageType,
    weaponDmg,
    weaponCrit,
    totalMitigation,
    setBonuses
  };
}

function simulatePvPDuel(p1, p2) {
  const log = [];

  const eqP1 = getEquipmentAndMitigation(p1, 'physical');
  const eqP2 = getEquipmentAndMitigation(p2, 'physical');

  // Vida máxima ajustada por bonos de set (si aplica)
  let hp1 = Math.round(p1.maxHp * eqP1.setBonuses.hpMultiplier);
  let hp2 = Math.round(p2.maxHp * eqP2.setBonuses.hpMultiplier);

  const maxHp1 = hp1;
  const maxHp2 = hp2;

  let potionsUsed1 = 0;
  let potionsUsed2 = 0;

  const maxPotionsAllowed = 2;
  const availablePotions1 = p1.potionsSmall || 0;
  const availablePotions2 = p2.potionsSmall || 0;

  // Iniciativa según Agilidad
  let attacker = (p1.agility >= p2.agility) ? p1 : p2;
  let defender = (attacker === p1) ? p2 : p1;

  log.push(`⚔️ *¡Comienza el duelo entre ${p1.name} y ${p2.name}!*`);

  const MAX_ROUNDS = 30;
  let round = 1;

  while (hp1 > 0 && hp2 > 0 && round <= MAX_ROUNDS) {
    const isP1Attacking = (attacker === p1);

    // 1. Uso automático de poción si cae por debajo del 40% de vida
    if (isP1Attacking && hp1 <= maxHp1 * 0.4 && potionsUsed1 < maxPotionsAllowed && potionsUsed1 < availablePotions1) {
      potionsUsed1++;
      hp1 = Math.min(maxHp1, hp1 + 20);
      log.push(`🧪 ${p1.name} bebió una Poción de Salud (+20 HP).`);
    } else if (!isP1Attacking && hp2 <= maxHp2 * 0.4 && potionsUsed2 < maxPotionsAllowed && potionsUsed2 < availablePotions2) {
      potionsUsed2++;
      hp2 = Math.min(maxHp2, hp2 + 20);
      log.push(`🧪 ${p2.name} bebió una Poción de Salud (+20 HP).`);
    }

    const attEq = isP1Attacking ? eqP1 : eqP2;
    const defEq = isP1Attacking 
      ? getEquipmentAndMitigation(p2, attEq.damageType) 
      : getEquipmentAndMitigation(p1, attEq.damageType);

    // 2. Probabilidad de Esquive (Agilidad + Bono de Set Cuero, máx 25%)
    const baseDodge = (defender.agility - attacker.agility) * 1.5;
    const dodgeChance = Math.min(25, Math.max(5, baseDodge + defEq.setBonuses.extraDodge));
    const dodged = Math.random() * 100 < dodgeChance;

    if (dodged) {
      log.push(`💨 ${defender.name} esquivó el ataque de ${attacker.name}.`);
    } else {
      // 3. Daño base + arma
      let rawDamage = 10 + (attacker.strength * 1.2) + attEq.weaponDmg;

      // Variación aleatoria (-2 a +2)
      rawDamage += Math.floor(Math.random() * 5) - 2;

      // 4. Aplicar mitigación porcentual del defensor (Tope 60%)
      let finalDamage = Math.round(rawDamage * (1 - defEq.totalMitigation));
      finalDamage = Math.max(3, finalDamage);

      // 5. Probabilidad de Crítico según Suerte (Multiplicador x1.25)
      const critChance = Math.min(35, Math.max(5, (attacker.luck * 1.2) + attEq.weaponCrit));
      const isCrit = Math.random() * 100 < critChance;

      if (isCrit) {
        const critMultiplier = 1.25 + attEq.setBonuses.extraCritDmg;
        finalDamage = Math.round(finalDamage * critMultiplier);
        log.push(`💥 ¡Crítico! ${attacker.name} impactó a ${defender.name} por *${finalDamage}* de daño.`);
      } else {
        const attackIcon = attEq.damageType === 'elemental' ? '🔮' : '🗡️';
        log.push(`${attackIcon} ${attacker.name} golpeó a ${defender.name} por *${finalDamage}* de daño.`);
      }

      // Descontar daño
      if (isP1Attacking) {
        hp2 = Math.max(0, hp2 - finalDamage);
      } else {
        hp1 = Math.max(0, hp1 - finalDamage);
      }
    }

    if (hp1 <= 0 || hp2 <= 0) break;

    // Alternar turno
    const temp = attacker;
    attacker = defender;
    defender = temp;
    round++;
  }

  // Definición del ganador
  let winner = null;
  let loser = null;

  if (hp1 > 0 && hp2 <= 0) {
    winner = p1;
    loser = p2;
  } else if (hp2 > 0 && hp1 <= 0) {
    winner = p2;
    loser = p1;
  } else {
    // Desempate por mayor porcentaje de HP restante
    const p1Ratio = hp1 / maxHp1;
    const p2Ratio = hp2 / maxHp2;
    winner = (p1Ratio >= p2Ratio) ? p1 : p2;
    loser = (winner === p1) ? p2 : p1;
  }

  log.push(`\n🏆 *¡${winner.name} se alza con la victoria en la arena!*`);

  return {
    winnerId: winner.userId,
    loserId: loser.userId,
    combatLog: log,
    potionsConsumedP1: potionsUsed1,
    potionsConsumedP2: potionsUsed2
  };
}

module.exports = { simulatePvPDuel, getEquipmentAndMitigation };
