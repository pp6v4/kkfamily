-- Align existing migration output with the Prisma model without rewriting data.
-- Keep historical migration checksums stable; apply this as a forward migration.
BEGIN;

ALTER TABLE "HouseholdInvitation" DROP CONSTRAINT "HouseholdInvitation_householdId_fkey";
ALTER TABLE "HouseholdInvitation" ADD CONSTRAINT "HouseholdInvitation_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvitationRedemption" DROP CONSTRAINT "InvitationRedemption_invitationId_fkey";
ALTER TABLE "InvitationRedemption" ADD CONSTRAINT "InvitationRedemption_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "HouseholdInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvitationRedemption" DROP CONSTRAINT "InvitationRedemption_membershipId_fkey";
ALTER TABLE "InvitationRedemption" ADD CONSTRAINT "InvitationRedemption_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_householdId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_householdId_fkey"
  FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing timestamps are preserved; Prisma supplies future @updatedAt values.
ALTER TABLE "Trip" ALTER COLUMN "updatedAt" DROP DEFAULT;

COMMIT;
