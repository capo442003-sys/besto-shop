/**
 * Crée un client OAuth Web (console Google) et pousse les secrets sur Railway.
 * Usage: node deploy/scripts/create-google-oauth-playwright.mjs
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const ENV_FILE = path.join(ROOT, 'deploy/.cloud.env');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'bmb-gestion-oauth';
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI
  || 'https://bmb-api-production.up.railway.app/api/backups/google/callback';
const RAILWAY_SERVICE = process.env.RAILWAY_SERVICE || 'bmb-api';
const APP_NAME = 'BMB Gestion Web';
const GOOGLE_EMAIL = process.env.GOOGLE_ACCOUNT || 'mamadousalioumsdiallo@gmail.com';
const PROFILE_DIR = path.join(ROOT, 'deploy/.playwright-google-profile');

function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const vars = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) vars[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return vars;
}

function writeEnvVars(updates) {
  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`(?m)^${key}=.*$`);
    const line = `${key}=${value}`;
    content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(ENV_FILE, content, 'utf8');
}

function pushRailway(clientId, clientSecret) {
  execSync(`npx -y @railway/cli variable set "GOOGLE_OAUTH_CLIENT_ID=${clientId}" --service ${RAILWAY_SERVICE}`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
  execSync(`npx -y @railway/cli variable set "GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}" --service ${RAILWAY_SERVICE}`, {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

async function safeContent(page) {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    return await page.content();
  } catch {
    await page.waitForTimeout(2000);
    return await page.content().catch(() => '');
  }
}

async function waitForCredentials(page, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const html = await safeContent(page);
    const match = html.match(
      /([0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com)[\s\S]{0,4000}?(GOCSPX-[A-Za-z0-9_-]+)/i
    );
    if (match) return { clientId: match[1], clientSecret: match[2] };

    const idInput = page.locator('input[readonly][value*="googleusercontent.com"]').first();
    const secretInput = page.locator('input[readonly][value*="GOCSPX"]').first();
    if (await idInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      const clientId = await idInput.inputValue();
      let clientSecret = '';
      if (await secretInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        clientSecret = await secretInput.inputValue();
      } else {
        await page.locator('text=Show secret, text=Afficher le secret').first().click().catch(() => {});
        clientSecret = await secretInput.inputValue().catch(() => '');
      }
      if (clientId && clientSecret) return { clientId, clientSecret };
    }
    await page.waitForTimeout(2000);
  }
  return null;
}

async function ensureGoogleLogin(page) {
  for (let i = 0; i < 120; i++) {
    const url = page.url();
    if (url.includes('console.cloud.google.com')) return;
    if (url.includes('accounts.google.com')) {
      const emailInput = page.locator('input[type="email"], input#identifierId').first();
      if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await emailInput.fill(GOOGLE_EMAIL);
        await clickFirst(page, ['Next', 'Suivant']);
        console.log(`Connexion Google : terminez le mot de passe / 2FA dans le navigateur (${GOOGLE_EMAIL})...`);
      }
    }
    await page.waitForTimeout(3000);
  }
  throw new Error('Connexion Google Cloud non terminée dans les 6 minutes.');
}

async function clickFirst(page, labels) {
  for (const label of labels) {
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click();
      return true;
    }
    const link = page.getByText(label, { exact: false }).first();
    if (await link.isVisible({ timeout: 1500 }).catch(() => false)) {
      await link.click();
      return true;
    }
  }
  return false;
}

async function setupConsent(page) {
  await page.goto(`https://console.cloud.google.com/auth/overview?project=${PROJECT_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForTimeout(3000);

  if (await page.getByText('Get started', { exact: false }).isVisible({ timeout: 5000 }).catch(() => false)) {
    await clickFirst(page, ['Get started', 'Commencer']);
    await page.waitForTimeout(2000);
    await page.locator('input').first().fill(APP_NAME.replace(' Web', '')).catch(() => {});
    await clickFirst(page, ['External', 'Externe']);
    await clickFirst(page, ['Next', 'Suivant']);
    await clickFirst(page, ['Next', 'Suivant']);
    await clickFirst(page, ['Continue', 'Continuer', 'Create', 'Créer']);
    await page.waitForTimeout(3000);
  }
}

async function createViaLegacyCredentials(page) {
  await page.goto(`https://console.cloud.google.com/apis/credentials/oauthclient?project=${PROJECT_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForTimeout(4000);

  await page.locator('input[type="text"]').first().fill(APP_NAME).catch(() => {});

  const redirect = page.locator('input[aria-label*="redirect" i], input[placeholder*="URI" i]').last();
  if (await redirect.isVisible({ timeout: 5000 }).catch(() => false)) {
    await redirect.fill(REDIRECT_URI);
  } else {
    await clickFirst(page, ['Add URI', 'Ajouter un URI']);
    await page.locator('input').last().fill(REDIRECT_URI).catch(() => {});
  }

  await clickFirst(page, ['Create', 'Créer']);
  return waitForCredentials(page);
}

async function createViaAuthPlatform(page) {
  await page.goto(`https://console.cloud.google.com/auth/clients/create?project=${PROJECT_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForTimeout(4000);

  await clickFirst(page, ['Web application', 'Application Web', 'Web']);
  await page.locator('input').filter({ hasNot: page.locator('[type="hidden"]') }).first()
    .fill(APP_NAME).catch(() => {});

  const redirect = page.locator('input:visible:not([type="hidden"])').last();
  if (await redirect.isVisible({ timeout: 5000 }).catch(() => false)) {
    await redirect.fill(REDIRECT_URI);
  } else {
    await clickFirst(page, ['Add URI', 'Ajouter un URI', 'Add']);
    await page.locator('input:visible:not([type="hidden"])').last().fill(REDIRECT_URI);
  }

  await clickFirst(page, ['Create', 'Créer']);
  return waitForCredentials(page);
}

async function main() {
  const existing = readEnvFile();
  if (existing.GOOGLE_OAUTH_CLIENT_ID && existing.GOOGLE_OAUTH_CLIENT_SECRET) {
    console.log('Identifiants déjà dans deploy/.cloud.env — push Railway...');
    pushRailway(existing.GOOGLE_OAUTH_CLIENT_ID, existing.GOOGLE_OAUTH_CLIENT_SECRET);
    console.log('OK Railway configuré.');
    return;
  }

  console.log('Navigateur Google Cloud — connectez-vous si demandé (6 min max)...');
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(`https://console.cloud.google.com/auth/clients/create?project=${PROJECT_ID}`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
    await ensureGoogleLogin(page);
    await setupConsent(page);
    let creds = await createViaAuthPlatform(page);
    if (!creds) creds = await createViaLegacyCredentials(page);
    if (!creds) {
      throw new Error(
        'Création OAuth non terminée. Dans le navigateur : Credentials → Create OAuth client ID → Web → '
        + `redirect ${REDIRECT_URI} → puis relancez ce script.`
      );
    }

    console.log('Client ID trouvé:', creds.clientId);
    writeEnvVars({
      GCP_PROJECT_ID: PROJECT_ID,
      GOOGLE_OAUTH_CLIENT_ID: creds.clientId,
      GOOGLE_OAUTH_CLIENT_SECRET: creds.clientSecret,
      GOOGLE_OAUTH_REDIRECT_URI: REDIRECT_URI,
      RAILWAY_SERVICE,
      RAILWAY_API_URL: REDIRECT_URI.replace('/api/backups/google/callback', ''),
    });
    pushRailway(creds.clientId, creds.clientSecret);
    console.log('OK — Google OAuth configuré sur Railway.');
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
