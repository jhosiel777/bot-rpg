const DUNGEONS = {
  bosque: {
    name: '🌲 Bosque Umbrío',
    cost: 1,
    travelSec: 10,
    enemies: [
      { name: 'Duende Ladrón', minDmg: 4, maxDmg: 10, minGold: 5, maxGold: 12, minExp: 15, maxExp: 25 },
      { name: 'Lobo Salvaje', minDmg: 8, maxDmg: 15, minGold: 8, maxGold: 18, minExp: 22, maxExp: 35 }
    ]
  },
  cripta: {
    name: '🪦 Cripta Abandonada',
    cost: 2,
    travelSec: 20,
    enemies: [
      { name: 'Esqueleto Guerrero', minDmg: 14, maxDmg: 24, minGold: 15, maxGold: 28, minExp: 40, maxExp: 65 },
      { name: 'Necrófago', minDmg: 20, maxDmg: 32, minGold: 22, maxGold: 40, minExp: 55, maxExp: 80 }
    ]
  },
  dragon: {
    name: '🌋 Guarida del Dragón',
    cost: 3,
    travelSec: 35,
    enemies: [
      { name: 'Cría de Dragón', minDmg: 28, maxDmg: 45, minGold: 45, maxGold: 75, minExp: 90, maxExp: 140 },
      { name: 'Dragón de Magma', minDmg: 40, maxDmg: 65, minGold: 70, maxGold: 120, minExp: 140, maxExp: 220 }
    ]
  }
};

module.exports = DUNGEONS;
