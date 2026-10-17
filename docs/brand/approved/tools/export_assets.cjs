/* Render approved SVGs. Requires Playwright and a Chromium-compatible browser.
   Optional HOMEOPS_PLAYWRIGHT=absolute package path, HOMEOPS_CHROME=browser path. */
const fs=require('fs');const path=require('path');const {pathToFileURL}=require('url');
const {chromium}=require(process.env.HOMEOPS_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{const options={headless:true};if(process.env.HOMEOPS_CHROME)options.executablePath=process.env.HOMEOPS_CHROME;const b=await chromium.launch(options);const page=await b.newPage({deviceScaleFactor:1});let count=0;
async function render(input,output,w,h){await page.setViewportSize({width:w,height:h});await page.goto(pathToFileURL(path.join(root,input)).href);await page.evaluate(({w,h})=>{document.documentElement.setAttribute('width',w);document.documentElement.setAttribute('height',h);document.documentElement.style.cssText=`display:block;width:${w}px;height:${h}px`},{w,h});await page.screenshot({path:path.join(root,output),omitBackground:true});count++;}
for(const color of ['white','ink','cyan']){for(const size of [256,512,1024])await render(`logos/mark-${color}.svg`,`logos/mark-${color}-${size}.png`,size,size);for(const [kind,w,h] of [['horizontal',1520,320],['compact',1000,320],['stacked',1200,800]])await render(`logos/wordmark-${kind}-${color}.svg`,`logos/wordmark-${kind}-${color}.png`,w,h);}
for(const size of [32,48,64,96,128,180,192,256,384,512,1024])await render('icons/app-icon.svg',`icons/app-icon-${size}.png`,size,size);
await render('icons/app-icon-preview.svg','icons/app-icon-preview-1024.png',1024,1024);
await render('icons/app-icon-maskable.svg','icons/app-icon-maskable-512.png',512,512);
for(const size of [16,32,48])await render('icons/favicon.svg',`icons/favicon-${size}.png`,size,size);
for(const [name,w,h] of [['open-graph',1200,630],['social-square',1080,1080],['repository-cover',1280,640],['linkedin-banner',1584,396]])await render(`social/${name}.svg`,`social/${name}.png`,w,h);
for(const [name,w,h] of [['android-adaptive-foreground',1080,1080],['android-adaptive-background',1080,1080],['android-monochrome',1080,1080],['notification-white',96,96],['splash-foreground',512,512],['launch-preview',1170,2532]])await render(`icons/mobile/${name}.svg`,`icons/mobile/${name}.png`,w,h);
await render('social/play-store-feature.svg','social/play-store-feature.png',1024,500);
fs.copyFileSync(path.join(root,'icons/app-icon-180.png'),path.join(root,'icons/apple-touch-icon.png'));
fs.copyFileSync(path.join(root,'icons/app-icon-512.png'),path.join(root,'icons/avatar-512.png'));
await b.close();console.log(`Exported ${count} PNGs plus touch and avatar aliases.`);
})().catch(error=>{console.error(error);process.exit(1)});
