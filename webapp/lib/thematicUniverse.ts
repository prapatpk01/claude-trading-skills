export const THEMATIC_UNIVERSES = {
  "biotech": { label: "Biotech", benchmark: "XBI", tickers: ["REGN","VRTX","ALNY","ARGX","NTRA","MRNA","BMRN","INCY","BIIB","GILD","AMGN","CRSP","IONS","EXAS","SRPT","UTHR","NBIX","HALO","TECH","ILMN"] },
  "regional-banks": { label: "Regional Banks", benchmark: "KRE", tickers: ["USB","PNC","TFC","FITB","CFG","RF","KEY","HBAN","MTB","ZION","CMA","WAL","FHN","EWBC","SNV","CBSH","BOKF","FNB","CADE","OZK"] },
  "aerospace-defense": { label: "Aerospace & Defence", benchmark: "ITA", tickers: ["RTX","LMT","NOC","GD","LHX","TDG","HWM","HII","TXT","BWXT","CW","KTOS","AVAV","LDOS","SAIC","HEI","WWD","MRCY","SPR","BA"] },
  "semiconductors": { label: "Semiconductors", benchmark: "SOXX", tickers: ["NVDA","AVGO","AMD","QCOM","TSM","ASML","AMAT","LRCX","KLAC","MU","ARM","MRVL","ADI","TXN","NXPI","ON","MCHP","MPWR","TER","ENTG"] },
  "cloud-software": { label: "Cloud & Software", benchmark: "IGV", tickers: ["MSFT","ORCL","NOW","CRM","ADBE","SNOW","DDOG","NET","MDB","TEAM","HUBS","WDAY","INTU","CDNS","SNPS","PLTR","APP","SHOP","CRWD","PANW"] },
  "cybersecurity": { label: "Cybersecurity", benchmark: "CIBR", tickers: ["CRWD","PANW","FTNT","ZS","OKTA","CYBR","CHKP","NET","TENB","QLYS","VRNS","RBRK","S","GEN","AKAM","RDWR","OSPN","RPD","SAIL","BB"] },
  "ai-infrastructure": { label: "AI Infrastructure", benchmark: "AIQ", tickers: ["NVDA","AVGO","AMD","QCOM","TSM","ASML","ARM","MU","ANET","VRT","MSFT","GOOGL","AMZN","META","ORCL","PLTR","NOW","DELL","SMCI","MRVL"] },
  "energy-transition": { label: "Energy Transition", benchmark: "ICLN", tickers: ["FSLR","ENPH","NXT","NEE","CEG","VST","GEV","ETN","PWR","BE","PLUG","SEDG","AES","ORA","CWEN","RUN","FLNC","STEM","ALB","SQM"] }
} as const;

export type ThemeId = keyof typeof THEMATIC_UNIVERSES;
export const DEFAULT_THEME: ThemeId = "biotech";
export const isThemeId = (value: string): value is ThemeId => value in THEMATIC_UNIVERSES;
