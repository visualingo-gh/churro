import { NextRequest, NextResponse } from 'next/server';
import { getRoomById, getMembersByRoom, lockRoom, touchMemberActivity } from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  if (room.is_locked) {
    return NextResponse.json({ error: 'Game already started' }, { status: 409 });
  }

  if (room.phase !== 'contribution') {
    return NextResponse.json({ error: 'Game already in progress' }, { status: 409 });
  }

  const members = await getMembersByRoom(id);
  if (!members.find(m => m.user_id === userId)) {
    return NextResponse.json({ error: 'Not a member of this room' }, { status: 403 });
  }

  await lockRoom(id);
  await touchMemberActivity(userId, id);

  return NextResponse.json({ success: true });
}
