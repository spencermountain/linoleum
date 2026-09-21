/* eslint-disable no-bitwise */
// dynamic palmer-penguins dataset — real-ish distributions, any row count
// seeded by default so runs are reproducible when comparing index sizes
const SPECIES = [
  { species: 'Adelie', islands: ['Torgersen', 'Biscoe', 'Dream'], bill: [38.8, 2.7], depth: [18.3, 1.2], flipper: [190, 6.5], mass: [3700, 460] },
  { species: 'Chinstrap', islands: ['Dream'], bill: [48.8, 3.3], depth: [18.4, 1.1], flipper: [196, 7.1], mass: [3733, 384] },
  { species: 'Gentoo', islands: ['Biscoe'], bill: [47.5, 3.1], depth: [15.0, 1.0], flipper: [217, 6.5], mass: [5076, 504] },
]

// species mix from the real dataset — 44% adelie, 20% chinstrap, 36% gentoo
const pickSpecies = (r) => {
  if (r < 0.44) {
    return SPECIES[0]
  }
  if (r < 0.64) {
    return SPECIES[1]
  }
  return SPECIES[2]
}

// mulberry32 — tiny seeded rng
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const round = (n, step) => Math.round(n / step) * step
const round1 = (n) => Math.round(n * 10) / 10

export const makePenguins = (count, seed = 42) => {
  const rand = rng(seed)
  // box-muller normal
  const normal = (mean, sd) => {
    const n = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
    return mean + n * sd
  }
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const rows = []
  for (let i = 0; i < count; i += 1) {
    const sp = pickSpecies(rand())
    const male = rand() < 0.5
    const dimorphism = male ? 1.04 : 0.96 // males run ~8% heavier
    const missing = rand() < 0.01 // the real dataset has a few unmeasured birds
    let sex = male ? 'male' : 'female'
    if (rand() < 0.03) {
      sex = null // and a few unsexed ones
    }
    rows.push({
      species: sp.species,
      island: pick(sp.islands),
      bill_length_mm: missing ? null : round1(normal(sp.bill[0] * dimorphism, sp.bill[1])),
      bill_depth_mm: missing ? null : round1(normal(sp.depth[0] * dimorphism, sp.depth[1])),
      flipper_length_mm: missing ? null : round(normal(sp.flipper[0] * dimorphism, sp.flipper[1]), 1),
      body_mass_g: missing ? null : round(normal(sp.mass[0] * dimorphism, sp.mass[1]), 25),
      sex,
      year: 2007 + Math.floor(rand() * 3),
    })
  }
  return rows
}
