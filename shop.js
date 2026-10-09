const ITEMS = {
  potion_small: {
    id: 'potion_small',
    name: '🧪 Poción Menor de Vida',
    desc: 'Restaura 15 puntos de salud.',
    cost: 30,
    npcSell: true,
    type: 'hp',
    value: 15,
    field: 'potionsSmall'
  },
  potion_medium: {
    id: 'potion_medium',
    name: '🧪 Poción Mayor de Vida',
    desc: 'Restaura 30 puntos de salud.',
    cost: 60,
    npcSell: true,
    type: 'hp',
    value: 30,
    field: 'potionsMedium'
  },
  potion_energy: {
    id: 'potion_energy',
    name: '⚡ Elixir de Energía',
    desc: 'Restaura 1 punto de energía al instante.',
    cost: 50,
    npcSell: true,
    type: 'energy',
    value: 1,
    field: 'potionsEnergy'
  },
  energy_drink: {
    id: 'energy_drink',
    name: '🥤 Bebida Energética',
    desc: 'Restaura +2 de Energía. Recompensa exclusiva por ver anuncios.',
    cost: 300,
    npcSell: false,
    type: 'energy',
    value: 2,
    field: 'potionsEnergyDrink'
  }
};

module.exports = ITEMS;
