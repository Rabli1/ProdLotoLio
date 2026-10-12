<?php

namespace App\Services;

use App\Models\GameRound;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** All draws, hidden state, wagers and settlements live on the server. */
class GameRoundService
{
    public const GAMES = ['blackjack', 'plinko', 'mines', 'chicken-road', 'roulette', 'slot-machine', 'crash', 'coinflip', 'poker', 'liotodle'];
    public const MINES_MAX = 24;
    private const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    private const PLINKO = [
        'low' => [3, 1.5, 1, .8, .5, .8, 1, 1.5, 3],
        'medium' => [12, 3, 1.2, .5, .3, .5, 1.2, 3, 12],
        'high' => [30, 5, .8, .3, .1, .3, .8, 5, 30],
    ];

    public function start(int $userId, string $game, int $stake, array $options): array
    {
        return DB::transaction(function () use ($userId, $game, $stake, $options) {
            $user = $this->lockPlayer($userId);
            $active = GameRound::where('user_id', $userId)->where('status', 'active')->lockForUpdate()->first();
            if ($active) {
                if ($active->created_at->lt(now()->subDay())) {
                    $this->settle($active, $user, 0, 'Partie expirée.');
                    $active->save();
                } else {
                    abort(409, 'Termine ou abandonne ta partie en cours avant de rejouer.');
                }
            }
            if ($game === 'liotodle') {
                if (GameRound::where('user_id', $userId)->where('game', 'liotodle')->whereDate('created_at', today())->exists()) {
                    abort(409, 'Le Liotodle a déjà été joué aujourd’hui.');
                }
            } elseif ($stake > $user->points) {
                throw ValidationException::withMessages(['stake' => 'Solde insuffisant.']);
            }

            $user->points -= $stake;
            $user->pointsLost = min(1000000000, $user->pointsLost + $stake);
            $round = new GameRound([
                'id' => (string) Str::uuid(), 'user_id' => $userId, 'game' => $game,
                'stake' => $stake, 'status' => 'active', 'payout' => 0, 'state' => [],
            ]);
            $this->initialize($round, $user, $options);
            $round->save();
            $user->save();
            app(UserServices::class)->rememberInSession($user);

            return $this->response($round, $user);
        }, 5);
    }

    public function action(int $userId, string $roundId, array $input): array
    {
        return DB::transaction(function () use ($userId, $roundId, $input) {
            $user = $this->lockPlayer($userId);
            // Owner filtering avoids exposing another player's hidden state or round existence.
            $round = GameRound::whereKey($roundId)->where('user_id', $userId)->lockForUpdate()->firstOrFail();
            abort_unless($round->status === 'active', 409, 'Cette partie est déjà terminée.');
            if ($round->created_at->lt(now()->subDay())) {
                $this->settle($round, $user, 0, 'Partie expirée.');
            } elseif (($input['action'] ?? '') === 'forfeit') {
                $this->settle($round, $user, 0, 'Partie abandonnée.');
            } else {
                match ($round->game) {
                    'blackjack' => $this->blackjackAction($round, $user, $input),
                    'mines' => $this->minesAction($round, $user, $input),
                    'chicken-road' => $this->chickenAction($round, $user, $input),
                    'crash' => $this->crashAction($round, $user, $input),
                    'poker' => $this->pokerAction($round, $user, $input),
                    'liotodle' => $this->wordAction($round, $user, $input),
                    default => $this->invalidAction(),
                };
            }
            $round->save();
            $user->save();
            app(UserServices::class)->rememberInSession($user);

            return $this->response($round, $user);
        }, 5);
    }

    public function current(int $userId): array
    {
        return DB::transaction(function () use ($userId) {
            $user = $this->lockPlayer($userId);
            $round = GameRound::where('user_id', $userId)->where('status', 'active')->lockForUpdate()->first();
            if ($round && ($round->created_at->lt(now()->subDay()) || ($round->game === 'crash' && $this->crashMultiplier($round) >= $round->state['crashAt']))) {
                $this->settle($round, $user, 0, $round->game === 'crash' ? 'Le vol est terminé.' : 'Partie expirée.');
                $round->save();
                $user->save();
            }
            app(UserServices::class)->rememberInSession($user);
            return ['round' => $round ? $this->publicRound($round) : null, 'balance' => $user->points];
        }, 5);
    }

    private function lockPlayer(int $id): User
    {
        $user = User::whereKey($id)->lockForUpdate()->firstOrFail();
        abort_unless($user->confirmed && !$user->banned, 403);
        return $user;
    }

    private function initialize(GameRound $round, User $user, array $options): void
    {
        switch ($round->game) {
            case 'coinflip':
                $side = random_int(0, 1) ? 'heads' : 'tails';
                $round->state = ['side' => $side, 'choice' => $options['side'] ?? 'heads'];
                $this->settle($round, $user, $side === $round->state['choice'] ? 1.95 : 0, $side === 'heads' ? 'Pile' : 'Face');
                break;
            case 'roulette':
                $number = random_int(0, 36);
                $selection = (string) ($options['selection'] ?? 'red');
                $color = $number === 0 ? 'green' : (in_array($number, self::RED_NUMBERS, true) ? 'red' : 'black');
                $multiplier = is_numeric($selection) ? ($number === (int) $selection ? 36 : 0)
                    : ($selection === $color ? ($color === 'green' ? 36 : 2) : 0);
                $round->state = ['number' => $number, 'color' => $color, 'selection' => $selection];
                $this->settle($round, $user, $multiplier, 'Numéro '.$number);
                break;
            case 'plinko':
                $slot = 0;
                $path = [];
                for ($i = 0; $i < 8; $i++) {
                    $path[] = random_int(0, 1);
                    $slot += $path[$i];
                }
                $risk = $options['risk'] ?? 'medium';
                $round->state = ['slot' => $slot, 'path' => $path, 'risk' => $risk, 'multipliers' => self::PLINKO[$risk]];
                $this->settle($round, $user, self::PLINKO[$risk][$slot], 'Case '.($slot + 1));
                break;
            case 'slot-machine':
                $symbols = ['cherry', 'lemon', 'grape', 'bell', 'diamond', 'seven'];
                $reels = [$symbols[random_int(0, 5)], $symbols[random_int(0, 5)], $symbols[random_int(0, 5)]];
                $unique = count(array_unique($reels));
                $multiplier = $unique === 1 ? ['cherry' => 6, 'lemon' => 8, 'grape' => 10, 'bell' => 15, 'diamond' => 30, 'seven' => 50][$reels[0]] : ($unique === 2 ? 1 : 0);
                $round->state = ['symbols' => $reels];
                $this->settle($round, $user, $multiplier, $unique === 1 ? 'Trois symboles identiques.' : ($unique === 2 ? 'Paire : mise rendue.' : 'Aucune combinaison.'));
                break;
            case 'blackjack':
                $deck = $this->deck();
                $state = ['deck' => $deck, 'playerCards' => [], 'dealerCards' => []];
                for ($i = 0; $i < 2; $i++) {
                    $state['playerCards'][] = array_pop($state['deck']);
                    $state['dealerCards'][] = array_pop($state['deck']);
                }
                $round->state = $state;
                if ($this->cardTotal($state['playerCards']) === 21 || $this->cardTotal($state['dealerCards']) === 21) {
                    $playerTotal = $this->cardTotal($state['playerCards']);
                    $dealerTotal = $this->cardTotal($state['dealerCards']);
                    $this->settle($round, $user, $playerTotal === $dealerTotal ? 1 : ($playerTotal === 21 ? 2.5 : 0), 'Blackjack.');
                }
                break;
            case 'mines':
                $count = (int) ($options['mines'] ?? 3);
                $cells = range(0, 24);
                $this->shuffleSecure($cells);
                $round->state = ['mines' => $count, 'minesPositions' => array_slice($cells, 0, $count), 'revealed' => [], 'multiplier' => 1];
                break;
            case 'chicken-road':
                $round->state = ['difficulty' => $options['difficulty'] ?? 'medium', 'steps' => 0, 'maxSteps' => 12, 'multiplier' => 1];
                break;
            case 'crash':
                // The hidden outcome is independent of all client timing and claimed multipliers.
                $uniform = random_int(1, 1000000) / 1000001;
                $round->state = ['startedAt' => now()->valueOf(), 'crashAt' => min(100, max(1, floor(.97 / $uniform * 100) / 100))];
                break;
            case 'poker':
                $deck = $this->deck();
                $cards = [];
                for ($i = 0; $i < 5; $i++) {
                    $cards[] = array_pop($deck);
                }
                $round->state = ['cards' => $cards, 'deck' => $deck, 'hand' => ''];
                break;
            case 'liotodle':
                $words = $this->words();
                $round->state = ['secret' => $words[random_int(0, count($words) - 1)], 'guesses' => [], 'maxAttempts' => 6];
                break;
        }
    }

    private function blackjackAction(GameRound $round, User $user, array $input): void
    {
        $state = $round->state;
        if ($input['action'] === 'hit') {
            $state['playerCards'][] = array_pop($state['deck']);
            $round->state = $state;
            $total = $this->cardTotal($state['playerCards']);
            if ($total > 21) {
                $this->settle($round, $user, 0, 'Main supérieure à 21.');
            } elseif ($total === 21) {
                $this->blackjackAction($round, $user, ['action' => 'stand']);
            }
        } elseif ($input['action'] === 'stand') {
            while ($this->cardTotal($state['dealerCards']) < 17) {
                $state['dealerCards'][] = array_pop($state['deck']);
            }
            $round->state = $state;
            $player = $this->cardTotal($state['playerCards']);
            $dealer = $this->cardTotal($state['dealerCards']);
            $multiplier = $dealer > 21 || $player > $dealer ? 2 : ($player === $dealer ? 1 : 0);
            $this->settle($round, $user, $multiplier, $multiplier === 2 ? 'Main gagnante.' : ($multiplier === 1 ? 'Égalité.' : 'Le croupier gagne.'));
        } else {
            $this->invalidAction();
        }
    }

    private function minesAction(GameRound $round, User $user, array $input): void
    {
        $state = $round->state;
        if ($input['action'] === 'cashout') {
            if (count($state['revealed']) === 0) {
                $this->invalidAction('Révèle au moins une case avant de retirer.');
            }
            $this->settle($round, $user, $state['multiplier'], 'Retrait effectué.');
        } elseif ($input['action'] === 'reveal' && isset($input['cell'])) {
            $cell = (int) $input['cell'];
            if (in_array($cell, $state['revealed'], true)) {
                $this->invalidAction('Cette case est déjà ouverte.');
            }
            $state['revealed'][] = $cell;
            $round->state = $state;
            if (in_array($cell, $state['minesPositions'], true)) {
                $this->settle($round, $user, 0, 'Mine.');
                return;
            }
            $probability = 1;
            for ($i = 0; $i < count($state['revealed']); $i++) {
                $probability *= (25 - $state['mines'] - $i) / (25 - $i);
            }
            $state['multiplier'] = min(1000, floor(.96 / $probability * 100) / 100);
            $round->state = $state;
            if (count($state['revealed']) === 25 - $state['mines']) {
                $this->settle($round, $user, $state['multiplier'], 'Toutes les cases sûres sont ouvertes.');
            }
        } else {
            $this->invalidAction();
        }
    }

    private function chickenAction(GameRound $round, User $user, array $input): void
    {
        $state = $round->state;
        if ($input['action'] === 'cashout') {
            if ($state['steps'] === 0) {
                $this->invalidAction('Avance au moins une fois avant de retirer.');
            }
            $this->settle($round, $user, $state['multiplier'], 'Retrait effectué.');
        } elseif ($input['action'] === 'step') {
            $survival = ['easy' => 88, 'medium' => 76, 'hard' => 62][$state['difficulty']];
            $state['steps']++;
            $round->state = $state;
            if (random_int(1, 100) > $survival) {
                $this->settle($round, $user, 0, 'Collision.');
                return;
            }
            $state['multiplier'] = floor(.96 / pow($survival / 100, $state['steps']) * 100) / 100;
            $round->state = $state;
            if ($state['steps'] >= $state['maxSteps']) {
                $this->settle($round, $user, $state['multiplier'], 'Route traversée.');
            }
        } else {
            $this->invalidAction();
        }
    }

    private function crashAction(GameRound $round, User $user, array $input): void
    {
        if (!in_array($input['action'], ['status', 'cashout'], true)) {
            $this->invalidAction();
        }
        $multiplier = $this->crashMultiplier($round);
        if ($multiplier >= $round->state['crashAt']) {
            $this->settle($round, $user, 0, 'Le vol est terminé.');
        } elseif ($input['action'] === 'cashout') {
            $this->settle($round, $user, $multiplier, 'Retrait effectué.');
        }
    }

    private function crashMultiplier(GameRound $round): float
    {
        $elapsed = max(0, now()->valueOf() - $round->state['startedAt']);
        return min(100, floor(exp(min(50000, $elapsed) / 10000) * 100) / 100);
    }

    private function pokerAction(GameRound $round, User $user, array $input): void
    {
        if ($input['action'] !== 'draw') {
            $this->invalidAction();
        }
        $state = $round->state;
        $hold = $input['hold'] ?? [];
        for ($i = 0; $i < 5; $i++) {
            if (!in_array($i, $hold, true)) {
                $state['cards'][$i] = array_pop($state['deck']);
            }
        }
        [$hand, $multiplier] = $this->pokerHand($state['cards']);
        $state['hand'] = $hand;
        $round->state = $state;
        $this->settle($round, $user, $multiplier, $hand);
    }

    private function pokerHand(array $cards): array
    {
        $ranks = array_map(fn (array $card) => array_search($card['rank'], ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'], true) + 2, $cards);
        sort($ranks);
        $counts = array_count_values($ranks);
        $groups = array_values($counts);
        rsort($groups);
        $flush = count(array_unique(array_column($cards, 'suit'))) === 1;
        $straight = count($counts) === 5 && ($ranks[4] - $ranks[0] === 4 || $ranks === [2, 3, 4, 5, 14]);
        if ($straight && $flush) {
            return $ranks === [10, 11, 12, 13, 14] ? ['Quinte flush royale', 250] : ['Quinte flush', 50];
        }
        if ($groups[0] === 4) return ['Carré', 25];
        if ($groups === [3, 2]) return ['Full', 9];
        if ($flush) return ['Couleur', 6];
        if ($straight) return ['Quinte', 4];
        if ($groups[0] === 3) return ['Brelan', 3];
        if ($groups === [2, 2, 1]) return ['Deux paires', 2];
        foreach ($counts as $rank => $count) {
            if ($count === 2 && $rank >= 11) return ['Paire de valets ou mieux', 1];
        }
        return ['Pas de combinaison gagnante', 0];
    }

    private function wordAction(GameRound $round, User $user, array $input): void
    {
        if ($input['action'] !== 'guess' || !isset($input['word'])) {
            $this->invalidAction();
        }
        $word = strtoupper($input['word']);
        if (!in_array($word, $this->words(), true)) {
            $this->invalidAction('Ce mot ne figure pas dans le dictionnaire.');
        }
        $state = $round->state;
        $secret = str_split($state['secret']);
        $letters = str_split($word);
        $result = array_fill(0, 5, 'absent');
        for ($i = 0; $i < 5; $i++) {
            if ($letters[$i] === $secret[$i]) {
                $result[$i] = 'correct';
                $secret[$i] = null;
            }
        }
        for ($i = 0; $i < 5; $i++) {
            if ($result[$i] === 'correct') continue;
            $match = array_search($letters[$i], $secret, true);
            if ($match !== false) {
                $result[$i] = 'present';
                $secret[$match] = null;
            }
        }
        $won = $word === $state['secret'];
        $state['guesses'][] = ['word' => $word, 'result' => $result, 'won' => $won];
        $round->state = $state;
        if ($won || count($state['guesses']) >= 6) {
            $this->settle($round, $user, 0, $won ? 'Mot trouvé : +300 points.' : 'Le mot était '.$state['secret'], $won ? 300 : 0);
        }
    }

    private function words(): array
    {
        $words = json_decode(file_get_contents(resource_path('data/liotodle.json')), true, 512, JSON_THROW_ON_ERROR);
        $words = array_values(array_filter(array_map('strtoupper', $words), fn (string $word) => preg_match('/^[A-Z]{5}$/', $word)));
        if (!$words) throw new \RuntimeException('Le dictionnaire est vide.');
        return $words;
    }

    private function settle(GameRound $round, User $user, float $multiplier, string $result, ?int $fixedPayout = null): void
    {
        if ($round->status !== 'active') return;
        $payout = $fixedPayout ?? (int) floor($round->stake * $multiplier);
        $round->payout = $payout;
        $round->status = $payout > 0 ? 'won' : 'lost';
        $round->state = array_merge($round->state, ['multiplier' => $multiplier, 'result' => $result]);
        $user->points = min(1000000000, $user->points + $payout);
        $user->exp += max(0, $payout - $round->stake);
        while ($user->exp >= max(1, $user->lvl) * 1000) {
            $user->exp -= max(1, $user->lvl) * 1000;
            $user->lvl++;
        }
    }

    private function deck(): array
    {
        $deck = [];
        foreach (['C', 'D', 'H', 'S'] as $suit) {
            foreach (['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as $rank) {
                $deck[] = ['rank' => $rank, 'suit' => $suit];
            }
        }
        $this->shuffleSecure($deck);
        return $deck;
    }

    private function shuffleSecure(array &$values): void
    {
        for ($i = count($values) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$values[$i], $values[$j]] = [$values[$j], $values[$i]];
        }
    }

    private function cardTotal(array $cards): int
    {
        $total = 0;
        $aces = 0;
        foreach ($cards as $card) {
            if ($card['rank'] === 'A') {
                $aces++;
                $total += 11;
            } else {
                $total += in_array($card['rank'], ['J', 'Q', 'K'], true) ? 10 : (int) $card['rank'];
            }
        }
        while ($total > 21 && $aces-- > 0) $total -= 10;
        return $total;
    }

    private function invalidAction(string $message = 'Action invalide pour cette partie.'): never
    {
        throw ValidationException::withMessages(['action' => $message]);
    }

    private function response(GameRound $round, User $user): array
    {
        return ['round' => $this->publicRound($round), 'balance' => $user->points];
    }

    private function publicRound(GameRound $round): array
    {
        $state = $round->state;
        unset($state['deck'], $state['secret'], $state['crashAt']);
        if ($round->game === 'mines' && $round->status === 'active') unset($state['minesPositions']);
        if ($round->game === 'blackjack') {
            $state['playerTotal'] = $this->cardTotal($state['playerCards']);
            $state['dealerTotal'] = $round->status === 'active' ? null : $this->cardTotal($state['dealerCards']);
            if ($round->status === 'active') $state['dealerCards'] = [$state['dealerCards'][0], ['hidden' => true]];
        }
        if ($round->game === 'crash') {
            $state['currentMultiplier'] = $round->status === 'active' ? $this->crashMultiplier($round) : ($state['multiplier'] ?? 0);
            if ($round->status !== 'active') $state['crashAt'] = $round->state['crashAt'];
        }
        if ($round->game === 'liotodle') {
            $state['attempts'] = count($state['guesses']);
            if ($round->status !== 'active') $state['answer'] = $round->state['secret'];
        }
        return array_merge(['id' => $round->id, 'game' => $round->game, 'status' => $round->status,
            'stake' => $round->stake, 'payout' => $round->payout], $state);
    }
}
