// Captures the README screenshots against a running stack.
//
//   npm run sim:up                 # or sim:dev — stack must be up
//   node docs/screenshot.mjs       # writes docs/*.png
//
// Requires Playwright + Chromium (not a devDependency):
//   npm i --no-save playwright && npx playwright install chromium
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DOCS = dirname(fileURLToPath(import.meta.url));
const NODE_RED = 'http://localhost:1880/';

// Example-flow inject nodes (examples/basic-control.json) fired before the
// editor shot, so the gree node shows "connected" and the debug sidebar has
// a write acknowledgement, a diagnostic and an action response in it.
const INJECTS = ['a1c0de0000000002', 'a1c0de0000000012'];

const SHOTS = [
    {
        name: 'example-flow.png',
        url: NODE_RED,
        viewport: { width: 1600, height: 820 },
        fullPage: false,
        prepare: async page => {
            await page.waitForSelector('.red-ui-flow-node', { timeout: 30000 });
            // First-run dialogs that cover the canvas: the update-notification
            // prompt and the welcome tour (its first button is the close ×).
            // Either can show, one after the other, on a fresh container.
            const dialogs = [
                page.getByRole('button', {
                    name: /do not enable notifications/i,
                }),
                page
                    .locator(
                        '.red-ui-tourGuide-popover .red-ui-popover-content button'
                    )
                    .first(),
            ];
            for (let round = 0; round < 3; round++) {
                await page.waitForTimeout(1500);
                for (const close of dialogs) {
                    if (await close.isVisible().catch(() => false)) {
                        await close.click();
                    }
                }
            }
            await page.evaluate(() => globalThis.RED.sidebar.show('debug'));
            for (const id of INJECTS) {
                await page.evaluate(
                    inject => fetch('inject/' + inject, { method: 'POST' }),
                    id
                );
                await page.waitForTimeout(1500);
            }
        },
    },
    {
        name: 'sim-dashboard.png',
        url: 'http://localhost:8080/',
        viewport: { width: 1180, height: 980 },
        fullPage: true,
    },
];

const main = async () => {
    const browser = await chromium.launch();
    try {
        for (const shot of SHOTS) {
            const page = await browser.newPage({
                viewport: shot.viewport,
                locale: 'en-US',
            });
            // Not 'networkidle': the dashboard holds an SSE stream and the
            // editor a websocket open, so the network is never idle.
            await page.goto(shot.url, { waitUntil: 'domcontentloaded' });
            if (shot.prepare) {
                await shot.prepare(page);
            }
            await page.waitForTimeout(1500);
            const out = join(DOCS, shot.name);
            await page.screenshot({ path: out, fullPage: shot.fullPage });
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
