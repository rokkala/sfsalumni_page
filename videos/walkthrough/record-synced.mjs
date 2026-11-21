#!/usr/bin/env node
/**
 * Record one webm per scene, dwelling for VO duration so narration matches the screen.
 * Auth is prepared in a silent context (storageState) so login is not repeated on every clip.
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const OUT = join(ROOT, 'out');
const BASE = (process.env.WALKTHROUGH_BASE_URL || 'https://test-sfs-alumni-alpha.vercel.app').replace(
  /\/$/,
  '',
);
const VIEW = { width: 1440, height: 900 };
const PAD_MS = 900;

const alumniUser = process.env.WALKTHROUGH_ALUMNI_USER;
const alumniPass = process.env.WALKTHROUGH_ALUMNI_PASS;
const adminUser = process.env.WALKTHROUGH_ADMIN_USER;
const adminPass = process.env.WALKTHROUGH_ADMIN_PASS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrollDuring(page, ms) {
  const start = Date.now();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await sleep(500);
  const { height, view } = await page.evaluate(() => ({
    height: document.body.scrollHeight,
    view: window.innerHeight,
  }));
  if (height > view + 80) {
    const remaining = () => Math.max(0, ms - (Date.now() - start));
    const steps = Math.max(3, Math.floor(ms / 2500));
    for (let i = 1; i <= steps; i++) {
      const left = remaining();
      if (left < 400) break;
      await page.evaluate(
        ([h, s, i]) => window.scrollTo({ top: (h * i) / (s + 1), behavior: 'smooth' }),
        [height, steps, i],
      );
      await sleep(Math.min(2200, Math.floor(left / (steps - i + 1))));
    }
  }
  const left = ms - (Date.now() - start);
  if (left > 0) await sleep(left);
}

async function dwell(page, ms, scroll) {
  if (scroll) await scrollDuring(page, ms);
  else await sleep(ms);
}

async function fillAlumniLogin(page, user, pass) {
  const legacyUser = page.locator('#login-username');
  if (await legacyUser.count()) {
    await legacyUser.waitFor({ timeout: 30000 });
    await legacyUser.fill(user);
    await sleep(450);
    await page.locator('#login-password').fill(pass);
    await sleep(450);
    await page.getByRole('button', { name: /sign in/i }).click();
  } else {
    const idField = page.locator('#login-gate-login-id');
    await idField.waitFor({ timeout: 30000 });
    await idField.fill(user);
    await sleep(450);
    await page.getByRole('button', { name: /^Continue$/i }).click();
    await sleep(700);
    await page.locator('#login-gate-password').fill(pass);
    await sleep(450);
    await page.getByRole('button', { name: /^Sign in$/i }).click();
  }
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
  await sleep(800);
}

async function loginSilent(browser, user, pass, nextPath, statePath) {
  const context = await browser.newContext({ viewport: VIEW });
  const page = await context.newPage();
  await page.goto(`${BASE}/login?next=${encodeURIComponent(nextPath)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await fillAlumniLogin(page, user, pass);
  await context.storageState({ path: statePath });
  await context.close();
}

function storageForScene(scene, statePath, audience) {
  if (scene.action === 'login-alumni' || scene.action === 'login-admin') return null;
  if (scene.path === '/' || scene.path === '/signup') return null;
  return statePath;
}

async function openRegistrationFromEvents(page) {
  const regCta = page.getByRole('link', { name: /register|continue|open registration/i }).first();
  if (await regCta.count()) {
    await regCta.click();
    await page.waitForURL(/\/registration/, { timeout: 60000 });
    await sleep(900);
    return;
  }
  const eventLink = page.locator('a[href*="/events/"]').filter({ hasText: /.+/ }).first();
  if (await eventLink.count()) {
    await eventLink.click();
    await sleep(800);
    const inner = page.getByRole('link', { name: /register|continue/i }).first();
    if (await inner.count()) {
      await inner.click();
      await page.waitForURL(/\/registration/, { timeout: 60000 });
    }
  }
}

async function advanceRegistrationToForm(page) {
  await closeOverlays(page);
  if (!page.url().includes('/registration')) {
    await page.goto(`${BASE}/registration`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  }
  await sleep(1200);
  const yesPrefill = page.getByRole('button', { name: /yes, this is correct/i });
  if (await yesPrefill.count()) {
    await yesPrefill.click();
    await sleep(3500);
  }
  if (!(await page.getByRole('heading', { name: /event registration/i }).count())) {
    await page
      .getByRole('heading', { name: /event registration|choose an event/i })
      .first()
      .waitFor({ timeout: 90000 })
      .catch(() => {});
    const pick = page.getByRole('link', { name: /register|continue|in progress/i }).first();
    if (await pick.count()) {
      await pick.click();
      await sleep(1500);
    }
  }
  const eventReg = page.getByRole('link', { name: /register|continue|in progress/i }).first();
  if (await eventReg.count()) {
    const onForm = await page.getByRole('heading', { name: /event registration/i }).count();
    if (!onForm) {
      await eventReg.click();
      await sleep(1500);
    }
  }
  await page.getByRole('heading', { name: /event registration/i }).first().waitFor({ timeout: 45000 }).catch(() => {});
  await sleep(500);
}

async function saveRegistrationForPayment(page) {
  const payReady =
    (await page.getByRole('button', { name: /pay online/i }).count()) ||
    (await page.getByRole('button', { name: /UPI PhonePe/i }).count()) ||
    (await page.getByRole('button', { name: /Pay Via Alternative Method/i }).count());
  if (payReady) return;

  const city = page.getByPlaceholder('City');
  if (await city.count()) {
    const v = await city.inputValue();
    if (!v.trim()) await city.fill('Hyderabad');
  }
  const countryBox = page.getByRole('combobox', { name: /country/i });
  if (await countryBox.count()) {
    await countryBox.click();
    await countryBox.fill('India');
    await sleep(400);
    await page.getByRole('option', { name: /india/i }).first().click().catch(() => page.keyboard.press('Enter'));
  }
  const batchBox = page.getByRole('combobox', { name: /batch/i });
  if (await batchBox.count()) {
    const batchVal = await batchBox.inputValue();
    if (!batchVal.trim()) {
      await batchBox.fill('1988');
      await sleep(400);
      await page.getByRole('option', { name: /1988/ }).first().click().catch(() => page.keyboard.press('Enter'));
    }
  }
  const section = page.locator('select:has(option:text("Select section"))').first();
  if (await section.count()) {
    const sec = await section.inputValue();
    if (!sec) await section.selectOption({ index: 1 });
  }
  const attendYes = page
    .locator('fieldset')
    .filter({ hasText: /going to attend/i })
    .getByRole('radio', { name: 'Yes' });
  if (await attendYes.count()) await attendYes.check();
  const lunchYes = page
    .locator('fieldset')
    .filter({ hasText: /having lunch/i })
    .getByRole('radio', { name: 'Yes' });
  if (await lunchYes.count()) await lunchYes.check();
  const parkingNo = page
    .locator('fieldset')
    .filter({ hasText: /need parking/i })
    .getByRole('radio', { name: 'No' });
  if (await parkingNo.count()) await parkingNo.check();

  const saveBtn = page.getByRole('button', { name: /save registration|save changes/i }).first();
  if (await saveBtn.count()) {
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.click();
    await sleep(5000);
  }
}

async function ensureRegistrationPage(page, saveForPay = false) {
  await advanceRegistrationToForm(page);
  if (saveForPay) await saveRegistrationForPayment(page);
}

async function scrollToPaymentSection(page) {
  const summary = page.getByRole('heading', { name: /payment summary/i }).first();
  if (await summary.count()) {
    await summary.scrollIntoViewIfNeeded();
    await sleep(600);
  } else {
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight * 0.72, behavior: 'smooth' }));
    await sleep(800);
  }
}

async function clickPayButton(page, nameRe) {
  const btn = page.getByRole('button', { name: nameRe }).first();
  await btn.waitFor({ state: 'visible', timeout: 60000 });
  await btn.scrollIntoViewIfNeeded();
  await sleep(400);
  await btn.click();
  await sleep(1200);
}

async function selectRemittance(page, labelRe) {
  const radio = page.getByRole('radio', { name: labelRe }).first();
  if (await radio.count()) {
    await radio.check({ force: true });
    await sleep(700);
  }
}

async function closeOverlays(page) {
  await page.keyboard.press('Escape');
  await sleep(400);
  const close = page.getByRole('button', { name: /close/i }).first();
  if (await close.count()) {
    await close.click();
    await sleep(400);
  }
}

async function runRegistrationAction(page, scene) {
  switch (scene.action) {
    case 'goto-register':
      await openRegistrationFromEvents(page);
      if (!page.url().includes('/registration')) {
        await page.goto(`${BASE}/registration`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await sleep(1200);
      }
      break;
    case 'advance-form':
      await advanceRegistrationToForm(page);
      break;
    case 'focus-payment':
      await ensureRegistrationPage(page, true);
      await scrollToPaymentSection(page);
      break;
    case 'offline-upi':
      await ensureRegistrationPage(page, false);
      await scrollToPaymentSection(page);
      await clickPayButton(page, /UPI PhonePe/i);
      break;
    case 'offline-method-neft':
      await ensureRegistrationPage(page, false);
      await scrollToPaymentSection(page);
      await clickPayButton(page, /Pay Via Alternative Method|View payment proof/i);
      await selectRemittance(page, /NEFT \/ RTGS/i);
      break;
    case 'offline-method-cash':
      await ensureRegistrationPage(page, false);
      await scrollToPaymentSection(page);
      await clickPayButton(page, /Pay Via Alternative Method|View payment proof/i);
      await selectRemittance(page, /Cash \/ cheque deposit/i);
      break;
    case 'offline-method-class':
      await ensureRegistrationPage(page, false);
      await scrollToPaymentSection(page);
      await clickPayButton(page, /Pay Via Alternative Method|View payment proof/i);
      await selectRemittance(page, /Class representative/i);
      break;
    case 'offline-method-foreign':
      await ensureRegistrationPage(page, false);
      await scrollToPaymentSection(page);
      await clickPayButton(page, /Pay Via Alternative Method|View payment proof/i);
      await selectRemittance(page, /Foreign remittance/i);
      break;
    case 'cashfree-preview':
      await ensureRegistrationPage(page, false);
      await scrollToPaymentSection(page);
      {
        const online = page.getByRole('button', { name: /^Pay online$/i }).first();
        if (await online.count()) await online.scrollIntoViewIfNeeded();
      }
      break;
    default:
      break;
  }
}

async function recordAudience(browser, audience) {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'vo', `${audience}-scenes.json`), 'utf8'));
  const sceneDir = join(OUT, 'scenes', audience);
  mkdirSync(sceneDir, { recursive: true });

  const statePath = join(OUT, `${audience}-state.json`);
  if (audience === 'alumni' || audience === 'registration-payments') {
    if (!alumniUser || !alumniPass) throw new Error('Missing alumni credentials');
    await loginSilent(browser, alumniUser, alumniPass, '/member', statePath);
  } else {
    if (!adminUser || !adminPass) throw new Error('Missing admin credentials');
    await loginSilent(browser, adminUser, adminPass, '/admin', statePath);
  }

  const fromScene = process.env.WALKTHROUGH_FROM_SCENE;
  for (const scene of manifest) {
    if (fromScene && scene.id < fromScene) continue;
    const targetMs = Math.round(scene.duration * 1000) + PAD_MS;
    console.log(`→ ${audience}/${scene.id} (${(targetMs / 1000).toFixed(1)}s)`);

    const state = storageForScene(scene, statePath, audience);
    const ctx = await browser.newContext({
      viewport: VIEW,
      recordVideo: { dir: sceneDir, size: VIEW },
      ...(state ? { storageState: state } : {}),
    });
    const page = await ctx.newPage();
    const t0 = Date.now();
    try {
      if (scene.action === 'login-alumni') {
        await page.goto(`${BASE}/login?next=${encodeURIComponent('/member')}`, {
          waitUntil: 'domcontentloaded',
          timeout: 90000,
        });
        await sleep(700);
        await fillAlumniLogin(page, alumniUser, alumniPass);
        await ctx.storageState({ path: statePath });
      } else if (scene.action === 'login-admin') {
        await page.goto(`${BASE}/login?next=${encodeURIComponent('/admin')}`, {
          waitUntil: 'domcontentloaded',
          timeout: 90000,
        });
        await page.waitForSelector('#login-username', { timeout: 30000 });
        await sleep(700);
        await page.fill('#login-username', adminUser);
        await sleep(450);
        await page.fill('#login-password', adminPass);
        await sleep(450);
        await page.click('button[type="submit"]');
        await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 90000 });
        await sleep(800);
        await ctx.storageState({ path: statePath });
      } else {
        await page.goto(`${BASE}${scene.path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 120000,
        });
        await sleep(scene.path === '/registration' ? 1200 : 700);
        if (scene.action === 'logout') {
          const btn = page.getByRole('button', { name: /log out|sign out/i }).first();
          if (await btn.count()) {
            await btn.click();
            await sleep(1200);
          }
        } else if (audience === 'registration-payments' && scene.action) {
          await runRegistrationAction(page, scene);
        }
      }
      const used = Date.now() - t0;
      const shouldScroll = !!scene.scroll && scene.action !== 'focus-payment';
      await dwell(page, Math.max(1200, targetMs - used), shouldScroll);
    } finally {
      const video = page.video();
      await ctx.close();
      const tmp = await video?.path();
      if (tmp) {
        const dest = join(sceneDir, `${scene.id}.webm`);
        rmSync(dest, { force: true });
        renameSync(tmp, dest);
      }
    }
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const which = process.argv[2] || 'both';
  const browser = await chromium.launch({ headless: true });
  try {
    if (which === 'alumni' || which === 'both') await recordAudience(browser, 'alumni');
    if (which === 'committee' || which === 'both') await recordAudience(browser, 'committee');
    if (which === 'registration-payments') await recordAudience(browser, 'registration-payments');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
