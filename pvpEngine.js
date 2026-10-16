// Motor de combate automático para duelos PvP (Abyss RPG)

function getEquipmentAndMitigation(player, incomingDamageType = 'physical') {
  // 1. Mitigación base por Fuerza (Escala hasta un tope de 25% a nivel/stat máximo)
  const strengthMitigation = Math.min(0.25, ((player.strength || 0) / 100) * 0.25);

  // 2. Estructura modular de equipo
  const equipment = player.equipped || {
    weapon: player.equippedWeapon || null,
    head: player.equippedHead || null,
    chest: player.equippedChest || null,
    legs: player.equippedLegs || null
  };

  const weapon = equipment.weapon || {
    type: player.equippedWeaponType || 'none',
    bonusDmg: player.weaponBonusDmg || 0,
    bonusCrit: player.weaponBonusCrit || 0
  };

  let damageType = 'physical';
  let weaponDmg = weapon.bonusDmg || 0;
  let weaponCrit = weapon.bonusCrit || 0;

  if (weapon.type === 'espada') {
    damageType = 'physical';
    weaponDmg += 4;
  } else if (weapon.type === 'arco') {
    damageType = 'physical';
    weaponDmg += 1;
    weaponCrit += 10;
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
    const material = piece.material;
    const tierPct = piece.mitigationPct || 0.05;

    if (material === 'metal') {
      metalCount++;
      if (incomingDamageType === 'physical') gearMitigation += tierPct;
    } else if (material === 'tela') {
      clothCount++;
      if (incomingDamageType === 'elemental') gearMitigation += tierPct;
    } else if (material === 'cuero') {
      leatherCount++;
      gearMitigation += tierPct * 0.5;
    }
  }

  // 4. Bonos por Set Completo (3 piezas)
  const setBonuses = {
    hpMultiplier: metalCount === 3 ? 1.05 : 1.0,
    extraDodge: leatherCount === 3 ? 5 : 0,
    extraCritDmg: clothCount === 3 ? 0.05 : 0.0
  };

  // 5. Hard Cap de mitigación del 60% en PvP
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

  let hp1 = Math.round(p1.maxHp * eqP1.setBonuses.hpMultiplier);
  let hp2 = Math.round(p2.maxHp * eqP2.setBonuses.hpMultiplier);

  const maxHp1 = hp1;
  const maxHp2 = hp2;

  // Seguimiento de pociones reales en la mochila
  let p1SmallAvailable = p1.potionsSmall || 0;
  let p1MedAvailable = p1.potionsMedium || 0;
  let p1SmallUsed = 0;
  let p1MedUsed = 0;

  let p2SmallAvailable = p2.potionsSmall || 0;
  let p2MedAvailable = p2.potionsMedium || 0;
  let p2SmallUsed = 0;
  let p2MedUsed = 0;

  const MAX_POTIONS_PER_DUEL = 2;

  let attacker = (p1.agility >= p2.agility) ? p1 : p2;
  let defender = (attacker === p1) ? p2 : p1;

  log.push(`⚔️ *¡Comienza el duelo entre ${p1.name} y ${p2.name}!*`);

  const MAX_ROUNDS = 30;
  let round = 1;

  while (hp1 > 0 && hp2 > 0 && round <= MAX_ROUNDS) {
    const isP1Attacking = (attacker === p1);

    // 1. Uso automático de pociones (Prioriza Mayor +35 HP, luego Menor +10 HP)
    if (isP1Attacking && hp1 <= maxHp1 * 0.4 && (p1SmallUsed + p1MedUsed) < MAX_POTIONS_PER_DUEL) {
      if (p1MedAvailable > 0) {
        p1MedAvailable--;
        p1MedUsed++;
        hp1 = Math.min(maxHp1, hp1 + 35);
        log.push(`🧪 ${p1.name} bebió una *Poción Mayor de Salud* (+35 HP).`);
      } else if (p1SmallAvailable > 0) {
        p1SmallAvailable--;
        p1SmallUsed++;
        hp1 = Math.min(maxHp1, hp1 + 10);
        log.push(`🧪 ${p1.name} bebió una *Poción Menor de Salud* (+10 HP).`);
      }
    } else if (!isP1Attacking && hp2 <= maxHp2 * 0.4 && (p2SmallUsed + p2MedUsed) < MAX_POTIONS_PER_DUEL) {
      if (p2MedAvailable > 0) {
        p2MedAvailable--;
        p2MedUsed++;
        hp2 = Math.min(maxHp2, hp2 + 35);
        log.push(`🧪 ${p2.name} bebió una *Poción Mayor de Salud* (+35 HP).`);
      } else if (p2SmallAvailable > 0) {
        p2SmallAvailable--;
        p2SmallUsed++;
        hp2 = Math.min(maxHp2, hp2 + 10);
        log.push(`🧪 ${p2.name} bebió una *Poción Menor de Salud* (+10 HP).`);
      }
    }

    const attEq = isP1Attacking ? eqP1 : eqP2;
    const defEq = isP1Attacking 
      ? getEquipmentAndMitigation(p2, attEq.damageType) 
      : getEquipmentAndMitigation(p1, attEq.damageType);

    // 2. Esquive por Agilidad
    const baseDodge = (defender.agility - attacker.agility) * 1.5;
    const dodgeChance = Math.min(25, Math.max(5, baseDodge + defEq.setBonuses.extraDodge));
    const dodged = Math.random() * 100 < dodgeChance;

    if (dodged) {
      log.push(`💨 ${defender.name} esquivó el ataque de ${attacker.name}.`);
    } else {
      // 3. Daño base
      let rawDamage = 10 + (attacker.strength * 1.2) + attEq.weaponDmg;
      rawDamage += Math.floor(Math.random() * 5) - 2;

      // 4. Mitigación (máx 60%)
      let finalDamage = Math.round(rawDamage * (1 - defEq.totalMitigation));
      finalDamage = Math.max(3, finalDamage);

      // 5. Crítico (x1.25)
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

      if (isP1Attacking) {
        hp2 = Math.max(0, hp2 - finalDamage);
      } else {
        hp1 = Math.max(0, hp1 - finalDamage);
      }
    }

    if (hp1 <= 0 || hp2 <= 0) break;

    const temp = attacker;
    attacker = defender;
    defender = temp;
    round++;
  }

  let winner = null;
  let loser = null;

  if (hp1 > 0 && hp2 <= 0) {
    winner = p1;
    loser = p2;
  } else if (hp2 > 0 && hp1 <= 0) {
    winner = p2;
    loser = p1;
  } else {
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
    potionsUsedP1: { small: p1SmallUsed, medium: p1MedUsed },
    potionsUsedP2: { small: p2SmallUsed, medium: p2MedUsed }
  };
}

module.exports = { simulatePvPDuel, getEquipmentAndMitigation };
