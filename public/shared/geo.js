// Real-world maps: Natural Earth coastlines rasterised onto the tile grid, with hand-placed mountain
// ranges, plateaus, deserts, rainforests, rivers, cities and realms. Shared by server and client so both
// build the identical map from (world, size).
import { T, hash2 } from './map.js';

export const WORLDS = {
  random: { name: 'Random', icon: '🎲' },
  india: { name: 'India', icon: '🗺️', lon0: 65, lon1: 99, lat0: 37.5, lat1: 4.5 },
  earth: { name: 'Earth', icon: '🌍', lon0: -180, lon1: 180, latC: 12, stretch: 1.3 },
};

const GEO = {};
export async function loadGeo(world) {
  if (!WORLDS[world] || world === 'random') return null;
  if (GEO[world]) return GEO[world];
  const url = new URL(`./geo/${world}.json`, import.meta.url);
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const fs = await import('node:fs');
    GEO[world] = JSON.parse(fs.readFileSync(url, 'utf8'));
  } else GEO[world] = await (await fetch(url)).json();
  return GEO[world];
}
export const geoLoaded = (world) => world === 'random' || !!GEO[world];

// tile <-> lon/lat for a world of `size` tiles
export function projection(world, size) {
  const W = WORLDS[world];
  if (world === 'earth') {
    const dLon = 360 / size, dLat = dLon / W.stretch;
    return {
      dLon, dLat,
      toTile: (lon, lat) => [(lon + 180) / dLon, size / 2 - (lat - W.latC) / dLat],
      toLonLat: (x, y) => [-180 + x * dLon, W.latC - (y - size / 2) * dLat],
    };
  }
  const dLon = (W.lon1 - W.lon0) / size, dLat = (W.lat0 - W.lat1) / size;
  return {
    dLon, dLat,
    toTile: (lon, lat) => [(lon - W.lon0) / dLon, (W.lat0 - lat) / dLat],
    toLonLat: (x, y) => [W.lon0 + x * dLon, W.lat0 - y * dLat],
  };
}

// ---------------------------------------------------------------- geography (lon, lat)
// mountain ranges: polyline, half-width in degrees, height boost
const RANGES = [
  { p: [[73.5, 35.6], [75, 34.4], [77, 33.2], [79, 31.6], [81, 30.1], [83, 29.1], [85, 28.3], [87, 27.95], [89, 27.85], [91, 27.95], [93, 28.25], [95, 28.9], [97, 28.6]], w: 1.15, h: 0.6 },
  { p: [[69, 35.6], [71, 36.2], [73, 36.3], [75, 35.9], [77, 35.4], [79, 34.6]], w: 1.1, h: 0.6 },
  { p: [[73.3, 21.2], [73.55, 18.5], [73.9, 15.6], [74.9, 12.9], [76.3, 10.6], [77.25, 8.6]], w: 0.55, h: 0.36 },
  { p: [[86.2, 21.2], [83.6, 18.6], [81.2, 16.6], [79.6, 14.6], [78.6, 12.6]], w: 0.55, h: 0.27 },
  { p: [[72.6, 24], [73.7, 25.5], [75, 26.8], [76.4, 28.1]], w: 0.45, h: 0.24 },
  { p: [[74.5, 22.6], [77, 23.1], [80, 23.6], [82.5, 23.2]], w: 0.6, h: 0.2 },
  { p: [[74, 21.6], [77, 21.9], [79.6, 22.3]], w: 0.5, h: 0.2 },
  { p: [[93.2, 26.6], [94, 25], [93.4, 23.5], [92.7, 22]], w: 0.8, h: 0.34 },
  { p: [[67, 28], [68.5, 30], [69.6, 31.6], [70.6, 33.2]], w: 0.8, h: 0.34 },
  { p: [[97, 28.4], [98.6, 26], [98.5, 23]], w: 1, h: 0.4 },
  { p: [[5.5, 44], [7, 45.8], [10, 46.5], [13, 47], [15.5, 47.3]], w: 1, h: 0.62 },
  { p: [[-1.6, 43], [0.6, 42.7], [2.9, 42.5]], w: 0.6, h: 0.46 },
  { p: [[18, 49.5], [22, 49], [25, 47.5], [26, 45.6], [23, 45.1]], w: 0.8, h: 0.34 },
  { p: [[37.5, 44], [41, 43.3], [44, 42.6], [47, 41.5]], w: 0.8, h: 0.62 },
  { p: [[59, 47], [58.6, 53], [59.6, 58], [60, 63], [64, 67]], w: 0.9, h: 0.3 },
  { p: [[45, 36.5], [47.5, 34], [50, 31.6], [53, 29], [56, 27.6]], w: 1.2, h: 0.44 },
  { p: [[49, 36.8], [53, 36.4], [56, 37.3]], w: 0.8, h: 0.46 },
  { p: [[70, 41], [75, 41.6], [80, 42], [85, 43], [89, 43.5]], w: 1.4, h: 0.62 },
  { p: [[85, 50], [89, 49], [93, 47.6]], w: 1.2, h: 0.44 },
  { p: [[75, 37], [80, 36.1], [85, 35.8], [90, 35.8], [95, 35.5]], w: 1.1, h: 0.5 },
  { p: [[136.5, 35], [138, 36.5], [139.6, 38]], w: 0.7, h: 0.46 },
  { p: [[145.5, -16], [147, -21], [150, -26], [151.6, -30], [149, -35.6], [146.5, -37.6]], w: 1, h: 0.3 },
  { p: [[167, -46], [170, -43.6], [172.5, -42]], w: 0.6, h: 0.56 },
  { p: [[-150, 62], [-135, 59], [-125, 53], [-117, 49], [-114, 45], [-110, 42], [-106, 38], [-106, 33]], w: 3, h: 0.56 },
  { p: [[-121, 40], [-118.5, 36.5]], w: 0.8, h: 0.46 },
  { p: [[-108, 28], [-104, 23], [-100, 19.6], [-97, 17]], w: 1.5, h: 0.44 },
  { p: [[-84.5, 34], [-81, 37], [-78, 39.6], [-75, 41.6], [-72, 44], [-69, 46]], w: 1.5, h: 0.27 },
  { p: [[-74, 11], [-76, 4], [-78, -1], [-78, -8], [-74, -14], [-69, -18], [-68, -24], [-69.6, -30], [-70, -36], [-71.6, -42], [-73, -48], [-73, -52]], w: 2, h: 0.72 },
  { p: [[-9, 30.6], [-5, 32], [-1, 33.6], [3, 35], [8, 36]], w: 1.2, h: 0.4 },
  { p: [[27, -31], [29.6, -29], [31, -26]], w: 1, h: 0.34 },
  { p: [[6, 59], [8, 61.6], [12, 64], [15, 66.6], [18, 68.6], [21, 69.6]], w: 1.3, h: 0.4 },
];
// plateaus and highlands: centre, radii (degrees), height boost
const AREAS = [
  { c: [87, 32.6], r: [11, 4], h: 0.4 },
  { c: [73, 38.6], r: [2.6, 1.6], h: 0.6 },
  { c: [77.6, 17], r: [5, 5], h: 0.12 },
  { c: [56, 32], r: [8, 4], h: 0.17 },
  { c: [103, 46], r: [10, 4], h: 0.18 },
  { c: [38.6, 10], r: [3, 4], h: 0.44 },
  { c: [-46, -16], r: [6, 6], h: 0.16 },
  { c: [-110, 37], r: [4, 3], h: 0.24 },
  { c: [34, 39], r: [6, 2], h: 0.18 },
  { c: [-68, -18], r: [3, 5], h: 0.5 },
];
const DESERTS = [
  { c: [10, 23], r: [24, 8] }, { c: [46, 23], r: [10, 7] }, { c: [71.4, 26.6], r: [3.2, 2.6] }, { c: [57, 32], r: [6, 3] },
  { c: [83, 39], r: [7, 2] }, { c: [104, 42.5], r: [10, 3] }, { c: [21, -24], r: [5, 5] }, { c: [15, -23], r: [1.5, 5] },
  { c: [130, -25], r: [13, 7] }, { c: [-70, -23], r: [1.5, 6] }, { c: [-114, 32], r: [5, 4] }, { c: [60, 39.6], r: [5, 2.6] },
  { c: [70, 23.8], r: [1.4, 0.6] }, { c: [66, 27], r: [3, 3] },
];
const WETLANDS = [
  { c: [-62, -4], r: [12, 8] }, { c: [22, 0], r: [10, 5] }, { c: [103, 12], r: [10, 10] }, { c: [115, -2], r: [18, 6] },
  { c: [75.6, 12], r: [1.3, 5] }, { c: [93, 25.6], r: [3.6, 2.6] }, { c: [82, 22], r: [4, 3] }, { c: [89, 22], r: [1, 0.6] },
  { c: [-82, 38], r: [8, 8] }, { c: [-123, 47], r: [4, 6] }, { c: [138, 37], r: [5, 6] }, { c: [80.6, 7.6], r: [1.2, 1.4] },
];
const RIVERS = [
  [[78.9, 30.1], [78.2, 29.9], [78.0, 29.0], [79.4, 27.3], [80.4, 26.4], [81.9, 25.4], [83.0, 25.3], [84.1, 25.6], [85.1, 25.6], [86.0, 25.3], [87.3, 25.2], [88.1, 24.5], [88.4, 23.4], [88.3, 22.5], [88.1, 21.6]],
  [[78.4, 31.0], [77.6, 30.4], [77.2, 28.6], [78.0, 27.2], [79.3, 26.4], [81.8, 25.4]],
  [[95.5, 28.0], [94.6, 27.4], [93.0, 26.7], [91.7, 26.2], [90.0, 25.7], [89.7, 24.5], [90.5, 23.5], [90.8, 22.4]],
  [[79.5, 32.8], [77.5, 34.2], [75.5, 35.5], [73.0, 34.3], [72.0, 33.0], [71.0, 31.0], [69.5, 28.5], [68.5, 26.5], [68.0, 24.5], [67.4, 23.9]],
  [[73.5, 19.9], [75.3, 19.5], [77.5, 18.9], [79.9, 18.8], [80.9, 17.5], [81.8, 16.6], [82.3, 16.4]],
  [[73.7, 17.9], [74.6, 16.6], [76.5, 16.4], [78.0, 16.1], [79.6, 16.5], [80.6, 16.5], [81.0, 15.8]],
  [[81.7, 22.7], [80.3, 23.1], [78.5, 22.8], [76.2, 22.2], [74.5, 22.0], [73.2, 21.7], [72.6, 21.6]],
  [[75.7, 12.4], [76.5, 12.3], [77.6, 12.1], [78.5, 11.6], [79.2, 11.0], [79.9, 11.1]],
  [[82.0, 20.3], [83.4, 21.4], [84.5, 20.8], [85.8, 20.4], [86.8, 20.3]],
  [[33, 2], [32.5, 9.5], [32.5, 15.5], [33.5, 18], [32, 21], [31.5, 25], [31.2, 30], [31, 31.6]],
  [[-73, -4.5], [-68, -3.5], [-62, -3.2], [-58, -3], [-54, -2.2], [-50, -0.4]],
  [[-95, 47], [-91.5, 44], [-90.5, 41], [-90, 38.5], [-89.5, 35], [-91, 32.5], [-90.2, 29.2]],
  [[91, 33], [97, 32.5], [101, 28], [104, 28.8], [108, 30.5], [112, 30.3], [116, 29.8], [119, 32], [121.6, 31.5]],
  [[8.5, 48], [12, 48.8], [16.5, 48.2], [19, 47.5], [19, 45], [22.5, 44], [26, 43.7], [28, 45.2], [29.6, 45.2]],
  [[33, 57], [38, 57.5], [44, 56.3], [48, 55.8], [49, 53], [46, 50], [45, 47.5], [47.6, 46]],
  [[98, 32], [100, 22], [101, 18], [104, 16], [105.8, 11.5], [106.6, 10]],
  [[25, -6], [24, 0], [19, 1.5], [16, -1.5], [13.5, -5.8], [12.2, -6]],
  [[38.5, 37.5], [40.5, 35], [43, 33.5], [45.5, 32], [47.5, 30.5], [48.6, 29.9]],
  [[85, 52], [83, 56], [76, 61], [69, 62], [66, 66.6]],
];

// cities (lon, lat), most important first; realm = kingdom name when the city is a capital
export const CITIES = {
  india: [
    ['New Delhi', 77.21, 28.61, 'Indraprastha'], ['Mumbai', 72.88, 19.08, 'Maratha'], ['Kolkata', 88.36, 22.57, 'Banga'], ['Chennai', 80.27, 13.08, 'Chola'],
    ['Bengaluru', 77.59, 12.97, 'Vijayanagara'], ['Hyderabad', 78.49, 17.39, 'Deccan'], ['Ahmedabad', 72.57, 23.02, 'Gurjara'], ['Jaipur', 75.79, 26.91, 'Rajputana'],
    ['Lucknow', 80.95, 26.85, 'Awadh'], ['Patna', 85.14, 25.59, 'Magadha'], ['Guwahati', 91.74, 26.14, 'Kamarupa'], ['Bhubaneswar', 85.82, 20.30, 'Kalinga'],
    ['Amritsar', 74.87, 31.63, 'Panchnad'], ['Kochi', 76.27, 9.93, 'Chera'], ['Bhopal', 77.41, 23.26, 'Malwa'], ['Srinagar', 74.80, 34.08, 'Kashmira'],
    ['Pune', 73.86, 18.52], ['Kanpur', 80.33, 26.45], ['Nagpur', 79.09, 21.15], ['Indore', 75.86, 22.72], ['Surat', 72.83, 21.17], ['Varanasi', 82.97, 25.32],
    ['Ayodhya', 82.20, 26.80], ['Agra', 78.01, 27.18], ['Prayagraj', 81.85, 25.44], ['Chandigarh', 76.78, 30.73], ['Visakhapatnam', 83.22, 17.69], ['Madurai', 78.12, 9.93],
    ['Mysuru', 76.64, 12.30], ['Thiruvananthapuram', 76.94, 8.52], ['Goa', 73.83, 15.49], ['Udaipur', 73.71, 24.58], ['Jodhpur', 73.02, 26.24], ['Jaisalmer', 70.91, 26.91],
    ['Leh', 77.58, 34.15], ['Shimla', 77.17, 31.10], ['Dehradun', 78.03, 30.32], ['Rishikesh', 78.27, 30.09], ['Gangtok', 88.61, 27.33], ['Darjeeling', 88.26, 27.04],
    ['Shillong', 91.89, 25.58], ['Imphal', 93.94, 24.82], ['Agartala', 91.28, 23.83], ['Itanagar', 93.62, 27.08], ['Ranchi', 85.31, 23.34], ['Raipur', 81.63, 21.25],
    ['Jabalpur', 79.94, 23.18], ['Gwalior', 78.18, 26.22], ['Bikaner', 73.31, 28.02], ['Ajmer', 74.64, 26.45], ['Rajkot', 70.80, 22.30], ['Dwarka', 68.97, 22.24],
    ['Bhuj', 69.67, 23.25], ['Nashik', 73.79, 20.00], ['Aurangabad', 75.34, 19.88], ['Kolhapur', 74.24, 16.70], ['Mangaluru', 74.86, 12.91], ['Kozhikode', 75.78, 11.26],
    ['Coimbatore', 76.96, 11.02], ['Tiruchirappalli', 78.70, 10.79], ['Puducherry', 79.81, 11.94], ['Rameswaram', 79.31, 9.29], ['Kanyakumari', 77.54, 8.08], ['Hampi', 76.46, 15.33],
    ['Tirupati', 79.42, 13.63], ['Warangal', 79.59, 17.97], ['Vijayawada', 80.65, 16.51], ['Puri', 85.83, 19.81], ['Jammu', 74.86, 32.73], ['Port Blair', 92.73, 11.62],
    ['Lahore', 74.34, 31.55], ['Karachi', 67.01, 24.86], ['Islamabad', 73.05, 33.68], ['Kathmandu', 85.32, 27.72], ['Dhaka', 90.41, 23.81], ['Colombo', 79.86, 6.93],
    ['Thimphu', 89.64, 27.47], ['Lhasa', 91.11, 29.65], ['Kandy', 80.64, 7.29], ['Chittagong', 91.83, 22.36], ['Pokhara', 83.99, 28.21], ['Multan', 71.47, 30.16],
    ['Peshawar', 71.58, 34.01], ['Quetta', 67.00, 30.18], ['Mandalay', 96.08, 21.97],
  ],
  earth: [
    ['New Delhi', 77.21, 28.61, 'Bharat'], ['Beijing', 116.4, 39.9, 'Zhonghua'], ['Tokyo', 139.7, 35.7, 'Nippon'], ['Moscow', 37.6, 55.8, 'Rus'],
    ['London', -0.13, 51.5, 'Britannia'], ['Washington', -77.0, 38.9, 'Columbia'], ['Cairo', 31.2, 30.0, 'Misr'], ['Brasilia', -47.9, -15.8, 'Brasilis'],
    ['Sydney', 151.2, -33.9, 'Australis'], ['Tehran', 51.4, 35.7, 'Persia'], ['Mexico City', -99.1, 19.4, 'Aztlan'], ['Lagos', 3.4, 6.5, 'Benin'],
    ['Paris', 2.35, 48.86, 'Gallia'], ['Rome', 12.5, 41.9, 'Roma'], ['Lima', -77.0, -12.0, 'Inca'], ['Johannesburg', 28.0, -26.2, 'Zulu'],
    ['Jakarta', 106.8, -6.2, 'Majapahit'], ['Istanbul', 29.0, 41.0, 'Byzantium'], ['Riyadh', 46.7, 24.7, 'Arabia'], ['Bangkok', 100.5, 13.8, 'Siam'],
    ['Mumbai', 72.9, 19.1], ['Shanghai', 121.5, 31.2], ['Seoul', 127.0, 37.6], ['New York', -74.0, 40.7], ['Los Angeles', -118.2, 34.1], ['Chicago', -87.6, 41.9],
    ['Toronto', -79.4, 43.7], ['Vancouver', -123.1, 49.3], ['Houston', -95.4, 29.8], ['Miami', -80.2, 25.8], ['Havana', -82.4, 23.1], ['Bogota', -74.1, 4.7],
    ['Caracas', -66.9, 10.5], ['Quito', -78.5, -0.2], ['Santiago', -70.7, -33.4], ['Buenos Aires', -58.4, -34.6], ['Sao Paulo', -46.6, -23.6], ['Rio de Janeiro', -43.2, -22.9],
    ['Manaus', -60.0, -3.1], ['Madrid', -3.7, 40.4], ['Lisbon', -9.1, 38.7], ['Berlin', 13.4, 52.5], ['Vienna', 16.4, 48.2], ['Warsaw', 21.0, 52.2],
    ['Stockholm', 18.1, 59.3], ['Oslo', 10.8, 59.9], ['Athens', 23.7, 38.0], ['Kyiv', 30.5, 50.5], ['Saint Petersburg', 30.3, 59.9], ['Dublin', -6.3, 53.3],
    ['Reykjavik', -21.9, 64.1], ['Casablanca', -7.6, 33.6], ['Algiers', 3.1, 36.8], ['Tunis', 10.2, 36.8], ['Dakar', -17.4, 14.7], ['Accra', -0.2, 5.6],
    ['Kinshasa', 15.3, -4.3], ['Luanda', 13.2, -8.8], ['Nairobi', 36.8, -1.3], ['Addis Ababa', 38.7, 9.0], ['Khartoum', 32.5, 15.6], ['Dar es Salaam', 39.3, -6.8],
    ['Cape Town', 18.4, -33.9], ['Antananarivo', 47.5, -18.9], ['Baghdad', 44.4, 33.3], ['Dubai', 55.3, 25.3], ['Karachi', 67.0, 24.9], ['Kabul', 69.2, 34.5],
    ['Tashkent', 69.3, 41.3], ['Almaty', 76.9, 43.2], ['Kolkata', 88.4, 22.6], ['Chennai', 80.3, 13.1], ['Bengaluru', 77.6, 13.0], ['Dhaka', 90.4, 23.8],
    ['Kathmandu', 85.3, 27.7], ['Lhasa', 91.1, 29.7], ['Colombo', 79.9, 6.9], ['Yangon', 96.2, 16.8], ['Hanoi', 105.8, 21.0], ['Ho Chi Minh City', 106.7, 10.8],
    ['Kuala Lumpur', 101.7, 3.1], ['Singapore', 103.8, 1.35], ['Manila', 121.0, 14.6], ['Hong Kong', 114.2, 22.3], ['Taipei', 121.6, 25.0], ['Chengdu', 104.1, 30.7],
    ['Xian', 108.9, 34.3], ['Ulaanbaatar', 106.9, 47.9], ['Vladivostok', 131.9, 43.1], ['Novosibirsk', 82.9, 55.0], ['Yakutsk', 129.7, 62.0], ['Osaka', 135.5, 34.7],
    ['Perth', 115.9, -32.0], ['Melbourne', 145.0, -37.8], ['Darwin', 130.8, -12.5], ['Auckland', 174.8, -36.8], ['Anchorage', -149.9, 61.2], ['Denver', -105.0, 39.7],
    ['Panama City', -79.5, 9.0], ['La Paz', -68.1, -16.5], ['Nuuk', -51.7, 64.2],
  ],
};

// ---------------------------------------------------------------- generation
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct) {
  let sum = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) (sum += vnoise(x * f, y * f, s + i * 101) * amp), (norm += amp), (amp *= 0.5), (f *= 2);
  return sum / norm;
}

// even-odd scanline fill of all rings into a land mask
function rasterize(geo, size, P) {
  const land = new Uint8Array(size * size);
  const rows = Array.from({ length: size }, () => []);
  const q = geo.q;
  for (const r of geo.rings) {
    const n = r.length / 2;
    // unwrap rings that cross the antimeridian (Eurasia, Antarctica, Fiji…) so they stay closed,
    // then draw them again shifted by one map width to cover the wrapped part
    const pts = [];
    let shift = 0, prev = null, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < n; i++) {
      let lon = r[i * 2] / q;
      if (prev !== null) {
        const d = lon + shift - prev;
        if (d > 180) shift -= 360;
        else if (d < -180) shift += 360;
      }
      lon += shift;
      prev = lon;
      const p = P.toTile(lon, r[i * 2 + 1] / q);
      pts.push(p);
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
    }
    const wrapW = world360(P, size);
    for (const off of wrapW ? [0, -wrapW, wrapW] : [0]) {
      if (maxX + off < 0 || minX + off > size) continue;
      addEdges(pts, off);
    }
  }
  function addEdges(pts, off) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x1 = pts[i][0] + off, y1 = pts[i][1], x2 = pts[j][0] + off, y2 = pts[j][1];
      if (y1 === y2) continue;
      const ya = Math.min(y1, y2), yb = Math.max(y1, y2);
      for (let y = Math.max(0, Math.ceil(ya - 0.5)); y <= Math.min(size - 1, Math.floor(yb - 0.5)); y++) {
        const yc = y + 0.5;
        if (yc < ya || yc >= yb) continue;
        rows[y].push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
  }
  for (let y = 0; y < size; y++) {
    const xs = rows[y].sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.max(0, Math.round(xs[i])), b = Math.min(size, Math.round(xs[i + 1]));
      for (let x = a; x < b; x++) land[y * size + x] = 1;
    }
  }
  return land;
}

// map width covering 360 degrees of longitude (only the Earth map wraps)
function world360(P, size) {
  return Math.abs(360 / P.dLon - size) < 1 ? size : 0;
}

// distance (in tiles) to the nearest tile of the other kind, two-pass chamfer
function coastDistance(land, size) {
  const D = new Float32Array(size * size).fill(1e6);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x, v = land[i];
      if ((x > 0 && land[i - 1] !== v) || (x < size - 1 && land[i + 1] !== v) || (y > 0 && land[i - size] !== v) || (y < size - 1 && land[i + size] !== v)) D[i] = 0.5;
    }
  const S2 = Math.SQRT2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let d = D[i];
      if (x > 0) d = Math.min(d, D[i - 1] + 1);
      if (y > 0) {
        d = Math.min(d, D[i - size] + 1);
        if (x > 0) d = Math.min(d, D[i - size - 1] + S2);
        if (x < size - 1) d = Math.min(d, D[i - size + 1] + S2);
      }
      D[i] = d;
    }
  for (let y = size - 1; y >= 0; y--)
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      let d = D[i];
      if (x < size - 1) d = Math.min(d, D[i + 1] + 1);
      if (y < size - 1) {
        d = Math.min(d, D[i + size] + 1);
        if (x < size - 1) d = Math.min(d, D[i + size + 1] + S2);
        if (x > 0) d = Math.min(d, D[i + size - 1] + S2);
      }
      D[i] = d;
    }
  return D;
}

const ell = (lon, lat, a) => ((lon - a.c[0]) / a.r[0]) ** 2 + ((lat - a.c[1]) / a.r[1]) ** 2;

export function generateGeoMap(size, world, ELEV_MAX) {
  const geo = GEO[world];
  if (!geo) throw new Error(`geo data for "${world}" not loaded`);
  const P = projection(world, size);
  const land = rasterize(geo, size, P);
  const D = coastDistance(land, size);
  const N = size * size;
  // mountains: rasterise each range into a boost field
  const boost = new Float32Array(N);
  const degTile = P.dLon;
  for (const R of RANGES) {
    for (let k = 0; k + 1 < R.p.length; k++) {
      const [ax, ay] = R.p[k], [bx, by] = R.p[k + 1];
      const [tx0, ty0] = P.toTile(Math.min(ax, bx) - R.w, Math.max(ay, by) + R.w);
      const [tx1, ty1] = P.toTile(Math.max(ax, bx) + R.w, Math.min(ay, by) - R.w);
      for (let y = Math.max(0, Math.floor(ty0)); y <= Math.min(size - 1, Math.ceil(ty1)); y++)
        for (let x = Math.max(0, Math.floor(tx0)); x <= Math.min(size - 1, Math.ceil(tx1)); x++) {
          const [lon, lat] = P.toLonLat(x + 0.5, y + 0.5);
          // distance from (lon, lat) to the segment, in degrees
          const vx = bx - ax, vy = by - ay;
          const t = Math.max(0, Math.min(1, ((lon - ax) * vx + (lat - ay) * vy) / (vx * vx + vy * vy || 1)));
          const d = Math.hypot(lon - (ax + vx * t), lat - (ay + vy * t)) / R.w;
          if (d >= 1) continue;
          const v = R.h * (1 - d * d) * (0.7 + 0.6 * fbm(lon * 1.7, lat * 1.7, 77, 3));
          const i = y * size + x;
          if (v > boost[i]) boost[i] = v;
        }
    }
  }
  for (const A of AREAS) {
    const [tx0, ty0] = P.toTile(A.c[0] - A.r[0], A.c[1] + A.r[1]);
    const [tx1, ty1] = P.toTile(A.c[0] + A.r[0], A.c[1] - A.r[1]);
    for (let y = Math.max(0, Math.floor(ty0)); y <= Math.min(size - 1, Math.ceil(ty1)); y++)
      for (let x = Math.max(0, Math.floor(tx0)); x <= Math.min(size - 1, Math.ceil(tx1)); x++) {
        const [lon, lat] = P.toLonLat(x + 0.5, y + 0.5);
        const e = ell(lon, lat, A);
        if (e >= 1) continue;
        const v = A.h * (1 - e) ** 0.6 * (0.75 + 0.5 * fbm(lon * 1.3, lat * 1.3, 91, 3));
        const i = y * size + x;
        boost[i] = Math.max(boost[i], v);
      }
  }
  const tiles = new Uint8Array(N), elev = new Uint8Array(N);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const [lon, lat] = P.toLonLat(x + 0.5, y + 0.5);
      const off = lat > 90 || lat < -90;
      const n = fbm(lon * 0.9, lat * 0.9, 5, 5);
      const dDeg = D[i] * degTile;
      let e, t;
      if (!land[i] || off) {
        // continental shelf: shallow near the coast (a few tiles at least), deep beyond ~0.5 degrees
        const shelf = Math.min(D[i] / 6, dDeg / 0.5);
        e = 0.375 - Math.min(shelf, 2.5) * 0.06 - (n - 0.5) * 0.03;
        t = e < 0.3 ? T.DEEP : T.WATER;
      } else {
        e = 0.43 + Math.min(dDeg, 3) * 0.05 + (n - 0.5) * 0.22 + boost[i];
        e = Math.max(0.41, e);
        const fine = fbm(lon * 4.5 + 50, lat * 4.5, 13, 3); // small-scale variety for biome edges
        let m = 0.44 + (fbm(lon * 1.4 + 300, lat * 1.4, 9, 4) - 0.5) * 0.8 + (fine - 0.5) * 0.25;
        const al = Math.abs(lat);
        m += 0.16 * Math.exp(-((lat / 10) ** 2)) - 0.13 * Math.exp(-(((al - 25) / 8) ** 2)) + 0.13 * Math.exp(-(((al - 57) / 8) ** 2));
        let desert = 0;
        for (const A of DESERTS) desert = Math.max(desert, 1 - ell(lon, lat, A));
        if (desert > 0) desert *= 0.55 + 0.9 * fbm(lon * 0.35 + 70, lat * 0.35, 17, 3); // ragged desert edges
        for (const A of WETLANDS) m += Math.max(0, 1 - ell(lon, lat, A)) * 0.35;
        const greenland = lon > -60 && lon < -15 && lat > 59;
        const icecap = lat < -60 || greenland || al > 76;
        if (e > 1.05 + fine * 0.14 || icecap) t = T.SNOW;
        else if (e > 0.93) t = T.MOUNTAIN;
        else if (e > 0.82) t = T.HILL;
        else if (desert > 0.12 + fine * 0.45) t = T.SAND;
        else if (al > 66) t = fine > 0.6 ? T.SNOW : fine > 0.42 ? T.GRASS : T.FOREST; // tundra
        else if (m > 0.55) t = T.FOREST;
        else t = T.GRASS;
        if (t === T.SNOW && e < 1.11 && !icecap && al <= 66) e = 1.11;
      }
      tiles[i] = t;
      elev[i] = Math.round((Math.max(0, Math.min(ELEV_MAX, e)) / ELEV_MAX) * 255);
    }
  // rivers: carve navigable water along the great rivers (a little wider on detailed maps)
  const rw = Math.max(0.5, Math.min(1.6, 0.06 / degTile));
  for (const R of RIVERS) {
    for (let k = 0; k + 1 < R.length; k++) {
      const [ax, ay] = P.toTile(R[k][0], R[k][1]), [bx, by] = P.toTile(R[k + 1][0], R[k + 1][1]);
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        // meander a little so rivers don't look ruler-straight
        const mx = ax + (bx - ax) * t, my = ay + (by - ay) * t;
        const wob = (fbm(mx * 0.08, my * 0.08, 33, 2) - 0.5) * 6;
        const nx = -(by - ay), ny = bx - ax, nl = Math.hypot(nx, ny) || 1;
        const cx = mx + (nx / nl) * wob, cy = my + (ny / nl) * wob;
        for (let dy = -Math.ceil(rw); dy <= Math.ceil(rw); dy++)
          for (let dx = -Math.ceil(rw); dx <= Math.ceil(rw); dx++) {
            if (dx * dx + dy * dy > rw * rw + 0.3) continue;
            const x = Math.round(cx + dx), y = Math.round(cy + dy);
            if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const i = y * size + x;
            if (tiles[i] >= T.SAND && tiles[i] <= T.HILL) (tiles[i] = T.WATER), (elev[i] = Math.round((0.36 / ELEV_MAX) * 255));
          }
      }
    }
  }
  return { tiles, elev };
}

// kingdom capitals for a real-world map: well-separated realm cities on land
export function geoSpawns(map, n, seed) {
  const P = projection(map.world, map.size);
  const caps = CITIES[map.world].filter((c) => c[3]).map((c) => ({ name: c[0], realm: c[3], t: P.toTile(c[1], c[2]) })).filter((c) => c.t[0] > 4 && c.t[1] > 4 && c.t[0] < map.size - 4 && c.t[1] < map.size - 4);
  const out = [];
  let r = seed;
  const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
  const pool = [...caps];
  while (out.length < n && pool.length) {
    let best = 0;
    if (out.length) {
      let bd = -1;
      pool.forEach((c, i) => {
        const d = Math.min(...out.map((o) => Math.hypot(o.t[0] - c.t[0], o.t[1] - c.t[1]))) * (0.85 + rnd() * 0.3);
        if (d > bd) (bd = d), (best = i);
      });
    } else best = Math.floor(rnd() * Math.min(pool.length, 6));
    out.push(pool.splice(best, 1)[0]);
  }
  return out;
}
