import {test,expect,type Page} from '@playwright/test';
async function start(page:Page){await page.goto('/?demo=1');await page.locator('.language-picker select').selectOption('en');}
async function login(page:Page,role:'Super admin'|'User'|'Sub-Ayyagaru'){
  await page.locator('.demo-toolbar button').first().click();await page.getByRole('button',{name:`${role} demo`,exact:true}).click();
  await expect(page.locator('.dashboard-greeting')).toBeVisible();
  await expect(page.locator('dialog')).toHaveCount(0);
}
test('all roles work offline: guidance, upload, persistence, and admin promotion',async({page})=>{
  const external:string[]=[];page.on('request',request=>{const url=new URL(request.url());if(url.hostname.endsWith('.supabase.co')||url.port==='8000'||url.hostname.includes('aisensy'))external.push(request.url());});
  await start(page);await login(page,'User');
  await expect(page.locator('h1')).toContainText('Ananya');
  await expect(page.getByText('Guidance from Ayyagaru',{exact:true})).toBeVisible();
  await page.locator('.request-card .text-button').first().click();await expect(page.locator('dialog img')).toBeVisible();await page.keyboard.press('Escape');
  await page.goto('/?demo=1#consultations');
  await page.locator('input[type=file]').setInputFiles('public/images/devotional-hero.png');
  await page.locator('textarea[name=notes]').fill('Browser-only uploaded request');await page.getByRole('button',{name:'Submit request',exact:true}).click();
  await expect(page.getByText('Browser-only uploaded request',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Browser-only uploaded request',{exact:true})).toBeVisible();
  await login(page,'Sub-Ayyagaru');
  const card=page.locator('.request-card').filter({hasText:'I would like guidance on my career'});
  await card.locator('textarea').fill('Demo response from the assigned Ayyagaru.');await card.getByRole('button',{name:'Complete consultation',exact:true}).click();
  await expect(page.locator('.request-card').filter({hasText:'Browser-only uploaded request'}).locator('.badge')).toHaveText('Assigned to Ayyagaru');
  await login(page,'User');await expect(page.getByText('Demo response from the assigned Ayyagaru.',{exact:true})).toBeVisible();
  await login(page,'Super admin');
  await page.locator('input[name=phone]').fill('9000000004');await page.getByRole('button',{name:'Add to team',exact:true}).click();
  await expect(page.locator('.team-list')).toContainText('Ravi');
  const newRequest=page.locator('.request-card').filter({hasText:'Browser-only uploaded request'});
  await newRequest.locator('select').selectOption('demo-member');await newRequest.getByRole('button',{name:'Assign',exact:true}).click();
  await expect(newRequest).toContainText('Assigned Ayyagaru: Ravi');
  await page.screenshot({path:'artifacts/demo-admin.png',fullPage:true});
  expect(external).toEqual([]);
});
test('free bookings issue invitations, paid requests stay pending, and demo can reset',async({page})=>{
  await start(page);await login(page,'User');await page.goto('/?demo=1#events');
  await page.locator('.event-card .text-button').first().click();await page.getByRole('button',{name:'Book a place',exact:true}).click();
  await page.getByRole('button',{name:'Invitation',exact:true}).click();await expect(page.locator('.invitation .badge')).toHaveText('Confirmed');await page.keyboard.press('Escape');
  await page.goto('/?demo=1#events');await page.locator('.event-card .text-button').nth(1).click();await page.getByRole('button',{name:'Book a place',exact:true}).click();
  await expect(page.locator('.request-card').filter({hasText:'An evening of devotion'})).toContainText('A ticket has not been issued.');
  await expect(page.getByRole('button',{name:'Invitation',exact:true})).toHaveCount(1);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Reset demo',exact:true}).click();
  await expect(page.getByText('Demo restored to the sample data.',{exact:true})).toBeVisible();
  await login(page,'User');await expect(page.getByText('Your event bookings will appear here.',{exact:true})).toBeVisible();
});
test('admin creates a three-language event and publishes a simulated notification',async({page})=>{
  await start(page);await login(page,'Super admin');await page.getByRole('button',{name:/Create event/}).first().click();
  for(const lang of ['te','hi','en']){
    await page.locator(`input[name=title_${lang}]`).fill(`Demo event ${lang}`);
    await page.locator(`textarea[name=description_${lang}]`).fill(`Demo description ${lang}`);
    await page.locator(`input[name=venue_${lang}]`).fill(`Demo venue ${lang}`);
  }
  const date=new Date(Date.now()+20*86400000).toISOString().slice(0,16);
  await page.locator('input[name=date]').fill(date);await page.locator('.event-editor button[type=submit],.event-editor button.button').click();
  const event=page.locator('.admin-events .request-card').filter({hasText:'Demo event en'});
  await event.getByRole('button',{name:'Publish event',exact:true}).click();await expect(event).toContainText('Published');
  await page.reload();await expect(page.locator('.queue-row')).toHaveCount(2);
  await page.goto('/?demo=1#events');await expect(page.getByText('Demo event en',{exact:true})).toBeVisible();
});
test('manual demo password and OTP recovery work without SMS',async({page})=>{
  await start(page);await page.locator('.header-actions .button').click();
  await page.locator('dialog input[type=tel]').fill('9000000001');await page.locator('dialog input[type=password]').fill('wrong-password');
  await page.locator('dialog form button').click();await expect(page.locator('dialog .error')).toBeVisible();
  await page.locator('dialog input[type=password]').fill('Demo@12345');await page.locator('dialog form button').click();await expect(page.locator('h1')).toContainText('Main Ayyagaru');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('.header-actions .button').click();
  await page.getByRole('button',{name:'Forgot password?',exact:true}).click();await page.locator('dialog input[type=tel]').fill('9000000003');await page.getByRole('button',{name:'Send OTP',exact:true}).click();
  await page.locator('dialog input[autocomplete=one-time-code]').fill('000000');await page.getByRole('button',{name:'Verify & continue',exact:true}).click();await expect(page.locator('dialog .error')).toBeVisible();
  await page.locator('dialog input[autocomplete=one-time-code]').fill('123456');await page.getByRole('button',{name:'Verify & continue',exact:true}).click();
  await page.locator('dialog input[type=password]').fill('DemoNew@12345');await page.getByRole('button',{name:'Save new password',exact:true}).click();await expect(page.locator('h1')).toContainText('Ananya');
});
