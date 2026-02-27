export type GamePhase = 'contribution' | 'reveal' | 'final' | 'complete';

export interface User {
  id: string;
  display_name: string;
  created_at: string;
}

export interface Room {
  id: string;
  invite_code: string;
  max_players: number;
  is_locked: boolean;
  locked_at: string | null;
  phase: GamePhase;
  streak_count: number;
  game_date: string; // round mode: "1","2",… | daily mode: "YYYY-MM-DD" (LA tz)
  created_at: string;
}

export interface RoomMember {
  room_id: string;
  user_id: string;
  display_name: string; // denormalized from users
  joined_at: string;
  reveal_viewed_at: string | null;
  ready_for_next: boolean; // round mode: true when player has clicked "Start Next Word"
}

export interface Guess {
  id: string;
  room_id: string;
  user_id: string;
  game_date: string; // YYYY-MM-DD
  phase: 'contribution' | 'final';
  guess: string;
  is_correct: boolean | null;
  submitted_at: string;
}

export interface Result {
  room_id: string;
  game_date: string;
  winner_user_id: string | null;
  solved_at: string | null;
  all_participated: boolean;
  created_at: string;
}

export interface RevealData {
  presentLetters: string[];
  eliminatedLetters: string[];
  knownPositions: (string | null)[];
}

export interface PlayerKnowledge {
  presentLetters: string[];
  eliminatedLetters: string[];
  knownPositions: (string | null)[]; // 7 slots; null = unknown
}
