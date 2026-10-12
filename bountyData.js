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
    minDmgRatio: 0.10,
    maxDmgRatio: 0.40,
    hpMinCap: 45,
    hpMaxCap: 130,
    autoPotionsBase: 1,
    autoPotionsWithAds: 2,
    beastNames: ['Colmillitos', 'Rabioso', 'Pata-Tuerta', 'El Hocicos', 'Piel-Dura', 'Tronchador'],
    humanoidNames: ['Gorg el Manazas', 'Pulgoso Joe', 'Milo el Ratero', 'Garek Tragapanes', 'Bob el Descalzo', 'Tilo Pies-Ligeros'],
    beastParts: {
      subjects: [
        'Un jabalí salvaje enfurecido',
        'Un tejón gigante territorial',
        'Un macho alfa de ratas de cloaca',
        'Un lobo sarnoso hambriento',
        'Un carnero montaraz descontrolado',
        'Un oso cachorro territorial'
      ],
      actions: [
        'arrasó con el sembradío de hortalizas',
        'destrozó las vallas de los corrales comunales',
        'asaltó los sacos de grano del granero',
        'bloqueó el paso atacando a los transeúntes',
        'volcó las carretas de verduras de los campesinos',
        'ahuyentó a los animales de tiro'
      ],
      locations: [
        'en los linderos de la granja comunal',
        'junto al arroyo de las piedras bajas',
        'en el huerto comunal',
        'a las puertas del molino del pueblo',
        'en el cruce de caminos del pueblo',
        'en los pastizales comunales'
      ],
      contexts: [
        'tras haberse embriagado comiendo manzanas fermentadas.',
        'gruñendo agresivamente a cualquiera que intente acercarse.',
        'dejando a su paso un desastre caótico de barro y heno.',
        'mordisqueando las herramientas de los peones que intentaron ahuyentarlo.',
        'derribando cercados y espantapájaros en su arrebato.',
        'mostrando ferocidad extrema sin intención de huir.'
      ]
    },
    humanoidParts: {
      subjects: [
        'Un duende ratero escurridizo',
        'Un borracho conflictivo armado con un garrote',
        'Un aprendiz de ladrón recién expulsado',
        'Un pícaro novato con exceso de confianza',
        'Un timador de cartas de taberna',
        'Un mozo de cuadra renegado'
      ],
      actions: [
        'robó una canasta de pasteles recién horneados',
        'vació varios barriles de cerveza de mala calidad',
        'sustrajo la ropa tendida de la guardia municipal',
        'arrojó tomates pochos a la estatua del fundador',
        'huyó con las propinas de las meseras',
        'cambió de lugar los letreros de dirección'
      ],
      locations: [
        'en la plaza principal del mercado',
        'en la taberna de la comarca',
        'en los callejones detrás de la herrería',
        'frente al cuartelillo de los centinelas',
        'en la entrada del puente levadizo',
        'junto al pozo de agua potable'
      ],
      contexts: [
        'mientras cantaba rimas burlonas y groseras al escapar.',
        'dejando una nota sarcástica burlándose de la milicia.',
        'vistiendo un sombrero estrafalario con plumas de ganso.',
        'culpando a gritos al sacerdote del pueblo mientras huía.',
        'bailando de manera ridícula antes de echar a correr.',
        'tropezando con su propia capa pero logrando escapar.'
      ]
    }
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
    hpMinCap: 150,
    hpMaxCap: 350,
    autoPotionsBase: 1,
    autoPotionsWithAds: 2,
    beastNames: ['Garra-Sombra', 'Lobo Carmesí', 'Ojo-Sangrante', 'Mandíbula de Hierro', 'El Gran Oso Tuerto', 'Garras-de-Acero'],
    humanoidNames: ['Valeria la Sin Ley', 'Krag Dientes Podridos', 'Garrick el Desertor', 'Brog el Triturador', 'Sylas Mano-Negra', 'Darek el Tuerto'],
    beastParts: {
      subjects: [
        'Un oso pardo de tamaño descomunal',
        'Un lobo huargo que lidera una jauría',
        'Una pantera montaraz acechadora',
        'Un jabalí acorazado con piel gruesa como corteza',
        'Un basilisco menor de pantano',
        'Un felino albino salvaje'
      ],
      actions: [
        'emboscó a la caravana de transporte del gremio',
        'destrozó el campamento de leñadores del este',
        'ha estado cazando a las patrullas montadas',
        'bloqueó el paso de carretas comarcal',
        'devoró el ganado de tres aldeas vecinas',
        'arrasó con los puestos de avituallamiento'
      ],
      locations: [
        'en el desfiladero de los vientos cortantes',
        'en los límites del bosque profundo',
        'en las ruinas del antiguo peaje comarcal',
        'a orillas del río de las sombras',
        'en las colinas escarpadas del norte',
        'cerca del campamento minero abandonado'
      ],
      contexts: [
        'atacando por sorpresa amparado por la espesa niebla matutina.',
        'marcando su territorio con destrozos visibles en la roca y troncos.',
        'mostrando una resistencia feroz al acero ordinario de los guardias.',
        'haciendo huir despavoridos a caballos y escoltas mercenarias.',
        'cubierto de cicatrices de viejos combates que no merman su furia.',
        'vigilando desde riscos inaccesibles a cualquier viajero solitario.'
      ]
    },
    humanoidParts: {
      subjects: [
        'Un desertor veterano de la guardia fronteriza',
        'El líder de una banda de salteadores de caminos',
        'Un contrabandista renegado de armas robadas',
        'Un mercenario sin estandarte ni escrúpulos',
        'Una cazadora furtiva buscada por la corona',
        'Un forajido que comanda una cuadrilla armada'
      ],
      actions: [
        'asaltó un convoy cargado de suministros militares',
        'extorsionó a los mercaderes bajo amenaza de fuego',
        'secuestró un lote de lingotes de hierro templado',
        'quemó el puesto de control de aduanas del condado',
        'falsificó salvoconductos comerciales del señor feudal',
        'saqueó la armería del puesto fronterizo'
      ],
      locations: [
        'en el desfiladero de los vientos cortantes',
        'en el antiguo cruce de carretas reales',
        'en las cuevas de contrabandistas de la colina',
        'junto al puente de piedra derruido',
        'en el bosque de robles negros',
        'en las inmediaciones de la fortaleza olvidada'
      ],
      contexts: [
        'haciéndose pasar con cinismo por un recaudador de impuestos.',
        'tras emborrachar a la escolta mercenaria con brebajes somníferos.',
        'dejando trampas de pinchos y barricadas en los senderos de escape.',
        'desafiando a los campeones del reino a un duelo a muerte.',
        'amenazando con aislar las rutas comerciales del distrito.',
        'respaldado por secuaces armados con ballestas pesadas.'
      ]
    }
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
    hpMinCap: 380,
    hpMaxCap: 700,
    autoPotionsBase: 2,
    autoPotionsWithAds: 3,
    beastNames: ['Quimera del Cieno', 'Devorador Espectral', 'Gólem Descontrolado', 'Engendro de Cripta', 'Acechador Óseo', 'Gárgola Sangrienta'],
    humanoidNames: ['Morgana la Hereje', 'Malthor Ojos Muertos', 'Ignis el Pirómano', 'Vesper la Oscura', 'Eldrin el Apóstata', 'Belial el Renegado'],
    beastParts: {
      subjects: [
        'Una quimera mutada por residuos de miasma',
        'Un gólem rúnico fuera del control de su creador',
        'Un engendro óseo alzado por magia residual',
        'Una sierpe venenosa de sombras subterráneas',
        'Una bestia carnicera escapada de las catacumbas',
        'Un espectro voraz que drena calor vital'
      ],
      actions: [
        'profanó las tumbas antiguas del cementerio sagrado',
        'destruyó las defensas mágicas del santuario',
        'ha estado consumiendo la esencia de las criaturas del bosque',
        'fracturó los sellos de piedra de la cripta señorial',
        'derribó las torres de vigilancia de la cantera',
        'corrompió las fuentes de agua subterránea'
      ],
      locations: [
        'en las catacumbas bajo la abadía en ruinas',
        'en el claro marchito del bosque espectral',
        'en los túneles abandonados de la mina de plata',
        'en la garganta de las lápidas olvidadas',
        'en el santuario profanado de los antiguos ritos',
        'en las ciénagas de bruma perpetua'
      ],
      contexts: [
        'dejando un rastro cáustico que funde el hierro y la piedra.',
        'irradiando pulsos de energía oscura que desorientan a los intrusos.',
        'inmune al dolor y alimentándose de la desesperación circundante.',
        'rodeado de restos de armas rotas de aventureros caídos.',
        'exhalando miasmas que marchitan la vegetación al instante.',
        'protegido por una coraza de huesos y piedra encantada.'
      ]
    },
    humanoidParts: {
      subjects: [
        'Un nigromante proscrito por la corte real',
        'El sumo sacerdote de una secta prohibida',
        'Un alquimista demente expulsado de la capital',
        'Una hechicera de sombras renegada de la orden',
        'Un inquisidor corrupto que abraza la herejía',
        'Un brujo proscrito de sangre demoníaca'
      ],
      actions: [
        'profanó los altares sagrados e intentó alzar un ejército',
        'envenenó las cisternas con una toxina que nubla la razón',
        'robó grimorios prohibidos de invocación oscura',
        'sacrificó patrullas enteras para abrir fisuras etéreas',
        'desató maldiciones debilitantes sobre la comarca',
        'secuestró a novicios del templo para experimentos arcanos'
      ],
      locations: [
        'en las profundidades de la cripta subterránea',
        'en el santuario profanado de los antiguos ritos',
        'en la torre semiderruida del nigromante',
        'en las catacumbas bajo la abadía en ruinas',
        'en la caverna de los ecos prohibidos',
        'en el círculo de piedras ensangrentadas'
      ],
      contexts: [
        'proclamando que el reino sucumbirá ante la Era Oscura.',
        'mientras recita cánticos en un dialecto vetado por el Trono.',
        'utilizando cenizas mágicas para cegar a quienes le plantan cara.',
        'afirmando que limpia la tierra para la llegada de su amo.',
        'cubierto de tatuajes rúnicos que arden al contacto con el acero.',
        'burlándose abiertamente de la justicia de los dioses justos.'
      ]
    }
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
    hpMinCap: 800,
    hpMaxCap: 1200,
    autoPotionsBase: 2,
    autoPotionsWithAds: 3,
    beastNames: ['Behemot de Plaga', 'Abominación del Abismo', 'Sierpe de Ceniza', 'Leviatán Menor', 'Hydra Corrupta', 'Tiranus del Páramo'],
    humanoidNames: ['Vrax el Desollador', 'Noxus Corazón Negro', 'Baelor el Azote', 'General Morvath', 'Zephyr Sangre-Fría', 'Lady Vesperia'],
    beastParts: {
      subjects: [
        'Un leviatán abisal con piel de magma solidificado',
        'Una hidra de siete cabezas impregnada en peste',
        'Un behemot corrupto alzado desde fallas tectónicas',
        'Un coloso de ceniza ardiente que no se extingue',
        'Una sierpe dragontina corrompida por el vacío',
        'Una aberración cósmica que devora materia'
      ],
      actions: [
        'pulverizó el bastión defensivo de la frontera occidental',
        'marchitó las tierras fértiles de tres condados enteros',
        'rompió los sellos ancestrales de confinamiento abisal',
        'consumió batallones de caballería de un solo embate',
        'calcinó asentamientos completos hasta reducirlos a escombros',
        'desencadenó terremotos que abrieron grietas de azufre'
      ],
      locations: [
        'en el cráter humeante de la falla volcánica',
        'en la fortaleza flotante de magma petrificado',
        'en el valle de huesos de los antiguos monarcas',
        'en la garganta de los lamentos eternos',
        'en la ciudadela corrupta del páramo gris',
        'en la sima del fin del mundo'
      ],
      contexts: [
        'irradiando un calor sofocante que funde proyectiles en el aire.',
        'exhalando vapores tóxicos que descomponen el metal y la carne.',
        'haciendo temblar la corteza terrestre con cada rugido atronador.',
        'envuelto en un torbellino de cenizas incandescentes y fuego.',
        'regenerando heridas a una velocidad casi imposible.',
        'desafiando a los ejércitos reales sin mostrar un rasguño.'
      ]
    },
    humanoidParts: {
      subjects: [
        'Un general traidor de las legiones reales fronterizas',
        'Un archimago renegado del fuego primordial',
        'El señor de la guerra de las hordas del páramo',
        'Una matriarca oscura que comanda legiones proscritas',
        'Un corruptor de almas que sirve a entidades primarias',
        'Un paladín caído que juró venganza a la corona'
      ],
      actions: [
        'subyugó el bastión de la frontera mediante magia de sangre',
        'abrió una brecha elemental descontrolada sobre las ciudades',
        'declaró la guerra total a las provincias del reino',
        'ejecutó a los emisarios reales y colgó sus insignias',
        'convirtió a un regimiento completo en soldados sin voluntad',
        'saqueó las arcas provinciales para financiar su levantamiento'
      ],
      locations: [
        'en el bastión fortificado de la cordillera gris',
        'en la cumbre de la aguja olvidada',
        'en el palacio derruido de los antiguos señores feudales',
        'en la fortaleza flotante de magma petrificado',
        'en el campamento de guerra de las tierras baldías',
        'en el altar de sangre de la montaña quebrada'
      ],
      contexts: [
        'enarbolando estandartes manchados con la sangre de sus superiores.',
        'amenazando con sepultar el reino bajo una marea de destrucción.',
        'armado con reliquias que absorben la energía de los atacantes.',
        'respaldado por un ejército de autómatas y bestias atadas.',
        'proclamando que ningún ejército mortal podrá arrebatarle su feudo.',
        'demostrando una crueldad metódica que no deja testigos vivos.'
      ]
    }
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
    hpMinCap: 1300,
    hpMaxCap: 1800,
    autoPotionsBase: 2,
    autoPotionsWithAds: 4,
    beastNames: ['Titán de Discordia', 'Devorador de Soles', 'Heraldo del Colapso', 'Kraken Primordial', 'Dragón del Vacío', 'Vórtice Eterno'],
    humanoidNames: ['Azrak el Hereje Primordial', 'Lord Malakor el Usurpador', 'Señor del Ocaso', 'Archimago Vael', 'Kaelen el Regicida', 'El Apóstata Supremo'],
    beastParts: {
      subjects: [
        'Un coloso primordial dormido desde el origen del mundo',
        'Una entidad cósmica que rasga la bóveda celeste',
        'El devorador astral de soles y estrellas',
        'Un dragón antediluviano con aliento de antimateria',
        'El titán que custodia los pilares del abismo',
        'La serpiente del juicio final que circunda el reino'
      ],
      actions: [
        'fracturó la cordillera sagrada y amenaza con partir el continente',
        'ha comenzado a devorar la barrera protectora de la realidad',
        'desató tormentas astrales que amenazan con apagar el sol',
        'despertó a los horrores durmientes del centro del planeta',
        'anuló las leyes de la física y el tiempo en la capital',
        'exigió las almas de toda la dinastía como tributo cósmico'
      ],
      locations: [
        'en la cúspide celestial del fin del mundo',
        'en el nexo astral superior de la realidad',
        'en el trono de obsidiana más allá del cosmos',
        'en el vórtice final donde mueren las eras',
        'en las terrazas de cristal del reino celestial',
        'en el altar primordial del génesis del universo'
      ],
      contexts: [
        'haciendo temblar el Trono de Roble con cada pisada cataclísmica.',
        'desencadenando centellas doradas que pulverizan murallas enteras.',
        'sin que las armas sagradas logren mellar su esencia primordial.',
        'proclamando el colapso absoluto de todas las civilizaciones mortales.',
        'alimentándose del tejido del espacio para incrementar su poder.',
        'aguardando al único guerrero capaz de mirarle a los ojos sin perecer.'
      ]
    },
    humanoidParts: {
      subjects: [
        'El cabecilla de la conjura suprema contra la corona',
        'Un semi-inmortal proscrito por los dioses creadores',
        'El usurpador definitivo que reclama el Trono de Roble',
        'El sumo avatar del Vacío Primordial en cuerpo mortal',
        'El regicida que juró extinguir el linaje de los reyes',
        'El archimago de las estrellas que trascendió la mortalidad'
      ],
      actions: [
        'intentó asesinar al Rey directamente en la sala del trono',
        'declaró la guerra total a toda la dinastía y a los templos',
        'arrebató la corona ancestral para fusionarla con reliquias oscuras',
        'desató el colapso del plano astral sobre el Palacio Real',
        'abrió las puertas del tártaro sobre la capital imperial',
        'desafió a los campeones legendarios a una última batalla'
      ],
      locations: [
        'en las terrazas superiores del Palacio Sagrado',
        'frente a las puertas de la Ciudadela Celestial',
        'en la cámara secreta del Trono de Roble',
        'en el altar primordial del génesis del universo',
        'en la cúspide celestial del fin del mundo',
        'en el nexo astral donde convergen todos los destinos'
      ],
      contexts: [
        'empleando reliquias prohibidas capaces de anular juramentos divinos.',
        'proclamando que el linaje de los monarcas mortales debe extinguirse hoy.',
        'sin mostrar un ápice de temor ante la guardia real ni los ejércitos.',
        'desafiando cara a cara al monarca en su propio estrado dorado.',
        'portando una hoja forjada en el núcleo de una estrella moribunda.',
        'listo para derramar la sangre de reyes para forjar su nuevo imperio.'
      ]
    }
  }
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

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

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

  const isBeast = Math.random() < 0.40;
  const parts = isBeast ? tierCfg.beastParts : tierCfg.humanoidParts;
  const nameList = isBeast ? tierCfg.beastNames : tierCfg.humanoidNames;

  const name = getRandom(nameList);
  const subject = getRandom(parts.subjects);
  const action = getRandom(parts.actions);
  const location = getRandom(parts.locations);
  const context = getRandom(parts.contexts);

  const description = `${subject} conocido como *"${name}"* ${action} ${location} ${context}`;

  const baseGold = Math.floor(Math.random() * (tierCfg.baseGoldMax - tierCfg.baseGoldMin + 1)) + tierCfg.baseGoldMin;

  const turnsTarget = 5;
  const rawEnemyHp = Math.round(playerBaseAtk * turnsTarget);
  const enemyHp = Math.max(tierCfg.hpMinCap, Math.min(tierCfg.hpMaxCap, rawEnemyHp));

  const minDmg = Math.max(4, Math.round(playerMaxHp * tierCfg.minDmgRatio));
  const maxDmg = Math.max(minDmg + 3, Math.round(playerMaxHp * tierCfg.maxDmgRatio));

  return {
    tierKey,
    name,
    description,
    isBeast,
    durationMinutes: tierCfg.travelMinutes,
    baseGold,
    enemyHp,
    enemyMinDmg: minDmg,
    enemyMaxDmg: maxDmg
  };
}

module.exports = {
  BOUNTY_TIERS,
  TRAVEL_EVENTS,
  getTierKey,
  generateBounty
};
