import { NextRequest, NextResponse } from 'next/server';
import { db, hasModel, isDbAvailable } from '@/lib/db';
import { hashPassword } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      email,
      password,
      fullName,
      phone,
      country,
      experienceLevel,
      assetTypes,
      concerns,
      portfolioRange,
      referralSource,
    } = body;

    const name = fullName || '';

    // Validate required fields
    if (!email || !password || !name.trim()) {
      return NextResponse.json(
        { error: 'Email, password, and name are required' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const emailLower = email.toLowerCase().trim();

    if (isDbAvailable() && db && hasModel('user')) {
      // Check if user already exists
      const existing = await db.user.findUnique({ where: { email: emailLower } });
      if (existing) {
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 }
        );
      }

      const passwordHash = hashPassword(password);

      const profileData = JSON.stringify({
        phone: phone || null,
        country: country || null,
        tradingExperience: experienceLevel || null,
        tradedAssets: assetTypes || [],
        tradingConcerns: concerns || [],
        portfolioSize: portfolioRange || null,
        referralSource: referralSource || null,
      });

      const user = await db.user.create({
        data: {
          email: emailLower,
          name: name.trim(),
          passwordHash,
        },
      });

      // Create default settings
      await db.userSettings.create({
        data: {
          userId: user.id,
        },
      });

      return NextResponse.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      });
    }

    // Demo mode - simulate successful signup
    return NextResponse.json({
      success: true,
      user: {
        id: 'new-user-' + Date.now(),
        email: emailLower,
        name: name.trim(),
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
