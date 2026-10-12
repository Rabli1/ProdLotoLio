@php($catalog = require resource_path('games.php'))
@php($game = $catalog[$gameKey])
@php($pageTitle = $game['name'])
@include('shared.header')
@include('shared.navbar')
<main id="main-content" class="page-width game-page" data-game="{{ $gameKey }}" data-authenticated="{{ session()->has('user') ? 'true' : 'false' }}" data-daily-available="{{ ($liotodleDailyAvailable ?? true) ? 'true' : 'false' }}" data-api="{{ url('/game/rounds') }}">
    <a class="back-link" href="{{ url('/game') }}"><span aria-hidden="true">←</span> Tous les jeux</a>
    <div class="game-heading"><div><h1>{{ $game['name'] }}</h1></div><span class="game-category">{{ $game['icon'] }} {{ $game['category'] }}</span></div>
    @unless(session()->has('user'))<div class="notice"><a href="{{ url('/user/connection') }}">Connectez-vous</a> pour jouer.</div>@endunless
    <section class="game-workspace" aria-label="{{ $game['name'] }}">
        <aside class="game-panel">
            <div class="panel-title"><span>Partie</span><span class="mini-tag">POINTS VIRTUELS</span></div>
            <form id="round-form">
                @if($gameKey !== 'liotodle')
                <label for="stake">Mise</label><div class="stake-input"><span aria-hidden="true">◈</span><input id="stake" name="stake" type="number" min="1" max="10000" step="1" value="50" required inputmode="numeric"><span>pts</span></div>
                <div class="stake-presets">@foreach([10,50,100,250] as $stake)<button type="button" data-stake="{{ $stake }}">{{ $stake }}</button>@endforeach</div>
                @endif
                @switch($gameKey)
                    @case('coinflip')<label for="side">Votre côté</label><select id="side" name="side"><option value="heads">Pile ✦</option><option value="tails">Face L</option></select>@break
                    @case('roulette')<label for="selection">Votre pari</label><select id="selection" name="selection"><option value="red">Rouge · ×2</option><option value="black">Noir · ×2</option><option value="green">Zéro · ×36</option>@for($n=1;$n<=36;$n++)<option value="{{ $n }}">Numéro {{ $n }} · ×36</option>@endfor</select>@break
                    @case('plinko')<label for="risk">Risque</label><select id="risk" name="risk"><option value="low">Faible</option><option value="medium" selected>Moyen</option><option value="high">Élevé</option></select>@break
                    @case('mines')
                        <label for="mines">Nombre de mines</label>
                        <div class="mine-slider">
                            <div class="mine-slider-meta"><output id="mine-count" for="mines">3 mines</output><output id="safe-count" for="mines">22 diamants</output></div>
                            <input id="mines" name="mines" type="range" min="1" max="24" step="1" value="3" aria-valuetext="3 mines, 22 diamants" style="--range-progress:8.696%">
                            <div class="mine-slider-meta" aria-hidden="true"><span>1</span><span>24</span></div>
                        </div>
                        @break
                    @case('chicken-road')<label for="difficulty">Difficulté</label><select id="difficulty" name="difficulty"><option value="easy">Facile</option><option value="medium" selected>Moyenne</option><option value="hard">Difficile</option></select>@break
                    @case('liotodle')<div class="daily-panel"><span class="daily-icon">L</span><h3>Le mot du jour</h3><p>5 lettres · 6 essais<br>Aucune mise nécessaire</p></div>@break
                @endswitch
                <button id="start-round" class="button play-button" type="submit" @disabled(!session()->has('user'))>{{ $gameKey === 'liotodle' ? 'Commencer le défi' : 'Jouer' }} <span aria-hidden="true">↗</span></button>
            </form>
            <div id="active-controls" class="active-controls" hidden></div>
            <div class="round-stats"><div><span>Multiplicateur</span><strong id="round-multiplier">—</strong></div><div><span>Retour</span><strong id="round-payout">—</strong></div></div>
            <div id="round-status" class="round-status" role="status" aria-live="polite">Choisissez vos options et lancez une partie.</div>
            <button id="forfeit-round" class="subtle-button" type="button" hidden>Abandonner la manche</button>
        </aside>
        <div class="game-stage stage-{{ $gameKey }}">
            <div class="stage-topline"><span class="live-dot"></span><span id="stage-state">PRÊT</span><span class="stage-brand">LIOL<span>OTO</span></span></div>
            <div id="game-board" class="game-board" aria-label="Plateau de jeu">@include('shared.game-art')</div>
            <div id="stage-caption" class="stage-caption"></div>
        </div>
    </section>
    <div class="game-bottom"><details class="rules-card" open><summary>Comment jouer <span aria-hidden="true">⌄</span></summary><p>{{ $game['rules'] }}</p>
        @if($gameKey==='poker')<dl class="paytable">@foreach(['Paire de valets ou mieux'=>1,'Deux paires'=>2,'Brelan'=>3,'Quinte'=>4,'Couleur'=>6,'Full'=>9,'Carré'=>25,'Quinte flush'=>50,'Quinte flush royale'=>250] as $hand=>$return)<div><dt>{{ $hand }}</dt><dd>×{{ $return }}</dd></div>@endforeach</dl>@endif
        @if($gameKey==='slot-machine')<dl class="paytable">@foreach(['🍒 ×3'=>6,'🍋 ×3'=>8,'🍇 ×3'=>10,'♧ ×3'=>15,'◇ ×3'=>30,'7 ×3'=>50,'Deux symboles identiques'=>1] as $symbols=>$return)<div><dt>{{ $symbols }}</dt><dd>×{{ $return }}</dd></div>@endforeach</dl>@endif
    </details><div class="recent-card"><h2>Dernières manches</h2><ol id="recent-rounds"><li class="empty-history">Aucune manche.</li></ol></div></div>
    <div class="other-games"><span>Autres jeux</span>
        @foreach(array_slice($catalog,0,5,true) as $key=>$other)
            @if($key!==$gameKey)<a href="{{ url('/game/'.$key) }}">{{ $other['icon'] }} {{ $other['name'] }} <span aria-hidden="true">↗</span></a>@endif
        @endforeach
    </div>
</main>
@include('shared.footer')
