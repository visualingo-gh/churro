import { NextRequest, NextResponse } from 'next/server';
import { getRoomById, getMembersByRoom, addMemberToRoom, getUserById, touchRoomActivity } from '@/lib/db';

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

  const user = await getUserById(userId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const room = await getRoomById(id);
  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }

  if (room.is_locked) {
    return NextResponse.json({ error: 'Room is locked' }, { status: 409 });
  }

  const members = await getMembersByRoom(id);

  if (members.length >= room.max_players) {
    return NextResponse.json({ error: 'Room is full' }, { status: 409 });
  }

  // Already a member — idempotent
  if (members.some(m => m.user_id === userId)) {
    const existing = members.find(m => m.user_id === userId)!;
    return NextResponse.json({ member: existing });
  }

  try {
    const member = await addMemberToRoom({
      roomId: id,
      userId: user.id,
      displayName: user.display_name,
    });
    // member.last_action_at set by DB DEFAULT; just refresh the room's expires_at
    await touchRoomActivity(id);

    return NextResponse.json({ member });
  } catch {
    return NextResponse.json({ error: 'Failed to join room' }, { status: 500 });
  }
}
