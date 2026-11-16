import { NextResponse, type NextRequest } from 'next/server';
import { isAuthorized, isSameOrigin, UNAUTHORIZED_HEADERS } from './lib/basic-auth';

export function middleware(req: NextRequest) {
  if (!isSameOrigin(req)) return new NextResponse('Yêu cầu không hợp lệ', { status: 403 });
  if (isAuthorized(req.headers.get('authorization'))) return NextResponse.next();
  return new NextResponse('Cần đăng nhập ViPost', { status: 401, headers: UNAUTHORIZED_HEADERS });
}

// /api/media tự kiểm tra mật khẩu bên trong (middleware giới hạn kích thước body, sẽ làm hỏng upload video lớn)
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/media).*)'],
};
