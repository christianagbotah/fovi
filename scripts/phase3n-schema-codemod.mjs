import { readFileSync, writeFileSync } from 'node:fs';

const path = 'prisma/schema.prisma';
let source = readFileSync(path, 'utf8');

const relationNeedle = '  authSessions   AuthSession[]\n';
if (!source.includes(relationNeedle)) throw new Error('User authSessions relation marker not found');
source = source.replace(
  relationNeedle,
  `${relationNeedle}  twoFactorChallenges TwoFactorChallenge[]\n`,
);

const authSessionModel = `model AuthSession {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  familyId     String
  tokenHash    String   @unique
  rememberMe   Boolean  @default(false)
  expiresAt    DateTime
  lastUsedAt   DateTime?
  revokedAt    DateTime?
  revokeReason String?
  createdAt    DateTime @default(now())

  @@index([userId])
  @@index([familyId])
  @@index([expiresAt])
  @@index([familyId, revokedAt])
}
`;
if (!source.includes(authSessionModel)) throw new Error('AuthSession model marker not found');

const challengeModel = `
model TwoFactorChallenge {
  id         String    @id
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
  @@index([expiresAt])
}
`;

source = source.replace(authSessionModel, `${authSessionModel}${challengeModel}`);
writeFileSync(path, source);
console.log('Phase 3N Prisma schema updated.');
