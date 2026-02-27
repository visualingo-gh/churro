import { NextRequest, NextResponse } from 'next/server';
import { getRoomById, getMembersByRoom, setMemberReady, advanceToNextRound } from '@/lib/db';
import { getAppMode } from '@/lib/app-mode';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (getAppMode() !== 'round') {
    return NextResponse.json({ error: 'Not in round mode' }, { status: 400 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { userId } = body ?? {};

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const room = await getRoomById(id);
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  if (room.phase !== 'complete') {
    return NextResponse.json({ error: 'Round must be complete' }, { status: 400 });
  }

  const members = await getMembersByRoom(id);
  if (!members.find(m => m.user_id === userId)) {
    return NextResponse.json({ error: 'Not a member of this room' }, { status: 403 });
  }

  // Idempotent: setting true twice is fine
  await setMemberReady(userId, id);

  // Count ready members; always include the requesting user in case the DB
  // update failed silently (e.g. column missing / RLS) — ensures 1-player
  // rooms always advance.
  const updatedMembers = await getMembersByRoom(id);
  const readyCount = updatedMembers.filter(m => m.ready_for_next || m.user_id === userId).length;

  if (readyCount >= members.length) {
    try {
      await advanceToNextRound(id, room.game_date);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
    return NextResponse.json({ advanced: true });
  }

  return NextResponse.json({ advanced: false, readyCount, total: members.length });
}
