import { clearSession, ensureSession } from './session';
import { ApiError, rawRequest } from './transport';
export type Level = 'VIEW' | 'EDIT' | 'MANAGE';
export interface Override { module: string; level: Level; effect: 'ALLOW' | 'DENY' }
export interface Member { id: string; membershipId: string; user: { id: string; nickname: string | null }; status: 'ACTIVE' | 'PENDING' | 'DISABLED' | 'LEFT'; version: number; roles: string[]; overrides: Override[]; effectivePermissions: Record<string, Level> }
export interface Invitation { id: string; roleCodes: string[]; expiresAt: string; usedCount: number; maxUses: number; revokedAt: string | null; version: number; code?: string }
async function request<T>(path: string, method: UniApp.RequestOptions['method'] = 'GET', data?: unknown) {
  const session = await ensureSession();
  try { return await rawRequest<T>(path.replace(':household', encodeURIComponent(session.householdId)), method, data, { Authorization: `Bearer ${session.accessToken}`, 'X-Household-Id': session.householdId }); }
  catch (error) { if (error instanceof ApiError && error.statusCode === 401) clearSession(); throw error; }
}
export const listMembers = (cursor = '') => request<{ items: Member[]; nextCursor: string | null }>('/members' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''));
export const roleCatalog = () => request<Record<string, Record<string, Level>>>('/members/roles');
export const listInvitations = () => request<Invitation[]>('/households/:household/invitations');
export const createInvitation = (roleCodes: string[], grants: Override[]) => request<Invitation>('/households/:household/invitations', 'POST', { roleCodes, grants, maxUses: 1 });
export const revokeInvitation = (invite: Invitation) => request('/invitations/' + encodeURIComponent(invite.id), 'DELETE', { version: invite.version });
export const saveMemberPermissions = (member: Member, roleCodes: string[], overrides: Override[]) => request<Member>('/members/' + encodeURIComponent(member.id) + '/permissions', 'PATCH', { version: member.version, roleCodes, overrides });
export const setMemberStatus = (member: Member, status: 'ACTIVE' | 'DISABLED') => request<Member>('/members/' + encodeURIComponent(member.id) + '/status', 'PATCH', { version: member.version, status });
export const transferAdmin = (member: Member, version: number) => request<Member>('/households/:household/transfer-admin', 'POST', { targetMembershipId: member.id, targetVersion: member.version, version });
