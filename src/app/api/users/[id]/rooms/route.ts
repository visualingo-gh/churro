import { NextRequest, NextResponse } from 'next/server';
import { getRoomsByUserId } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rooms = await getRoomsByUserId(id);
  return NextResponse.json({ rooms });
}
