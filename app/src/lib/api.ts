import { NextResponse } from 'next/server';
import { ProviderError } from './providers/types';

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ProviderError) return err.message;
  console.error(err);
  return 'Có lỗi xảy ra, vui lòng thử lại.';
}
