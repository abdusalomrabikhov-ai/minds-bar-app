import * as fs from 'fs';
import * as path from 'path';

function loadEnvFile(filePath: string, env: Record<string, string>): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

function loadEnv(): Record<string, string> {
  const e2eDir = path.resolve(__dirname, '..');
  const root = path.resolve(e2eDir, '..');
  const env: Record<string, string> = {};

  // .env.test is opt-in only (set TEST_ENV=1) so a stray local file can't
  // silently redirect the suite at production. .env/.env.local always win.
  if (process.env.TEST_ENV) {
    loadEnvFile(path.join(root, '.env.test'), env);
    loadEnvFile(path.join(e2eDir, '.env.test'), env);
  }
  for (const file of ['.env', '.env.local']) {
    loadEnvFile(path.join(root, file), env);
    loadEnvFile(path.join(e2eDir, file), env);
  }

  return { ...env, ...process.env } as Record<string, string>;
}

const ENV = loadEnv();

export function getBaseUrl(): string {
  return ENV.BASE_URL || 'http://localhost:3000';
}

export function getAuthFilePath(): string {
  return ENV.AUTH_FILE || 'e2e/.auth/admin.json';
}

export function getAdminCredentials(): { email: string; password: string } {
  return {
    email: ENV.LOGIN_EMAIL || 'admin@teamtask.com',
    password: ENV.LOGIN_PASSWORD || 'admin123',
  };
}
