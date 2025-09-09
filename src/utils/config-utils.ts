import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_PATH = path.join(os.homedir(), '.', '.g66config.json');

export interface DeveloperConfig {
  name: string;
  [key: string]: any;
}

export function getDeveloperConfig(): DeveloperConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('⚠️ No se encontró la configuración. Ejecutá `g66 init` primero.');
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  console.log(JSON.parse(raw));
  
  return JSON.parse(raw);
}
