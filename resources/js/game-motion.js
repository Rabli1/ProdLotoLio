const DURATIONS = { card: 440, flip: 460, mine: 480, word: 440, wheel: 1200, plinko: 800, crash: 650 };

const cardKey = card => card?.hidden ? 'hidden' : `${card?.rank ?? ''}:${card?.suit ?? ''}`;
const guessKey = guess => JSON.stringify([guess?.word, guess?.result, guess?.won]);
const positive = value => Number.isFinite(Number(value)) && Number(value) >= 1 ? Number(value) : null;

/** Pure state diff: only public, newly changed outcomes produce motion. */
export function planGameTransition(previous, next, game = next?.game) {
    if (!next || next.game !== game) return [];
    const sameRound = Boolean(previous && previous.id === next.id && previous.game === next.game);
    const before = sameRound ? previous : null;
    const effects = [];
    const cards = (set, current, old = []) => {
        current.forEach((card, index) => {
            if (old[index] && cardKey(old[index]) === cardKey(card)) return;
            effects.push({ type: old[index] ? 'card-reveal' : 'card-deal', set, index, delay: sameRound ? 0 : index * 70 });
        });
    };
    switch (game) {
        case 'blackjack':
            cards('dealer', next.dealerCards || [], before?.dealerCards || []);
            cards('player', next.playerCards || [], before?.playerCards || []);
            break;
        case 'poker':
            cards('poker', next.cards || [], before?.cards || []);
            break;
        case 'mines': {
            const revealed = new Set(before?.revealed || []);
            (next.revealed || []).filter(cell => !revealed.has(cell)).forEach((index, order) => {
                effects.push({ type: 'mine-reveal', index, delay: Math.min(order * 35, 350) });
            });
            if (next.status === 'lost' && before?.status === 'active') {
                const known = new Set(before.minesPositions || []);
                (next.minesPositions || []).filter(cell => !known.has(cell)).forEach(index => effects.push({ type: 'mine-hit', index }));
            }
            break;
        }
        case 'liotodle':
            (next.guesses || []).forEach((guess, row) => {
                if (guessKey(guess) === guessKey(before?.guesses?.[row])) return;
                for (let column = 0; column < 5; column++) {
                    effects.push({ type: 'word-reveal', index: row * 5 + column, delay: column * 85 });
                    const solved = guess.won === true || (next.status === 'won' && guess.result?.length === 5 && guess.result.every(result => result === 'correct'));
                    if (solved) effects.push({ type: 'word-win', index: row * 5 + column, delay: DURATIONS.word + column * 85 + 30 });
                }
            });
            break;
        case 'chicken-road':
            if (Number(next.steps) > Number(before?.steps || 0)) effects.push({
                type: next.status === 'lost' ? 'chicken-hit' : 'chicken-step',
                index: Math.max(0, Number(next.steps) - 1),
            });
            break;
        case 'crash':
            if (next.status !== 'active' && before?.status === 'active') effects.push({ type: 'crash-end' });
            break;
        case 'roulette':
            if (!sameRound && next.status !== 'active') effects.push({ type: 'roulette-result' });
            break;
        case 'slot-machine':
            if (!sameRound && next.status !== 'active') effects.push({ type: 'slot-result' });
            break;
        case 'coinflip':
            if (!sameRound && next.status !== 'active') effects.push({ type: 'coin-result' });
            break;
        case 'plinko':
            if (!sameRound && Array.isArray(next.path) && next.path.length) effects.push({ type: 'plinko-path' });
            break;
    }
    return effects;
}

export function interpolateConfirmedMultiplier(previous, next, progress) {
    const end = positive(next) ?? 1;
    const start = positive(previous) ?? end;
    const t = Math.min(1, Math.max(0, Number(progress) || 0));
    const eased = 1 - Math.pow(1 - t, 3);
    return Math.min(Math.max(start, end), Math.max(Math.min(start, end), start + (end - start) * eased));
}

export function confirmedCrashMultiplier(round) {
    return positive(round?.status === 'lost' ? round?.crashAt : round?.currentMultiplier)
        ?? positive(round?.currentMultiplier)
        ?? positive(round?.multiplier)
        ?? 1;
}

/** No DOM globals are read until this factory is called. */
export function createGameMotion(board, game) {
    const document = board.ownerDocument;
    const window = document?.defaultView || globalThis;
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const tasks = new Set();
    const persistentStyles = new Map();
    const stateClasses = new Map();
    let generation = 0;
    let lastApplied = null;
    let crashTask = null;
    let lastCrashTarget = null;
    const query = selector => board.querySelector(selector);
    const all = selector => [...board.querySelectorAll(selector)];
    const canAnimate = () => !media?.matches && !document?.hidden;
    const now = () => window.performance?.now?.() ?? Date.now();

    function persistentStyle(node, property, value) {
        if (!node) return;
        if (!persistentStyles.has(node)) persistentStyles.set(node, new Map());
        const styles = persistentStyles.get(node);
        if (!styles.has(property)) styles.set(property, [node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]);
        node.style.setProperty(property, value);
    }

    function stateClass(node, name, enabled) {
        if (!node) return;
        if (!stateClasses.has(node)) stateClasses.set(node, new Map());
        const classes = stateClasses.get(node);
        if (!classes.has(name)) classes.set(name, node.classList.contains(name));
        node.classList.toggle(name, enabled);
    }

    function cssMotion(node, className, duration, delay = 0, target = node, inlineAnimation = null) {
        if (!node || !canAnimate()) return;
        const saved = new Map();
        for (const property of ['--motion-delay', '--motion-duration', ...(inlineAnimation ? ['animation'] : [])]) {
            saved.set(property, [node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]);
        }
        const already = node.classList.contains(className);
        node.style.setProperty('--motion-delay', delay + 'ms');
        node.style.setProperty('--motion-duration', duration + 'ms');
        if (inlineAnimation) node.style.setProperty('animation', inlineAnimation);
        node.classList.add(className);
        let done = false;
        const task = { finish: cleanup };
        const timeout = window.setTimeout(cleanup, duration + delay + 60);
        function cleanup() {
            if (done) return;
            done = true;
            window.clearTimeout(timeout);
            if (!already) node.classList.remove(className);
            for (const [property, [value, priority]] of saved) {
                if (value) node.style.setProperty(property, value, priority);
                else node.style.removeProperty(property);
            }
            tasks.delete(task);
        }
        tasks.add(task);
    }

    function later(callback, delay) {
        const token = generation;
        let done = false;
        const task = { finish: cleanup };
        const timeout = window.setTimeout(() => {
            cleanup();
            if (token === generation && canAnimate()) callback();
        }, delay);
        function cleanup() {
            if (done) return;
            done = true;
            window.clearTimeout(timeout);
            tasks.delete(task);
        }
        tasks.add(task);
    }

    function frameMotion(duration, update, final, onDone = () => {}) {
        const token = generation;
        let handle = null;
        let done = false;
        const start = now();
        const task = { finish: () => stop(true), stop: () => stop(false) };
        function stop(settle) {
            if (done) return;
            done = true;
            if (handle !== null) window.cancelAnimationFrame?.(handle);
            if (settle) final();
            tasks.delete(task);
            onDone();
        }
        function frame(time) {
            if (done || token !== generation) return stop(false);
            if (!canAnimate() || board.isConnected === false) return stop(true);
            const progress = Math.min(1, Math.max(0, (time - start) / duration));
            update(progress);
            if (progress >= 1) return stop(true);
            handle = window.requestAnimationFrame(frame);
        }
        tasks.add(task);
        if (!canAnimate() || typeof window.requestAnimationFrame !== 'function') stop(true);
        else handle = window.requestAnimationFrame(frame);
        return task;
    }

    function setCrash(value) {
        const text = query('.crash-value');
        if (text) text.textContent = value.toFixed(2) + '×';
        const line = query('.crash-chart .graph-line');
        const rise = Math.min(225, Math.max(10, (value - 1) * 80));
        line?.setAttribute('d', 'M10 250 C150 250 225 240 330 ' + (250 - rise * .45) + ' S430 ' + (250 - rise) + ' 485 ' + (250 - rise));
    }

    function pathGeometry() {
        const path = query('.plinko-trail');
        const ball = query('.plinko-ball');
        if (!path || !ball) return null;
        try {
            const length = path.getTotalLength();
            if (!Number.isFinite(length) || length <= 0) return null;
            return { path, ball, length };
        } catch { return null; }
    }

    function moveBall(geometry, progress) {
        if (geometry.ball.isConnected === false) return;
        const point = geometry.path.getPointAtLength(geometry.length * progress);
        geometry.ball.setAttribute('cx', point.x);
        geometry.ball.setAttribute('cy', point.y);
    }

    function suppressBaseline() {
        persistentStyle(query('.plinko-trail'), 'animation', 'none');
        persistentStyle(query('.crash-value'), 'animation', 'none');
    }

    function cancel() {
        generation++;
        for (const task of [...tasks]) task.finish();
        crashTask = null;
        for (const [node, styles] of persistentStyles) {
            for (const [property, [value, priority]] of styles) {
                if (value) node.style.setProperty(property, value, priority);
                else node.style.removeProperty(property);
            }
        }
        persistentStyles.clear();
        for (const [node, classes] of stateClasses) for (const [name, enabled] of classes) node.classList.toggle(name, enabled);
        stateClasses.clear();
    }

    function apply(previous, next, { animate = true } = {}) {
        const prior = previous || lastApplied;
        const effects = planGameTransition(prior, next, game);
        lastApplied = next ? JSON.parse(JSON.stringify(next)) : null;
        const enabled = animate && canAnimate();
        // These selectors have baseline CSS animation; restoration must stay still.
        suppressBaseline();
        if (game === 'crash' && next?.game === game) {
            const crashBoard = query('.crash-board');
            stateClass(crashBoard, 'is-running', next.status === 'active');
            stateClass(crashBoard, 'is-crashed', next.status === 'lost');
            lastCrashTarget = confirmedCrashMultiplier(next);
            setCrash(lastCrashTarget);
        }
        const geometry = game === 'plinko' ? pathGeometry() : null;
        if (geometry && !effects.some(effect => effect.type === 'plinko-path')) moveBall(geometry, 1);
        if (!enabled) {
            if (geometry) moveBall(geometry, 1);
            return;
        }
        for (const effect of effects) {
            switch (effect.type) {
                case 'card-deal':
                case 'card-reveal': {
                    const selector = effect.set === 'poker' ? '.card-group .playing-card' : '[data-card-set="' + effect.set + '"] .playing-card';
                    cssMotion(all(selector)[effect.index], effect.type === 'card-deal' ? 'is-dealing' : 'is-revealing', effect.type === 'card-deal' ? DURATIONS.card : DURATIONS.flip, effect.delay);
                    break;
                }
                case 'mine-reveal':
                case 'mine-hit':
                    cssMotion(query('[data-cell="' + effect.index + '"]'), effect.type === 'mine-hit' ? 'is-hit' : 'is-revealing', effect.type === 'mine-hit' ? 420 : DURATIONS.mine, effect.delay || 0);
                    break;
                case 'word-reveal':
                    cssMotion(all('.word-cell')[effect.index], 'is-revealing', DURATIONS.word, effect.delay);
                    break;
                case 'word-win':
                    later(() => cssMotion(all('.word-cell')[effect.index], 'is-celebrating', 480), effect.delay);
                    break;
                case 'chicken-step':
                case 'chicken-hit': {
                    const lane = all('.road-lane')[effect.index];
                    cssMotion(lane, effect.type === 'chicken-hit' ? 'is-hit' : 'is-crossing', effect.type === 'chicken-hit' ? 450 : 400);
                    break;
                }
                case 'coin-result':
                    cssMotion(query('.coin-display'), 'is-landing', 540);
                    break;
                case 'slot-result':
                    all('.slot-reel').forEach((reel, index) => cssMotion(reel, 'is-stopping', 400, index * 110));
                    break;
                case 'roulette-result':
                    cssMotion(query('.roulette-wheel'), 'is-spinning', DURATIONS.wheel);
                    cssMotion(query('.roulette-result'), 'is-revealing', 420, 900);
                    break;
                case 'plinko-path':
                    if (geometry) {
                        persistentStyle(geometry.path, 'animation', 'plinko-trail ' + DURATIONS.plinko + 'ms ease-out both');
                        moveBall(geometry, 0);
                        frameMotion(DURATIONS.plinko, progress => moveBall(geometry, progress), () => moveBall(geometry, 1));
                    }
                    cssMotion(all('.plinko-bin')[next.slot], 'is-winning', 540, DURATIONS.plinko - 80);
                    break;
                case 'crash-end':
                    cssMotion(query('.crash-value'), 'is-settling', 450, 0, undefined, 'motion-crash-end 450ms ease-out backwards');
                    break;
            }
        }
    }

    function crash(previousMultiplier, nextMultiplier) {
        const target = positive(nextMultiplier);
        if (target === null || !query('.crash-value')) return;
        if (target === lastCrashTarget && crashTask) return;
        const displayed = positive(Number.parseFloat(query('.crash-value').textContent));
        if (target === lastCrashTarget && displayed === target) return;
        crashTask?.stop();
        lastCrashTarget = target;
        const start = displayed ?? positive(previousMultiplier) ?? target;
        if (!canAnimate() || target <= start) return setCrash(target);
        const task = frameMotion(DURATIONS.crash, progress => setCrash(interpolateConfirmedMultiplier(start, target, progress)), () => setCrash(target), () => { crashTask = null; });
        crashTask = tasks.has(task) ? task : null;
    }

    function finishForPreference() {
        if (canAnimate()) return;
        generation++;
        for (const task of [...tasks]) task.finish();
        crashTask = null;
        suppressBaseline();
    }
    if (media?.addEventListener) media.addEventListener('change', finishForPreference);
    else media?.addListener?.(finishForPreference);
    document?.addEventListener?.('visibilitychange', finishForPreference);

    return {
        apply,
        crash,
        cancel,
        invalidWord: () => cssMotion(query('.word-board'), 'is-invalid', 320),
        typeCell: cell => cssMotion(cell, 'is-typing', 170),
    };
}

