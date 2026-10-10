const DUNGEONS = {
  bosque: {
    id: 'bosque',
    name: '🌲 Bosque Umbrío',
    cost: 1,
    travelSec: 10,
    hasTraps: false,
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
    enemies: [
      { name: 'Cría de Dragón Volcánico', minDmg: 8, maxDmg: 12, minGold: 40, maxGold: 75, minExp: 80, maxExp: 130, hits: 3 },
      { name: 'Guardián Dragontino', minDmg: 12, maxDmg: 17, minGold: 55, maxGold: 100, minExp: 110, maxExp: 170, hits: 3 },
      { name: 'Dragón del Abismo', minDmg: 16, maxDmg: 24, minGold: 70, maxGold: 140, minExp: 150, maxExp: 230, hits: 3 }
    ]
  }
};

module.exports = DUNGEONS;
