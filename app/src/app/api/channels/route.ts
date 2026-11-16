import { NextResponse } from 'next/server';
import { listChannelsSafe } from '@/lib/channels';

export async function GET() {
  return NextResponse.json(await listChannelsSafe());
}
