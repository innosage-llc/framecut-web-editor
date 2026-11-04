import { useEffect, useSyncExternalStore } from 'react';
import { licensing } from '../src/auth/licenseClient';

export function useLicense() {
  const account = useSyncExternalStore(licensing.subscribe, licensing.snapshot);
  useEffect(() => licensing.start(), []);
  return account;
}
