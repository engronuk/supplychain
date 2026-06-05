/**
 * Tiny module-scoped data cache so navigating away and back doesn't flash
 * a loading state — the previous payload is shown immediately while a
 * background refresh fetches new data.
 *
 * Pair it with `useCachedFetch(key, fetcher, deps)`.
 */
import { useEffect, useRef, useState } from "react";

const _store = new Map(); // key -> data

export function getCached(key) {
  return _store.get(key);
}

export function setCached(key, value) {
  _store.set(key, value);
}

export function invalidate(prefix = "") {
  for (const k of Array.from(_store.keys())) {
    if (!prefix || k.startsWith(prefix)) _store.delete(k);
  }
}

/**
 * Returns { data, loading, refreshing, reload }.
 *  - `data` is the previously cached value (or null) on first paint.
 *  - `loading` is true only when there's no cached value AND we're fetching.
 *  - `refreshing` is true on every background refetch.
 */
export function useCachedFetch(key, fetcher, deps = []) {
  const initial = key ? getCached(key) : null;
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [refreshing, setRefreshing] = useState(false);
  const tick = useRef(0);

  const run = async () => {
    if (!key) return;
    const myTick = ++tick.current;
    setRefreshing(true);
    if (!getCached(key)) setLoading(true);
    try {
      const fresh = await fetcher();
      if (tick.current !== myTick) return;
      setCached(key, fresh);
      setData(fresh);
    } finally {
      if (tick.current === myTick) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, refreshing, reload: run };
}
