import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Camera, Map, Marker } from '@maplibre/maplibre-react-native';
import { useTheme } from '../theme/ThemeProvider';
import { MAP_STYLE_URL, useOfflineMap } from '../features/trips/offlineMap';
import { AppText } from './AppText';
import { Button } from './Button';

/**
 * The trip area map. Shows the saved offline pack when there is no signal; while it is not
 * saved yet, says so and offers to download it now (on mobile data only when asked).
 */
export function TripMap({ itinerary, online }) {
  const { c, radius, space } = useTheme();
  const { t } = useTranslation();
  const map = useOfflineMap(itinerary);
  const showMap = map.state === 'ready' || online;

  return (
    <View style={{ gap: space.sm }}>
      {showMap ? (
        <View style={{ height: 220, borderRadius: radius.card, overflow: 'hidden', backgroundColor: c.surface }}>
          <Map style={{ flex: 1 }} mapStyle={MAP_STYLE_URL} accessibilityLabel={itinerary.destination.name}>
            <Camera initialViewState={{ bounds: itinerary.mapBounds }} />
            <Marker lngLat={[itinerary.destination.lng, itinerary.destination.lat]} anchor="bottom">
              <Ionicons name="location" size={32} color={c.primary} />
            </Marker>
          </Map>
        </View>
      ) : null}

      {map.state === 'ready' ? (
        <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center' }}>
          <Ionicons name="checkmark-circle" size={16} color={c.success} />
          <AppText variant="caption" tone="success">{t('trip.mapReady')}</AppText>
        </View>
      ) : map.state === 'downloading' ? (
        <AppText variant="caption" tone="textMuted" accessibilityLiveRegion="polite">{t('trip.mapDownloading', { pct: map.pct })}</AppText>
      ) : map.state === 'needs_wifi' || map.state === 'failed' ? (
        <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.input, backgroundColor: c.surface }}>
          <AppText variant="label" tone="textMuted">{map.state === 'failed' ? t('trip.mapFailed') : t('trip.mapNeedsWifi')}</AppText>
          {online ? <Button label={t('trip.mapDownloadNow')} variant="secondary" icon="download-outline" onPress={map.downloadNow} /> : null}
        </View>
      ) : null}
    </View>
  );
}
