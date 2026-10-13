/**
 * Seed data for local development and tests. Edit this file, then run `npm run db:seed`
 * to regenerate supabase/seed.sql. Names of lodges and operators are made up.
 *
 * Dates are offsets in days from the day the seed is loaded, so the seed never goes stale.
 */

const users = {
  wanjiru: { phone: '254700000001', name: 'Wanjiru', roles: ['traveller'], language: 'en' },
  otieno: { phone: '254700000002', name: 'Otieno', roles: ['traveller'], language: 'sw' },
  achieng: { phone: '254700000003', name: 'Achieng', roles: ['traveller'], language: 'en' },
  agencyOwner: { phone: '254700000021', name: 'Safiri Getaways desk', roles: ['traveller', 'agency'], language: 'en' },
};

const destinations = {
  naivasha: {
    slug: 'naivasha',
    name: 'Naivasha',
    region: 'Nakuru County',
    lat: -0.7167,
    lng: 36.4333,
    heroImage: 'naivasha-lake',
    summary: 'A freshwater lake in the Rift Valley with hippos, boat rides, Hell\'s Gate cycling and lakeside lodges.',
    bestTime: 'All year. Driest from June to October and January to February.',
    gettingThere: 'About 2 hours (90 km) from Nairobi by road on the Nairobi-Nakuru highway.',
    faq: [
      { q: 'Can I do Naivasha as a day trip?', a: 'Yes. Leave Nairobi by 7am and you can cycle Hell\'s Gate, take a boat ride and be back by evening.' },
      { q: 'Is the boat ride safe with hippos around?', a: 'Licensed boat operators keep a safe distance and provide life jackets.' },
    ],
    sw: {
      summary: 'Ziwa la maji baridi katika Bonde la Ufa lenye viboko, safari za mashua, baiskeli Hell\'s Gate na hoteli kando ya ziwa.',
      bestTime: 'Mwaka mzima. Kiangazi ni Juni hadi Oktoba na Januari hadi Februari.',
      gettingThere: 'Takriban saa 2 (km 90) kutoka Nairobi kwa barabara kuu ya Nairobi-Nakuru.',
    },
  },
  mara: {
    slug: 'maasai-mara',
    name: 'Maasai Mara',
    region: 'Narok County',
    lat: -1.4902,
    lng: 35.1435,
    heroImage: 'maasai-mara-savanna',
    summary: 'Open savanna, big cats and, from July to October, the wildebeest migration.',
    bestTime: 'July to October for the migration; good game viewing all year.',
    gettingThere: '5 to 6 hours (about 270 km) by road via Narok, or a 45-minute flight from Wilson Airport.',
    faq: [
      { q: 'Do Kenyan citizens pay less park fees?', a: 'Yes. Citizen and resident rates are much lower than non-resident rates. Bring your ID.' },
      { q: 'Is the road to the Mara rough?', a: 'The last stretch can be bumpy, especially in the rains. Our vans are 4x4.' },
    ],
    sw: {
      summary: 'Nyika pana, wanyama wakubwa na, kuanzia Julai hadi Oktoba, uhamaji wa nyumbu.',
      bestTime: 'Julai hadi Oktoba kwa uhamaji; wanyama huonekana mwaka mzima.',
      gettingThere: 'Saa 5 hadi 6 (takriban km 270) kwa barabara kupitia Narok, au dakika 45 kwa ndege kutoka Wilson.',
    },
  },
  diani: {
    slug: 'diani',
    name: 'Diani',
    region: 'Kwale County',
    lat: -4.2799,
    lng: 39.5947,
    heroImage: 'diani-boat',
    summary: 'White sand, warm Indian Ocean water, snorkelling at Kisite and colobus monkeys in the coastal forest.',
    bestTime: 'December to March and July to October. April to June is the long rains.',
    gettingThere: 'SGR train from Nairobi Terminus to Mombasa (about 5 hours), then about 1.5 hours by road via the Likoni ferry.',
    faq: [
      { q: 'Which SGR class is included?', a: 'Each package says Economy or First Class. Bring your ID; tickets are booked in your name.' },
      { q: 'When is the best snorkelling?', a: 'Calm mornings from October to March usually have the clearest water.' },
    ],
    sw: {
      summary: 'Mchanga mweupe, maji ya joto ya Bahari Hindi, kupiga mbizi Kisite na tumbili aina ya mbega msituni.',
      bestTime: 'Desemba hadi Machi na Julai hadi Oktoba. Aprili hadi Juni ni masika.',
      gettingThere: 'Treni ya SGR kutoka Nairobi hadi Mombasa (takriban saa 5), kisha saa 1.5 kwa barabara kupitia kivuko cha Likoni.',
    },
  },
  amboseli: {
    slug: 'amboseli',
    name: 'Amboseli',
    region: 'Kajiado County',
    lat: -2.6527,
    lng: 37.2606,
    heroImage: 'amboseli-kilimanjaro',
    summary: 'Big elephant herds under Mount Kilimanjaro, swamps full of birds and wide open plains.',
    bestTime: 'June to October and January to February, when Kilimanjaro is often clear in the early morning.',
    gettingThere: 'About 4 hours (240 km) by road via Emali or Namanga.',
    faq: [
      { q: 'Will I see Kilimanjaro?', a: 'Usually at sunrise and sunset. Clouds often cover it in the middle of the day.' },
    ],
    sw: {
      summary: 'Makundi makubwa ya tembo chini ya Mlima Kilimanjaro, vinamasi vyenye ndege na nyanda pana.',
      bestTime: 'Juni hadi Oktoba na Januari hadi Februari, Kilimanjaro huonekana vizuri asubuhi.',
      gettingThere: 'Takriban saa 4 (km 240) kwa barabara kupitia Emali au Namanga.',
    },
  },
};

const agency = { slug: 'safiri-getaways', name: 'Safiri Getaways', licenceNo: 'TRA/TA/2026/0142', owner: 'agencyOwner' };

// type: lodge | guide | driver | activity. verified: false keeps a provider off the public catalogue.
const providers = {
  ziwaShores: { name: 'Ziwa Shores Lodge', type: 'lodge', destination: 'naivasha', licenceNo: 'TRA/AC/2025/1187' },
  mvuli: { name: 'Mvuli Campsite', type: 'lodge', destination: 'naivasha', licenceNo: 'TRA/AC/2025/2210' },
  riftShuttles: { name: 'Rift Valley Shuttles', type: 'driver', destination: 'naivasha', licenceNo: 'NTSA/PSV/2026/0731' },
  ziwaBoats: { name: 'Ziwa Boat Rides', type: 'activity', destination: 'naivasha', licenceNo: 'KMA/BT/2025/0412' },
  hellsGateCycles: { name: "Hell's Gate Cycle Guides", type: 'guide', destination: 'naivasha', licenceNo: 'KWS/TG/2026/0093' },
  mchanga: { name: 'Mchanga Beach Cottages', type: 'lodge', destination: 'diani', licenceNo: 'TRA/AC/2025/3301' },
  pwaniBreeze: { name: 'Pwani Breeze Resort', type: 'lodge', destination: 'diani', licenceNo: 'TRA/AC/2024/0876' },
  pwaniTransfers: { name: 'Pwani Transfers', type: 'driver', destination: 'diani', licenceNo: 'NTSA/PSV/2026/1145' },
  kisiteReef: { name: 'Kisite Reef Trips', type: 'activity', destination: 'diani', licenceNo: 'KMA/BT/2026/0057' },
  olkeri: { name: 'Olkeri Budget Camp', type: 'lodge', destination: 'mara', licenceNo: 'TRA/AC/2025/4410' },
  enkang: { name: 'Enkang Tented Camp', type: 'lodge', destination: 'mara', licenceNo: 'TRA/AC/2024/2093' },
  maraRoad: { name: 'Mara Road Safaris', type: 'driver', destination: 'mara', licenceNo: 'NTSA/PSV/2025/0588' },
  maraGuides: { name: 'Mara Plains Guides', type: 'guide', destination: 'mara', licenceNo: 'KPSGA/2026/0311' },
  kimana: { name: 'Kimana View Lodge', type: 'lodge', destination: 'amboseli', licenceNo: 'TRA/AC/2025/0964' },
  amboseliRoad: { name: 'Amboseli Road Safaris', type: 'driver', destination: 'amboseli', licenceNo: 'NTSA/PSV/2026/0402' },
  kilimaGuides: { name: 'Kilima Game Guides', type: 'guide', destination: 'amboseli', licenceNo: 'KPSGA/2025/0718' },
  flamingoPoint: { name: 'Flamingo Point Cottages', type: 'lodge', destination: 'naivasha', licenceNo: null, verified: false },
};

// unit: night | person | day. netKes: what the provider receives per unit (stays: per person per night, twin share).
const listings = {
  ziwaRoom: { provider: 'ziwaShores', kind: 'stay', unit: 'night', capacity: 12, netKes: 4500, title: 'Lake-view room, breakfast included' },
  ziwaLunch: { provider: 'ziwaShores', kind: 'activity', unit: 'person', capacity: 40, netKes: 1200, title: 'Lakeside lunch' },
  mvuliTent: { provider: 'mvuli', kind: 'stay', unit: 'night', capacity: 15, netKes: 2000, title: 'Furnished tent with bedding' },
  naivashaShuttle: { provider: 'riftShuttles', kind: 'transport', unit: 'person', capacity: 14, netKes: 2500, title: 'Nairobi-Naivasha return shuttle' },
  crescentBoat: { provider: 'ziwaBoats', kind: 'activity', unit: 'person', capacity: 30, netKes: 1500, title: 'Boat ride to Crescent Island' },
  hellsGateCycle: { provider: 'hellsGateCycles', kind: 'activity', unit: 'person', capacity: 25, netKes: 1500, title: "Guided cycling in Hell's Gate" },
  mchangaCottage: { provider: 'mchanga', kind: 'stay', unit: 'night', capacity: 8, netKes: 3500, title: 'Garden cottage, 3 minutes from the beach' },
  pwaniRoom: { provider: 'pwaniBreeze', kind: 'stay', unit: 'night', capacity: 20, netKes: 7500, title: 'Ocean-view room, half board' },
  sgrEconomy: { provider: 'pwaniTransfers', kind: 'transport', unit: 'person', capacity: 30, netKes: 3000, title: 'SGR Economy return with station transfers' },
  sgrFirst: { provider: 'pwaniTransfers', kind: 'transport', unit: 'person', capacity: 20, netKes: 6000, title: 'SGR First Class return with station transfers' },
  shimbaHills: { provider: 'pwaniTransfers', kind: 'activity', unit: 'person', capacity: 14, netKes: 4000, title: 'Shimba Hills day trip' },
  kisiteSnorkel: { provider: 'kisiteReef', kind: 'activity', unit: 'person', capacity: 20, netKes: 3500, title: 'Kisite marine park snorkelling' },
  olkeriTent: { provider: 'olkeri', kind: 'stay', unit: 'night', capacity: 10, netKes: 5500, title: 'Budget tent, full board' },
  enkangTent: { provider: 'enkang', kind: 'stay', unit: 'night', capacity: 12, netKes: 9500, title: 'Tented camp, full board' },
  maraVan: { provider: 'maraRoad', kind: 'transport', unit: 'person', capacity: 7, netKes: 7000, title: 'Nairobi-Mara return by 4x4 safari van' },
  maraDrive: { provider: 'maraGuides', kind: 'activity', unit: 'day', capacity: 14, netKes: 3000, title: 'Full-day game drive with a guide' },
  kimanaRoom: { provider: 'kimana', kind: 'stay', unit: 'night', capacity: 16, netKes: 8000, title: 'Lodge room, full board' },
  amboseliVan: { provider: 'amboseliRoad', kind: 'transport', unit: 'person', capacity: 7, netKes: 6000, title: 'Nairobi-Amboseli return by 4x4 safari van' },
  amboseliDrive: { provider: 'kilimaGuides', kind: 'activity', unit: 'day', capacity: 14, netKes: 3000, title: 'Game drive with a guide' },
  flamingoCottage: { provider: 'flamingoPoint', kind: 'stay', unit: 'night', capacity: 6, netKes: 3000, title: 'Lakeside cottage' },
};

// items: [listing, day, qty]. qty is per person: nights for a stay, days for a game drive, 1 otherwise.
const packages = {
  naivashaDay: {
    slug: 'naivasha-day-escape', destination: 'naivasha', nights: 0, depositPct: 100, instalments: 0,
    title: "Naivasha day escape: Hell's Gate and the lake",
    summary: "Cycle Hell's Gate in the morning, lunch by the lake, then a boat ride to Crescent Island.",
    items: [['naivashaShuttle', 1, 1], ['hellsGateCycle', 1, 1], ['ziwaLunch', 1, 1], ['crescentBoat', 1, 1]],
    inclusions: ['Return shuttle from Nairobi', 'Bike and guide', 'Lunch', 'Boat ride'],
    exclusions: ['Park entry fees', 'Drinks'],
  },
  naivashaWeekend: {
    slug: 'naivasha-lakeside-weekend', destination: 'naivasha', nights: 2, depositPct: 25, instalments: 3,
    title: 'Naivasha lakeside weekend',
    summary: 'Two nights in a lake-view room with breakfast, return shuttle and a boat ride to see the hippos.',
    items: [['naivashaShuttle', 1, 1], ['ziwaRoom', 1, 2], ['crescentBoat', 2, 1]],
    inclusions: ['Return shuttle from Nairobi', '2 nights, breakfast', 'Boat ride'],
    exclusions: ['Lunch and dinner', 'Drinks'],
  },
  naivashaCamping: {
    slug: 'naivasha-camping-weekend', destination: 'naivasha', nights: 2, depositPct: 25, instalments: 2,
    title: "Naivasha camping weekend with Hell's Gate cycling",
    summary: "Two nights in a furnished tent by the lake and a guided cycle through Hell's Gate gorge.",
    items: [['naivashaShuttle', 1, 1], ['mvuliTent', 1, 2], ['hellsGateCycle', 2, 1]],
    inclusions: ['Return shuttle from Nairobi', '2 nights in a furnished tent', 'Bike and guide'],
    exclusions: ['Meals', 'Park entry fees'],
  },
  dianiWeekend: {
    slug: 'diani-beach-weekend', destination: 'diani', nights: 3, depositPct: 25, instalments: 3,
    title: 'Diani beach long weekend by SGR',
    summary: 'SGR Economy to the coast, three nights in a garden cottage and a snorkelling trip to Kisite.',
    items: [['sgrEconomy', 1, 1], ['mchangaCottage', 1, 3], ['kisiteSnorkel', 2, 1]],
    inclusions: ['SGR Economy return', 'Station transfers', '3 nights', 'Snorkelling trip'],
    exclusions: ['Meals', 'Marine park fees'],
  },
  dianiResort: {
    slug: 'diani-resort-escape', destination: 'diani', nights: 4, depositPct: 25, instalments: 3,
    title: 'Diani resort escape, First Class SGR',
    summary: 'Four nights half board facing the ocean, First Class SGR, snorkelling and a Shimba Hills day.',
    items: [['sgrFirst', 1, 1], ['pwaniRoom', 1, 4], ['kisiteSnorkel', 2, 1], ['shimbaHills', 3, 1]],
    inclusions: ['SGR First Class return', 'Station transfers', '4 nights, half board', 'Snorkelling', 'Shimba Hills trip'],
    exclusions: ['Lunches', 'Park and marine fees'],
  },
  maraBudget: {
    slug: 'maasai-mara-budget-safari', destination: 'mara', nights: 2, depositPct: 25, instalments: 3,
    title: 'Maasai Mara budget safari',
    summary: 'Two nights full board in a budget camp and two full days of game drives with a guide.',
    items: [['maraVan', 1, 1], ['olkeriTent', 1, 2], ['maraDrive', 1, 2]],
    inclusions: ['Return 4x4 safari van', '2 nights, full board', '2 days of game drives'],
    exclusions: ['Park entry fees', 'Drinks', 'Tips'],
  },
  maraTented: {
    slug: 'maasai-mara-tented-safari', destination: 'mara', nights: 3, depositPct: 25, instalments: 3,
    title: 'Maasai Mara tented camp, 3 nights',
    summary: 'Three nights full board in a tented camp and three days of game drives, timed for the migration.',
    items: [['maraVan', 1, 1], ['enkangTent', 1, 3], ['maraDrive', 1, 3]],
    inclusions: ['Return 4x4 safari van', '3 nights, full board', '3 days of game drives'],
    exclusions: ['Park entry fees', 'Drinks', 'Tips'],
  },
  amboseliWeekend: {
    slug: 'amboseli-kilimanjaro-weekend', destination: 'amboseli', nights: 2, depositPct: 25, instalments: 3,
    title: 'Amboseli weekend under Kilimanjaro',
    summary: 'Two nights full board, sunrise game drives and elephants with Kilimanjaro behind them.',
    items: [['amboseliVan', 1, 1], ['kimanaRoom', 1, 2], ['amboseliDrive', 1, 2]],
    inclusions: ['Return 4x4 safari van', '2 nights, full board', '2 days of game drives'],
    exclusions: ['Park entry fees', 'Drinks', 'Tips'],
  },
  // Not published: shows that drafts stay private to the agency.
  naivashaDraft: {
    slug: 'naivasha-flamingo-weekend', destination: 'naivasha', nights: 1, depositPct: 25, instalments: 1, status: 'draft',
    title: 'Naivasha flamingo weekend (draft)',
    summary: 'Work in progress.',
    items: [['naivashaShuttle', 1, 1], ['ziwaRoom', 1, 1]],
    inclusions: [], exclusions: [],
  },
};

/**
 * One sample booking in every state. Offsets are days from today.
 * payments: which instalments (by seq) have been paid, and when (day offset).
 */
const bookings = {
  draft: { ref: 'SAF-D7RAFT', user: 'otieno', pkg: 'dianiWeekend', status: 'draft', createdDay: -1, startDay: 60, travellers: 2 },
  held: { ref: 'SAF-H3LD01', user: 'wanjiru', pkg: 'naivashaWeekend', status: 'held', createdDay: 0, startDay: 21, travellers: 2 },
  confirmed: {
    ref: 'SAF-C0NF01', user: 'wanjiru', pkg: 'maraBudget', status: 'confirmed', createdDay: -10, startDay: 45, travellers: 2,
    paid: [{ seq: 0, day: -10 }],
  },
  group: {
    ref: 'SAF-GR0UP1', user: 'otieno', pkg: 'dianiResort', status: 'confirmed', createdDay: -5, startDay: 75, travellers: 2,
    group: [
      { user: 'otieno', organiser: true, paidDay: -5 },
      { user: 'achieng', organiser: false, paidDay: null },
    ],
  },
  fullyPaid: {
    ref: 'SAF-FP4ID1', user: 'wanjiru', pkg: 'amboseliWeekend', status: 'fully_paid', createdDay: -60, startDay: 10, travellers: 2,
    paid: [{ seq: 0, day: -60 }, { seq: 1, day: -39 }, { seq: 2, day: -18 }, { seq: 3, day: -2 }],
  },
  completed: {
    ref: 'SAF-D0NE01', user: 'wanjiru', pkg: 'naivashaDay', status: 'completed', createdDay: -75, startDay: -30, travellers: 2,
    paid: [{ seq: 0, day: -75 }],
    review: { rating: 5, body: 'Cycling Hell\'s Gate was the highlight. Shuttle was on time both ways.' },
  },
  expired: { ref: 'SAF-EXP1RD', user: 'otieno', pkg: 'maraTented', status: 'expired', createdDay: -2, startDay: 30, travellers: 2 },
  cancelled: {
    ref: 'SAF-CANC01', user: 'wanjiru', pkg: 'naivashaCamping', status: 'cancelled', createdDay: -20, startDay: 50, travellers: 2,
    paid: [{ seq: 0, day: -20 }],
    cancelledDay: -5, // 55 days before travel: 100% refund under the default policy
  },
};

module.exports = { users, destinations, agency, providers, listings, packages, bookings };
