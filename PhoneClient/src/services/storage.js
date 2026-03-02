import { Alert, PermissionsAndroid, Platform } from 'react-native';

// AGGRESSIVE SANITIZER: Replaces illegal OS characters with hyphens
export const sanitizeName = (name) => {
  return name.replace(/[\/\\?%*:|"<>]/g, '-');
};

// Requests permission on old Androids; Auto-approves on Android 10+
export const requestStoragePermission = async () => {
  if (Platform.OS === 'android' && Platform.Version < 30) {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) { return false; }
  }
  return true;
};

export const handleSyncError = (e, setStatus) => {
  console.error(e);
  setStatus('❌ Sync Error');
  Alert.alert("Sync Failed", e?.message || String(e));
};