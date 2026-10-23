// Captures dashboard screenshots for the README against a running stack.
//
//   npm run sim:up                 # or sim:dev — stack must be up
//   node docs/screenshot.mjs       # writes docs/*.png
//
// Requires Playwright + Chromium:
//   npm i -D playwright && npx playwright install chromium
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DOCS = dirname(fileURLToPath(import.meta.url));

const SHOTS = [
    {
        name: 'sim-dashboard.png',
        url: 'http://localhost:8080/',
        viewport: { width: 1180, height: 980 },
        settleMs: 1500,
    },
];

const main = async () => {
    const browser = await chromium.launch();
    try {
        for (const shot of SHOTS) {
            const page = await browser.newPage({ viewport: shot.viewport });
            // Not 'networkidle': the dashboard holds an SSE stream open, so
            // the network is never idle.
            await page.goto(shot.url, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(shot.settleMs);
            const out = join(DOCS, shot.name);
            await page.screenshot({ path: out, fullPage: true });
            console.log('wrote', out);
            await page.close();
        }
    } finally {
        await browser.close();
    }
};

main().catch(err => {
    console.error(err);
    process.exit(1);
});
