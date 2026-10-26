export interface RecipeDraftFields {
  id: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  name: string;
  categoryId: string | null;
  originalCategoryId: string | null;
  coverAssetId: string;
  ingredients: Array<{ name: string; quantity: string; unit: string }>;
  seasonings: string[];
  steps: string[];
  pendingCover?: {
    tempFilePath: string;
    size: number;
    mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
    localSaved?: boolean;
    confirmation?: { intentId: string; checksumSha256: string; expectedVersion: number };
  };
}
type Identity = { householdId: string; membershipId: string };
export interface StoredRecipeDraft extends Identity {
  schema: 1;
  slotId: string;
  revision: string;
  savedAt: number;
  fields: RecipeDraftFields;
}
const instanceId = Math.random().toString(36).slice(2);
let sequence = 0;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max; }
function identifier(value: unknown): value is string { return text(value, 256) && value.length > 0; }
function nullableId(value: unknown): value is string | null { return value === null || identifier(value); }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function strings(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= maxItems && value.every(item => text(item, maxLength));
}
function key(identity: Identity, slotId: string) {
  if (!identifier(identity.householdId) || !identifier(identity.membershipId) || !text(slotId, 256)) throw new Error('草稿所属账号或菜谱无效');
  return `kkfamily.recipeDraft.v1:${encodeURIComponent(identity.householdId)}:${encodeURIComponent(identity.membershipId)}:${slotId ? 'recipe:' + encodeURIComponent(slotId) : 'new'}`;
}
function fields(value: unknown): RecipeDraftFields | undefined {
  if (!object(value) || !text(value.id, 256) || !count(value.version) || !['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(String(value.status)) || !text(value.name, 80)
    || !nullableId(value.categoryId) || !nullableId(value.originalCategoryId) || !text(value.coverAssetId, 256)
    || !Array.isArray(value.ingredients) || value.ingredients.length < 1 || value.ingredients.length > 100
    || !strings(value.seasonings, 40, 60) || !strings(value.steps, 50, 4000)) return undefined;
  const ingredients: RecipeDraftFields['ingredients'] = [];
  for (const row of value.ingredients) {
    if (!object(row) || !text(row.name, 60) || !text(row.quantity, 140) || !text(row.unit, 12)) return undefined;
    ingredients.push({ name: row.name, quantity: row.quantity, unit: row.unit });
  }
  let pendingCover: RecipeDraftFields['pendingCover'];
  if (value.pendingCover !== undefined) {
    const cover = value.pendingCover;
    if (!object(cover) || !text(cover.tempFilePath, 2048) || !cover.tempFilePath || !count(cover.size) || !cover.size || cover.size > 8 * 1024 * 1024
      || !['image/jpeg', 'image/png', 'image/webp'].includes(String(cover.mimeType))) return undefined;
    pendingCover = { tempFilePath: cover.tempFilePath, size: cover.size, mimeType: cover.mimeType as NonNullable<RecipeDraftFields['pendingCover']>['mimeType'] };
    if (cover.localSaved !== undefined) {
      if (typeof cover.localSaved !== 'boolean') return undefined;
      pendingCover.localSaved = cover.localSaved;
    }
    if (cover.confirmation !== undefined) {
      const confirmation = cover.confirmation;
      if (!object(confirmation) || !identifier(confirmation.intentId) || !text(confirmation.checksumSha256, 128) || !confirmation.checksumSha256 || !count(confirmation.expectedVersion)) return undefined;
      pendingCover.confirmation = { intentId: confirmation.intentId, checksumSha256: confirmation.checksumSha256, expectedVersion: confirmation.expectedVersion };
    }
  }
  return { id: value.id, version: value.version, status: value.status as RecipeDraftFields['status'], name: value.name,
    categoryId: value.categoryId, originalCategoryId: value.originalCategoryId, coverAssetId: value.coverAssetId,
    ingredients, seasonings: [...value.seasonings], steps: [...value.steps], ...(pendingCover ? { pendingCover } : {}) };
}
export function readRecipeDraft(identity: Identity, slotId: string): StoredRecipeDraft | undefined {
  const value: unknown = uni.getStorageSync(key(identity, slotId));
  if (!object(value) || value.schema !== 1 || value.householdId !== identity.householdId || value.membershipId !== identity.membershipId
    || value.slotId !== slotId || !identifier(value.revision) || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) || value.savedAt <= 0) return undefined;
  const draft = fields(value.fields);
  if (!draft || (slotId && draft.id !== slotId)) return undefined;
  return { schema: 1, householdId: identity.householdId, membershipId: identity.membershipId, slotId,
    revision: value.revision, savedAt: value.savedAt, fields: draft };
}
export function writeRecipeDraft(identity: Identity, slotId: string, input: RecipeDraftFields): StoredRecipeDraft {
  const storageKey = key(identity, slotId), draft = fields(input);
  if (!draft || (slotId && draft.id !== slotId)) throw new Error('草稿内容无法备份，请先保存菜谱');
  const savedAt = Date.now();
  const record: StoredRecipeDraft = { schema: 1, householdId: identity.householdId, membershipId: identity.membershipId, slotId,
    revision: `${savedAt}-${instanceId}-${++sequence}`, savedAt, fields: draft };
  uni.setStorageSync(storageKey, record);
  return { ...record, fields: fields(draft)! };
}
export function removeRecipeDraft(identity: Identity, slotId: string, revision: string): boolean {
  const current = readRecipeDraft(identity, slotId);
  if (!current || current.revision !== revision) return false;
  uni.removeStorageSync(key(identity, slotId));
  return true;
}
