const DUNGEONS = {
  bosque: {
    name: '🌲 Bosque Umbrío',
    cost: 1,
    travelSec: 10,
    enemies: [
      { name: 'Duende Ladrón', minDmg: 5, maxDmg: 12, minGold: 6, maxGold: 14 },
      { name: 'Duende Borracho', minDmg: 7, maxDmg: 15, minGold: 8, maxGold: 15 },
      { name: 'Lobo Salvaje', minDmg: 10, maxDmg: 18, minGold: 10, maxGold: 20 }
    ]
  },
  cripta: {
    name: '🪦 Cripta Abandonada',
    cost: 2,
    travelSec: 20,
    enemies: [
      { name: 'Esqueleto Guerrero', minDmg: 15, maxDmg: 28, minGold: 18, maxGold: 32 },
      { name: 'Necrófago', minDmg: 22, maxDmg: 35, minGold: 25, maxGold: 45 }
    ]
  },
  dragon: {
    name: '🌋 Guarida del Dragón',
    cost: 3,
    travelSec: 35,
    enemies: [
      { name: 'Cría de Dragón', minDmg: 30, maxDmg: 50, minGold: 50, maxGold: 85 },
      { name: 'Dragón de Magma', minDmg: 45, maxDmg: 75, minGold: 80, maxGold: 140 }
    ]
  }
};

module.exports = DUNGEONS;
