CREATE TYPE "PermissionEffect" AS ENUM ('ALLOW', 'DENY');
ALTER TABLE "ModulePermission" ADD COLUMN "effect" "PermissionEffect" NOT NULL DEFAULT 'ALLOW';
ALTER TABLE "Membership" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "permissionVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "HouseholdInvitation" (
  "id" TEXT PRIMARY KEY, "householdId" TEXT NOT NULL, "codeHash" TEXT NOT NULL,
  "roleCodes" TEXT[] NOT NULL, "grants" JSONB NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "maxUses" INTEGER NOT NULL DEFAULT 1, "usedCount" INTEGER NOT NULL DEFAULT 0,
  "revokedAt" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HouseholdInvitation_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE,
  CONSTRAINT "HouseholdInvitation_usage_check" CHECK ("maxUses" > 0 AND "usedCount" >= 0 AND "usedCount" <= "maxUses")
);
CREATE UNIQUE INDEX "HouseholdInvitation_codeHash_key" ON "HouseholdInvitation"("codeHash");
CREATE INDEX "HouseholdInvitation_householdId_createdAt_idx" ON "HouseholdInvitation"("householdId", "createdAt");

CREATE TABLE "InvitationRedemption" (
  "invitationId" TEXT NOT NULL, "userId" TEXT NOT NULL, "membershipId" TEXT NOT NULL,
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("invitationId", "userId"),
  CONSTRAINT "InvitationRedemption_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "HouseholdInvitation"("id") ON DELETE CASCADE,
  CONSTRAINT "InvitationRedemption_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY, "householdId" TEXT NOT NULL, "actorMembershipId" TEXT NOT NULL,
  "action" TEXT NOT NULL, "targetId" TEXT NOT NULL, "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE
);
CREATE INDEX "AuditLog_householdId_createdAt_idx" ON "AuditLog"("householdId", "createdAt");
