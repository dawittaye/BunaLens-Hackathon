import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildCoffeeMapHtml, type CoffeeMapPoint, type CoffeeMapSite } from './coffeeMapHtml';

type Props = { site: CoffeeMapSite; points: CoffeeMapPoint[]; zoom: boolean; onToggle: () => void };
const INK = '#26372D';
const MUTED = '#727C70';
const GREEN = '#55765D';
const BORDER = '#E5E9E0';

export default function CoffeeOriginMap({ site, points, zoom, onToggle }: Props) {
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [locationMessage, setLocationMessage] = useState('');
  const html = useMemo(() => buildCoffeeMapHtml(site, points, zoom), [site, points, zoom]);

  const handleMessage = useCallback(async (event: WebViewMessageEvent) => {
    if (event.nativeEvent.data !== 'REQUEST_LOCATION') return;
    try {
      setLocationMessage('Requesting location permission…');
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationMessage('Location permission was denied. The map remains available.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;
      webRef.current?.injectJavaScript(`window.setCoffeeMapUserLocation(${latitude},${longitude}); true;`);
      setLocationMessage('Your current location is shown on the map.');
    } catch {
      setLocationMessage('Unable to determine your location. The map remains available.');
    }
  }, []);

  return (
    <View style={{ backgroundColor: '#FFFFFF', borderColor: BORDER, borderWidth: 1, borderRadius: 18, padding: 15, flex: 1, minWidth: 280 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: INK, fontSize: 15, fontWeight: '900' }}>Jimma Coffee-Growing Area · Satellite View</Text>
          <Text style={{ color: MUTED, fontSize: 10, marginTop: 3 }}>NASA MODIS satellite imagery · geoBoundaries Jimma Zone</Text>
        </View>
        <Pressable onPress={onToggle} style={{ backgroundColor: INK, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '900' }}>{zoom ? 'Full Ethiopia View' : 'Zoom to Jimma'}</Text>
        </Pressable>
      </View>
      <View style={{ width: '100%', height: 390, marginTop: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: '#25382D' }}>
        <WebView
          ref={webRef}
          source={{ html }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          geolocationEnabled
          onLoadEnd={() => setLoading(false)}
          onMessage={handleMessage}
          style={{ flex: 1, backgroundColor: '#25382D' }}
          setSupportMultipleWindows={false}
          allowsInlineMediaPlayback
        />
        {loading ? <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#25382D' }}><ActivityIndicator color="#FFFFFF"/><Text style={{ color: '#FFFFFF', fontSize: 10, marginTop: 8 }}>Loading satellite imagery and Jimma boundary…</Text></View> : null}
      </View>
      {locationMessage ? <Text style={{ color: MUTED, fontSize: 9, marginTop: 7 }}>{locationMessage}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
        <Text style={{ color: '#A34F3E', fontSize: 9 }}>● Selected coffee site</Text>
        <Text style={{ color: GREEN, fontSize: 9 }}>● Other coffee sites</Text>
        <Text style={{ color: '#8B4D36', fontSize: 9 }}>● GBIF native occurrence</Text>
        <Text style={{ color: '#C28B18', fontSize: 9 }}>━ Jimma Zone boundary</Text>
      </View>
      <Text style={{ color: MUTED, fontSize: 9, marginTop: 8, lineHeight: 14 }}>Satellite imagery: NASA EOSDIS GIBS · MODIS Terra True Color (250 m). Administrative boundaries: geoBoundaries gbOpen (CC BY 4.0). NASA imagery is regional satellite context, not parcel-level imagery.</Text>
    </View>
  );
}
