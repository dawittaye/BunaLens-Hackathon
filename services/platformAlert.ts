import { Alert, Platform } from 'react-native';

// React Native Web ships a no-op Alert, so browsers would silently drop every
// error and confirmation message without this fallback.
export function showAlert(title: string, message?: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(message ? title + '\n\n' + message : title);
    return;
  }
  Alert.alert(title, message);
}
