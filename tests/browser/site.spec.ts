import { test, expect } from '@playwright/test';
import { dictionaries } from '../../src/i18n';
for (const language of ['te','hi','en'] as const) {
  test(`${language}: home, language persistence, events, and mobile layout`, async ({page})=>{
    const errors:string[]=[];page.on('pageerror',err=>errors.push(err.message));
    await page.setViewportSize({width:1440,height:1050});
    await page.goto('/');
    await page.locator('.language-picker select').selectOption(language);
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    await expect(page.locator('h1')).toHaveText(dictionaries[language].heroTitle);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang',language);
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:`artifacts/home-${language}-desktop.png`,fullPage:true});
    await page.locator('.hero-actions .secondary').click();
    await expect(page.locator('h1')).toHaveText(dictionaries[language].eventsTitle);
    await page.locator('.event-card .text-button').first().click();
    await expect(page.locator('dialog')).toBeVisible();
    await expect(page.locator('dialog .full-width')).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog')).toHaveCount(0);
    await page.goto('/#consultations');
    await expect(page.locator('textarea')).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    await page.goto('/#home');
    await page.evaluate(()=>document.fonts.ready);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:`artifacts/home-${language}-mobile.png`,fullPage:true});
    await page.locator('.mobile-menu').click();
    await expect(page.locator('.nav')).toBeVisible();
    await page.locator('.nav a[href="#events"]').click();
    await expect(page.locator('h1')).toHaveText(dictionaries[language].eventsTitle);
    expect(errors).toEqual([]);
  });
}
test('sign-in clearly identifies browser-only demo accounts',async({page})=>{
  await page.goto('/');await page.locator('.language-picker select').selectOption('en');
  await page.locator('.header-actions .button').click();
  await expect(page.locator('dialog')).toBeVisible();
  await expect(page.locator('dialog form button')).toBeEnabled();
  await expect(page.getByRole('button',{name:'Super admin demo',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByLabel('Full name',{exact:true})).toBeVisible();
  await expect(page.locator('dialog input[type="checkbox"]')).not.toBeChecked();
});
