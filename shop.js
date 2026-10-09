const ITEMS = {
  potion_small: {
    id: 'potion_small',
    name: '🧪 Poción Menor de Vida',
    desc: 'Restaura +10 HP',
    cost: 35,
    type: 'hp',
    value: 15,
    field: 'potionsSmall'
  },
  potion_medium: {
    id: 'potion_medium',
    name: '🧪 Poción Mayor de Vida',
    desc: 'Restaura +30 HP',
    cost: 100,
    type: 'hp',
    value: 30,
    field: 'potionsMedium'
  },
  potion_energy: {
    id: 'potion_energy',
    name: '⚡ Elixir de Energía',
    desc: 'Restaura +1 punto de Energía',
    cost: 170,
    type: 'energy',
    value: 1,
    field: 'potionsEnergy'
  }
};

module.exports = ITEMS;
