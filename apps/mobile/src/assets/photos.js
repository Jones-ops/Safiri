/**
 * Photos bundled in the app. Only the two used before any data loads are bundled, to keep
 * the install small; destination photos are served from Supabase Storage from Slice 1.
 * Every photo needs its credit here (CC BY / CC BY-SA licences require attribution).
 */
export const bundledPhotos = {
  welcome: require('../../assets/images/backgrounds/maasai-mara-savanna.jpg'),
  explore: require('../../assets/images/backgrounds/naivasha-lake.jpg'),
};

/** Credits for every photo in assets/images/backgrounds (mirror of CREDITS.md). */
export const photoCredits = [
  { file: 'naivasha-shoreline.jpg', place: 'Lake Naivasha', author: 'Kenenock', licence: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Lake_Naivasha_Shoreline.jpg' },
  { file: 'naivasha-lake.jpg', place: 'Lake Naivasha', author: 'Letherian3', licence: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Lake_Naivasha_Kenya_07.jpg' },
  { file: 'naivasha-hells-gate.jpg', place: "Hell's Gate", author: 'Shadychiri', licence: 'CC BY 4.0', url: 'https://commons.wikimedia.org/wiki/File:Cliff_on_the_Hells_Gate_Game_Park.jpg' },
  { file: 'maasai-mara-savanna.jpg', place: 'Maasai Mara', author: 'Daniel Case', licence: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Maasai_Mara_savanna_landscape,_Kenya.jpg' },
  { file: 'maasai-mara-game-paths.jpg', place: 'Maasai Mara', author: 'Daniel Case', licence: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Game_paths_in_Maasai_Mara_savanna_from_balloon.jpg' },
  { file: 'diani-boat.jpg', place: 'Diani', author: 'Margarida Taborda', licence: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Boat_at_Diani_Beach,_Kenya.jpg' },
  { file: 'diani-beach.jpg', place: 'Diani', author: 'Tall Black', licence: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Diani_Beach_-_December_2023.jpg' },
  { file: 'amboseli-kilimanjaro.jpg', place: 'Amboseli', author: 'Ninaras', licence: 'CC BY 4.0', url: 'https://commons.wikimedia.org/wiki/File:Amboseli_National_Park_and_Mt._Kilimanjaro.jpg' },
  { file: 'amboseli-kilimanjaro-2.jpg', place: 'Amboseli', author: 'Sergey Pesterev', licence: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Kilimanjaro_from_Amboseli.jpg' },
];
