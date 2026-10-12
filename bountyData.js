const BOUNTY_TIERS = {
  tier1: {
    minLevel: 1,
    maxLevel: 10,
    travelMinutes: 2,
    eventCount: 2,
    baseGoldMin: 120,
    baseGoldMax: 200,
    goldBonusRange: [15, 30],
    goldLossRange: [10, 20],
    hpLossRange: [3, 7],
    minDmgRatio: 0.20,
    maxDmgRatio: 0.40,
    hpMultiplier: 1.25,
    autoPotionsBase: 1,
    autoPotionsWithAds: 2
  },
  tier2: {
    minLevel: 11,
    maxLevel: 25,
    travelMinutes: 4,
    eventCount: 2,
    baseGoldMin: 220,
    baseGoldMax: 380,
    goldBonusRange: [25, 55],
    goldLossRange: [20, 40],
    hpLossRange: [6, 12],
    minDmgRatio: 0.25,
    maxDmgRatio: 0.50,
    hpMultiplier: 1.45,
    autoPotionsBase: 1,
    autoPotionsWithAds: 2
  },
  tier3: {
    minLevel: 26,
    maxLevel: 50,
    travelMinutes: 6,
    eventCount: 3,
    baseGoldMin: 420,
    baseGoldMax: 700,
    goldBonusRange: [45, 90],
    goldLossRange: [35, 70],
    hpLossRange: [10, 20],
    minDmgRatio: 0.28,
    maxDmgRatio: 0.50,
    hpMultiplier: 1.65,
    autoPotionsBase: 2,
    autoPotionsWithAds: 3
  },
  tier4: {
    minLevel: 51,
    maxLevel: 75,
    travelMinutes: 8,
    eventCount: 3,
    baseGoldMin: 750,
    baseGoldMax: 1250,
    goldBonusRange: [70, 140],
    goldLossRange: [50, 100],
    hpLossRange: [15, 28],
    minDmgRatio: 0.35,
    maxDmgRatio: 0.65,
    hpMultiplier: 1.90,
    autoPotionsBase: 2,
    autoPotionsWithAds: 3
  },
  tier5: {
    minLevel: 76,
    maxLevel: 101,
    travelMinutes: 10,
    eventCount: 4,
    baseGoldMin: 1350,
    baseGoldMax: 2200,
    goldBonusRange: [110, 220],
    goldLossRange: [80, 150],
    hpLossRange: [22, 40],
    minDmgRatio: 0.40,
    maxDmgRatio: 0.65,
    hpMultiplier: 2.20,
    autoPotionsBase: 2,
    autoPotionsWithAds: 4
  }
};

const BOUNTY_ENEMIES = {
  tier1: [
    { name: 'Darek el Tuerto', isBeast: false, desc: 'Un desertor armado con una cimitarra oxidada que asalta caravanas en el cruce de caminos.' },
    { name: 'Lobo de Ceniza Alfa', isBeast: true, desc: 'Una fiera salvaje de colmillos tiznados que aterroriza a los leñadores de las faldas montañosas.' },
    { name: 'Roba-caminos Bram', isBeast: false, desc: 'Fugitivo de las mazmorras reales con experiencia en trampas de cuerda y cuchillos arrojadizos.' }
  ],
  tier2: [
    { name: 'Capitán Sangrefuerte', isBeast: false, desc: 'Ex-comandante mercenario que lidera una banda de forajidos fuertemente armados.' },
    { name: 'Oso de Placas Carmesí', isBeast: true, desc: 'Enorme bestia acorazada con piel endurecida por antiguos minerales volcánicos.' },
    { name: 'Varek Sombranegra', isBeast: false, desc: 'Asesino a sueldo conocido por emboscar a mensajeros reales en pasos estrechos.' }
  ],
  tier3: [
    { name: 'Señor de las Cuchillas Thorne', isBeast: false, desc: 'Duelista proscrito que domina el acero gemelo y no deja testigos en sus asaltos.' },
    { name: 'Manticora Acechadora', isBeast: true, desc: 'Criatura alada con aguijón ponzoñoso que anida en las ruinas olvidadas del valle.' },
    { name: 'Gromk el Rompehuesos', isBeast: false, desc: 'Gigante nómada armado con un mazo de piedra que cobra peaje de sangre.' }
  ],
  tier4: [
    { name: 'Comandante del Abismo Malakor', isBeast: false, desc: 'Guerrero corrupto imbuido con magia sombría que busca derrocar el puesto fronterizo.' },
    { name: 'Gólem de Magma Ancestral', isBeast: true, desc: 'Masa colosal de roca fundida despertada por los temblores de la falla profunda.' },
    { name: 'Kaelen el Impío', isBeast: false, desc: 'Caballero renegado cuyas armaduras absorben la luz del día y desvían flechas.' }
  ],
  tier5: [
    { name: 'General Infernal Valerius', isBeast: false, desc: 'Líder legendario de las legiones proscritas que porta un mandoble bendecido en fuego maldito.' },
    { name: 'Sombra Dracónica de Ébano', isBeast: true, desc: 'Terror alado de escamas impenetrables que devora batallones enteros.' },
    { name: 'Zul’Khar el Sin Corona', isBeast: false, desc: 'Tirano desterrado con fuerza titánica capaz de hender adoquines con sus puños desnudos.' }
  ]
};

const TRAVEL_EVENTS = [
  {
    type: 'gold_gain',
    text: '💰 Encontraste una faltriquera bien provista perdida entre la maleza.'
  },
  {
    type: 'gold_gain',
    text: '💎 Hallaste un alijo oculto de contrabandistas bajo unas piedras sueltas.'
  },
  {
    type: 'accident_dmg',
    avoidChanceBase: 0.15,
    avoidBonusPerAgi: 0.0045,
    dodgeText: '🤸 Tus reflejos de Agilidad te permitieron esquivar una trampa de lazo oculta en el suelo.',
    failText: '⚠️ Tropezaste con una trampa de puas improvisada y perdiste salud antes de llegar.'
  },
  {
    type: 'accident_gold_loss',
    avoidChanceBase: 0.20,
    avoidBonusPerAgi: 0.0040,
    dodgeText: '🤸 Saltaste a tiempo sobre un vado lodoso evitando que tu bolsa de monedas se rasgara.',
    failText: '💸 Un desprendimiento de rocas rasgó tu morral y parte de tus monedas cayeron al barranco.'
  },
  {
    type: 'ambush',
    avoidChanceBase: 0.20,
    avoidBonusPerStr: 0.0035,
    dodgeText: '💪 Un acechador salvaje intentó emboscarte pero tu Fuerza lo repelió sin causarte daño.',
    failText: '🐺 Un acechador salvaje te mordió desprevenido antes de huir.'
  }
];

function getTierKey(playerLevel) {
  for (const key in BOUNTY_TIERS) {
    const tier = BOUNTY_TIERS[key];
    if (playerLevel >= tier.minLevel && playerLevel <= tier.maxLevel) {
      return key;
    }
  }
  return 'tier5';
}

function generateBounty(playerLevel, playerMaxHp, playerBaseAtk) {
  const tierKey = getTierKey(playerLevel);
  const tierCfg = BOUNTY_TIERS[tierKey];

  const pool = BOUNTY_ENEMIES[tierKey];
  const selected = pool[Math.floor(Math.random() * pool.length)];

  const baseGold = Math.floor(Math.random() * (tierCfg.baseGoldMax - tierCfg.baseGoldMin + 1)) + tierCfg.baseGoldMin;

  // Salud calibrada para durar entre 4 y 7 turnos contra el daño base del jugador
  const turnsTarget = Math.floor(Math.random() * 4) + 4;
  const enemyHp = Math.round(playerBaseAtk * turnsTarget * (tierCfg.hpMultiplier || 1.3));

  // Daño calibrado estrictamente al porcentaje de la vida máxima del jugador
  const minDmg = Math.max(5, Math.round(playerMaxHp * tierCfg.minDmgRatio));
  const maxDmg = Math.max(minDmg + 5, Math.round(playerMaxHp * tierCfg.maxDmgRatio));

  return {
    tierKey,
    name: selected.name,
    description: selected.desc,
    isBeast: selected.isBeast,
    durationMinutes: tierCfg.travelMinutes,
    baseGold,
    enemyHp,
    enemyMinDmg: minDmg,
    enemyMaxDmg: maxDmg
  };
}

module.exports = {
  BOUNTY_TIERS,
  BOUNTY_ENEMIES,
  TRAVEL_EVENTS,
  getTierKey,
  generateBounty
};
