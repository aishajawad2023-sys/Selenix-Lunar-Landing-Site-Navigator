// Render deck.html and document.html to PDF with headless Chromium. Run: node docs/pitch/render_pdf.js
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const here = __dirname;
  const deck = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await deck.goto('file://' + path.join(here, 'deck.html'), { waitUntil: 'networkidle' });
  await deck.evaluate(() => document.fonts.ready);
  await deck.pdf({ path: path.join(here, 'SELENIX_Technical_Review_Deck.pdf'), width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
  const doc = await b.newPage();
  await doc.goto('file://' + path.join(here, 'document.html'), { waitUntil: 'networkidle' });
  await doc.evaluate(() => document.fonts.ready);
  const foot = '<div style="width:100%;font:7.5pt Inter,sans-serif;color:#7d8592;padding:0 18mm;display:flex;justify-content:space-between"><span style="letter-spacing:.25em;font-weight:700">SELENIX</span><span>Technical document · <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>';
  await doc.pdf({ path: path.join(here, 'SELENIX_Technical_Document.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: foot, margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' } });
  await b.close();
  console.log('PDFs written');
})();
