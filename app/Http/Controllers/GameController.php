<?php

namespace App\Http\Controllers;

use App\Models\GameRound;
use App\Services\GameRoundService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class GameController extends Controller
{
    public function show(Request $request, string $game)
    {
        abort_unless(in_array($game, GameRoundService::GAMES, true), 404);
        $player = $request->attributes->get('player');
        $available = $player && !GameRound::where('user_id', $player->id)->where('game', 'liotodle')->whereDate('created_at', today())->exists();
        return view('game.'.$game, [
            'playerBalance' => $player?->points ?? 0,
            'liotodleDailyAvailable' => $available,
            'liotodleDailyLockMessage' => $available ? '' : 'Connecte-toi ou reviens demain pour le Liotodle.',
        ]);
    }

    public function startRound(Request $request, GameRoundService $games)
    {
        $validated = $request->validate([
            'game' => ['required', Rule::in(GameRoundService::GAMES)],
            'stake' => ['required', 'integer', 'min:0', 'max:10000'],
            'options' => ['sometimes', 'array:side,selection,risk,mines,difficulty'],
            'options.side' => ['sometimes', Rule::in(['heads', 'tails'])],
            'options.selection' => ['sometimes', Rule::in(array_merge(['red', 'black', 'green'], array_map('strval', range(0, 36))))],
            'options.risk' => ['sometimes', Rule::in(['low', 'medium', 'high'])],
            'options.mines' => ['sometimes', 'integer', 'min:1', 'max:'.GameRoundService::MINES_MAX],
            'options.difficulty' => ['sometimes', Rule::in(['easy', 'medium', 'hard'])],
        ]);
        if (($validated['game'] === 'liotodle' && (int) $validated['stake'] !== 0)
            || ($validated['game'] !== 'liotodle' && (int) $validated['stake'] < 1)) {
            throw \Illuminate\Validation\ValidationException::withMessages(['stake' => 'Mise invalide.']);
        }
        return response()->json($games->start($request->attributes->get('player')->id,
            $validated['game'], (int) $validated['stake'], $validated['options'] ?? []));
    }

    public function roundAction(Request $request, string $round, GameRoundService $games)
    {
        $validated = $request->validate([
            'action' => ['required', Rule::in(['hit', 'stand', 'reveal', 'cashout', 'step', 'status', 'draw', 'guess', 'forfeit'])],
            'cell' => ['sometimes', 'integer', 'min:0', 'max:24'],
            'hold' => ['sometimes', 'array', 'max:5'],
            'hold.*' => ['integer', 'distinct', 'min:0', 'max:4'],
            'word' => ['sometimes', 'string', 'regex:/^[a-zA-Z]{5}$/'],
        ]);
        if (isset($validated['hold'])) $validated['hold'] = array_map('intval', $validated['hold']);
        return response()->json($games->action($request->attributes->get('player')->id, $round, $validated));
    }

    public function currentRound(Request $request, GameRoundService $games)
    {
        return response()->json($games->current($request->attributes->get('player')->id));
    }

    public function retiredEndpoint()
    {
        return response()->json(['message' => 'Ce protocole a été remplacé par des parties calculées par le serveur. Recharge la page.'], 410);
    }
}
