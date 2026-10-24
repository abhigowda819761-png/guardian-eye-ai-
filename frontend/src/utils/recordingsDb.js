// IndexedDB storage for real meeting video recordings
const DB_NAME = 'GuardianEyeRecordingsDB';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not supported by this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

export async function getAllRecordings() {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const list = request.result || [];
        // Sort newest first
        list.sort((a, b) => (b.id || 0) - (a.id || 0));
        resolve(list);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('[recordingsDb] Could not read recordings:', err);
    return [];
  }
}

export async function saveRecording(item) {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(item);

      request.onsuccess = () => resolve(item);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('[recordingsDb] Could not save recording:', err);
    return item;
  }
}

export async function deleteRecording(id) {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('[recordingsDb] Could not delete recording:', err);
    return false;
  }
}
