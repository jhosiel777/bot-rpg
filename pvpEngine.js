function getEquipmentAndMitigation(player, incomingDamageType = 'physical') {
  const strengthMitigation = Math.min(0.25, ((player.strength || 0) / 100) * 0.25);

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

  const setBonuses = {
    hpMultiplier: metalCount === 3 ? 1.05 : 1.0,
    extraDodge: leatherCount === 3 ? 5 : 0,
    extraCritDmg: clothCount === 3 ? 0.05 : 0.0
  };

  const totalMitigation = Math.min(0.60, strengthMitigation + gearMitigation);

  return { damageType, weaponDmg, weaponCrit, totalMitigation, setBonuses };
}

function shortenName(name) {
  if (!name) return 'Aventurero';
  const clean = name.trim();
  return clean.length > 18 ? clean.slice(0, 15) + '...' : clean;
}

function simulatePvPDuel(p1, p2) {
  const log = [];
  const name1 = shortenName(p1.name);
  const name2 = shortenName(p2.name);

  const eqP1 = getEquipmentAndMitigation(p1, 'physical');
  const eqP2 = getEquipmentAndMitigation(p2, 'physical');

  let hp1 = Math.round(p1.maxHp * eqP1.setBonuses.hpMultiplier);
  let hp2 = Math.round(p2.maxHp * eqP2.setBonuses.hpMultiplier);
  const maxHp1 = hp1;
  const maxHp2 = hp2;

  let p1SmallAvailable = p1.potionsSmall || 0;
  let p1MedAvailable = p1.potionsMedium || 0;
  let p1SmallUsed = 0;
  let p1MedUsed = 0;

  let p2SmallAvailable = p2.potionsSmall || 0;
  let p2MedAvailable = p2.potionsMedium || 0;
  let p2SmallUsed = 0;
  let p2MedUsed = 0;

  const MAX_POTIONS = 2;

  let attacker = (p1.agility >= p2.agility) ? p1 : p2;
  let defender = (attacker === p1) ? p2 : p1;

  const MAX_ROUNDS = 25;
  let round = 1;

  while (hp1 > 0 && hp2 > 0 && round <= MAX_ROUNDS) {
    const isP1Attacking = (attacker === p1);
    const attName = isP1Attacking ? name1 : name2;
    const defName = isP1Attacking ? name2 : name1;

    const attEq = isP1Attacking ? eqP1 : eqP2;
    const defEq = isP1Attacking 
      ? getEquipmentAndMitigation(p2, attEq.damageType) 
      : getEquipmentAndMitigation(p1, attEq.damageType);

    // Esquive
    const baseDodge = (defender.agility - attacker.agility) * 1.5;
    const dodgeChance = Math.min(25, Math.max(5, baseDodge + defEq.setBonuses.extraDodge));
    const dodged = Math.random() * 100 < dodgeChance;

    if (dodged) {
      log.push(`💨 ${defName} esquivó el ataque de ${attName}.`);
    } else {
      let rawDamage = 10 + (attacker.strength * 1.2) + attEq.weaponDmg;
      rawDamage += Math.floor(Math.random() * 5) - 2;

      let finalDamage = Math.round(rawDamage * (1 - defEq.totalMitigation));
      finalDamage = Math.max(3, finalDamage);

      const critChance = Math.min(35, Math.max(5, (attacker.luck * 1.2) + attEq.weaponCrit));
      const isCrit = Math.random() * 100 < critChance;

      if (isCrit) {
        finalDamage = Math.round(finalDamage * (1.25 + attEq.setBonuses.extraCritDmg));
        log.push(`💥 ¡Crítico! ${attName} impactó a ${defName} por *${finalDamage}* de daño.`);
      } else {
        const icon = attEq.damageType === 'elemental' ? '🔮' : '🗡️';
        log.push(`${icon} ${attName} golpeó a ${defName} por *${finalDamage}* de daño.`);
      }

      // Aplicar daño
      if (isP1Attacking) {
        hp2 = Math.max(0, hp2 - finalDamage);
        // Si el defensor sobrevive pero cae bajo el 40%, bebe poción de inmediato
        if (hp2 > 0 && hp2 <= maxHp2 * 0.4 && (p2SmallUsed + p2MedUsed) < MAX_POTIONS) {
          if (p2MedAvailable > 0) {
            p2MedAvailable--; p2MedUsed++;
            hp2 = Math.min(maxHp2, hp2 + 35);
            log.push(`🧪 ${defName} bebió una *Poción Mayor de Salud* (+35 HP).`);
          } else if (p2SmallAvailable > 0) {
            p2SmallAvailable--; p2SmallUsed++;
            hp2 = Math.min(maxHp2, hp2 + 10);
            log.push(`🧪 ${defName} bebió una *Poción Menor de Salud* (+10 HP).`);
          }
        }
      } else {
        hp1 = Math.max(0, hp1 - finalDamage);
        if (hp1 > 0 && hp1 <= maxHp1 * 0.4 && (p1SmallUsed + p1MedUsed) < MAX_POTIONS) {
          if (p1MedAvailable > 0) {
            p1MedAvailable--; p1MedUsed++;
            hp1 = Math.min(maxHp1, hp1 + 35);
            log.push(`🧪 ${defName} bebió una *Poción Mayor de Salud* (+35 HP).`);
          } else if (p1SmallAvailable > 0) {
            p1SmallAvailable--; p1SmallUsed++;
            hp1 = Math.min(maxHp1, hp1 + 10);
            log.push(`🧪 ${defName} bebió una *Poción Menor de Salud* (+10 HP).`);
          }
        }
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
    winner = p1; loser = p2;
  } else if (hp2 > 0 && hp1 <= 0) {
    winner = p2; loser = p1;
  } else {
    const r1 = hp1 / maxHp1;
    const r2 = hp2 / maxHp2;
    winner = (r1 >= r2) ? p1 : p2;
    loser = (winner === p1) ? p2 : p1;
  }

  return {
    winnerId: winner.userId,
    loserId: loser.userId,
    combatLog: log,
    potionsUsedP1: { small: p1SmallUsed, medium: p1MedUsed },
    potionsUsedP2: { small: p2SmallUsed, medium: p2MedUsed }
  };
}

module.exports = { simulatePvPDuel, getEquipmentAndMitigation, shortenName };
