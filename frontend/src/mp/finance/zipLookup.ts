// Destination lookup (spec §7): ~42,000 US ZIP centroids (zipcodes package, MIT) in /data/us-zips.json,
// loaded the first time the calculator needs it. A 5-digit entry is a ZIP; anything else is "City, ST".

export interface Place { zip?: string; city: string; county: string; state: string; lat: number; lng: number; label: string }

interface ZipFile { cities: string[]; counties: string[]; rows: Array<[string, number, number, number, number, string]> }
interface CityEntry { city: string; state: string; lat: number; lng: number; county: string; zips: number }

const STATES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA',
  KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR',
  PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC', 'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY', 'PUERTO RICO': 'PR',
};
const CODES = new Set(Object.values(STATES));

/** Uppercase, no periods/apostrophes, Saint→St, Mount→Mt, Fort→Ft. */
export function normCity(s: string): string {
  return s.toUpperCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/\bSAINT\b/g, 'ST').replace(/\bMOUNT\b/g, 'MT').replace(/\bFORT\b/g, 'FT');
}

let loading: Promise<void> | null = null;
let byZip = new Map<string, Place>();
let byCity = new Map<string, CityEntry>(); // `${norm}|${ST}`
let cityList: CityEntry[] = [];

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export function loadZips(): Promise<void> {
  if (!loading) {
    loading = fetch('/data/us-zips.json').then((r) => {
      if (!r.ok) throw new Error(`ZIP table: HTTP ${r.status}`);
      return r.json() as Promise<ZipFile>;
    }).then((d) => {
      const zips = new Map<string, Place>();
      const acc = new Map<string, { city: string; state: string; lat: number; lng: number; n: number; counties: Map<string, number> }>();
      for (const [zip, lat, lng, ci, co, state] of d.rows) {
        const city = d.cities[ci];
        const county = d.counties[co];
        zips.set(zip, { zip, city, county, state, lat, lng, label: `${title(city)}, ${state} ${zip}` });
        const k = `${normCity(city)}|${state}`;
        const a = acc.get(k) || { city: title(city), state, lat: 0, lng: 0, n: 0, counties: new Map() };
        a.lat += lat; a.lng += lng; a.n++;
        a.counties.set(county, (a.counties.get(county) || 0) + 1);
        acc.set(k, a);
      }
      const cities = new Map<string, CityEntry>();
      for (const [k, a] of acc) {
        const county = Array.from(a.counties.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] || '';
        cities.set(k, { city: a.city, state: a.state, lat: a.lat / a.n, lng: a.lng / a.n, county, zips: a.n });
      }
      byZip = zips;
      byCity = cities;
      cityList = Array.from(cities.values()).sort((x, y) => y.zips - x.zips);
    }).catch((e) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

const toPlace = (c: CityEntry): Place => ({ city: c.city, county: c.county, state: c.state, lat: c.lat, lng: c.lng, label: `${c.city}, ${c.state}` });

/** Splits "Ocean City, NJ" / "ocean city nj" / "Ocean City, New Jersey" into city + state code. */
function splitCityState(input: string): { city: string; state: string } {
  const s = input.trim().replace(/\s+/g, ' ');
  const comma = s.lastIndexOf(',');
  if (comma > 0) {
    const st = s.slice(comma + 1).trim().toUpperCase();
    return { city: s.slice(0, comma), state: STATES[st] || (CODES.has(st) ? st : '') };
  }
  const words = s.split(' ');
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const tail = words.slice(-n).join(' ').toUpperCase();
    const st = STATES[tail] || (n === 1 && CODES.has(tail) ? tail : '');
    if (st) return { city: words.slice(0, -n).join(' '), state: st };
  }
  return { city: s, state: '' };
}

/** Exact match: 5-digit ZIP, or a city with its state. */
export function findPlace(input: string): Place | null {
  const s = input.trim();
  if (/^\d{5}$/.test(s)) return byZip.get(s) || null;
  const { city, state } = splitCityState(s);
  if (!state || !city) return null;
  const c = byCity.get(`${normCity(city)}|${state}`);
  return c ? toPlace(c) : null;
}

/**
 * Best guess for whatever was typed, so the drive time always fills in: a ZIP anywhere in it (full address,
 * "Lecanto FL 34461"), "City, ST" from the end of an address, a city name alone (the largest place with that
 * name), and finally the first suggestion for a partly typed name. null only when nothing matches at all.
 */
export function guessPlace(input: string): Place | null {
  const s = input.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const exact = findPlace(s);
  if (exact) return exact;
  const zip = [...s.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)].map((m) => byZip.get(m[1])).filter(Boolean).pop();
  if (zip) return zip;
  // "street, City, ST 12345" → try the last two comma parts, without any ZIP.
  const parts = s.replace(/\b\d{5}(?:-\d{4})?\b/g, '').split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const tail = findPlace(`${parts[parts.length - 2]}, ${parts[parts.length - 1]}`);
    if (tail) return tail;
  }
  const noZip = parts.join(', ');
  const cs = findPlace(noZip);
  if (cs) return cs;
  // City alone: the largest place with exactly that name.
  const n = normCity(noZip.replace(/,/g, ' '));
  const named = cityList.find((c) => normCity(c.city) === n);
  if (named) return toPlace(named);
  return suggestPlaces(s)[0] || null;
}

/** Up to 6 places as the salesperson types (3+ letters), largest cities first, narrowed by a typed state. */
export function suggestPlaces(input: string): Place[] {
  const s = input.trim();
  if (s.length < 3 || /^\d+$/.test(s)) return [];
  const { city, state } = splitCityState(s);
  const n = normCity(city || s);
  if (n.length < 3) return [];
  const out: Place[] = [];
  for (const c of cityList) {
    if (state && c.state !== state) continue;
    if (!normCity(c.city).startsWith(n)) continue;
    out.push(toPlace(c));
    if (out.length >= 6) break;
  }
  return out;
}

export const zipsLoaded = () => byZip.size > 0;
