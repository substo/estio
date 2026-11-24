# Motion graphics you design yourself

For anything the title presets cannot do (kinetic type, a stat that counts up, a chart that builds itself, a lower third that
slides, a logo sting), write the graphic as one HTML file, render it with `substo graphic`, and place the clip. Presets are
still the right tool for plain titles and captions ([broll-and-titles.md](broll-and-titles.md)); reach for this when the idea
needs more than a preset.

## The loop

1. **Write** `./graphic-<n>.html` in the project folder (Write tool, relative path, `graphic-*.html` only).
2. **Look**: `substo graphic frame graphic-<n>.html --at <seconds> -o graphic-<n>-a.png --size 1920x1080`, then view the image.
   Check the first, middle and last moment. Fix and look again until each frame is right.
3. **Render**: `substo graphic render graphic-<n>.html --duration <s> --size 1920x1080` writes `graphic-<n>.mov`, ProRes 4444
   with alpha. `--size 1080x1920` for a portrait video. Up to 3840x2160, 60 s, 12 to 60 fps.
4. **Place** it like any overlay, on the Graphics track by ID (find it with `substo timeline`), for the moment it belongs to:
   `{"placeMedia": {"mediaIDs": ["<id of graphic-<n>.mov>"], "at": 12.4, "duration": 3, "videoTrackID": "<Graphics track id>"}}`
   (run `substo media --refresh` first so the new file is in the project). Without `videoTrackID` it lands on the lowest track, under the video.
5. **Check** the composed frame: `substo frame <time> -o /tmp/f.png`. When the creator asks for a change, edit the HTML, render
   again (same name), and `updateClip`/replace the clip. Never leave the old render on the timeline.

## The rules a graphic must follow

- **Everything is a pure function of time.** The page defines `window.seek(t)` (seconds) and draws the whole frame from `t`
  alone. No CSS transitions or animations, no `setTimeout`/`setInterval`/`requestAnimationFrame` loops, no unseeded
  `Math.random` (seed your own), no `Date.now()`. Easing and springs are closed-form (below). `seek` may be async.
- **Transparent**: no background on `html` or `body`. Only the elements you draw are visible. The clip lays over the video.
- **Avoid top-level names the window already owns** (`top`, `name`, `parent`, `length`, `status`, `event`): a `const` with one of those names rejects the whole script and `seek` is never defined.
- **Self-contained**: inline SVG, CSS and canvas, system fonts, or files in the project folder. The network is blocked.
- **Scale from the frame**: `const W = innerWidth, H = innerHeight, u = Math.min(W, H) / 1080;` and size everything in `u`, so the
  same file works at 1920x1080 and 1080x1920.
- Text at least `48 * u` tall, inside safe margins (about 5%; portrait: 150 px top and 170 px bottom for platform UI), never over
  the captions, a few words at a time. Use the numbers, names and words from the script exactly. **Never invent a figure.**
- **Banned** (the generic "AI look"): particle bursts, glows and lens flares, RGB split, camera shake, crossfades as the only
  transition, bouncy easing everywhere, dead time, a template look with no point of view. One entrance style per video.
- End with a hold of at least 1 to 1.5 s so the idea can be read, then (optionally) a short exit.

## How to brief yourself (the five parts)

Before writing, decide: **Inputs** (the exact words, numbers, colours, format, length: use the creator's Look settings and say
what you assumed); **Direction** (style in numbers: durations, easing, sizes; one line on what premium looks like here and one
on what generic looks like); **Structure** (timed beats: 0.0 to 0.4 s in, hold, exit); **Build** (this file's rules);
**Check** (look at one frame per beat, fix overlaps, clipped text and anything generic; confirm the last frame holds).
Then one critique round as a senior motion designer (hierarchy, timing, rushed or lingering moments, type fighting motion), fix
it all in one pass, re-check what changed, and stop.

## Easing helpers (paste at the top of the script)

```js
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, start, dur) => clamp((t - start) / dur);          // 0 to 1 over [start, start + dur]
const outCubic = p => 1 - Math.pow(1 - p, 3);
const inOutCubic = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
const outBack = (p, s = 1.2) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);   // a little overshoot, once
const lerp = (a, b, p) => a + (b - a) * p;
```

## Starters

Copy one, change `P` (the variables: words, colours, timings), keep `seek`. All four are transparent and use the helpers above.

### Kinetic title (one to four words, each landing in turn)

```html
<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}
#s{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:.28em;font:900 calc(var(--u)*150px) "Helvetica Neue",Arial,sans-serif;text-transform:uppercase;color:var(--fg);letter-spacing:-.01em}
.w{display:inline-block;padding:.04em .22em;will-change:transform}</style><div id="s"></div>
<script>
const P = { words: ["Stop", "scrolling"], fg: "#111111", accent: "#facc15", start: 0.1, step: 0.22, enter: 0.3, hold: 1.4, exit: 0.25 };
const W = innerWidth, H = innerHeight, u = Math.min(W, H) / 1080;
document.documentElement.style.setProperty("--u", u); document.documentElement.style.setProperty("--fg", P.fg);
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)),prog=(t,s,d)=>clamp((t-s)/d),outBack=(p,s=1.2)=>1+(s+1)*Math.pow(p-1,3)+s*Math.pow(p-1,2),outCubic=p=>1-Math.pow(1-p,3);
const root = document.getElementById("s");
const els = P.words.map(w => { const e = document.createElement("span"); e.className = "w"; e.textContent = w; e.style.background = P.accent; root.appendChild(e); return e; });
const total = P.start + (P.words.length - 1) * P.step + P.enter + P.hold + P.exit;
window.seek = t => els.forEach((e, i) => {
  const a = prog(t, P.start + i * P.step, P.enter), out = prog(t, total - P.exit, P.exit);
  e.style.opacity = clamp(a * 3) * (1 - outCubic(out));
  e.style.transform = `translateY(${(1 - outBack(a)) * 60 * u}px) scale(${.85 + .15 * outBack(a)})`;
}); seek(0);
</script>
```

### Stat reveal (a number counting up with its label)

```html
<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}
#s{position:absolute;left:8%;top:50%;transform:translateY(-50%);font-family:"Helvetica Neue",Arial,sans-serif;color:var(--fg)}
#n{font-weight:900;font-size:calc(var(--u)*260px);line-height:1;letter-spacing:-.03em}#l{font-weight:600;font-size:calc(var(--u)*64px);margin-top:.2em}
#bar{height:calc(var(--u)*10px);background:var(--accent);margin-top:calc(var(--u)*18px);transform-origin:left}</style>
<div id="s"><div id="n"></div><div id="bar"></div><div id="l"></div></div>
<script>
const P = { value: 312, prefix: "+", suffix: "%", label: "more reach in 30 days", fg: "#ffffff", accent: "#10b981", countStart: 0.1, count: 1.2, hold: 1.5, exit: 0.3, decimals: 0 };
const W = innerWidth, H = innerHeight, u = Math.min(W, H) / 1080;
const r = document.documentElement.style; r.setProperty("--u", u); r.setProperty("--fg", P.fg); r.setProperty("--accent", P.accent);
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)),prog=(t,s,d)=>clamp((t-s)/d),outCubic=p=>1-Math.pow(1-p,3),inOut=p=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
const n = document.getElementById("n"), bar = document.getElementById("bar"), l = document.getElementById("l"); l.textContent = P.label;
const total = P.countStart + P.count + P.hold + P.exit;
window.seek = t => {
  const c = outCubic(prog(t, P.countStart, P.count)), out = prog(t, total - P.exit, P.exit);
  n.textContent = P.prefix + (P.value * c).toFixed(P.decimals) + P.suffix;
  bar.style.transform = `scaleX(${inOut(prog(t, P.countStart, P.count))})`;
  l.style.opacity = prog(t, P.countStart + P.count * .6, .4);
  document.getElementById("s").style.opacity = 1 - outCubic(out);
}; seek(0);
</script>
```

### Bar chart (bars grow in order, the top one highlighted)

```html
<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}
#s{position:absolute;left:10%;right:10%;top:18%;bottom:14%;display:flex;align-items:flex-end;gap:4%;font-family:"Helvetica Neue",Arial,sans-serif}
.c{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}
.b{width:100%;border-radius:calc(var(--u)*10px) calc(var(--u)*10px) 0 0}.v{font-weight:800;font-size:calc(var(--u)*56px);margin-bottom:.2em}.k{font-weight:600;font-size:calc(var(--u)*40px);margin-top:.5em}</style>
<div id="s"></div>
<script>
const P = { data: [["Mon", 12], ["Tue", 18], ["Wed", 31], ["Thu", 22]], fg: "#ffffff", base: "#64748b", accent: "#f59e0b", start: 0.1, step: 0.25, grow: 0.7, hold: 1.5, exit: 0.3 };
const W = innerWidth, H = innerHeight, u = Math.min(W, H) / 1080; document.documentElement.style.setProperty("--u", u);
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)),prog=(t,s,d)=>clamp((t-s)/d),outCubic=p=>1-Math.pow(1-p,3);
const max = Math.max(...P.data.map(d => d[1])), peak = P.data.findIndex(d => d[1] === max), root = document.getElementById("s");
const cols = P.data.map(([k, v], i) => { const c = document.createElement("div"); c.className = "c"; c.style.color = P.fg;
  c.innerHTML = `<div class="v">${v}</div><div class="b" style="background:${i === peak ? P.accent : P.base}"></div><div class="k">${k}</div>`; root.appendChild(c); return c; });
const total = P.start + (P.data.length - 1) * P.step + P.grow + P.hold + P.exit;
window.seek = t => cols.forEach((c, i) => {
  const g = outCubic(prog(t, P.start + i * P.step, P.grow)), out = prog(t, total - P.exit, P.exit);
  c.querySelector(".b").style.height = (P.data[i][1] / max * 62 * g) + "%"; c.style.opacity = (1 - outCubic(out)) * clamp(g * 4);
}); seek(0);
</script>
```

### Lower third (name and role sliding in, then out)

```html
<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}
#s{position:absolute;left:6%;bottom:16%;font-family:"Helvetica Neue",Arial,sans-serif;display:flex;align-items:stretch;gap:calc(var(--u)*18px)}
#r{width:calc(var(--u)*10px);background:var(--accent)}#t{color:var(--fg)}#a{font-weight:800;font-size:calc(var(--u)*72px)}#b{font-weight:500;font-size:calc(var(--u)*44px);opacity:.85;margin-top:.15em}</style>
<div id="s"><div id="r"></div><div id="t"><div id="a"></div><div id="b"></div></div></div>
<script>
const P = { name: "Alex Rivera", role: "Founder, Studio Nine", fg: "#ffffff", accent: "#3b82f6", start: 0.1, enter: 0.45, hold: 2.4, exit: 0.35 };
const W = innerWidth, H = innerHeight, u = Math.min(W, H) / 1080;
const r = document.documentElement.style; r.setProperty("--u", u); r.setProperty("--fg", P.fg); r.setProperty("--accent", P.accent);
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)),prog=(t,s,d)=>clamp((t-s)/d),outCubic=p=>1-Math.pow(1-p,3),inCubic=p=>p*p*p;
document.getElementById("a").textContent = P.name; document.getElementById("b").textContent = P.role;
const s = document.getElementById("s"), total = P.start + P.enter + P.hold + P.exit;
window.seek = t => { const i = outCubic(prog(t, P.start, P.enter)), o = inCubic(prog(t, total - P.exit, P.exit));
  s.style.opacity = i * (1 - o); s.style.transform = `translateX(${(-1 + i) * 80 * u - o * 80 * u}px)`; }; seek(0);
</script>
```

Each starter's length is its `start` plus its entrance, `hold` and `exit` times: render with `--duration` at least that long.
