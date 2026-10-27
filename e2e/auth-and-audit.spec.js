import { test, expect } from '@playwright/test';

test.describe('BMB — parcours critique', () => {
  test('connexion admin et accès tableau de bord', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/identifiant/i).fill('admin');
    await page.getByLabel(/mot de passe/i).fill('admin123');
    await page.getByRole('button', { name: /connexion/i }).click();

    const changePwd = page.getByRole('heading', { name: /changement de mot de passe/i });
    if (await changePwd.isVisible().catch(() => false)) {
      await page.getByLabel(/nouveau mot de passe/i).first().fill('BmbSecure2026!');
      await page.getByLabel(/confirmer/i).fill('BmbSecure2026!');
      await page.getByRole('button', { name: /enregistrer le mot de passe/i }).click();
    }

    await expect(page).toHaveURL(/\//);
    await expect(page.getByText(/tableau de bord|chiffre/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('journal audit accessible pour admin', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/identifiant/i).fill('admin');
    await page.getByLabel(/mot de passe/i).fill(process.env.E2E_ADMIN_PASSWORD || 'admin123');
    await page.getByRole('button', { name: /connexion/i }).click();

    if (await page.getByRole('heading', { name: /changement de mot de passe/i }).isVisible().catch(() => false)) {
      test.skip();
    }

    await page.goto('/parametres/audit');
    await expect(page.getByRole('heading', { name: /journal d'audit/i })).toBeVisible({ timeout: 15000 });
  });
});
