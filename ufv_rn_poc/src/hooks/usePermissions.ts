import { useState, useEffect, useCallback } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { StorageService, PermissionState } from '../services/StorageService';

export function usePermissions() {
  const [state, setState] = useState<PermissionState>({
    media: 'denied',
    documentsTreeGranted: false,
    treeUri: null,
    allFiles: false,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const storageService = StorageService.getInstance();

  const refreshPermissions = useCallback(async () => {
    setIsLoading(true);
    try {
      const perms = await storageService.getPermissionState();
      setState(perms);
    } catch (err) {
      console.warn('Failed to refresh permissions', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPermissions();
  }, [refreshPermissions]);

  const requestMediaPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

    try {
      if (Platform.Version >= 33) {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO,
        ]);
        const granted =
          results[PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES] === PermissionsAndroid.RESULTS.GRANTED ||
          results[PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO] === PermissionsAndroid.RESULTS.GRANTED ||
          results[PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;

        await refreshPermissions();
        return granted;
      } else {
        const res = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
        );
        const granted = res === PermissionsAndroid.RESULTS.GRANTED;
        await refreshPermissions();
        return granted;
      }
    } catch (err) {
      console.warn('requestMediaPermissions error', err);
      return false;
    }
  };

  const requestDocumentsTree = async (): Promise<boolean> => {
    try {
      const res = await storageService.requestDocumentsTree();
      await refreshPermissions();
      return Boolean(res.granted);
    } catch (err) {
      console.warn('requestDocumentsTree error', err);
      return false;
    }
  };

  return {
    permissionState: state,
    isLoading,
    refreshPermissions,
    requestMediaPermissions,
    requestDocumentsTree,
  };
}

