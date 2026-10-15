# Headless verification for Murder Train.
# Loads the built game in headless Chrome (SwiftShader GL), drives the simulation
# deterministically through window.__vce, checks streaming / gore / replay, saves screenshots.
import asyncio, json, sys, time
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5199/'
OUT = sys.argv[2] if len(sys.argv) > 2 else '/workspace/voxel-carnage-shots'
RES = {}

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        logs = []
        pg.on('console', lambda m: logs.append((m.type, m.text)))
        pg.on('pageerror', lambda e: logs.append(('pageerror', str(e))))
        await pg.goto(URL + '?autostart=1&seed=7&manual=1', wait_until='load')
        await pg.wait_for_function('window.__vce', timeout=120000)
        ev = pg.evaluate
        st = lambda: ev('window.__vce.state()')
        async def shot(name):
            await ev('window.__vce.advance(0, 1/30, true)')
            await pg.screenshot(path=f'{OUT}/{name}.png', timeout=240000)
            print('shot', name, flush=True)

        s0 = await st(); print('start', s0, flush=True)
        # 1. normal gameplay
        await ev('window.__vce.throttle(6); window.__vce.advance(5)')
        await ev("window.__vce.game.hud.select('trex')")
        await shot('01-gameplay')

        # 2. streaming: drive for 90 simulated seconds at full throttle
        await ev('window.__vce.throttle(10)')
        track = []
        for i in range(6):
            await ev('window.__vce.advance(15)')
            s = await st(); track.append(s)
            print('drive', round(s['s']), 'chunks', s['chunks'], 'biome', s['biome'], 'targets', s['targets'], 'kills', s['kills'], 'replays', s['replays'], 'pos', round(s['x']), round(s['z']), flush=True)
        RES['streaming'] = {'s_start': s0['s'], 's_end': track[-1]['s'], 'chunks_end': track[-1]['chunks'], 'z_end': track[-1]['z'], 'natural_kills': track[-1]['kills'], 'natural_replays': track[-1]['replays']}
        await ev('window.__vce.game.replay && window.__vce.game.endReplay()')

        # 3. gore: line up a herd on the track
        await ev('window.__vce.throttle(10); window.__vce.advance(1)')
        await ev("['cow','cow','person','cow'].forEach((t,i)=>window.__vce.spawn(t, 16 + i*1.5, (i%2?0.6:-0.6)))")
        await ev('window.__vce.forceReplay()')
        k0 = (await st())['kills']
        for i in range(40):
            await ev('window.__vce.advance(1/30, 1/30, false)')
            s = await st()
            if s['kills'] >= k0 + 3: break
        await ev('window.__vce.advance(0.2)')
        await ev("window.__vce.setCam('chase')")
        await shot('02-gore-chase')
        await ev("window.__vce.setCam('orbit')")
        await ev('window.__vce.advance(0.15)')
        await shot('03-gore-orbit')
        s = await st(); print('after gore', s, flush=True)
        RES['gore'] = {'kills': s['kills'] - k0, 'debris': s['debris'], 'blood': s['blood']}
        # 4. replay should auto-trigger
        for i in range(60):
            await ev('window.__vce.advance(0.1, 1/30, false)')
            s = await st()
            if s['replay']: break
        print('replay started', s['replay'], flush=True)
        await ev('window.__vce.advance(1.6)')
        await asyncio.sleep(0.8)  # let the CSS letterbox/HUD fade finish in real time
        await shot('04-replay')
        await ev('window.__vce.advance(2.2)')
        await shot('05-replay-late')
        RES['replay'] = {'triggered': s['replay']}
        for i in range(100):
            await ev('window.__vce.advance(0.2, 1/30, false)')
            if not (await st())['replay']: break
        RES['replay']['ended'] = not (await st())['replay']

        # 5. biomes + crazy stuff
        for biome, spawns in [('desert', ['trex', 'ufo', 'alien', 'alien']), ('snow', ['snowman', 'snowman', 'sheep']), ('alien', ['ufo', 'alien', 'robot', 'alien']), ('town', ['band', 'clown', 'piano', 'duck'])]:
            sB = await ev(f"window.__vce.findBiome('{biome}', window.__vce.game.train.s + 200)")
            if sB < 0: print('no biome', biome); continue
            await ev(f'window.__vce.game.replay && window.__vce.game.endReplay(); window.__vce.teleport({sB}); window.__vce.throttle(5); window.__vce.game.train.speed = 12;')
            for i, t in enumerate(spawns):
                if t == 'band':
                    await ev("window.__vce.game.spawnEvent('band', 40)")
                else:
                    await ev(f"window.__vce.spawn('{t}', {22 + i * 7}, {(-2.5 if i % 2 else 2.5)})")
            await ev('window.__vce.advance(1.0)')
            await shot(f'06-biome-{biome}')
        # 6. night
        await ev("window.__vce.night(true); window.__vce.advance(1.5)")
        await shot('07-night')
        await ev("window.__vce.night(false); window.__vce.advance(1.5)")
        print('final', await st())
        RES['console_errors'] = [l for l in logs if l[0] in ('error', 'pageerror')]
        RES['console_warnings'] = [l for l in logs if l[0] == 'warning'][:10]
        print(json.dumps(RES, indent=1, default=str))
        await b.close()

asyncio.run(main())
