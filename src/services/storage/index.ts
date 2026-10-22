const STORAGE_PREFIX = 'herein-file:';

function hasElectronStorage() {
  return Boolean(window.electron?.storage);
}

function localStorageKey(fileName: string) {
  return `${STORAGE_PREFIX}${fileName}`;
}

export async function readJSONFile<T>(fileName: string): Promise<T | null> {
  if (hasElectronStorage()) {
    return await window.electron!.storage!.read(fileName) as T | null;
  }

  try {
    const stored = localStorage.getItem(localStorageKey(fileName));
    return stored ? JSON.parse(stored) as T : null;
  } catch (error) {
    console.error(`Failed to read ${fileName}:`, error);
    return null;
  }
}

export async function writeJSONFile(fileName: string, data: unknown): Promise<void> {
  if (hasElectronStorage()) {
    await window.electron!.storage!.write(fileName, data);
    return;
  }

  localStorage.setItem(localStorageKey(fileName), JSON.stringify(data));
}

export async function deleteJSONFile(fileName: string): Promise<void> {
  if (hasElectronStorage()) {
    await window.electron!.storage!.delete(fileName);
    return;
  }

  localStorage.removeItem(localStorageKey(fileName));
}

export async function encryptSecret(value: string) {
  if (window.electron?.secrets) {
    return await window.electron.secrets.encrypt(value);
  }

  return { encoding: 'plain:fallback', value };
}

export async function decryptSecret(encryptedValue: string, encoding: string) {
  if (!encryptedValue) {
    return '';
  }

  if (window.electron?.secrets) {
    return await window.electron.secrets.decrypt(encryptedValue, encoding);
  }

  return encryptedValue;
}
