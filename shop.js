const ITEMS = {
  potion_small: {
    id: 'potion_small',
    name: '🧪 Poción Menor de Vida',
    desc: 'Restaura +10 HP de salud.',
    cost: 30,
    field: 'potionsSmall',
    type: 'hp',
    value: 10,
    npcSell: true,
    dynamic: false
  },
  potion_medium: {
    id: 'potion_medium',
    name: '🧪 Poción Mayor de Vida',
    desc: 'Restaura +35 HP de salud.',
    cost: 80,
    field: 'potionsMedium',
    type: 'hp',
    value: 35,
    npcSell: true,
    dynamic: false
  },
  potion_energy: {
    id: 'potion_energy',
    name: '⚡ Elixir de Energía',
    desc: 'Recupera +1 punto de Energía.',
    cost: 100,
    field: 'potionsEnergy',
    type: 'energy',
    value: 1,
    npcSell: true,
    dynamic: false
  },
  energy_drink: {
    id: 'energy_drink',
    name: '🥤 Bebida Energética',
    desc: 'Recupera +2 puntos de Energía al instante. Máximo 5 en mochila.',
    cost: 300,
    field: 'potionsEnergyDrink',
    type: 'energy',
    value: 2,
    npcSell: false,
    dynamic: true
  },
  dragon_blood: {
    id: 'dragon_blood',
    name: '🩸 Elixir de Sangre de Dragón',
    desc: 'Elimina de inmediato el estado de inconsciencia y restaura tu salud completa.',
    cost: 2500,
    field: 'potionsDragonBlood',
    type: 'revive',
    value: 0,
    npcSell: false,
    dynamic: true
  }
};

module.exports = ITEMS;
