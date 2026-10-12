<?php

namespace Tests\Feature;

use App\Models\GameRound;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MinesLimitsTest extends TestCase
{
    use RefreshDatabase;

    private function signIn(): User
    {
        $user = User::factory()->create();
        $this->withSession(['user_id' => $user->id, 'credential_version' => hash('sha256', $user->password)]);
        return $user;
    }

    public function test_both_mine_count_boundaries_create_valid_boards_without_exposing_mines(): void
    {
        $this->signIn();
        foreach ([1, 24] as $count) {
            $response = $this->postJson('/game/rounds', ['game' => 'mines', 'stake' => 10, 'options' => ['mines' => $count]])
                ->assertOk()->assertJsonPath('round.mines', $count)->assertJsonPath('round.status', 'active')
                ->assertJsonMissingPath('round.minesPositions');
            $round = GameRound::findOrFail($response->json('round.id'));
            $this->assertCount($count, $round->state['minesPositions']);
            $this->assertCount($count, array_unique($round->state['minesPositions']));
            $this->assertEmpty(array_diff($round->state['minesPositions'], range(0, 24)));
            $this->postJson('/game/rounds/'.$round->id.'/actions', ['action' => 'forfeit'])->assertOk();
        }
    }

    public function test_invalid_mine_counts_never_create_a_round_or_debit_the_account(): void
    {
        $user = $this->signIn();
        foreach ([0, 25, -1, 1.5, 'NaN'] as $count) {
            $this->postJson('/game/rounds', ['game' => 'mines', 'stake' => 100, 'options' => ['mines' => $count]])
                ->assertUnprocessable()->assertJsonValidationErrors('options.mines');
        }
        $this->assertSame(1000, $user->fresh()->points);
        $this->assertDatabaseCount('game_rounds', 0);
    }

    public function test_the_only_safe_tile_with_twentyfour_mines_automatically_pays_exactly_twentyfour_times(): void
    {
        $user = $this->signIn();
        $id = $this->postJson('/game/rounds', ['game' => 'mines', 'stake' => 100, 'options' => ['mines' => 24]])
            ->assertOk()->assertJsonPath('balance', 900)->json('round.id');
        $round = GameRound::findOrFail($id);
        $safeCells = array_values(array_diff(range(0, 24), $round->state['minesPositions']));
        $this->assertCount(1, $safeCells);
        $this->postJson('/game/rounds/'.$id.'/actions', ['action' => 'cashout'])->assertUnprocessable();
        $response = $this->postJson('/game/rounds/'.$id.'/actions', [
            'action' => 'reveal', 'cell' => $safeCells[0], 'multiplier' => 999999, 'payout' => 999999,
        ])->assertOk()->assertJsonPath('round.status', 'won')->assertJsonPath('round.payout', 2400)
            ->assertJsonPath('balance', 3300);
        // The one safe pick has probability 1/25; the existing 96% return gives exactly 24x.
        $this->assertSame(24.0, (float) $response->json('round.multiplier'));
        $this->assertSame(3300, $user->fresh()->points);
        $this->postJson('/game/rounds/'.$id.'/actions', ['action' => 'cashout'])->assertConflict();
        $this->postJson('/game/rounds/'.$id.'/actions', ['action' => 'reveal', 'cell' => $safeCells[0]])->assertConflict();
        $this->assertSame(3300, $user->fresh()->points);
    }

    public function test_hitting_any_of_twentyfour_mines_loses_the_stake_without_a_payout(): void
    {
        $user = $this->signIn();
        $id = $this->postJson('/game/rounds', ['game' => 'mines', 'stake' => 100, 'options' => ['mines' => 24]])
            ->assertOk()->json('round.id');
        $mine = GameRound::findOrFail($id)->state['minesPositions'][0];
        $this->postJson('/game/rounds/'.$id.'/actions', ['action' => 'reveal', 'cell' => $mine])
            ->assertOk()->assertJsonPath('round.status', 'lost')->assertJsonPath('round.payout', 0)
            ->assertJsonPath('balance', 900);
        $this->assertSame(900, $user->fresh()->points);
    }
}
