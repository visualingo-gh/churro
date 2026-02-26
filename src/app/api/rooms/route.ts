import { NextRequest, NextResponse } from 'next/server';
import { createRoom, addMemberToRoom, lockRoom, getUserById } from '@/lib/db';
import { getAppMode, getTodayStringLA } from '@/lib/app-mode';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { userId, maxPlayers } = body ?? {};

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const parsed = parseInt(maxPlayers, 10);
  if (isNaN(parsed) || parsed < 2 || parsed > 4) {
    return NextResponse.json({ error: 'maxPlayers must be 2, 3, or 4' }, { status: 400 });
  }

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  try {
    const room = await createRoom({
      inviteCode: generateInviteCode(),
      maxPlayers: parsed,
      gameDate: getAppMode() === 'daily' ? getTodayStringLA() : '1',
    });

    const member = await addMemberToRoom({
      roomId: room.id,
      userId: user.id,
      displayName: user.display_name,
    });

    // If max_players is 1... shouldn't happen (min 2), but guard anyway
    if (parsed === 1) await lockRoom(room.id);

    return NextResponse.json({ room, member });
  } catch {
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}
