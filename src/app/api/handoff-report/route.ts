import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function GET() {
  try {
    const filePath = join(process.cwd(), 'FOVI_HANDOFF_REPORT.md');
    const content = readFileSync(filePath, 'utf-8');

    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': 'attachment; filename="FOVI_HANDOFF_REPORT.md"',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Report file not found' }, { status: 404 });
  }
}
