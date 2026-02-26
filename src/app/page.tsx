'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Room, RoomMember, User } from '@/types/game';

type RoomEntry = { room: Room; members: RoomMember[] };

function getRoomLabel(members: RoomMember[], userId: string): string {
  if (!members.length) return 'Empty room';
  return members.map(m => (m.user_id === userId ? 'You' : m.display_name)).join(' · ');
}

export default function Dashboard() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  const [rooms, setRooms] = useState<RoomEntry[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  const [maxPlayers, setMaxPlayers] = useState(4);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const [joinId, setJoinId] = useState('');

  // On mount, check localStorage for existing user
  useEffect(() => {
    const stored = localStorage.getItem('churro_user_id');
    if (stored) {
      fetch(`/api/users/${stored}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.user) {
            setUser(data.user);
          } else {
            // Stale ID — clear it
            localStorage.removeItem('churro_user_id');
          }
        })
        .catch(() => {});
    }
  }, []);

  // Load rooms whenever user is set
  useEffect(() => {
    if (!user) { setRooms([]); return; }
    setLoadingRooms(true);
    fetch(`/api/users/${user.id}/rooms`)
      .then(r => r.json())
      .then(data => setRooms(data.rooms ?? []))
      .catch(() => {})
      .finally(() => setLoadingRooms(false));
  }, [user]);

  async function createUser() {
    const name = nameInput.trim();
    if (!name) return;
    setCreatingUser(true);
    setUserError(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      localStorage.setItem('churro_user_id', data.user.id);
      setUser(data.user);
    } catch (e) {
      setUserError((e as Error).message);
    } finally {
      setCreatingUser(false);
    }
  }

  async function createRoom() {
    if (!user) return;
    setCreatingRoom(true);
    setRoomError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, maxPlayers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(`/room/${data.room.id}`);
    } catch (e) {
      setRoomError((e as Error).message);
      setCreatingRoom(false);
    }
  }

  function goToRoom() {
    const trimmed = joinId.trim();
    if (!trimmed) return;
    // Accept full URLs or bare room IDs
    const match = trimmed.match(/([0-9a-f-]{36})/i);
    router.push(`/room/${match ? match[1] : trimmed}`);
  }

  // ── No user yet — name setup screen ──────────────────────────────────────
  if (!user) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 max-w-sm mx-auto">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Churro</h1>
          <p className="text-sm text-gray-500 mt-1">Async multiplayer word vault</p>
        </div>

        <div className="w-full space-y-3">
          <p className="text-sm font-medium">Choose a display name to get started:</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Your name"
              value={nameInput}
              maxLength={20}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createUser()}
              className="border border-gray-300 px-3 py-2 text-sm flex-1"
            />
            <button
              onClick={createUser}
              disabled={creatingUser || !nameInput.trim()}
              className="px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
            >
              {creatingUser ? '…' : 'Start'}
            </button>
          </div>
          {userError && <p className="text-red-500 text-xs">{userError}</p>}
        </div>

        <div className="w-full space-y-2">
          <p className="text-xs text-gray-400">Have an invite link? Enter your name first, then join.</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Paste room ID or link"
              value={joinId}
              onChange={e => setJoinId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && goToRoom()}
              className="border border-gray-300 px-3 py-2 text-sm flex-1 font-mono"
            />
            <button
              onClick={goToRoom}
              disabled={!joinId.trim()}
              className="px-4 py-2 bg-gray-800 text-white text-sm disabled:opacity-50"
            >
              Go
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen p-8 max-w-md mx-auto font-sans">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-xl font-bold">Churro</h1>
          <p className="text-xs text-gray-400 mt-0.5">Playing as <strong>{user.display_name}</strong></p>
        </div>
      </div>

      {/* Room list */}
      <div className="mb-8">
        <p className="text-xs font-medium text-gray-500 mb-2">YOUR ROOMS</p>
        {loadingRooms ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : rooms.length === 0 ? (
          <p className="text-sm text-gray-400">No rooms yet. Create or join one below.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rooms.map(({ room, members }) => (
              <button
                key={room.id}
                onClick={() => router.push(`/room/${room.id}`)}
                className="text-left border border-gray-200 p-3 hover:bg-gray-50 w-full"
              >
                <p className="text-sm font-medium">{getRoomLabel(members, user.id)}</p>
                <div className="flex gap-3 mt-0.5 text-xs text-gray-400">
                  <span className="capitalize">{room.phase}</span>
                  <span>Streak {room.streak_count}</span>
                  <span>{members.length}/{room.max_players} players</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create room */}
      <div className="mb-6 border border-gray-200 p-4 space-y-3">
        <p className="text-sm font-medium">Create a room</p>
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500">Players:</label>
          {[2, 3, 4].map(n => (
            <button
              key={n}
              onClick={() => setMaxPlayers(n)}
              className={`w-8 h-8 text-sm border ${maxPlayers === n ? 'bg-black text-white border-black' : 'border-gray-300'}`}
            >
              {n}
            </button>
          ))}
        </div>
        <button
          onClick={createRoom}
          disabled={creatingRoom}
          className="px-5 py-2 bg-black text-white text-sm font-medium disabled:opacity-50"
        >
          {creatingRoom ? 'Creating…' : 'Create Room'}
        </button>
        {roomError && <p className="text-red-500 text-xs">{roomError}</p>}
      </div>

      {/* Join by link */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500">Join via invite link:</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Paste room ID or link"
            value={joinId}
            onChange={e => setJoinId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && goToRoom()}
            className="border border-gray-300 px-3 py-2 text-sm flex-1 font-mono"
          />
          <button
            onClick={goToRoom}
            disabled={!joinId.trim()}
            className="px-4 py-2 bg-gray-800 text-white text-sm disabled:opacity-50"
          >
            Go
          </button>
        </div>
      </div>
    </main>
  );
}
