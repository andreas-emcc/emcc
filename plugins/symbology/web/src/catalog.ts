import type { CatalogEntry, SymbolService } from '@emc2/plugin-sdk';

type Entries = readonly (readonly [name: string, entity: string])[];

/**
 * Common land unit entities (symbol set 10), for the symbol picker of `draw-symbols`. Every code is
 * in milsymbol 3.0.4's land unit table (`src/numbersidc/sidc/landunit.js`), which the names follow.
 * Doubtful names are listed in the plugin README. A headquarters is not an entity: it is the
 * HQ/task force/dummy part of the SIDC.
 */
const LAND_UNIT: Entries = [
  ['Command and control', '110000'],
  ['Liaison', '110500'],
  ['Signal', '111000'],
  ['Air assault', '120100'],
  ['Anti-tank', '120400'],
  ['Armour', '120500'],
  ['Army aviation (rotary wing)', '120600'],
  ['Combined arms', '121000'],
  ['Infantry', '121100'],
  ['Mechanized infantry', '121102'],
  ['Motorized infantry', '121104'],
  ['Reconnaissance', '121300'],
  ['Sniper', '121500'],
  ['Special forces', '121700'],
  ['Special operations forces', '121800'],
  ['Unmanned aircraft systems', '121900'],
  ['Air defence', '130100'],
  ['Field artillery', '130300'],
  ['Missile', '130700'],
  ['Mortar', '130800'],
  ['CBRN defence', '140100'],
  ['Engineer', '140700'],
  ['Explosive ordnance disposal', '140800'],
  ['Military police', '141200'],
  ['Security', '141700'],
  ['Electronic warfare', '150500'],
  ['Military intelligence', '151000'],
  ['Ammunition', '160400'],
  ['Maintenance', '161100'],
  ['Medical', '161300'],
  ['Medical treatment facility', '161400'],
  ['Supply', '163400'],
  ['Transportation', '163600'],
];

/*
 * M4 (brief function 6): 10 to 20 common entities of each further symbol set, or all that milsymbol
 * has. Every code is in milsymbol 3.0.4's table for its set (`src/numbersidc/sidc/<set>.js`). Names
 * follow APP-6D where known, otherwise milsymbol's icon names; doubtful ones are in the README.
 */

const AIR: Entries = [
  ['Fixed wing', '110100'],
  ['Attack/strike', '110102'],
  ['Bomber', '110103'],
  ['Fighter', '110104'],
  ['Fighter/bomber', '110105'],
  ['Cargo', '110107'],
  ['Tanker', '110109'],
  ['Patrol', '110110'],
  ['Reconnaissance', '110111'],
  ['Airborne early warning', '110116'],
  ['Anti-submarine warfare', '110118'],
  ['Electronic countermeasures (jammer)', '110108'],
  ['Medical evacuation', '110101'],
  ['Rotary wing', '110200'],
  ['Unmanned aerial vehicle', '110300'],
  ['Civilian fixed wing', '120100'],
  ['Civilian rotary wing', '120200'],
];

/** milsymbol has one air missile entity; the kinds of missile are sector modifiers, which the catalog does not cover. */
const AIR_MISSILE: Entries = [['Missile', '110000']];

const SPACE: Entries = [
  ['Space vehicle', '110100'],
  ['Re-entry vehicle', '110200'],
  ['Satellite', '110600'],
  ['Anti-satellite weapon', '110800'],
  ['Communications satellite', '111100'],
  ['Earth observation satellite', '111200'],
  ['Navigation satellite', '111400'],
  ['Reconnaissance satellite', '111500'],
  ['Space station', '111600'],
  ['Weather satellite', '111800'],
  ['Space launch vehicle', '111900'],
  ['Civilian satellite', '120300'],
];

const LAND_EQUIPMENT: Entries = [
  ['Rifle', '110100'],
  ['Machine gun', '110200'],
  ['Grenade launcher', '110300'],
  ['Air defence gun', '110500'],
  ['Anti-tank gun', '110600'],
  ['Howitzer', '110900'],
  ['Missile launcher', '111000'],
  ['Air defence missile launcher', '111100'],
  ['Anti-tank missile launcher', '111200'],
  ['Mortar', '111400'],
  ['Multiple rocket launcher', '111600'],
  ['Armoured fighting vehicle', '120101'],
  ['Armoured personnel carrier', '120103'],
  ['Tank', '120200'],
  ['Mine-clearing equipment', '130900'],
  ['Dozer', '131100'],
  ['Utility vehicle', '140100'],
  ['Radar', '220300'],
  ['Land mine', '210100'],
  ['Improvised explosive device', '210400'],
];

const LAND_INSTALLATION: Entries = [
  ['Military base', '120802'],
  ['Airport', '120803'],
  ['Helicopter landing site', '121305'],
  ['Air traffic control facility', '121302'],
  ['Ammunition cache', '110300'],
  ['Bridge', '110701'],
  ['Tunnel', '121313'],
  ['Railhead', '121307'],
  ['Port', '121309'],
  ['Electric power facility', '120500'],
  ['Chemical plant', '120301'],
  ['Industrial site', '120306'],
  ['Telecommunications tower', '121203'],
  ['Dam', '121402'],
  ['Hospital', '120702'],
  ['Religious institution', '121004'],
];

const SEA_SURFACE: Entries = [
  ['Carrier', '120100'],
  ['Battleship', '120201'],
  ['Cruiser', '120202'],
  ['Destroyer', '120203'],
  ['Frigate', '120204'],
  ['Corvette', '120205'],
  ['Amphibious warfare ship', '120300'],
  ['Landing craft', '120308'],
  ['Mine warfare vessel', '120400'],
  ['Minesweeper', '120402'],
  ['Minehunter', '120404'],
  ['Patrol', '120500'],
  ['Unmanned surface vehicle', '120700'],
  ['Auxiliary ship', '130100'],
  ['Hospital ship', '130107'],
  ['Replenishment oiler', '130110'],
  ['Merchant ship', '140100'],
  ['Oiler/tanker', '140109'],
  ['Passenger ship', '140110'],
  ['Fishing vessel', '140200'],
];

const SEA_SUBSURFACE: Entries = [
  ['Submarine', '110100'],
  ['Submarine, surfaced', '110101'],
  ['Submarine, snorkelling', '110102'],
  ['Submarine, bottomed', '110103'],
  ['Other submersible', '110200'],
  ['Non-submarine', '110300'],
  ['Military diver', '110500'],
  ['Civilian submersible', '120100'],
  ['Civilian diver', '120300'],
  ['Torpedo', '130100'],
  ['Improvised explosive device', '130200'],
  ['Underwater decoy', '130300'],
  ['Seabed installation', '200000'],
];

const MINE_WARFARE: Entries = [
  ['Sea mine', '110000'],
  ['Sea mine, bottom', '110100'],
  ['Sea mine, moored', '110200'],
  ['Sea mine, floating', '110300'],
  ['Sea mine, rising', '110400'],
  ['Kingfisher', '110600'],
  ['Exercise mine', '110800'],
  ['Neutralized sea mine', '110900'],
  ['Unexploded ordnance', '120000'],
  ['Sea mine decoy', '130000'],
  ['Mine-like contact (MILCO)', '140200'],
  ['Mine-like echo (MILEC)', '150100'],
];

/** The three named entities milsymbol has in each signals intelligence set; the kinds are sector modifiers. */
const SIGNALS_INTELLIGENCE: Entries = [
  ['Communications', '110100'],
  ['Jammer', '110200'],
  ['Radar', '110300'],
];

/** The symbol sets in the brief's order (function 6), each with its entries. */
export const SYMBOL_SETS: readonly { readonly code: string; readonly name: string; readonly entries: Entries }[] = [
  { code: '10', name: 'Land unit', entries: LAND_UNIT },
  { code: '15', name: 'Land equipment', entries: LAND_EQUIPMENT },
  { code: '20', name: 'Land installation', entries: LAND_INSTALLATION },
  { code: '01', name: 'Air', entries: AIR },
  { code: '02', name: 'Air missile', entries: AIR_MISSILE },
  { code: '05', name: 'Space', entries: SPACE },
  { code: '30', name: 'Sea surface', entries: SEA_SURFACE },
  { code: '35', name: 'Sea subsurface', entries: SEA_SUBSURFACE },
  { code: '36', name: 'Mine warfare', entries: MINE_WARFARE },
  { code: '50', name: 'Signals intelligence, space', entries: SIGNALS_INTELLIGENCE },
  { code: '51', name: 'Signals intelligence, air', entries: SIGNALS_INTELLIGENCE },
  { code: '52', name: 'Signals intelligence, land', entries: SIGNALS_INTELLIGENCE },
  { code: '53', name: 'Signals intelligence, sea surface', entries: SIGNALS_INTELLIGENCE },
  { code: '54', name: 'Signals intelligence, subsurface', entries: SIGNALS_INTELLIGENCE },
];

const ENTITIES: readonly CatalogEntry[] = SYMBOL_SETS.flatMap(({ code, entries }) =>
  entries.map(([name, entity]) => Object.freeze({ name, symbolSet: code, entity })),
);

/** Digit 4 of an APP-6D or APP-6E SIDC. */
const STANDARD_IDENTITIES = [
  { code: '0', name: 'Pending' },
  { code: '1', name: 'Unknown' },
  { code: '2', name: 'Assumed friend' },
  { code: '3', name: 'Friend' },
  { code: '4', name: 'Neutral' },
  { code: '5', name: 'Suspect' },
  { code: '6', name: 'Hostile' },
] as const;

/** Digits 9-10 of a land unit SIDC: the echelon (names as in milsymbol). Mobility codes are not echelons. */
const ECHELONS = [
  { code: '00', name: 'None' },
  { code: '11', name: 'Team/crew' },
  { code: '12', name: 'Squad' },
  { code: '13', name: 'Section' },
  { code: '14', name: 'Platoon/detachment' },
  { code: '15', name: 'Company/battery/troop' },
  { code: '16', name: 'Battalion/squadron' },
  { code: '17', name: 'Regiment/group' },
  { code: '18', name: 'Brigade' },
  { code: '21', name: 'Division' },
  { code: '22', name: 'Corps' },
  { code: '23', name: 'Army' },
  { code: '24', name: 'Army group/front' },
  { code: '25', name: 'Region/theatre' },
  { code: '26', name: 'Command' },
] as const;

export const CATALOG: ReturnType<SymbolService['catalog']> = Object.freeze({
  entities: Object.freeze(ENTITIES),
  standardIdentities: Object.freeze(STANDARD_IDENTITIES.map((i) => Object.freeze(i))),
  echelons: Object.freeze(ECHELONS.map((e) => Object.freeze(e))),
});
