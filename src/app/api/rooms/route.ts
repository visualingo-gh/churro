import { NextRequest, NextResponse } from 'next/server';
import { createRoom, addMemberToRoom, getUserById } from '@/lib/db';
import { getAppMode, getTodayStringLA } from '@/lib/app-mode';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { userId } = body ?? {};

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  try {
    const room = await createRoom({
      inviteCode: generateInviteCode(),
      maxPlayers: 4,
      gameDate: getAppMode() === 'daily' ? getTodayStringLA() : '1',
    });

    const member = await addMemberToRoom({
      roomId: room.id,
      userId: user.id,
      displayName: user.display_name,
    });

    return NextResponse.json({ room, member });
  } catch {
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}
