export const SECTOR_UNIVERSES = {
  Technology: ["NVDA","MSFT","AAPL","AVGO","AMD","ORCL","CRM","ADBE","PLTR","CRWD"],
  Communication: ["META","GOOGL","NFLX","TMUS","DIS","SPOT","PINS"],
  Consumer: ["AMZN","TSLA","COST","WMT","HD","NKE","SBUX","BKNG"],
  Financials: ["JPM","BAC","GS","MS","V","MA","AXP","BLK"],
  Healthcare: ["LLY","UNH","JNJ","ABBV","MRK","AMGN","ISRG","VRTX"],
  Industrials: ["GE","CAT","HON","RTX","ETN","PH","UBER","DE"],
  Energy: ["XOM","CVX","COP","SLB","EOG","MPC","OXY"],
  Utilities: ["NEE","SO","DUK","AEP","SRE","EXC"],
  RealEstate: ["PLD","AMT","EQIX","O","WELL","SPG"],
  Materials: ["LIN","SHW","FCX","NEM","APD","ECL"],
} as const;

export type SectorKey = keyof typeof SECTOR_UNIVERSES;
export const SECTOR_KEYS = Object.keys(SECTOR_UNIVERSES) as SectorKey[];

export function universeForSector(sector?: string | null): string[] {
  if (sector && sector !== "All" && sector in SECTOR_UNIVERSES) {
    return [...SECTOR_UNIVERSES[sector as SectorKey]];
  }
  return Array.from(new Set(SECTOR_KEYS.flatMap(k => [...SECTOR_UNIVERSES[k]])));
}
