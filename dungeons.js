// dungeons.js
const DUNGEONS = {
  bosque: {
    id: 'bosque',
    name: '🌲 Bosque Umbrío',
    cost: 1,
    travelSec: 10,
    hasTraps: false,
    drops: {
      smallHpChance: 0.10,    // 10% Poción Menor
      mediumHpChance: 0.00,   // No cae en bosque
      energyChance: 0.02      // 2% Elixir de Energía
    },
    enemies: [
      { name: 'Duende del Bosque', minDmg: 5, maxDmg: 10, minGold: 3, maxGold: 8, minExp: 8, maxExp: 15, hits: 1 },
      { name: 'Lobo Salvaje', minDmg: 8, maxDmg: 14, minGold: 6, maxGold: 14, minExp: 12, maxExp: 22, hits: 1 },
      { name: 'Bandido Rebelde', minDmg: 12, maxDmg: 18, minGold: 10, maxGold: 20, minExp: 18, maxExp: 30, hits: 1 }
    ]
  },
  cripta: {
    id: 'cripta',
    name: '🪦 Cripta Abandonada',
    cost: 2,
    travelSec: 20,
    hasTraps: true,
    drops: {
      smallHpChance: 0.16,    // 16% Poción Menor
      mediumHpChance: 0.00,   // No cae en cripta
      energyChance: 0.04      // 4% Elixir de Energía
    },
    enemies: [
      { name: 'Esqueleto Guerrero', minDmg: 16, maxDmg: 24, minGold: 15, maxGold: 30, minExp: 30, maxExp: 50, hits: 1 },
      { name: 'Zombi Pestilente', minDmg: 22, maxDmg: 30, minGold: 20, maxGold: 40, minExp: 40, maxExp: 65, hits: 1 },
      { name: 'Espectro de la Cripta', minDmg: 28, maxDmg: 38, minGold: 28, maxGold: 55, minExp: 55, maxExp: 90, hits: 1 }
    ]
  },
  dragon: {
    id: 'dragon',
    name: '🌋 Guarida del Dragón',
    cost: 3,
    travelSec: 35,
    hasTraps: true,
    drops: {
      smallHpChance: 0.14,    // 14% Poción Menor
      mediumHpChance: 0.10,   // 10% Poción Mayor (Exclusiva del dragón)
      energyChance: 0.06      // 6% Elixir de Energía
    },
    enemies: [
      { name: 'Cría de Dragón Volcánico', minDmg: 8, maxDmg: 12, minGold: 40, maxGold: 75, minExp: 80, maxExp: 130, hits: 3 },
      { name: 'Guardián Dragontino', minDmg: 12, maxDmg: 17, minGold: 55, maxGold: 100, minExp: 110, maxExp: 170, hits: 3 },
      { name: 'Dragón del Abismo', minDmg: 16, maxDmg: 24, minGold: 70, maxGold: 140, minExp: 150, maxExp: 230, hits: 3 }
    ]
  },
  yacimiento_khazur: {
    id: 'yacimiento_khazur',
    name: '⛏️ Yacimiento Olvidado de Khazur',
    cost: 5,
    travelSec: 120,
    hasTraps: true,
    isBorder: true,
    requiresPermit: true,
    drops: {
      smallHpChance: 0.20,
      mediumHpChance: 0.14,
      energyChance: 0.08
    },
    enemies: [
      { name: 'Autómata Rocoso de Khazur', minDmg: 17, maxDmg: 23, hits: 3, minGold: 100, maxGold: 160, minExp: 220, maxExp: 270, isColoso: false },
      { name: 'Guardián Rúnico de Arcilla', minDmg: 24, maxDmg: 30, hits: 3, minGold: 150, maxGold: 230, minExp: 260, maxExp: 310, isColoso: false },
      { name: 'Coloso Protector Ancestral', minDmg: 30, maxDmg: 37, hits: 3, minGold: 210, maxGold: 300, minExp: 300, maxExp: 380, isColoso: true }
    ]
  },
  arboleda_susurros: {
    id: 'arboleda_susurros',
    name: '🔮 Arboleda de los Susurros',
    cost: 5,
    travelSec: 120,
    hasTraps: true,
    isBorder: true,
    requiresPermit: true,
    drops: {
      smallHpChance: 0.20,
      mediumHpChance: 0.14,
      energyChance: 0.08
    },
    enemies: [
      { name: 'Aparición Menor', minDmg: 16, maxDmg: 22, hits: 3, minGold: 95, maxGold: 155, minExp: 215, maxExp: 265, isElite: false },
      { name: 'Espectro Desgarrador', minDmg: 23, maxDmg: 29, hits: 3, minGold: 145, maxGold: 225, minExp: 255, maxExp: 305, isElite: true },
      { name: 'Ent Corrompido', minDmg: 29, maxDmg: 36, hits: 3, minGold: 205, maxGold: 295, minExp: 295, maxExp: 375, isElite: true }
    ]
  },
  coto_bestias: {
    id: 'coto_bestias',
    name: '🐾 Coto de las Bestias Sombrías',
    cost: 5,
    travelSec: 120,
    hasTraps: true,
    isBorder: true,
    requiresPermit: true,
    drops: {
      smallHpChance: 0.20,
      mediumHpChance: 0.14,
      energyChance: 0.08
    },
    enemies: [
      { name: 'Acechador Sombrío', minDmg: 18, maxDmg: 24, hits: 3, minGold: 105, maxGold: 165, minExp: 225, maxExp: 275, isElite: false },
      { name: 'Lobo Abisal Alfa', minDmg: 25, maxDmg: 31, hits: 3, minGold: 155, maxGold: 235, minExp: 265, maxExp: 315, isElite: true },
      { name: 'Quimera Salvaje', minDmg: 31, maxDmg: 38, hits: 3, minGold: 215, maxGold: 310, minExp: 305, maxExp: 390, isElite: true }
    ]
  }
};

module.exports = DUNGEONS;
