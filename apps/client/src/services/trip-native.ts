import { canAccess, getStoredSession, refreshAccess } from './session';
import { confirmMediaAsset, createMediaUploadIntent, getTrip, uploadMediaContent, type TripStop } from './family-api';

export interface TripNativeTarget { id: string; householdId: string; membershipId: string }
export interface StopLocationDraft {
  tripId: string;
  original?: TripStop;
  form: { title: string; typeIndex: number; latitude: string; longitude: string; arriveDate: string; leaveDate: string; note: string };
}
export interface SelectedTripPhoto { tempFilePath: string; size: number }

export function checkNativeIdentity(target: TripNativeTarget, alive: () => boolean) {
  const stored = getStoredSession();
  if (!alive() || stored?.householdId !== target.householdId || stored?.membershipId !== target.membershipId) {
    throw new Error('账号、家庭或页面已变化，请重新打开原行程');
  }
}

export async function authorizeNativeTrip(target: TripNativeTarget, mode: 'VIEW' | 'PHOTO' | 'LOCATION', alive: () => boolean) {
  checkNativeIdentity(target, alive);
  const context = await refreshAccess();
  checkNativeIdentity(target, alive);
  if (context.householdId !== target.householdId || context.membershipId !== target.membershipId
    || !canAccess(context, 'trips', mode === 'VIEW' ? 'VIEW' : 'EDIT')) throw new Error('露营访问权限已变化');
  const trip = await getTrip(target.id);
  checkNativeIdentity(target, alive);
  const member = trip.members.find(row => row.membershipId === target.membershipId);
  if (!member || !['ACTIVE', 'HISTORY'].includes(member.status)) throw new Error('已不再拥有这趟行程的访问权限');
  if (mode !== 'VIEW' && !member.canEdit) throw new Error('没有这趟行程的协作权限');
  if (mode === 'LOCATION' && (member.status !== 'ACTIVE' || ['COMPLETED', 'CANCELLED'].includes(trip.status))) throw new Error('当前行程不能修改地图节点');
  return trip;
}

function mimeFor(path: string) {
  const clean = path.toLowerCase().split('?')[0];
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg' as const;
  if (clean.endsWith('.png')) return 'image/png' as const;
  if (clean.endsWith('.webp')) return 'image/webp' as const;
  throw new Error('请选择 JPG、PNG 或 WebP 图片');
}
function readBytes(path: string) {
  return new Promise<ArrayBuffer>((resolve, reject) => uni.getFileSystemManager().readFile({
    filePath: path,
    success(result) { if (typeof result.data === 'string') reject(new Error('图片读取格式错误')); else resolve(result.data as ArrayBuffer); },
    fail(error) { reject(new Error(error.errMsg || '图片读取失败')); },
  }));
}

// The owner is captured before opening the native picker, never read from a
// component prop after an await. Reauthorize each external write boundary.
export async function uploadTripSelection(target: TripNativeTarget, files: SelectedTripPhoto[], alive: () => boolean, progress: (count: number) => void) {
  if (!files.length || files.length > 9) throw new Error('请选择1～9张照片');
  for (const file of files) {
    if (!Number.isInteger(file.size) || file.size <= 0 || file.size > 8 * 1024 * 1024) throw new Error('每张图片必须大于0且不超过8MB');
    mimeFor(file.tempFilePath);
  }
  let completed = 0;
  for (const file of files) {
    await authorizeNativeTrip(target, 'PHOTO', alive);
    const mimeType = mimeFor(file.tempFilePath), bytes = await readBytes(file.tempFilePath);
    checkNativeIdentity(target, alive);
    if (bytes.byteLength !== file.size) throw new Error('图片读取大小不一致，请重新选择');
    const trip = await authorizeNativeTrip(target, 'PHOTO', alive);
    const intent = await createMediaUploadIntent({ ownerType: 'TRIP', ownerId: target.id, expectedOwnerVersion: trip.version, mimeType, byteSize: bytes.byteLength });
    await authorizeNativeTrip(target, 'PHOTO', alive);
    const uploaded = await uploadMediaContent(intent.uploadPath, bytes, mimeType);
    await authorizeNativeTrip(target, 'PHOTO', alive);
    await confirmMediaAsset(intent.id, uploaded.checksumSha256);
    checkNativeIdentity(target, alive);
    progress(++completed);
  }
  return completed;
}
