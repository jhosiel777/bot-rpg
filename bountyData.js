// Catálogo procedural modular con coherencia espacial y balance de eventos

const BOUNTY_TIERS = {
  tier1: {
    minLevel: 1,
    maxLevel: 10,
    minTimeMinutes: 1,
    maxTimeMinutes: 5,
    baseGoldMin: 180,
    baseGoldMax: 280,
    eventCount: 1,
    goldBonusRange: [20, 50],
    goldLossRange: [10, 25],
    hpLossRange: [6, 12],
    autoPotionsBase: 1,
    autoPotionsWithAds: 2,
    smartPotionChoice: false, // Aleatoria
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
    minTimeMinutes: 6,
    maxTimeMinutes: 12,
    baseGoldMin: 450,
    baseGoldMax: 650,
    eventCount: 2,
    goldBonusRange: [60, 120],
    goldLossRange: [30, 60],
    hpLossRange: [14, 25],
    autoPotionsBase: 1,
    autoPotionsWithAds: 2,
    smartPotionChoice: true, // Prioriza Poción Mayor
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
    minTimeMinutes: 15,
    maxTimeMinutes: 25,
    baseGoldMin: 900,
    baseGoldMax: 1300,
    eventCount: 3,
    goldBonusRange: [150, 300],
    goldLossRange: [80, 150],
    hpLossRange: [25, 45],
    autoPotionsBase: 2,
    autoPotionsWithAds: 3,
    smartPotionChoice: true,
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
    maxLevel: 85,
    minTimeMinutes: 30,
    maxTimeMinutes: 45,
    baseGoldMin: 1800,
    baseGoldMax: 2500,
    eventCount: 4,
    goldBonusRange: [350, 650],
    goldLossRange: [180, 350],
    hpLossRange: [40, 75],
    autoPotionsBase: 3,
    autoPotionsWithAds: 4,
    smartPotionChoice: true,
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
    minLevel: 86,
    maxLevel: 101,
    minTimeMinutes: 50,
    maxTimeMinutes: 60,
    baseGoldMin: 3500,
    baseGoldMax: 4800,
    eventCount: 5,
    goldBonusRange: [700, 1200],
    goldLossRange: [350, 700],
    hpLossRange: [60, 110],
    autoPotionsBase: 3,
    autoPotionsWithAds: 5,
    smartPotionChoice: true,
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
    text: '💎 ¡Detectaste una gema incrustada en una hendidura del sendero!',
    effectText: '+{amount}g sumados al botín final.'
  },
  {
    type: 'gold_gain',
    text: '💰 Encontraste una faltriquera bien provista perdida entre la maleza.',
    effectText: '+{amount}g asegurados de camino al objetivo.'
  },
  {
    type: 'gold_gain',
    text: '🪙 Un convoy comercial agradecido por asegurar la ruta te recompensó.',
    effectText: '+{amount}g recibidos como gratificación.'
  },
  {
    type: 'accident_dmg',
    statTest: 'agility',
    avoidChanceBase: 0.25,
    avoidBonusPerAgi: 0.005,
    dodgeText: '🤸 ¡Tus reflejos de Agilidad te salvaron de resbalar por el despeñadero!',
    failText: '⚠️ Tropezaste con rocas sueltas y caíste dando vueltas por la ladera.',
    failEffectText: 'Recibiste golpes y raspaduras perdiendo {hpLoss} HP.'
  },
  {
    type: 'accident_gold_loss',
    statTest: 'agility',
    avoidChanceBase: 0.20,
    avoidBonusPerAgi: 0.004,
    dodgeText: '🖐️ ¡Sujetaste tus bolsas con firmeza antes de cruzar los rápidos!',
    failText: '💸 Un enganche con ramas espinosas rasgó tu bolsa de suministros.',
    failEffectText: 'Se te cayeron {amount}g entre las piedras del camino.'
  },
  {
    type: 'ambush',
    statTest: 'strength',
    avoidChanceBase: 0.20,
    avoidBonusPerStr: 0.004,
    dodgeText: '💪 ¡Neutralizaste a un carroñero de un solo empellón contundente!',
    failText: '🐺 Un acechador salvaje te mordió desprevenido antes de huir.',
    failEffectText: 'El zarpazo te costó {hpLoss} HP antes de llegar a la guarida.'
  }
];

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getTierKey(level) {
  if (level >= 86) return 'tier5';
  if (level >= 51) return 'tier4';
  if (level >= 26) return 'tier3';
  if (level >= 11) return 'tier2';
  return 'tier1';
}

function generateBounty(playerLevel) {
  const tierKey = getTierKey(playerLevel);
  const tierConfig = BOUNTY_TIERS[tierKey];

  const isBeast = Math.random() < 0.40;
  const categoryKey = isBeast ? 'beast' : 'humanoid';

  const nameList = isBeast ? tierConfig.beastNames : tierConfig.humanoidNames;
  const parts = isBeast ? tierConfig.beastParts : tierConfig.humanoidParts;

  const name = getRandom(nameList);
  const subject = getRandom(parts.subjects);
  const action = getRandom(parts.actions);
  const location = getRandom(parts.locations);
  const context = getRandom(parts.contexts);

  const description = `${subject} conocido como *"${name}"* ${action} ${location} ${context}`;

  // Duración aleatoria dentro del rango del Tier
  const durationMinutes = Math.floor(
    Math.random() * (tierConfig.maxTimeMinutes - tierConfig.minTimeMinutes + 1)
  ) + tierConfig.minTimeMinutes;

  // Oro base estimado
  const baseGold = Math.floor(
    Math.random() * (tierConfig.baseGoldMax - tierConfig.baseGoldMin + 1)
  ) + tierConfig.baseGoldMin;

  // Stats del enemigo escaladas al nivel del jugador
  const enemyHp = Math.round((45 + playerLevel * 9) * (0.85 + Math.random() * 0.30));
  const enemyMinDmg = Math.max(8, Math.round((10 + playerLevel * 2.2) * 0.80));
  const enemyMaxDmg = Math.max(14, Math.round((14 + playerLevel * 2.8) * 1.15));

  return {
    tierKey,
    name,
    description,
    isBeast,
    durationMinutes,
    baseGold,
    enemyHp,
    enemyMinDmg,
    enemyMaxDmg,
    tierConfig
  };
}

module.exports = {
  BOUNTY_TIERS,
  TRAVEL_EVENTS,
  getTierKey,
  generateBounty
};
