import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ acceptDownloads: true });
const p = await ctx.newPage();
const receipts = [];
p.on('download', async d => { if (d.suggestedFilename().includes('receipt')) {
  const s = await d.createReadStream(); let t=''; for await (const c of s) t+=c; receipts.push(JSON.parse(t)); } else { await d.path(); }});
await p.goto('file:///Users/kodywildfeuer/workroom/index.html');
await p.waitForTimeout(1200);
const runOnce = async () => { await p.click('#dryrun');
  for (let i=0;i<240;i++){ const t=await p.textContent('#dryrun'); if(i>5&&t.includes('Dry run')) break; await p.waitForTimeout(500);} };
await runOnce();
const s1 = await p.evaluate(()=>({n:outbox.length, status:document.getElementById('status')?.textContent}));
// second run: move some cards back so there is work
await p.waitForTimeout(800);
await runOnce();
await p.waitForTimeout(800);
const s2 = await p.evaluate(()=>({n:outbox.length, status:document.getElementById('status')?.textContent}));
console.log(JSON.stringify({run1:s1, run2:s2,
  receipt2_artifacts: receipts[1]? receipts[1].artifacts.length : 'no 2nd receipt',
  receipt1_artifacts: receipts[0]? receipts[0].artifacts.length : null}, null, 2));
// third: mid-run manual stop message
await p.click('#dryrun'); await p.waitForTimeout(1000);
await p.click('#dryrun'); await p.waitForTimeout(500);
console.log('manual-stop status:', await p.evaluate(()=>document.getElementById('status')?.textContent));
await b.close();
