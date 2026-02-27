'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Room, RoomMember, User } from '@/types/game';
import { relativeTime } from '@/lib/relative-time';

type RoomEntry = {
  room: Room;
  members: RoomMember[];
  result: { winner_user_id: string | null } | null;
};

function getRoomTitle(members: RoomMember[], userId: string): string {
  const others = members.filter(m => m.user_id !== userId).map(m => m.display_name);
  return others.length === 0 ? 'Solo Vault' : `You · ${others.join(' · ')}`;
}

function getStatusLine(
  room: Room,
  result: { winner_user_id: string | null } | null,
): string {
  if (!room.is_locked) return 'Lobby · invite others to join';
  switch (room.phase) {
    case 'contribution': return 'Add Your Word';
    case 'reveal':       return 'Revealing…';
    case 'final':        return 'Crack the Vault';
    case 'complete':     return result?.winner_user_id ? 'Vault Opened' : 'Vault Locked';
    case 'expired':      return 'Vault expired';
    default:             return room.phase;
  }
}

function getLastMove(members: RoomMember[]): string | null {
  const timestamps = members.map(m => m.last_action_at).filter(Boolean);
  if (!timestamps.length) return null;
  const latest = timestamps.reduce((a, b) => (a > b ? a : b));
  return relativeTime(latest).replace('Active', 'Last move');
}

export default function Dashboard() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);

  const [rooms, setRooms] = useState<RoomEntry[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);

  const [creatingRoom, setCreatingRoom] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const [joinId, setJoinId] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('churro_user_id');
    if (stored) {
      fetch(`/api/users/${stored}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.user) {
            setUser(data.user);
          } else {
            localStorage.removeItem('churro_user_id');
          }
        })
        .catch(() => {});
    }
  }, []);

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
        body: JSON.stringify({ userId: user.id }),
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
    const match = trimmed.match(/([0-9a-f-]{36})/i);
    router.push(`/room/${match ? match[1] : trimmed}`);
  }

  // ── No user yet — name setup screen ──────────────────────────────────────
  if (!user) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8 max-w-sm mx-auto">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-stone-900">Churro</h1>
          <p className="text-sm text-gray-500 mt-1">Async multiplayer word vault</p>
        </div>

        <div className="w-full space-y-3">
          <p className="text-sm font-medium text-stone-800">Choose a display name to get started:</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Your name"
              value={nameInput}
              maxLength={20}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createUser()}
              className="border border-gray-300 rounded px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-stone-400"
            />
            <button
              onClick={createUser}
              disabled={creatingUser || !nameInput.trim()}
              className="px-4 py-2 bg-stone-900 text-white text-sm rounded disabled:opacity-50"
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
              className="border border-gray-300 rounded px-3 py-2 text-sm flex-1 font-mono focus:outline-none focus:ring-2 focus:ring-stone-400"
            />
            <button
              onClick={goToRoom}
              disabled={!joinId.trim()}
              className="px-4 py-2 bg-stone-700 text-white text-sm rounded font-medium disabled:opacity-40"
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
          <h1 className="text-xl font-bold text-stone-900">Churro</h1>
          <p className="text-xs text-gray-400 mt-0.5">Playing as <strong>{user.display_name}</strong></p>
        </div>
      </div>

      {/* Room list */}
      <div className="mb-8">
        <p className="text-xs font-medium text-gray-400 mb-3 uppercase tracking-wide">Your Vaults</p>
        {loadingRooms ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : rooms.length === 0 ? (
          <p className="text-sm text-gray-400">No vaults yet. Start or join one below.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rooms.map(({ room, members, result }) => {
              const activePhase = room.phase !== 'complete' && room.phase !== 'expired';
              const lastMove = activePhase ? getLastMove(members) : null;
              return (
                <button
                  key={room.id}
                  onClick={() => router.push(`/room/${room.id}`)}
                  className="text-left border border-gray-200 rounded-lg p-3 w-full
                             transition-all hover:shadow-sm hover:-translate-y-px hover:border-stone-300"
                >
                  <p className="text-sm font-medium text-stone-900">
                    {getRoomTitle(members, user.id)}
                  </p>
                  <p className="text-xs text-stone-600 mt-0.5">
                    {getStatusLine(room, result)}
                    {lastMove && <span className="text-gray-400"> · {lastMove}</span>}
                  </p>
                  <div className="flex gap-3 mt-1 text-xs text-gray-400">
                    <span>{members.length} player{members.length !== 1 ? 's' : ''}</span>
                    <span>Streak {room.streak_count}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Start a Vault */}
      <div className="mb-6 border border-gray-200 rounded-lg p-4 space-y-3">
        <p className="text-sm font-medium text-stone-900">Start a Vault</p>
        <p className="text-xs text-gray-400">
          Invite others via the room link. Begin when ready.
        </p>
        <button
          onClick={createRoom}
          disabled={creatingRoom}
          className="px-5 py-2 bg-stone-900 text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {creatingRoom ? 'Creating…' : 'Start a Vault'}
        </button>
        {roomError && <p className="text-red-500 text-xs">{roomError}</p>}
      </div>

      {/* Join a Vault */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500">Join a Vault:</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Paste room ID or link"
            value={joinId}
            onChange={e => setJoinId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && goToRoom()}
            className="border border-gray-300 rounded px-3 py-2 text-sm flex-1 font-mono focus:outline-none focus:ring-2 focus:ring-stone-400"
          />
          <button
            onClick={goToRoom}
            disabled={!joinId.trim()}
            className="px-4 py-2 bg-stone-700 text-white text-sm rounded font-medium disabled:opacity-40"
          >
            Go
          </button>
        </div>
      </div>
    </main>
  );
}
