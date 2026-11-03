import { test, expect } from '@playwright/test';
import { onRequest } from '../functions/api/licensing/[[path]]';

test('a forged checkout return does not grant Pro', async ({ page }) => {
  await page.route('**/api/licensing/**', route => route.fulfill({ json: { authenticated: false, pro: false } }));
  await page.goto('/?framecut_checkout=success');
  await expect(page.getByRole('button', { name: 'FrameCut account', exact: true })).toContainText('Free');
  await expect(page.getByRole('button', { name: 'Email me a sign-in code' })).toBeVisible();
});

test('an entitlement recheck removes stale Pro before export', async ({ page }) => {
  let revoked = false;
  await page.route('**/api/licensing/**', route => route.fulfill({ json: {
    authenticated: true, email: 'owner@example.com', csrf: 'fixture', pro: !revoked,
    session_id: 'one', session_active: true, lease_until: Math.floor(Date.now()/1000)+120,
    licenses: [], sessions: [],
  } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'FrameCut account', exact: true })).toContainText('Pro');
  revoked = true;
  const access = await page.evaluate(async () => {
    const path = '/src/auth/licenseClient.ts';
    return (await import(path)).licensing.exportAccess();
  });
  expect(access).toBe(false);
  await expect(page.getByRole('button', { name: 'FrameCut account', exact: true })).toContainText('Free');
});

test('proxy rejects upstream redirects and forwards only the licensing cookie', async () => {
  const response = await onRequest({ request: new Request('https://web.example/api/licensing/account', { headers: { Cookie: '__Host-framecut_session=fixture; unrelated=private' } }), env: {
    LICENSING_ORIGIN: 'https://license.example', WEB_PROXY_TOKEN: 'fixture', LICENSING: { fetch: async request => {
      expect(request.redirect).toBe('manual');
      expect(request.headers.get('Cookie')).toBe('__Host-framecut_session=fixture');
      return new Response(null, { status: 302, headers: { Location: 'https://attacker.example' } });
    } },
  }, params: { path: ['account'] } });
  expect(response.status).toBe(502);
  expect(response.headers.get('Location')).toBeNull();
});

test('proxy rejects cross-origin posts before forwarding credentials', async () => {
  const response = await onRequest({request:new Request('https://web.example/api/licensing/redeem',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'}),env:{LICENSING_ORIGIN:'https://license.example',WEB_PROXY_TOKEN:'test-only'},params:{path:['redeem']}});
  expect(response.status).toBe(403);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});

test('verified sign-in, redemption, release and explicit resume update Pro', async ({ page }) => {
  let signedIn=false, redeemed=false, released=false;
  const calls:{path:string;body:any;csrf:string|undefined}[]=[];
  const account=()=>({authenticated:signedIn,email:'owner@example.com',csrf:'csrf-fixture',session_id:'browser-a',session_active:!released,session_released:released,lease_until:Math.floor(Date.now()/1000)+120,pro:signedIn&&redeemed&&!released,sandbox:true,licenses:redeemed?[{id:'license-a',status:'active',edition:'pro',billing_kind:'perpetual',ent_exp:null,updates_until:1,key_suffix:'ABCD'}]:[],sessions:released?[]:[{id:'browser-a',label:'Chrome on macOS',last_seen:1}]});
  await page.route('**/api/licensing/**',async route=>{
    const path=new URL(route.request().url()).pathname.split('/api/licensing/')[1];
    const body=route.request().postDataJSON();
    calls.push({path,body,csrf:route.request().headers()['x-framecut-csrf']});
    if(path==='signin/request')return route.fulfill({json:{challenge_id:'challenge-fixture'}});
    if(path==='signin/verify'){expect(body).toEqual({challenge_id:'challenge-fixture',code:'12345678'});signedIn=true;}
    if(path==='redeem'){expect(body.key).toBe('FRAMECUT-TEST');redeemed=true;return route.fulfill({json:{ok:true}});}
    if(path==='release'){released=true;return route.fulfill({json:{ok:true}});}
    if(path==='resume')released=false;
    if(path==='logout'){signedIn=false;return route.fulfill({json:{ok:true}});}
    return route.fulfill({json:account()});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'FrameCut account',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'FrameCut account'});
  await dialog.getByLabel('Purchase email').fill('owner@example.com');
  await dialog.getByRole('button',{name:'Email me a sign-in code'}).click();
  await dialog.getByLabel('Sign-in code',{exact:true}).fill('12345678');
  await dialog.getByRole('button',{name:'Verify and sign in'}).click();
  await expect(dialog.getByText('owner@example.com',{exact:true})).toBeVisible();
  await dialog.getByLabel('Redeem your license',{exact:true}).fill('FRAMECUT-TEST');
  await dialog.getByRole('button',{name:'Redeem license',exact:true}).click();
  await expect(dialog.getByText('Pro active',{exact:false})).toBeVisible();
  expect(calls.find(call=>call.path==='redeem')?.csrf).toBe('csrf-fixture');
  await expect(dialog.getByText('Web Pro continues after desktop update coverage ends.')).toBeVisible();
  await dialog.getByRole('button',{name:'Release session',exact:true}).click();
  await expect(dialog.getByText('Free exports',{exact:false})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Resume this browser'})).toBeVisible();
  await dialog.getByRole('button',{name:'Resume this browser'}).click();
  await expect(dialog.getByText('Pro active',{exact:false})).toBeVisible();
  await dialog.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Email me a sign-in code'})).toBeVisible();
});

test('third browser stays Free and exposes account recovery controls', async ({page})=>{
  await page.route('**/api/licensing/**',route=>route.fulfill({json:{authenticated:true,email:'owner@example.com',csrf:'fixture',pro:false,session_id:'third',session_active:false,session_released:false,lease_until:0,licenses:[],sessions:[{id:'first',label:'Chrome on macOS',last_seen:1},{id:'second',label:'Firefox on Windows',last_seen:1}]}}));
  await page.goto('/'); await page.getByRole('button',{name:'FrameCut account',exact:true}).click();
  await expect(page.getByText('Two browser sessions may be active at once.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Release session',exact:true})).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Resume this browser'})).toBeVisible();
  await expect(page.getByRole('button',{name:'FrameCut account',exact:true})).toContainText('Free');
});

test('Free dimensions and watermark change the rendered pixels; Pro permits 4K',async({page})=>{
  await page.route('**/api/licensing/**',route=>route.fulfill({json:{authenticated:false,pro:false}}));
  await page.goto('/');
  const output=await page.evaluate(async()=>{
    const {outputSize,watermarkCanvas,drawExportWatermark,screenshotCanvas}=await import('/utils/licenseExport.ts');
    const free=outputSize(1920,1080,false,2160), pro=outputSize(1920,1080,true,2160);
    const canvas=document.createElement('canvas');canvas.width=free.width;canvas.height=free.height;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    const mark=watermarkCanvas(canvas.width,canvas.height);drawExportWatermark(ctx,mark);
    const pixel=Array.from(ctx.getImageData(canvas.width-mark.width-17,canvas.height-mark.height-17,1,1).data);
    const source=document.createElement('canvas');source.width=1920;source.height=1080;
    source.getContext('2d')!.fillStyle='white';source.getContext('2d')!.fillRect(0,0,1920,1080);
    const image=screenshotCanvas(source,false), paid=screenshotCanvas(source,true);
    const imageMark=watermarkCanvas(image.width,image.height);
    return{image:{width:image.width,height:image.height,pixel:image.getContext('2d')!.getImageData(image.width-imageMark.width-17,image.height-imageMark.height-17,1,1).data[0]},paid:{width:paid.width,height:paid.height},free,pro,pixel,untouched:Array.from(ctx.getImageData(10,10,1,1).data)};
  });
  expect(output.image.width).toBe(1280); expect(output.image.height).toBe(720); expect(output.image.pixel).toBeLessThan(200);
  expect(output.paid).toEqual({width:1920,height:1080});
  expect(output.free).toEqual({width:1280,height:720});
  expect(output.pro).toEqual({width:3840,height:2160});
  expect(output.pixel[0]).toBeLessThan(200);expect(output.untouched).toEqual([255,255,255,255]);
});
