export function createTtlCache<T>(ttlMs: number) {
  const map = new Map<string, { at: number; data: T }>();

  return {
    get(key: string): T | null {
      const hit = map.get(key);
      if (!hit) return null;
      if (Date.now() - hit.at > ttlMs) {
        map.delete(key);
        return null;
      }
      return hit.data;
    },
    set(key: string, data: T) {
      map.set(key, { at: Date.now(), data });
    },
  };
}
