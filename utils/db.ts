
const DB_NAME = 'FrameCutDB';
const STORE_NAME = 'assets';
const DB_VERSION = 1;

// Helper to open DB - returns a NEW connection every time
export const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => reject('IndexedDB error: ' + (event.target as any).error);

        request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME); // Key-Value store where Key is UUID
            }
        };
    });
};

export const storeAssetInDB = async (id: string, blob: Blob): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(blob, id);

        transaction.oncomplete = () => {
            db.close();
            resolve();
        };

        transaction.onerror = (e) => {
            db.close();
            reject('Error storing asset transaction: ' + (e.target as any).error);
        };
        
        request.onerror = (e) => {
            // Backup error handler
            db.close();
            reject('Error storing asset request: ' + (e.target as any).error);
        };
    });
};

export const getAssetFromDB = async (id: string): Promise<Blob | null> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
            const result = request.result;
            db.close();
            resolve(result || null);
        };

        request.onerror = (e) => {
            db.close();
            reject('Error retrieving asset: ' + (e.target as any).error);
        };
        
        // Also handle transaction errors
        transaction.onerror = () => db.close();
    });
};

export const deleteAssetFromDB = async (id: string): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        transaction.oncomplete = () => {
            db.close();
            resolve();
        };

        transaction.onerror = (e) => {
            db.close();
            reject('Error deleting asset: ' + (e.target as any).error);
        };
    });
};

export const clearAssetsDB = async (): Promise<void> => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        // Critical: Wait for transaction completion, not just request success
        transaction.oncomplete = () => {
            db.close();
            resolve();
        };

        transaction.onerror = (e) => {
            db.close();
            reject('Error clearing DB: ' + (e.target as any).error);
        };
    });
};
