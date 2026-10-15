# Headless check of the Murder Train intro: cozy gate -> cozy demo -> SPLAT -> title -> gameplay.
import asyncio, json, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5199/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/workspace/voxel-carnage-shots'

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=user-gesture-required'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        logs = []
        pg.on('console', lambda m: logs.append((m.type, m.text)))
        pg.on('pageerror', lambda e: logs.append(('pageerror', str(e))))
        await pg.goto(URL + '?seed=7&manual=1', wait_until='load')
        await pg.wait_for_function('window.__vce')
        ev = pg.evaluate
        st = lambda: ev('window.__vce.state()')
        async def shot(name, wait=0.0):
            if wait: await asyncio.sleep(wait)
            await ev('window.__vce.advance(0, 1/30, true)')
            await pg.screenshot(path=f'{OUT}/{name}.png', timeout=240000)
            s = await st(); print('shot', name, {k: s[k] for k in ('intro', 'music', 'audio', 'started', 'kills')}, flush=True)
            return s
        await ev('window.__vce.advance(1.5)')
        await shot('10-intro-gate')
        await pg.click('#cozy-go')
        await ev('window.__vce.advance(2.5)')
        r = {'cozy': await shot('11-intro-cozy', 0.8)}
        for i in range(400):
            await ev('window.__vce.advance(1/30, 1/30, false)')
            if (await st())['intro'] == 'splat': break
        await ev('window.__vce.advance(0.06, 1/30, false)')
        r['splat'] = await shot('12-intro-splat', 0.1)
        for i in range(200):
            await ev('window.__vce.advance(1/30, 1/30, false)')
            if (await st())['intro'] == 'title': break
        await ev('window.__vce.advance(1.0, 1/30, false)')
        r['title'] = await shot('13-intro-title', 3.2)
        await pg.keyboard.press('Enter')
        await ev('window.__vce.advance(2.5)')
        r['game'] = await shot('14-intro-gameplay', 1.5)
        print(json.dumps({k: {kk: v[kk] for kk in ('intro', 'music', 'audio', 'started', 'kills')} for k, v in r.items()}))
        print('errors/warnings:', [l for l in logs if l[0] in ('error', 'pageerror', 'warning')])
        await b.close()
asyncio.run(main())
