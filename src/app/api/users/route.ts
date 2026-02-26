import { NextRequest, NextResponse } from 'next/server';
import { createUser } from '@/lib/db';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const displayName = (body?.displayName ?? '').trim();

  if (!displayName) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
  }
  if (displayName.length > 20) {
    return NextResponse.json({ error: 'displayName must be 20 characters or fewer' }, { status: 400 });
  }

  try {
    const user = await createUser(displayName);
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
