import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('https://example.com');
const r = await p.evaluate(() => {
  const out = {};
  localStorage.clear();
  // fill to quota with 64KB chunks then 1KB then 1 byte
  const fill = (n, chunk) => { let i=0; try { for(;;){ localStorage.setItem('pad'+n+'_'+(i++), 'x'.repeat(chunk)); } } catch(e){ return i; } };
  out.big = fill(0, 65536); out.k = fill(1, 1024); out.one = fill(2, 1);
  out.usage = Object.keys(localStorage).reduce((a,k)=>a+k.length+localStorage.getItem(k).length,0);
  // now full. existing key overwrite, same size

  return out;
});
console.log(r);
const r2 = await p.evaluate(() => {
  const out = {};
  // pick an existing 1024-byte key
  const key = Object.keys(localStorage).find(k=>k.startsWith('pad1_'));
  try { localStorage.setItem(key, 'z'.repeat(1024)); out.sameSize = 'ok'; } catch(e){ out.sameSize = e.name; }
  try { localStorage.setItem(key, 'z'.repeat(1023)); out.shorter = 'ok'; } catch(e){ out.shorter = e.name; }
  try { localStorage.setItem(key, 'z'.repeat(1025)); out.longer = 'ok'; } catch(e){ out.longer = e.name; }
  try { localStorage.setItem('brandnewkey', 'z'.repeat(120)); out.newKey120 = 'ok'; } catch(e){ out.newKey120 = e.name; }
  return out;
});
console.log(r2);
await b.close();
