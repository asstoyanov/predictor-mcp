export function getRequired(sp: URLSearchParams, key: string) {
    const v = sp.get(key);
    if (!v) throw new Error(`Missing required param: ${key}`);
    return v;
  }
  
  export function getNumber(sp: URLSearchParams, key: string, fallback?: number) {
    const raw = sp.get(key);
    if (raw === null || raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`Invalid number for param: ${key}`);
    return n;
  }
  