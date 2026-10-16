/**
 * The map pack for a trip's area (destination plus providers, about 25 km around), saved by
 * MapLibre for use with no signal. Downloads on Wi-Fi; on mobile data only when the traveller
 * taps "Download now". Zoom 8 to 14 keeps it to roughly 1,500 tiles.
 *
 * Tiles: EXPO_PUBLIC_MAP_STYLE_URL, which must point at a provider whose terms allow offline
 * packs, or at our own Kenya extract (see README). The default is OpenFreeMap.
 */
import { useCallback, useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { OfflineManager } from '@maplibre/maplibre-react-native';

export const MAP_STYLE_URL = process.env.EXPO_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
const MIN_ZOOM = 8;
const MAX_ZOOM = 14;

async function findPack(bookingId) {
  const packs = await OfflineManager.getPacks();
  return packs.find((p) => p.metadata?.bookingId === bookingId) || null;
}

/** @returns {{ state: 'checking'|'ready'|'downloading'|'needs_wifi'|'failed', pct: number, downloadNow: () => void }} */
export function useOfflineMap(itinerary) {
  const [state, setState] = useState('checking');
  const [pct, setPct] = useState(0);
  const bookingId = itinerary?.bookingId;
  const bounds = itinerary?.mapBounds;

  const start = useCallback(async () => {
    if (!bookingId || !bounds) return;
    setState('downloading');
    try {
      await OfflineManager.createPack(
        { mapStyle: MAP_STYLE_URL, bounds, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, metadata: { bookingId } },
        (_pack, status) => {
          setPct(Math.round(status.percentage));
          if (status.state === 'complete') setState('ready');
        },
        () => setState('failed'),
      );
    } catch {
      setState('failed');
    }
  }, [bookingId, bounds]);

  useEffect(() => {
    if (!bookingId || !bounds) return undefined;
    let alive = true;
    (async () => {
      try {
        const existing = await findPack(bookingId);
        if (existing) {
          const status = await existing.status();
          if (!alive) return;
          if (status.state === 'complete') {
            setState('ready');
            return;
          }
          setPct(Math.round(status.percentage));
          setState('downloading');
          await existing.resume(); // carry on where an interrupted download stopped
          return;
        }
        const net = await NetInfo.fetch();
        if (!alive) return;
        if (net.type === 'wifi' && net.isConnected) await start();
        else setState('needs_wifi');
      } catch {
        if (alive) setState('failed');
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookingId, bounds, start]);

  return { state, pct, downloadNow: start };
}
