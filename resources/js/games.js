import {createGameMotion} from './game-motion.js';

const page = document.querySelector('[data-game]');
if (page) initializeGame(page);

function initializeGame(page) {
    const game = page.dataset.game;
    const endpoint = page.dataset.api;
    const authenticated = page.dataset.authenticated === 'true';
    const form = document.getElementById('round-form');
    const board = document.getElementById('game-board');
    const controls = document.getElementById('active-controls');
    const status = document.getElementById('round-status');
    const start = document.getElementById('start-round');
    const forfeit = document.getElementById('forfeit-round');
    const caption = document.getElementById('stage-caption');
    const multiplier = document.getElementById('round-multiplier');
    const payout = document.getElementById('round-payout');
    const stageState = document.getElementById('stage-state');
    const motion = createGameMotion(board, game);
    const csrf = document.querySelector('meta[name="csrf-token"]').content;
    const format = value => new Intl.NumberFormat('fr-CA').format(Number(value));
    let round = null;
    let busy = false;
    let pollTimer = null;
    let pollInFlight = false;
    let requestSequence = 0;
    let appliedSequence = 0;
    let draftWord = '';
    let availableBalance = Infinity;
    let dailyComplete = game === 'liotodle' && page.dataset.dailyAvailable === 'false';
    const held = new Set();
    const logged = new Set();
    const history = [];
    const names = {blackjack:'Blackjack',plinko:'Plinko',mines:'Mines',roulette:'Roulette','slot-machine':'Machine à sous',crash:'Crash',coinflip:'Coin Flip',poker:'Video Poker','chicken-road':'Chicken Road',liotodle:'Liotodle'};
    const plinkoMultipliers = {low:[3,1.5,1,.8,.5,.8,1,1.5,3],medium:[12,3,1.2,.5,.3,.5,1.2,3,12],high:[30,5,.8,.3,.1,.3,.8,5,30]};
    const active = () => round?.status === 'active';
    const here = () => !round || round.game === game;
    const el = (tag, className, value) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (value !== undefined) node.textContent = value;
        return node;
    };
    const svg = (tag, attrs) => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [key,value] of Object.entries(attrs)) node.setAttribute(key, value);
        return node;
    };
    function announce(message, kind = '') {
        status.textContent = message;
        status.className = 'round-status' + (kind ? ' ' + kind : '');
    }
    function setBusy(value) {
        busy = value;
        page.classList.toggle('is-loading', value);
        page.setAttribute('aria-busy', String(value));
        syncControls();
    }
    function syncControls() {
        for (const input of form.querySelectorAll('input,select,button')) input.disabled = busy || active() || (!authenticated && input.id !== 'mines');
        start.textContent = active() ? 'Partie en cours' : (game === 'liotodle' ? 'Commencer le défi ↗' : (round ? 'Rejouer ↗' : 'Jouer ↗'));
        if (dailyComplete && game === 'liotodle' && !active()) {
            start.disabled = true;
            start.textContent = 'Défi terminé pour aujourd’hui';
            if (!round) {
                stageState.textContent = 'DÉFI TERMINÉ POUR AUJOURD’HUI';
                caption.textContent = 'Revenez demain pour un nouveau mot.';
            }
        }
        if (game !== 'liotodle' && availableBalance <= 0 && !active()) {
            start.disabled = true;
            start.textContent = 'Solde épuisé';
        }
        forfeit.hidden = !active() || !authenticated;
        forfeit.disabled = busy;
        for (const button of controls.querySelectorAll('button')) button.disabled = busy || button.dataset.unavailable === 'true';
        for (const button of board.querySelectorAll('.mine-cell')) button.disabled = busy || !active() || !here() || round.revealed?.includes(Number(button.dataset.cell));
        for (const button of board.querySelectorAll('.holdable,.keyboard-key,.word-input-form button')) button.disabled = busy || !active() || !here();
        const wordInput = board.querySelector('#word-input');
        if (wordInput) wordInput.disabled = busy || !active() || !here();
    }
    async function request(url, data, {poll = false} = {}) {
        const sequence = ++requestSequence;
        const response = await fetch(url, {
            method: data ? 'POST' : 'GET',
            credentials: 'same-origin',
            headers: {'Accept':'application/json',...(data ? {'Content-Type':'application/json','X-CSRF-TOKEN':csrf} : {})},
            ...(data ? {body:JSON.stringify(data)} : {}),
        });
        let payload;
        try { payload = await response.json(); } catch { throw new Error('La réponse du serveur est indisponible. Rechargez la page pour reprendre.'); }
        if (!response.ok) {
            const firstError = Object.values(payload.errors || {}).flat()[0];
            throw new Error(firstError || (response.status === 419 ? 'Votre session a expiré. Rechargez la page.' : response.status === 401 ? 'Connectez-vous pour jouer.' : payload.message || 'La partie est indisponible. Réessayez.'));
        }
        if (sequence >= appliedSequence) {
            appliedSequence = sequence;
            apply(payload, poll, Boolean(data) && !poll);
        }
        return payload;
    }
    function apply(payload, quiet = false, animate = false) {
        if (typeof payload.balance === 'number') {
            availableBalance = payload.balance;
            document.querySelectorAll('[data-balance]').forEach(node => node.textContent = format(payload.balance));
            const stake = document.getElementById('stake');
            if (stake) stake.max = String(Math.max(1, Math.min(10000, payload.balance)));
        }
        const next = payload.round;
        const previous = round;
        const newRound = next?.id !== round?.id;
        round = next || null;
        if (newRound) {held.clear();draftWord='';}
        if (game === 'liotodle' && (round?.guesses?.length || 0) > (previous?.guesses?.length || 0)) draftWord = '';
        if (active() && here()) {
            const stakeInput = document.getElementById('stake');
            if (stakeInput) stakeInput.value = String(round.stake);
            for (const option of ['mines','difficulty']) {
                const field = form.elements.namedItem(option);
                if (field && round[option] !== undefined) field.value = String(round[option]);
            }
        }
        syncMineSlider();
        const liveUpdate = quiet && !newRound && active() && here() && game === 'crash';
        if (!liveUpdate) controls.replaceChildren();
        controls.hidden = !active() || !here();
        if (active() && !here()) {
            announce('Une partie de ' + (names[round.game] || 'jeu') + ' est en cours. Terminez-la ou abandonnez-la pour changer de jeu.');
            const link = el('a','small-link','Reprendre la partie →');
            link.href = endpoint.replace(/\/rounds$/, '/' + round.game);
            controls.append(link);
            controls.hidden = false;
        } else {
            if (liveUpdate) {
                const current = Number(round.currentMultiplier || 1);
                motion.crash(Number(previous?.currentMultiplier ?? 1), current);
                controls.querySelector('.cashout').textContent = 'Encaisser ' + format(Math.floor(round.stake * current)) + ' pts';
            } else {
                renderBoard();
                motion.apply(previous, round, {animate: animate || (quiet && previous?.status === 'active' && round?.status !== 'active')});
                renderActions();
            }
            if (round) {
                multiplier.textContent = Number.isFinite(Number(round.multiplier ?? round.currentMultiplier)) ? '×' + Number(round.multiplier ?? round.currentMultiplier).toFixed(2) : '—';
                payout.textContent = active() ? '—' : format(round.payout) + ' pts';
                stageState.textContent = active() ? 'PARTIE EN COURS' : (round.payout > 0 ? 'RETOUR CRÉDITÉ' : 'PARTIE TERMINÉE');
                const prompt = active() ? ({blackjack:'Tirez une carte ou restez sur votre main.',mines:'Révélez une case, puis encaissez quand vous le souhaitez.','chicken-road':'Avancez une voie à la fois. Pensez à encaisser.',crash:'Encaissez avant le crash.',poker:'Cliquez sur les cartes à garder, puis remplacez les autres.',liotodle:'Saisissez un mot de cinq lettres.'}[game] || '') : (round.result || 'Partie terminée.');
                if (!quiet || !active()) announce(prompt, !active() ? (round.payout > 0 ? 'success' : 'error') : '');
                caption.textContent = game === 'liotodle' && round.answer ? 'Le mot : ' + round.answer : prompt;
                if (!active() && !logged.has(round.id)) {
                    if (game === 'liotodle') dailyComplete = true;
                    logged.add(round.id);
                    history.unshift({result:round.result || names[game],payout:round.payout,stake:round.stake});
                    renderHistory();
                }
            }
        }
        syncControls();
        scheduleCrash();
    }
    function renderHistory() {
        const list = document.getElementById('recent-rounds');
        list.replaceChildren();
        history.slice(0,5).forEach(item => {
            const line = el('li');
            line.append(el('span','',item.result),el('strong','',format(item.payout) + ' pts'));
            list.append(line);
        });
    }
    function actionButton(label, action, data = {}, cashout = false, unavailable = false) {
        const button = el('button','action-button' + (cashout ? ' cashout' : ''),label);
        button.type = 'button';
        button.dataset.unavailable = String(unavailable);
        button.addEventListener('click', () => act(action,data));
        controls.append(button);
    }
    function renderActions() {
        if (!active() || !here()) return;
        const cashoutLabel = 'Encaisser ' + format(Math.floor(round.stake * Number(round.currentMultiplier ?? round.multiplier ?? 1))) + ' pts';
        switch(game) {
            case 'blackjack':
                actionButton('Tirer une carte +','hit');
                actionButton('Rester · ' + round.playerTotal,'stand');
                break;
            case 'mines':
                actionButton(cashoutLabel,'cashout',{},true,!round.revealed?.length);
                break;
            case 'chicken-road':
                actionButton('Avancer une voie →','step');
                actionButton(cashoutLabel,'cashout',{},true,round.steps === 0);
                break;
            case 'crash':
                actionButton(cashoutLabel,'cashout',{},true);
                break;
            case 'poker': {
                const button = el('button','action-button cashout','Remplacer les cartes ↻');
                button.type = 'button';
                button.addEventListener('click',() => act('draw',{hold:[...held]}));
                controls.append(button);
                break;
            }
        }
    }
    async function act(action, data = {}) {
        if (busy || !active()) return;
        clearTimeout(pollTimer);
        setBusy(true);
        try {
            await request(endpoint + '/' + encodeURIComponent(round.id) + '/actions',{action,...data});
        } catch(error) {
            announce(error.message,'error');
            if (game === 'liotodle') motion.invalidWord();
            if (game === 'crash') {
                try {await request(endpoint + '/current');} catch {}
            }
        } finally {setBusy(false);scheduleCrash();}
    }
    function scheduleCrash() {
        clearTimeout(pollTimer);
        if (!active() || !here() || game !== 'crash' || busy || !authenticated || document.hidden) return;
        pollTimer = setTimeout(async () => {
            if (pollInFlight || busy || !active()) return scheduleCrash();
            pollInFlight = true;
            try {await request(endpoint + '/' + encodeURIComponent(round.id) + '/actions',{action:'status'},{poll:true});}
            catch(error) {announce(error.message,'error');}
            finally {pollInFlight=false;scheduleCrash();}
        }, 1000);
    }
    function playingCard(card, index, selectable = false) {
        const suits = {C:'♣',D:'♦',H:'♥',S:'♠'};
        if (card?.hidden) return el('div','playing-card hidden-card','✦');
        const node = el(selectable ? 'button' : 'div','playing-card' + (['D','H'].includes(card.suit) ? ' red' : '') + (selectable ? ' holdable' : ''));
        if (selectable) {
            node.type='button';
            node.setAttribute('aria-label', card.rank + ' ' + ({C:'trèfle',D:'carreau',H:'cœur',S:'pique'}[card.suit] || '') + ' : garder cette carte');
            node.setAttribute('aria-pressed',String(held.has(index)));
            node.classList.toggle('held',held.has(index));
            node.addEventListener('click',() => {
                if (held.has(index)) held.delete(index); else held.add(index);
                node.classList.toggle('held',held.has(index));
                node.setAttribute('aria-pressed',String(held.has(index)));
                node.querySelector('.hold-label').textContent = held.has(index) ? 'GARDÉE' : 'GARDER';
            });
        }
        node.append(el('span','rank',card.rank),el('span','suit',suits[card.suit] || '♠'));
        if (selectable) node.append(el('span','hold-label',held.has(index) ? 'GARDÉE' : 'GARDER'));
        return node;
    }
    function renderBoard() {
        // All contents use DOM text nodes; user and server strings never become HTML.
        motion.cancel();
        board.replaceChildren();
        const state = here() ? round : null;
        switch(game) {
            case 'blackjack': {
                const zone=el('div','cards-zone');
                const cardSets=[['Croupier',state?.dealerCards || [{hidden:true},{hidden:true}],state?.dealerTotal],['Votre main',state?.playerCards || [{hidden:true},{hidden:true}],state?.playerTotal]];
                cardSets.forEach(([label,cards,total],setIndex) => {
                    const row=el('div');
                    row.append(el('div','card-caption',label + (total != null ? ' · ' + total : '')));
                    const group=el('div','card-group');
                    group.dataset.cardSet = setIndex === 0 ? 'dealer' : 'player';
                    cards.forEach((card,i)=>group.append(playingCard(card,i)));
                    row.append(group);zone.append(row);
                });
                board.append(zone);
                break;
            }
            case 'poker': {
                board.append(el('div','card-caption',state?.status === 'active' ? 'Sélectionnez les cartes à garder' : 'Votre main de cinq cartes'));
                const group=el('div','card-group');
                (state?.cards || Array.from({length:5},()=>({hidden:true}))).forEach((card,i)=>group.append(playingCard(card,i,state?.status === 'active')));
                board.append(group);
                if (state?.hand) board.append(el('div','hand-label' + (state.status === 'lost' ? ' hand-lost' : ''),state.hand));
                break;
            }
            case 'mines': {
                const found=state?.revealed?.length || 0;
                const mineCount=Number(state?.mines ?? document.getElementById('mines').value);
                const meter=el('div','board-meter',found + (found === 1 ? ' diamant trouvé' : ' diamants trouvés'));
                meter.append(el('strong','',String(mineCount) + (mineCount === 1 ? ' mine' : ' mines')));
                board.append(meter);
                const grid=el('div','mine-board');
                for(let cell=0;cell<25;cell++) {
                    const revealed=state?.revealed?.includes(cell);
                    const mine=state?.status !== 'active' && state?.minesPositions?.includes(cell);
                    const button=el('button','mine-cell' + (mine ? ' exploded' : revealed ? ' revealed' : ''),mine ? '✹' : revealed ? '◇' : '·');
                    button.type='button';button.dataset.cell=String(cell);
                    button.setAttribute('aria-label','Case ' + (cell+1) + (mine ? ', mine' : revealed ? ', diamant' : ', à révéler'));
                    button.addEventListener('click',()=>act('reveal',{cell}));
                    grid.append(button);
                }
                board.append(grid);
                break;
            }
            case 'plinko': {
                const panel=el('div','plinko-board');
                panel.append(el('div','plinko-drop','●'));
                for(let row=0;row<8;row++) {
                    const pegRow=el('div','peg-row');
                    for(let i=0;i<row+2;i++) pegRow.append(el('span','peg'));
                    panel.append(pegRow);
                }
                if (state?.path) {
                    const trajectory=svg('svg',{viewBox:'0 0 440 240',class:'plinko-trajectory','aria-hidden':'true'});
                    let x=220;
                    let path='M220 0';
                    state.path.forEach((direction,index)=>{x+=direction ? 18 : -18;path+=' L'+x+' '+((index+1)*24);});
                    path+=' L'+(20+state.slot*50)+' 238';
                    trajectory.append(svg('path',{d:path,class:'plinko-trail'}));
                    trajectory.append(svg('circle',{cx:20+state.slot*50,cy:238,r:6,class:'plinko-ball'}));
                    panel.append(trajectory);
                }
                const bins=el('div','plinko-bins');
                const values=state?.multipliers || plinkoMultipliers[document.getElementById('risk').value];
                values.forEach((value,index)=>bins.append(el('span','plinko-bin' + (state?.slot === index ? ' selected' : ''),'×' + value)));
                panel.append(bins);board.append(panel);
                break;
            }
            case 'roulette': {
                const panel=el('div','roulette-board');
                const wheel=el('div','roulette-wheel');
                wheel.append(el('span','roulette-pointer','▼'),el('span','roulette-result' + (state?.color ? ' ' + state.color : ''),state?.number ?? '◎'));
                panel.append(wheel);
                const trail=el('div','number-trail');
                const red=[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
                for(let n=0;n<=36;n++) trail.append(el('span',n===0 ? 'green' : red.includes(n) ? 'red' : '',n));
                panel.append(trail);board.append(panel);
                break;
            }
            case 'slot-machine': {
                board.append(el('div','slot-header','3 ROULEAUX'));
                const reels=el('div','slot-display');
                const symbols={cherry:'🍒',lemon:'🍋',grape:'🍇',bell:'♧',diamond:'◇',seven:'7'};
                (state?.symbols || ['seven','seven','seven']).forEach(symbol=>reels.append(el('span','slot-reel',symbols[symbol] || '7')));
                board.append(reels);
                break;
            }
            case 'coinflip':
                board.append(el('div','coin-display',state?.side === 'tails' ? 'L' : '✦'),el('div','coin-caption',state ? (state.side === 'tails' ? 'Face' : 'Pile') : 'Pile ou face ?'));
                break;
            case 'crash': {
                const panel=el('div','crash-board');
                const chart=svg('svg',{viewBox:'0 0 500 280',class:'crash-chart','aria-hidden':'true'});
                chart.append(svg('path',{d:'M10 20V260H490 M10 180H490 M10 100H490 M110 20V260 M210 20V260 M310 20V260 M410 20V260',class:'graph-grid'}));
                const current=state ? Number(state.status === 'lost' ? (state.crashAt ?? state.currentMultiplier ?? 1) : (state.currentMultiplier ?? state.multiplier ?? 1)) : 1;
                const rise=Math.min(225,Math.max(10,(current-1)*80));
                chart.append(svg('path',{d:'M10 250 C150 250 225 240 330 ' + (250-rise*.45) + ' S430 ' + (250-rise) + ' 485 ' + (250-rise),class:'graph-line'}));
                panel.append(chart,el('div','crash-value' + (state?.status==='lost' ? ' busted' : ''),current.toFixed(2) + '×'),el('div','crash-label',state?.status==='lost' ? 'CRASH' : state?.status==='won' ? 'ENCAISSÉ' : state ? 'EN COURS' : 'PRÊT'));
                board.append(panel);
                break;
            }
            case 'chicken-road': {
                board.append(el('div','road-label',(state?.steps || 0) + ' / ' + (state?.maxSteps || 12) + ' voies traversées'));
                const road=el('div','road-board');
                const steps=state?.steps || 0;
                for(let lane=0;lane<12;lane++) {
                    const node=el('div','road-lane' + (lane<steps ? ' crossed' : '') + (lane===Math.max(0,steps-1) ? ' current' : ''));
                    node.append(el('span','',lane+1));
                    node.append(el('span',lane===Math.max(0,steps-1) ? 'chicken' : 'car',lane===Math.max(0,steps-1) ? (state?.status==='lost' ? '✹' : '🐔') : (lane%3===1 && lane>=steps ? '▰' : '')));
                    node.append(el('span','',lane<steps ? '✓' : '···'));
                    road.append(node);
                }
                board.append(road);
                const currentLane = road.querySelector('.current');
                if (currentLane) road.scrollLeft = Math.max(0,currentLane.offsetLeft - road.offsetLeft - 100);
                break;
            }
            case 'liotodle':
                renderWord(state);
                break;
        }
    }
    function renderWord(state) {
        const guesses=state?.guesses || [];
        const grid=el('div','word-board');
        for(let row=0;row<6;row++) for(let column=0;column<5;column++) {
            const guess=guesses[row];
            const typed=row===guesses.length && state?.status==='active';
            const value=guess?.word[column] || (typed ? draftWord[column] || '' : '');
            grid.append(el('span','word-cell' + (guess ? ' ' + guess.result[column] : typed && value ? ' typed' : ''),value));
        }
        board.append(grid);
        const wordForm=el('form','word-input-form');
        const input=el('input');input.id='word-input';input.name='word';input.type='text';input.maxLength=5;input.minLength=5;input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label','Mot de cinq lettres');input.setAttribute('pattern','[A-Za-z]{5}');input.placeholder='VOTRE MOT';input.value=draftWord;input.required=true;
        input.addEventListener('input',()=>{draftWord=input.value.toUpperCase().replace(/[^A-Z]/g,'').slice(0,5);input.value=draftWord;updateDraft();});
        const submit=el('button','button','Valider ↗');submit.type='submit';
        wordForm.append(input,submit);wordForm.addEventListener('submit',event=>{event.preventDefault();guessWord();});
        board.append(wordForm);
        const letterStates={};const priorities={absent:1,present:2,correct:3};
        guesses.forEach(guess=>guess.word.split('').forEach((letter,index)=>{if((priorities[guess.result[index]]||0)>(priorities[letterStates[letter]]||0))letterStates[letter]=guess.result[index];}));
        const keyboard=el('div','word-keyboard');
        ['QWERTYUIOP','ASDFGHJKL','↵ZXCVBNM⌫'].forEach(letters=>{
            const row=el('div','keyboard-row');
            [...letters].forEach(letter=>{
                const button=el('button','keyboard-key' + (letter==='↵'||letter==='⌫' ? ' wide' : '') + (letterStates[letter] ? ' ' + letterStates[letter] : ''),letter);
                button.type='button';button.setAttribute('aria-label',letter==='↵' ? 'Valider le mot' : letter==='⌫' ? 'Effacer la dernière lettre' : letter);
                button.addEventListener('click',()=>{
                    if(!active()||busy)return;
                    if(letter==='↵')return guessWord();
                    draftWord=letter==='⌫' ? draftWord.slice(0,-1) : (draftWord+letter).slice(0,5);
                    input.value=draftWord;updateDraft();
                });row.append(button);
            });keyboard.append(row);
        });board.append(keyboard);
    }
    function updateDraft() {
        const offset=(round?.guesses?.length || 0)*5;
        const cells=board.querySelectorAll('.word-cell');
        for(let i=0;i<5;i++) if(cells[offset+i]) {
            const changed = cells[offset+i].textContent !== (draftWord[i] || '');
            cells[offset+i].textContent=draftWord[i]||'';
            cells[offset+i].classList.toggle('typed',Boolean(draftWord[i]));
            if (changed && draftWord[i]) motion.typeCell(cells[offset+i]);
        }
    }
    async function guessWord() {
        if(draftWord.length!==5) {announce('Votre mot doit contenir cinq lettres.','error');motion.invalidWord();return;}
        if(busy||!active())return;
        const before=round.guesses.length;
        await act('guess',{word:draftWord});
        if(round.guesses.length>before) {
            if(active())document.getElementById('word-input')?.focus();
        }
    }
    form.addEventListener('submit',async event=>{
        event.preventDefault();
        if(busy||active()||!authenticated)return;
        const values=new FormData(form);
        const options={};
        for(const key of ['side','selection','risk','difficulty']) if(values.has(key))options[key]=values.get(key);
        if(values.has('mines'))options.mines=Number(values.get('mines'));
        setBusy(true);
        announce('Votre partie se prépare…');
        const coin=board.querySelector('.coin-display');
        const slots=board.querySelector('.slot-display');
        coin?.classList.add('is-flipping');slots?.classList.add('is-spinning');
        try {await request(endpoint,{game,stake:game==='liotodle' ? 0 : Number(values.get('stake')),options});}
        catch(error) {
            announce(error.message,'error');
            // A failed network response may still have started a server round.
            try {await request(endpoint + '/current');} catch {}
        } finally {coin?.classList.remove('is-flipping');slots?.classList.remove('is-spinning');setBusy(false);scheduleCrash();}
    });
    document.querySelectorAll('[data-stake]').forEach(button=>button.addEventListener('click',()=>{
        const input=document.getElementById('stake');
        input.value=String(Math.min(Number(button.dataset.stake),Number(input.max)));
    }));
    forfeit.addEventListener('click',()=>{
        if(window.confirm('Abandonner cette manche ? La mise engagée sera perdue.'))act('forfeit');
    });
    function syncMineSlider() {
        const slider = document.getElementById('mines');
        if (!slider) return;
        const count = Number(slider.value);
        const minesLabel = count + (count === 1 ? ' mine' : ' mines');
        const safeLabel = (25-count) + (count === 24 ? ' diamant' : ' diamants');
        document.getElementById('mine-count').textContent = minesLabel;
        document.getElementById('safe-count').textContent = safeLabel;
        slider.style.setProperty('--range-progress', ((count-1)/23*100) + '%');
        slider.setAttribute('aria-valuetext', minesLabel + ', ' + safeLabel);
    }
    document.getElementById('mines')?.addEventListener('input',()=>{syncMineSlider();if(!round)renderBoard();syncControls();});
    document.getElementById('risk')?.addEventListener('change',()=>{if(!round)renderBoard();syncControls();});
    document.addEventListener('visibilitychange',()=>{
        if(document.hidden) clearTimeout(pollTimer);
        else if(authenticated&&game==='crash')request(endpoint+'/current').catch(error=>announce(error.message,'error'));
    });
    syncMineSlider();renderBoard();syncControls();
    if(dailyComplete) announce('Votre défi du jour a déjà commencé ou est terminé. Les parties en cours se reprennent automatiquement; revenez demain pour un nouveau mot.');
    if(authenticated) {
        setBusy(true);
        request(endpoint+'/current').catch(error=>announce(error.message,'error')).finally(()=>{setBusy(false);scheduleCrash();});
    }
}
