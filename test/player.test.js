/**
 * The walkthrough player page, tested against a stub YouTube player.
 *
 * Run with `node test/player.test.js`. No dependencies and no browser: the page is served from
 * GitHub Pages, so a mistake in it costs a deploy to find and another to fix, and the app that
 * depends on it caches it by revision. Driving it here is cheaper than either.
 *
 * A real browser cannot answer these questions anyway. Media does not play in a background tab, so
 * the cap — which only fires on a player that is actually running — never fires in an automated
 * Chrome session. A stub whose clock and state are inputs tests exactly the branch that matters.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = path.join(__dirname, '..', 'docs', 'youtube-player', 'index.html');

/** The page's inline script, run as the page runs it. */
function pageScript() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const match = html.match(/<script>\n([\s\S]*?)\n {2}<\/script>/);
  assert.ok(match, 'could not find the page script — has the markup changed?');
  return match[1];
}

/**
 * Boots the page with a given query string and a stub player.
 *
 * The stub records what it was told to do and takes its state and clock from the test, which is the
 * whole point: "playing at 31 seconds" is an input here and an act of faith in a browser.
 */
function boot(query) {
  const posted = [];
  const calls = [];
  const player = {
    state: 'PLAYING',
    at: 0,
    getCurrentTime() {
      return this.at;
    },
    getPlayerState() {
      return this.state;
    },
    playVideo() {
      calls.push('play');
    },
    pauseVideo() {
      calls.push('pause');
      this.state = 'PAUSED';
    },
    mute() {
      calls.push('mute');
    },
    unMute() {
      calls.push('unMute');
    },
    isMuted() {
      return false;
    },
  };

  const iframe = { src: '' };
  const context = {
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    YT: {
      PlayerState: { PLAYING: 'PLAYING', BUFFERING: 'BUFFERING', PAUSED: 'PAUSED' },
      // A `function`, not a shorthand method: the page calls `new YT.Player(...)`, and a shorthand
      // method is not constructible — it throws, the page's own catch posts `ready` from its
      // API-failed fallback, and every assertion about the ticker quietly fails for the wrong reason.
      Player: function (_id, options) {
        // Ready on the next tick, as the real API is: the page must cope with commands that arrive
        // before the player exists, and calling onReady synchronously would hide that.
        setTimeout(() => options.events.onReady(), 0);
        return player;
      },
    },
    document: {
      getElementById: () => iframe,
      createElement: () => ({ set src(_v) {} }),
      head: {
        appendChild() {
          // The IFrame API "loading". Fires once; the page appends the tag twice in warm-up mode
          // only, which these tests do not exercise.
          setTimeout(() => context.window.onYouTubeIframeAPIReady?.(), 0);
        },
      },
    },
  };
  context.window = context;
  context.window.location = { search: query, origin: 'https://example.test' };
  context.window.ReactNativeWebView = {
    postMessage: (raw) => posted.push(JSON.parse(raw)),
  };

  vm.createContext(context);
  vm.runInContext(pageScript(), context);

  return { posted, calls, player, iframe, api: () => context.window.cupbored };
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** One tick of the page's own 500ms ticker, plus a little slack. */
const TICK = 700;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── the cap ────────────────────────────────────────────────────────────────

test('does not cap a player that has not reached the limit', async () => {
  const { posted, player } = boot('?v=abcdefghijk&mute=1&cap=30');
  player.at = 10;

  await settle(TICK);

  assert.equal(posted.filter((m) => m.type === 'capped').length, 0);
});

test('pauses and reports once the limit is reached', async () => {
  const { posted, calls, player } = boot('?v=abcdefghijk&mute=1&cap=30');
  player.at = 31;

  await settle(TICK);

  const capped = posted.filter((m) => m.type === 'capped');
  assert.equal(capped.length, 1);
  assert.equal(capped[0].seconds, 31);
  assert.ok(calls.includes('pause'));
});

test('reports the cap once, not on every tick after it', async () => {
  const { posted, player } = boot('?v=abcdefghijk&mute=1&cap=30');
  player.at = 31;

  await settle(TICK * 3);

  assert.equal(posted.filter((m) => m.type === 'capped').length, 1);
});

test('never caps a player that was given no limit', async () => {
  const { posted, player } = boot('?v=abcdefghijk&mute=1');
  player.at = 6000;

  await settle(TICK * 2);

  assert.equal(posted.filter((m) => m.type === 'capped').length, 0);
});

// ── lifting it ─────────────────────────────────────────────────────────────

test('resume plays on past the limit, in place', async () => {
  const { calls, player, api } = boot('?v=abcdefghijk&mute=1&cap=30');
  player.at = 31;
  await settle(TICK);
  calls.length = 0;

  api().resume();
  player.state = 'PLAYING';
  player.at = 45;
  await settle(TICK * 2);

  assert.ok(calls.includes('play'), 'resume should start the player again');
  assert.ok(!calls.includes('pause'), 'the lifted cap must not stop it again');
});

// A viewer who paused with YouTube's own control and then opened the recipe was having playback
// forced back on against their last instruction. Lifting the limit is the whole job.
test('resume does not restart a player the viewer paused themselves', async () => {
  const { calls, player, api } = boot('?v=abcdefghijk&mute=1&cap=30');
  player.state = 'PAUSED';
  player.at = 12;
  await settle(TICK);
  calls.length = 0;

  api().resume();

  assert.ok(!calls.includes('play'));
});

// The app sends `play` whenever a page becomes the active one. Without this, swiping back to a
// preview whose taste had already run out would start it for the one tick it takes to stop it again.
test('play does not restart a player that has already capped', async () => {
  const { calls, player, api } = boot('?v=abcdefghijk&mute=1&cap=30');
  player.at = 31;
  await settle(TICK);
  calls.length = 0;

  api().play();

  assert.ok(!calls.includes('play'));
});

// ── the position it reports ────────────────────────────────────────────────

test('reports how far in it is while it is running', async () => {
  const { posted, player } = boot('?v=abcdefghijk&mute=1');
  player.at = 42.9;

  await settle(2600);

  const times = posted.filter((m) => m.type === 'time');
  assert.ok(times.length >= 1, 'expected at least one position report');
  assert.equal(times[0].seconds, 42, 'whole seconds only — the player takes nothing finer');
});

// The app keeps a preloaded neighbour either side of the page being watched, paused at zero. Letting
// those report would have a paused player overwrite the very position the app keeps to rebuild from.
test('says nothing about a player that is not running', async () => {
  const { posted, player } = boot('?v=abcdefghijk&mute=1&autoplay=0');
  player.state = 'PAUSED';
  player.at = 0;

  await settle(2600);

  assert.equal(posted.filter((m) => m.type === 'time').length, 0);
});

// ── the embed URL ──────────────────────────────────────────────────────────

test('seeks on load when it is being rebuilt', async () => {
  const { iframe } = boot('?v=abcdefghijk&mute=1&start=42');

  assert.ok(iframe.src.includes('&start=42'), iframe.src);
});

test('starts from the beginning when there is nothing to rebuild from', async () => {
  const { iframe } = boot('?v=abcdefghijk&mute=1');

  assert.ok(!iframe.src.includes('start='), iframe.src);
});

// The cap is ours, not YouTube's. `end` lives in the embed URL, and the app reuses one player from
// the preview into the detail — a limit in the URL could only be lifted by reloading, which is the
// restart the whole arrangement exists to avoid.
test('never puts the limit in the embed URL', async () => {
  const { iframe } = boot('?v=abcdefghijk&mute=1&cap=30');

  assert.ok(!iframe.src.includes('end='), iframe.src);
  assert.ok(!iframe.src.includes('cap='), iframe.src);
});

test('refuses anything that is not a real video id', async () => {
  const { posted, iframe } = boot('?v=../../evil&mute=1');

  assert.equal(iframe.src, '');
  assert.deepEqual(posted, [{ type: 'error', code: 'invalid_id' }]);
});

// ── run ────────────────────────────────────────────────────────────────────

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL  ${name}`);
      console.log(`      ${error.message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
})();
