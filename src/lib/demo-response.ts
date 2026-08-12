// ============================================================
// Demo Response Helper
// Wraps any JSON response with _demo: true so the frontend
// can display a warning banner when data is from fallback/demo.
// ============================================================

import { NextResponse } from 'next/server';

type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Wrap a response with `_demo: true` flag.
 * Works for both objects and arrays.
 */
export function demoResponse<T extends JsonValue>(data: T, status?: number) {
  if (Array.isArray(data)) {
    return NextResponse.json({ data, _demo: true } as any, status);
  }
  return NextResponse.json({ ...data, _demo: true } as any, status);
}

/**
 * Tag a simple success response as demo.
 */
export function demoSuccess(extra?: Record<string, JsonValue>) {
  return NextResponse.json({ ...extra, success: true, _demo: true });
}
