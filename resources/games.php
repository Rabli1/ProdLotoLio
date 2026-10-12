<?php
return [
    'blackjack' => ['name' => 'Blackjack', 'category' => 'Cartes', 'icon' => '♠', 'rules' => 'Approchez-vous de 21 sans dépasser. Le croupier tire jusqu’à 17. Une égalité rembourse la mise; un blackjack naturel paie 2,5 fois la mise.'],
    'plinko' => ['name' => 'Plinko', 'category' => 'Chance', 'icon' => '●', 'rules' => 'Choisissez votre risque puis lancez une bille. Le multiplicateur de sa case d’arrivée détermine votre retour. Consultez les neuf multiplicateurs du plateau.'],
    'mines' => ['name' => 'Mines', 'category' => 'Risque', 'icon' => '◇', 'rules' => 'Choisissez de 1 à 24 mines sur 25 cases. Révélez des diamants puis encaissez. Une mine met fin à la manche et à la mise. Ouvrir toutes les cases sûres encaisse automatiquement le gain.'],
    'roulette' => ['name' => 'Roulette', 'category' => 'Chance', 'icon' => '◎', 'rules' => 'La roue compte 37 numéros de 0 à 36. Rouge ou noir paie 2 fois, le zéro vert ou un numéro exact paie 36 fois la mise.'],
    'slot-machine' => ['name' => 'Machine à sous', 'category' => 'Chance', 'icon' => '7', 'rules' => 'Lancez les trois rouleaux. Une combinaison gagnante paie selon les symboles obtenus. Le résultat et son multiplicateur sont affichés à chaque tour.'],
    'crash' => ['name' => 'Crash', 'category' => 'Risque', 'icon' => '↗', 'rules' => 'Le multiplicateur augmente en temps réel. Encaissez avant le crash pour récupérer la mise multipliée. Si le crash survient d’abord, la mise est perdue.'],
    'coinflip' => ['name' => 'Coin Flip', 'category' => 'Chance', 'icon' => '◉', 'rules' => 'Choisissez pile ou face et lancez la pièce. Une bonne prédiction paie 1,95 fois la mise, autrement la mise est perdue.'],
    'poker' => ['name' => 'Video Poker', 'category' => 'Cartes', 'icon' => '♥', 'rules' => 'Recevez cinq cartes et sélectionnez celles à garder. Remplacez les autres une fois. La combinaison finale détermine le gain : paire de valets ou mieux jusqu’à la quinte flush royale.'],
    'chicken-road' => ['name' => 'Chicken Road', 'category' => 'Risque', 'icon' => '✦', 'rules' => 'Choisissez la difficulté puis traversez une voie à la fois. Chaque passage réussi augmente le multiplicateur. Encaissez avant une collision.'],
    'liotodle' => ['name' => 'Liotodle', 'category' => 'Quotidien', 'icon' => 'L', 'rules' => 'Trouvez le mot de cinq lettres en six essais. Vert : bonne lettre au bon endroit. Or : lettre présente ailleurs. Gris : absente. Une seule partie par jour, sans mise.'],
];
