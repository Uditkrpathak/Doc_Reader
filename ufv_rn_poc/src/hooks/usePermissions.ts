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

  const refreshPermissions = useCallback(async (): Promise<PermissionState> => {
    setIsLoading(true);
    try {
      const perms = await storageService.getPermissionState();
      setState(perms);
      return perms;
    } catch (err) {
      console.warn('Failed to refresh permissions', err);
      return state;
    } finally {
      setIsLoading(false);
    }
  }, [state, storageService]);

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
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        ]);
        const granted =
          results[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED ||
          results[PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED;
        await refreshPermissions();
        return granted;
      }
    } catch (err) {
      console.warn('requestMediaPermissions error', err);
      return false;
    }
  };

  const requestAllFilesAccess = async (): Promise<boolean> => {
    try {
      const res = await storageService.requestAllFilesAccess();
      await refreshPermissions();
      return Boolean(res.granted);
    } catch (err) {
      console.warn('requestAllFilesAccess error', err);
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

  const requestAutoPermissions = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      // 1. Request Media / External Storage Runtime Permissions
      await requestMediaPermissions();

      // 2. Refresh permission state
      const perms = await refreshPermissions();

      // 3. For modern Android (Android 11+ / API 30+), request All Files Access if not yet granted
      if (Platform.Version >= 30 && !perms.allFiles) {
        await requestAllFilesAccess();
      }

      await refreshPermissions();
      return true;
    } catch (err) {
      console.warn('requestAutoPermissions error', err);
      return false;
    }
  };

  return {
    permissionState: state,
    isLoading,
    refreshPermissions,
    requestMediaPermissions,
    requestAllFilesAccess,
    requestDocumentsTree,
    requestAutoPermissions,
  };
}

