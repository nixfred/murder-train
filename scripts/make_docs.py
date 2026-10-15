# Builds README art: a banner rendered from the live game + compressed gameplay screenshots.
import asyncio, base64, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
SHOTS = '/workspace/voxel-carnage-shots'
URL = 'http://localhost:5199/'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

BANNER_HTML = """<!doctype html><html><head><style>
body{margin:0;width:1600px;height:560px;overflow:hidden;font-family:Inter,'Segoe UI',system-ui,sans-serif;background:#000}
.bg{position:absolute;inset:0;background:url(data:image/png;base64,%s) center/cover}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,8,12,.88) 0%%,rgba(8,8,12,.55) 38%%,rgba(8,8,12,0) 62%%),linear-gradient(0deg,rgba(0,0,0,.45),transparent 30%%)}
.box{position:absolute;left:70px;top:100px;width:720px}
.badges{display:flex;gap:8px}
.b{font-size:15px;font-weight:600;padding:4px 12px;border-radius:999px;border:1px solid;background:rgba(0,0,0,.4)}
.o{color:#ffb36b;border-color:rgba(255,170,90,.55)}.bl{color:#7cc4ff;border-color:rgba(110,180,255,.55)}.g{color:#7be0a0;border-color:rgba(110,220,150,.5)}.r{color:#ff7a7a;border-color:rgba(255,110,110,.55)}
h1{margin:18px 0 10px;font-size:84px;line-height:.95;font-weight:900;letter-spacing:-2px;background:linear-gradient(90deg,#ff9f45,#ffd4a3 75%%);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 4px 18px rgba(0,0,0,.5))}
p{margin:0;font-size:24px;color:#e2e2ea;line-height:1.35;text-shadow:0 2px 10px rgba(0,0,0,.6)}
p b{color:#f5b301}
.stamp{position:absolute;right:46px;bottom:38px;transform:rotate(-8deg);font-weight:900;font-size:40px;font-style:italic;color:#fff;text-shadow:0 4px 0 #b3262a,0 10px 30px rgba(0,0,0,.6)}
</style></head><body><div class="bg"></div><div class="shade"></div>
<div class="box"><div class="badges"><span class="b o">three.js r186</span><span class="b bl">InstancedMesh</span><span class="b g">WebAudio synth</span><span class="b r">Cartoon gore</span></div>
<h1>Voxel Carnage<br>Express</h1><p>An endless procedural voxel railroad.<br>Drive the train. <b>Run everything over.</b></p></div>
<div class="stamp">SPLAT! x10</div></body></html>"""

async def main():
    from playwright.async_api import async_playwright
    os.makedirs(DOCS, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', headless=True, args=ARGS)
        pg = await b.new_page(viewport={'width': 1600, 'height': 560})
        await pg.goto(URL + '?autostart=1&seed=7&manual=1&clean=1')
        await pg.wait_for_function('window.__vce')
        ev = pg.evaluate
        await ev('window.__vce.throttle(6); window.__vce.advance(4)')
        await ev("""(() => { const v = window.__vce, g = v.game;
          ['cow','cow','duck','person','cow'].forEach((t,i) => v.spawn(t, 14 + i * 4, i % 2 ? 2.5 : -2.2));
          v.advance(0.4);
          const L = g.train.loco.position, d = g.trainDir();
          g.camMode = 'cinematic';
          g.camera.position.set(L.x + d.z * 11 + d.x * 16, L.y + 5.5, L.z - d.x * 11 + d.z * 16);
          g.camera.lookAt(L.x + d.x * 8 - d.z * 4, L.y + 1.5, L.z + d.z * 8 + d.x * 4);
        })()""")
        await ev('window.__vce.advance(0, 1/30, true)')
        bg = await pg.screenshot(timeout=240000)
        page2 = await b.new_page(viewport={'width': 1600, 'height': 560})
        await page2.set_content(BANNER_HTML % base64.b64encode(bg).decode())
        await page2.screenshot(path=os.path.join(DOCS, 'banner.png'))
        print('banner done')
        # close-up gore moment for the README
        pg3 = await b.new_page(viewport={'width': 1440, 'height': 900})
        await pg3.goto(URL + '?autostart=1&seed=11&manual=1')
        await pg3.wait_for_function('window.__vce')
        e3 = pg3.evaluate
        await e3('window.__vce.throttle(10); window.__vce.advance(6)')
        await e3('''(() => { const v = window.__vce, g = v.game;
          g.replayCooldown = 1e9;
          ['trex','cow','person','cow'].forEach((t,i) => v.spawn(t, 22 + i * 2.2, i % 2 ? 0.5 : -0.4));
          const tp = g.track.at(g.train.s + 24);
          const cp = g.track.at(g.train.s + 36); window.__cam = { x: cp.x - cp.dz * 2.2, z: cp.z + cp.dx * 2.2, lx: tp.x - tp.dx * 4, lz: tp.z - tp.dz * 4 };
        })()''')
        for i in range(60):
            await e3('window.__vce.advance(1/30, 1/30, false)')
            if (await e3('window.__vce.state()'))['kills'] >= 2: break
        await e3('window.__vce.advance(0.12, 1/30, false)')
        await e3('''(() => { const g = window.__vce.game, c = window.__cam; g.camMode = 'cine';
          g.camera.position.set(c.x, 1.8, c.z); g.camera.lookAt(c.lx, 1.9, c.lz); })()''')
        await e3('window.__vce.advance(0, 1/30, true)')
        await pg3.screenshot(path=SHOTS + '/08-gore-closeup.png', timeout=240000)
        print('closeup done')
        await b.close()
def compress():
    # compress gameplay shots into docs/ (needs Pillow)
    from PIL import Image
    for name in sorted(os.listdir(SHOTS)):
        if not name.endswith('.png'): continue
        im = Image.open(os.path.join(SHOTS, name)).convert('RGB')
        im.thumbnail((1280, 1280))
        im.save(os.path.join(DOCS, name.replace('.png', '.jpg')), quality=84, optimize=True)
        print('doc', name)

if __name__ == '__main__':
    if '--shots-only' in sys.argv: compress()
    else: asyncio.run(main())
