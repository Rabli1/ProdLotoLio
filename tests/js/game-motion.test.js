import test from 'node:test';
import assert from 'node:assert/strict';
import { planGameTransition, interpolateConfirmedMultiplier, confirmedCrashMultiplier, createGameMotion } from '../../resources/js/game-motion.js';

const card = (rank, suit = 'S') => ({ rank, suit });
const round = (game, state = {}) => ({ id: 'one', game, status: 'active', ...state });

test('absent/foreign rounds and unchanged public states do not animate', () => {
    assert.deepEqual(planGameTransition(null, null, 'mines'), []);
    assert.deepEqual(planGameTransition(null, round('poker'), 'mines'), []);
    const state = round('blackjack', { playerCards: [card('8'), card('J')], dealerCards: [card('4'), { hidden: true }] });
    assert.deepEqual(planGameTransition(state, structuredClone(state)), []);
});

test('new Blackjack deals are staggered, including the hidden dealer card', () => {
    const effects = planGameTransition(null, round('blackjack', { playerCards: [card('8'), card('J')], dealerCards: [card('4'), { hidden: true }] }));
    assert.equal(effects.length, 4);
    assert.deepEqual(effects.map(effect => [effect.set, effect.index, effect.type, effect.delay]), [
        ['dealer', 0, 'card-deal', 0], ['dealer', 1, 'card-deal', 70],
        ['player', 0, 'card-deal', 0], ['player', 1, 'card-deal', 70],
    ]);
});

test('a hit animates only the appended card; standing flips only the hidden dealer card', () => {
    const previous = round('blackjack', { playerCards: [card('8'), card('3')], dealerCards: [card('4'), { hidden: true }] });
    const hit = { ...previous, playerCards: [...previous.playerCards, card('5')] };
    assert.deepEqual(planGameTransition(previous, hit), [{ type: 'card-deal', set: 'player', index: 2, delay: 0 }]);
    const stand = { ...hit, status: 'won', dealerCards: [card('4'), card('K')] };
    assert.deepEqual(planGameTransition(hit, stand), [{ type: 'card-reveal', set: 'dealer', index: 1, delay: 0 }]);
});

test('Video Poker replacements preserve held and unchanged cards', () => {
    const previous = round('poker', { cards: [card('A'), card('2'), card('K'), card('5'), card('9')] });
    const next = { ...previous, status: 'lost', cards: [card('A'), card('6'), card('K'), card('J'), card('9')] };
    assert.deepEqual(planGameTransition(previous, next).map(effect => [effect.type, effect.index]), [['card-reveal', 1], ['card-reveal', 3]]);
    assert.deepEqual(planGameTransition(next, structuredClone(next)), []);
});

test('Mines reveals animate newly opened cells and terminal mines once', () => {
    const previous = round('mines', { revealed: [2, 4] });
    const next = { ...previous, revealed: [2, 4, 7] };
    assert.deepEqual(planGameTransition(previous, next), [{ type: 'mine-reveal', index: 7, delay: 0 }]);
    const lost = { ...next, status: 'lost', revealed: [...next.revealed, 1], minesPositions: [1, 8] };
    assert.deepEqual(planGameTransition(next, lost).map(effect => [effect.type, effect.index]), [['mine-hit', 1], ['mine-hit', 8]]);
    assert.deepEqual(planGameTransition(lost, structuredClone(lost)), []);
});

test('word reveals only the appended row and derives a win from public results', () => {
    const first = { word: 'ABACA', result: ['absent', 'absent', 'correct', 'absent', 'absent'] };
    const previous = round('liotodle', { guesses: [first] });
    const next = { ...previous, status: 'won', guesses: [first, { word: 'DIANE', result: Array(5).fill('correct') }] };
    const effects = planGameTransition(previous, next);
    assert.deepEqual(effects.filter(effect => effect.type === 'word-reveal').map(effect => effect.index), [5, 6, 7, 8, 9]);
    assert.deepEqual(effects.filter(effect => effect.type === 'word-win').map(effect => effect.index), [5, 6, 7, 8, 9]);
    assert.deepEqual(planGameTransition(next, structuredClone(next)), []);
});

test('chicken motion requires a new confirmed step, not a forfeit', () => {
    const previous = round('chicken-road', { steps: 3 });
    assert.deepEqual(planGameTransition(previous, { ...previous, steps: 4 }), [{ type: 'chicken-step', index: 3 }]);
    assert.deepEqual(planGameTransition(previous, { ...previous, steps: 4, status: 'lost' }), [{ type: 'chicken-hit', index: 3 }]);
    assert.deepEqual(planGameTransition(previous, { ...previous, status: 'lost' }), []);
});

test('instant results and Plinko paths animate once per authoritative round ID', () => {
    for (const game of ['roulette', 'slot-machine', 'coinflip']) {
        const state = round(game, { status: 'won' });
        assert.equal(planGameTransition(null, state).length, 1);
        assert.deepEqual(planGameTransition(state, structuredClone(state)), []);
        assert.equal(planGameTransition(state, { ...state, id: 'two' }).length, 1);
    }
    const state = round('plinko', { status: 'won', slot: 4, path: [0, 1, 1, 0, 0, 1, 1, 0] });
    assert.deepEqual(planGameTransition(null, state), [{ type: 'plinko-path' }]);
    assert.deepEqual(planGameTransition(state, state), []);
});

test('Crash display uses the confirmed crash threshold on loss, never zero payout multiplier', () => {
    assert.equal(confirmedCrashMultiplier(round('crash', { status: 'lost', multiplier: 0, currentMultiplier: 0, crashAt: 2.47 })), 2.47);
    assert.equal(confirmedCrashMultiplier(round('crash', { currentMultiplier: 1.56 })), 1.56);
    assert.equal(confirmedCrashMultiplier(round('crash', { status: 'won', multiplier: 1.78 })), 1.78);
    assert.equal(confirmedCrashMultiplier({ multiplier: NaN }), 1);
});

test('Crash interpolation stays within confirmed endpoints, clamps time and is monotonic', () => {
    const values = Array.from({ length: 21 }, (_, index) => interpolateConfirmedMultiplier(1.2, 2.4, index / 20));
    assert.equal(values[0], 1.2);
    assert.equal(values.at(-1), 2.4);
    values.forEach((value, index) => {
        assert.ok(value >= 1.2 && value <= 2.4);
        if (index) assert.ok(value >= values[index - 1]);
    });
    assert.equal(interpolateConfirmedMultiplier(1.2, 2.4, -1), 1.2);
    assert.equal(interpolateConfirmedMultiplier(1.2, 2.4, 5), 2.4);
    assert.equal(interpolateConfirmedMultiplier(NaN, 2, .5), 2);
});

class Style {
    values = new Map();
    getPropertyValue(name) { return this.values.get(name)?.[0] || ''; }
    getPropertyPriority(name) { return this.values.get(name)?.[1] || ''; }
    setProperty(name, value, priority = '') { this.values.set(name, [String(value), priority]); }
    removeProperty(name) { this.values.delete(name); }
}
class Classes {
    values = new Set();
    contains(name) { return this.values.has(name); }
    add(name) { this.values.add(name); }
    remove(name) { this.values.delete(name); }
    toggle(name, enabled) { if (enabled) this.add(name); else this.remove(name); }
}
const node = textContent => ({
    textContent, style: new Style(), classList: new Classes(), isConnected: true, attrs: new Map(),
    setAttribute(name, value) { this.attrs.set(name, String(value)); },
});

function environment(selectors = {}) {
    let clock = 0, sequence = 0;
    const frames = new Map(), timers = new Map(), listeners = new Map();
    const mediaListeners = [];
    const media = { matches: false, addEventListener(_, callback) { mediaListeners.push(callback); } };
    const window = {
        performance: { now: () => clock }, matchMedia: () => media,
        requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
        cancelAnimationFrame(id) { frames.delete(id); },
        setTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, due: clock + delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
    };
    const document = { defaultView: window, hidden: false, addEventListener(name, callback) { listeners.set(name, callback); } };
    const board = {
        ownerDocument: document, isConnected: true,
        querySelector(selector) { return selectors[selector]?.[0] || null; },
        querySelectorAll(selector) { return selectors[selector] || []; },
    };
    return {
        board, frames, timers, media, document,
        tick(time) { clock = time; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); },
        reduced(value) { media.matches = value; mediaListeners.forEach(callback => callback()); },
        hidden(value) { document.hidden = value; listeners.get('visibilitychange')?.(); },
    };
}

test('factory cancellation settles at the last confirmed value and blocks stale callbacks', () => {
    const value = node('1.00×'), line = node('');
    const env = environment({ '.crash-value': [value], '.crash-chart .graph-line': [line] });
    const motion = createGameMotion(env.board, 'crash');
    motion.crash(1, 2);
    env.tick(325);
    assert.ok(parseFloat(value.textContent) > 1 && parseFloat(value.textContent) < 2);
    const stale = [...env.frames.values()][0];
    motion.cancel();
    assert.equal(value.textContent, '2.00×');
    assert.equal(env.frames.size, 0);
    value.textContent = '5.00×';
    stale(900);
    assert.equal(value.textContent, '5.00×');
});

test('dynamic reduced motion and hidden visibility finish confirmed animation immediately', () => {
    const value = node('1.00×'), line = node('');
    const env = environment({ '.crash-value': [value], '.crash-chart .graph-line': [line] });
    const motion = createGameMotion(env.board, 'crash');
    motion.crash(1, 2);
    env.reduced(true);
    assert.equal(value.textContent, '2.00×');
    assert.equal(env.frames.size, 0);
    env.reduced(false);
    motion.crash(2, 3);
    env.tick(100);
    env.hidden(true);
    assert.equal(value.textContent, '3.00×');
    assert.equal(env.frames.size, 0);
    motion.cancel();
});

test('Plinko restoration is still and uses the real SVG endpoint; canceled motion settles there', () => {
    const path = Object.assign(node(''), { getTotalLength: () => 100, getPointAtLength: length => ({ x: 220 + length, y: length * 2 }) });
    const ball = node('');
    const env = environment({ '.plinko-trail': [path], '.plinko-ball': [ball], '.plinko-bin': [] });
    const motion = createGameMotion(env.board, 'plinko');
    const state = round('plinko', { status: 'won', slot: 4, path: [0, 1, 1, 0, 1, 0, 1, 0] });
    motion.apply(null, state, { animate: false });
    assert.equal(path.style.getPropertyValue('animation'), 'none');
    assert.equal(ball.attrs.get('cx'), '320');
    assert.equal(ball.attrs.get('cy'), '200');
    assert.equal(env.frames.size, 0);
    motion.cancel();
    motion.apply(state, { ...state, id: 'two' });
    assert.equal(ball.attrs.get('cx'), '220');
    env.tick(400);
    assert.equal(ball.attrs.get('cx'), '270');
    motion.cancel();
    assert.equal(ball.attrs.get('cx'), '320');
    assert.equal(env.frames.size, 0);
});

test('duplicate apply calls do not replay cards, and cancel restores owned inline props', () => {
    const first = node('A'), second = node('K');
    first.style.setProperty('--motion-delay', '12ms');
    const env = environment({ '.card-group .playing-card': [first, second] });
    const motion = createGameMotion(env.board, 'poker');
    const state = round('poker', { cards: [card('A'), card('K')] });
    motion.apply(null, state);
    assert.equal(first.classList.contains('is-dealing'), true);
    motion.cancel();
    assert.equal(first.classList.contains('is-dealing'), false);
    assert.equal(first.style.getPropertyValue('--motion-delay'), '12ms');
    motion.apply(null, structuredClone(state));
    assert.equal(first.classList.contains('is-dealing'), false);
    assert.equal(env.timers.size, 0);
    motion.cancel();
});

test('rapid typing replaces the previous node motion instead of stacking cleanup timers', () => {
    const cell = node('A');
    const env = environment();
    const motion = createGameMotion(env.board, 'liotodle');
    motion.typeCell(cell);
    motion.typeCell(cell);
    assert.equal(env.timers.size, 1);
    assert.equal(cell.classList.contains('is-typing'), true);
    motion.cancel();
    assert.equal(env.timers.size, 0);
    assert.equal(cell.classList.contains('is-typing'), false);
    assert.equal(cell.style.getPropertyValue('--motion-delay'), '');
});

