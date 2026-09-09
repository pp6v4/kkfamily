<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import TripItinerary from '../../components/trip-itinerary.vue';
import TripPhotos from '../../components/trip-photos.vue';
import { canAccess, getStoredSession, refreshAccess, type HouseholdContext } from '../../services/session';
import { takeCalendarTarget } from '../../services/calendar-navigation';
import { assertTravelOrder, shanghaiDate, travelTimestamp } from '../../services/trip-form';
import { ApiError } from '../../services/transport';
import { authorizeNativeTrip, uploadTripSelection, type SelectedTripPhoto, type StopLocationDraft, type TripNativeTarget } from '../../services/trip-native';
import { getMediaReadUrl, listTripPhotos, publicMediaUrl } from '../../services/family-api';
import { addTripMember, applyPackingTemplate, createPackingTemplate, createTrip, createTripPackingItem, createTripPreparationGroup, getTrip, listPackingTemplates, listTripCandidates, listTripPackingItems, listTrips, removeTripPackingItem, updatePackingTemplate, updateTrip, updateTripMember, updateTripPackingItem, updateTripPreparationGroup, updateTripStatus, type PackingTemplate, type Trip, type TripPackingItem, type TripPreparationGroup } from '../../services/family-api';

type ViewName = 'trips' | 'templates';
interface TemplateItemForm { id?: string; name: string; quantity: string; unit: string; note: string }
const active = ref<ViewName>('trips');
const session = ref<HouseholdContext>();
const trips = ref<Trip[]>([]);
const templates = ref<PackingTemplate[]>([]);
const selectedTripId = ref('');
const packingItems = ref<TripPackingItem[]>([]);
const creatingTrip = ref(false);
const editingTrip = ref(false);
const editingTemplateId = ref('');
const showingTemplateForm = ref(false);
const showingItemForm = ref(false);
const tripForm = ref({ title: '', destination: '', startsAt: '', endsAt: '' });
const tripEditForm = ref({ title: '', destination: '', startsAt: '', endsAt: '' });
const templateForm = ref<{ name: string; description: string; items: TemplateItemForm[] }>({ name: '', description: '', items: [{ name: '', quantity: '', unit: '', note: '' }] });
const itemForm = ref({ name: '', quantity: '', unit: '', note: '' });
const candidates = ref<Array<{ id: string; user: { id: string; nickname: string | null; avatarUrl: string | null } }>>([]);
const showingCollaboration = ref(false);
const groupName = ref('');
const groupMemberIds = ref<string[]>([]);
const editingGroupId = ref('');

const loadingTrip = ref(false), tripBusy = ref(false), pageBusy = ref(false);
const nativeBusy=ref(false),returnedStop=ref<StopLocationDraft>();
let nativeEpoch=0;
let nativeReturn:{target:TripNativeTarget;draft?:StopLocationDraft;notice?:string;token:number}|undefined;
const selectedTrip = computed(() => loadingTrip.value ? undefined : trips.value.find((trip) => trip.id === selectedTripId.value));
const currentTripMember = computed(() => selectedTrip.value?.members.find(m=>m.membershipId===session.value?.membershipId));
const canEditTrip = computed(() => canAccess(session.value,'trips','EDIT') && currentTripMember.value?.status === 'ACTIVE' && Boolean(currentTripMember.value?.canEdit) && !['COMPLETED','CANCELLED'].includes(selectedTrip.value?.status || ''));
const canAddTripPhotos = computed(() => canAccess(session.value,'trips','EDIT') && ['ACTIVE','HISTORY'].includes(currentTripMember.value?.status || '') && Boolean(currentTripMember.value?.canEdit));
const isTripOwner = computed(() => canEditTrip.value && currentTripMember.value?.tripRole === 'OWNER');
function canEditTemplate(template: PackingTemplate) { return canAccess(session.value,'packing_templates','EDIT') && (template.createdById===session.value?.membershipId || canAccess(session.value,'packing_templates','MANAGE')); }
const candidateNames = computed(() => candidates.value.map((entry,index)=>entry.user.nickname||`成员${index+1}`));
const groupNames = computed(() => ['不分组',...(selectedTrip.value?.preparationGroups ?? []).map(group=>group.name)]);
const packedCount = computed(() => packingItems.value.filter((item) => item.status === 'PACKED').length);
const pageVisible = ref(false);
const overviewPulse = ref(false);
let overviewTimer: ReturnType<typeof setInterval> | undefined;
let viewEpoch=0, detailEpoch=0, packingRead=0, tripRead=0, disposed=false;
type ViewStamp={epoch:number;detail:number;householdId:string;membershipId:string;tripId:string;tab:ViewName};
let returnTarget:{id:string;householdId:string;membershipId:string}|undefined;
function stamp():ViewStamp{return{epoch:viewEpoch,detail:detailEpoch,householdId:session.value?.householdId||'',membershipId:session.value?.membershipId||'',tripId:selectedTripId.value,tab:active.value};}
function current(scope:ViewStamp){const stored=getStoredSession();return!disposed&&pageVisible.value&&scope.epoch===viewEpoch&&scope.detail===detailEpoch&&scope.tab===active.value&&scope.tripId===selectedTripId.value&&Boolean(scope.membershipId)&&session.value?.householdId===scope.householdId&&session.value?.membershipId===scope.membershipId&&stored?.householdId===scope.householdId&&stored?.membershipId===scope.membershipId;}
function clearForms(){creatingTrip.value=false;editingTrip.value=false;showingTemplateForm.value=false;editingTemplateId.value='';showingItemForm.value=false;showingCollaboration.value=false;tripForm.value={title:'',destination:'',startsAt:'',endsAt:''};tripEditForm.value={title:'',destination:'',startsAt:'',endsAt:''};templateForm.value={name:'',description:'',items:[{name:'',quantity:'',unit:'',note:''}]};itemForm.value={name:'',quantity:'',unit:'',note:''};resetGroupForm();}
function clearView(){viewEpoch++;detailEpoch++;trips.value=[];templates.value=[];packingItems.value=[];candidates.value=[];session.value=undefined;selectedTripId.value='';loadingTrip.value=false;tripBusy.value=false;pageBusy.value=false;returnedStop.value=undefined;clearForms();}
function cancelNative(){nativeEpoch++;nativeBusy.value=false;nativeReturn=undefined;returnedStop.value=undefined;}
function childAccessLost(tripId:string){if(!current(stamp())||selectedTripId.value!==tripId)return;cancelNative();clearView();uni.showToast({title:'行程访问权限已变化，请重新进入',icon:'none'});}
function beginNative(tripId:string,kind:'VIEW'|'PHOTO'|'LOCATION'){
  const scope=stamp();if(!current(scope)||scope.tripId!==tripId||nativeBusy.value||tripBusy.value||pageBusy.value)return;
  if(kind==='PHOTO'&&!canAddTripPhotos.value||kind==='LOCATION'&&!canEditTrip.value)return;
  const target={id:tripId,householdId:scope.householdId,membershipId:scope.membershipId};nativeBusy.value=true;nativeReturn=undefined;return{target,token:++nativeEpoch};
}
async function restoreNative(){
  const result=nativeReturn;if(!result||disposed||!pageVisible.value)return;nativeReturn=undefined;
  returnTarget=result.target;await loadData();
  if(result.token!==nativeEpoch||!current(stamp())||selectedTripId.value!==result.target.id||session.value?.householdId!==result.target.householdId||session.value?.membershipId!==result.target.membershipId)return;
  if(result.draft&&canEditTrip.value)returnedStop.value=result.draft;
  if(result.notice)uni.showToast({title:result.notice,icon:'none',duration:3000});
}
async function finishNative(target:TripNativeTarget,token:number,draft?:StopLocationDraft,notice?:string){
  if(disposed||token!==nativeEpoch)return;nativeBusy.value=false;nativeReturn={target,token,draft,notice};if(pageVisible.value)await restoreNative();
}
async function chooseStopLocation(draft:StopLocationDraft){
  const flow=beginNative(draft.tripId,'LOCATION');if(!flow)return;
  const {target,token}=flow,alive=()=>!disposed&&token===nativeEpoch;
  const retained:StopLocationDraft={tripId:target.id,form:{...draft.form},original:draft.original?{...draft.original}:undefined};
  let notice:string|undefined,restore=false;
  try{
    let picked:{latitude:number;longitude:number;name:string;address:string}|undefined;
    try{picked=await new Promise((resolve,reject)=>uni.chooseLocation({success:resolve,fail:reject}));}
    catch{notice='未选择位置，可继续手工填写经纬度';}
    await authorizeNativeTrip(target,'LOCATION',alive);restore=true;
    if(picked){retained.form.latitude=String(picked.latitude);retained.form.longitude=String(picked.longitude);if(!retained.form.title)retained.form.title=picked.name||picked.address||'行程地点';}
  }catch(error){notice=message(error);}
  await finishNative(target,token,restore?retained:undefined,notice);
}
async function chooseTripPhotos(tripId:string){
  const flow=beginNative(tripId,'PHOTO');if(!flow)return;
  const{target,token}=flow,alive=()=>!disposed&&token===nativeEpoch;let completed=0,notice:string|undefined;
  try{
    const files=await new Promise<SelectedTripPhoto[]>((resolve,reject)=>uni.chooseMedia({count:9,mediaType:['image'],sourceType:['album','camera'],success:result=>resolve(result.tempFiles.map(file=>({tempFilePath:file.tempFilePath,size:file.size}))),fail:error=>reject(new Error(error.errMsg||'未选择图片'))}));
    await uploadTripSelection(target,files,alive,count=>{completed=count;});notice=`已添加 ${completed} 张照片`;
  }catch(error){const text=message(error);if(!text.includes('cancel'))notice=completed?`已添加 ${completed} 张，其余未完成：${text}`:text;}
  await finishNative(target,token,undefined,notice);
}
async function previewTripPhoto(tripId:string,photoId:string){
  const flow=beginNative(tripId,'VIEW');if(!flow)return;
  const{target,token}=flow,alive=()=>!disposed&&token===nativeEpoch;let notice:string|undefined;
  try{
    await authorizeNativeTrip(target,'VIEW',alive);
    const rows=await listTripPhotos(target.id);if(!alive())return;
    if(!rows.some(row=>row.id===photoId))throw new Error('照片已不可访问，请刷新相册');
    const signed=await Promise.all(rows.map(async row=>({id:row.id,url:publicMediaUrl((await getMediaReadUrl(row.id)).path)})));
    await authorizeNativeTrip(target,'VIEW',alive);
    await new Promise<void>((resolve,reject)=>uni.previewImage({current:signed.find(row=>row.id===photoId)!.url,urls:signed.map(row=>row.url),success:()=>resolve(),fail:error=>reject(new Error(error.errMsg||'照片预览失败'))}));
  }catch(error){notice=message(error);}
  await finishNative(target,token,undefined,notice);
}
function scopedError(scope:ViewStamp,error:unknown){
  if(disposed||!pageVisible.value||scope.epoch!==viewEpoch||scope.detail!==detailEpoch||scope.tripId!==selectedTripId.value||scope.tab!==active.value)return;
  if(error instanceof ApiError&&[401,403,404].includes(error.statusCode)){clearView();uni.showToast({title:'访问状态已变化，请重新进入露营页面',icon:'none'});return;}
  if(current(scope))uni.showToast({title:message(error),icon:'none',duration:3000});
}
async function refreshPacking(scope:ViewStamp){const request=++packingRead;const rows=await listTripPackingItems(scope.tripId);if(current(scope)&&request===packingRead)packingItems.value=rows;}
async function refreshTrip(scope:ViewStamp){const request=++tripRead;const trip=await getTrip(scope.tripId);if(current(scope)&&request===tripRead)replaceTrip(trip);}
async function refreshCandidates(scope:ViewStamp){if(!current(scope))return;if(!isTripOwner.value){candidates.value=[];return;}const rows=await listTripCandidates(scope.tripId);if(current(scope)&&isTripOwner.value)candidates.value=rows;}
async function mutateTrip<T>(write:(trip:Trip)=>Promise<T>,after:(result:T,scope:ViewStamp)=>Promise<void>|void,owner=false){
  const trip=selectedTrip.value,scope=stamp();
  if(!trip||!current(scope)||tripBusy.value||nativeBusy.value||!(owner?isTripOwner.value:canEditTrip.value))return;
  tripBusy.value=true;
  try{const result=await write(trip);if(current(scope))await after(result,scope);}catch(error){scopedError(scope,error);}finally{if(current(scope))tripBusy.value=false;}
}
const overviewPoints = computed(() => trips.value.flatMap(trip => (trip.stops || []).map(stop => ({ latitude: Number(stop.latitude), longitude: Number(stop.longitude) }))));
const overviewCenter = computed(() => overviewPoints.value[0] || { latitude: 35.8617, longitude: 104.1954 });
const overviewMarkers = computed(() => trips.value.flatMap((trip, tripIndex) => (trip.stops || []).map((stop, stopIndex) => ({
  id: tripIndex * 1000 + stopIndex + 1,
  latitude: Number(stop.latitude),
  longitude: Number(stop.longitude),
  title: `${trip.title} · ${stop.title}`,
  label: { content: stopIndex === 0 ? trip.title : `${stopIndex + 1}`, color: '#3f5844', fontSize: 11, borderRadius: 8, bgColor: '#fffdf7', padding: 4 },
}))));
const overviewPolylines = computed(() => trips.value.flatMap(trip => {
  const pending = trip.status === 'PLANNING' || trip.status === 'PENDING';
  return (trip.legs || []).map(leg => {
    const planned = leg.routeKind === 'PLANNED' && !leg.staleAt && Array.isArray(leg.geometryJson);
    const raw = planned ? leg.geometryJson! : [[Number(leg.fromStop.longitude), Number(leg.fromStop.latitude)], [Number(leg.toStop.longitude), Number(leg.toStop.latitude)]];
    const dotted = pending || Boolean(leg.staleAt);
    return {
      points: raw.map(point => ({ longitude: Number(point[0]), latitude: Number(point[1]) })),
      color: dotted ? (overviewPulse.value ? '#68a476' : '#b8d2ba') : trip.status === 'CANCELLED' ? '#b6b9b4' : '#4f8d66',
      width: dotted ? 4 : 5,
      dottedLine: dotted,
      arrowLine: !dotted && (trip.status === 'DEPARTING' || trip.status === 'COMPLETED'),
    };
  });
}));

function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
function dateText(value: string) { return shanghaiDate(value); }
function statusText(status: Trip['status']) { return ({ PLANNING: '规划中', PENDING: '待出行', DEPARTING: '旅途中', COMPLETED: '已完成', CANCELLED: '已取消' } as Record<Trip['status'], string>)[status]; }
function quantityText(quantity: string | number | null, unit: string | null) { return quantity === null ? '' : `${Number(quantity)}${unit ? ` ${unit}` : ''}`; }
function responsibleName(item: TripPackingItem) { return item.responsibleMembership?.user.nickname || (item.responsibleMembership ? '家庭成员' : '未分配'); }

async function loadData() {
  if(disposed||!pageVisible.value||nativeBusy.value)return false;
  const target=takeCalendarTarget('TRIP');
  const previous=session.value?{id:selectedTripId.value,householdId:session.value.householdId,membershipId:session.value.membershipId}:returnTarget;
  clearView();const epoch=viewEpoch;returnTarget=undefined;
  try {
    const context=await refreshAccess();
    if(disposed||!pageVisible.value||epoch!==viewEpoch)return false;
    session.value=context;
    if(target||!canAccess(context,'packing_templates'))active.value='trips';
    const scope=stamp();if(!current(scope))return false;
    const [tripRows, templateRows] = await Promise.all([canAccess(context,'trips') ? listTrips() : Promise.resolve([]), canAccess(context,'packing_templates') ? listPackingTemplates() : Promise.resolve([])]);
    if(!current(scope))return false;
    trips.value = tripRows; templates.value = templateRows;
    const wanted=target?.sourceId||(previous?.householdId===context.householdId&&previous?.membershipId===context.membershipId?previous.id:'');
    if(wanted&&tripRows.some(trip=>trip.id===wanted))await openTrip(wanted);
    else if(target&&!target.sourceId&&canAccess(context,'trips','EDIT')){creatingTrip.value=true;tripForm.value.startsAt=target.date;}
    return epoch===viewEpoch&&pageVisible.value;
  } catch (error) { if(epoch===viewEpoch&&pageVisible.value){clearView();uni.showToast({ title: message(error), icon: 'none', duration: 3000 });}return false; }
}
async function openTrip(tripId: string) {
  if(!current(stamp())||!canAccess(session.value,'trips'))return;
  if(nativeBusy.value)cancelNative();
  detailEpoch++;selectedTripId.value=tripId;loadingTrip.value=true;tripBusy.value=false;packingItems.value=[];candidates.value=[];clearForms();const scope=stamp();
  try {const [trip,items]=await Promise.all([getTrip(tripId),listTripPackingItems(tripId)]);if(!current(scope))return;replaceTrip(trip);packingItems.value=items;loadingTrip.value=false;await refreshCandidates(scope);}
  catch(error){if(current(scope)){scopedError(scope,error);closeTrip();}}
  finally{if(current(scope))loadingTrip.value=false;}
}
function replaceTrip(trip: Trip) { const index=trips.value.findIndex(row=>row.id===trip.id); if(index>=0){if(trips.value[index].version<=trip.version)trips.value[index]=trip;}else trips.value.unshift(trip); }
async function itineraryChanged(version: number,tripId:string) {
  const trip=selectedTrip.value,scope=stamp();
  if(!trip||trip.id!==tripId||!current(scope))return;
  replaceTrip({...trip,version:Math.max(trip.version,version)});
  try{await refreshTrip(scope);}catch(error){scopedError(scope,error);}
}
function closeTrip() { cancelNative();detailEpoch++;selectedTripId.value='';packingItems.value=[];candidates.value=[];loadingTrip.value=false;tripBusy.value=false;clearForms(); }
async function saveTrip() {
  const scope=stamp();if(!current(scope)||pageBusy.value||!canAccess(session.value,'trips','EDIT'))return;
  if (!tripForm.value.title.trim() || !tripForm.value.startsAt) { uni.showToast({ title: '请填写行程名称和出发日期', icon: 'none' }); return; }
  pageBusy.value=true;
  try {
    const startsAt=travelTimestamp(tripForm.value.startsAt,'08')!,endsAt=travelTimestamp(tripForm.value.endsAt,'20');
    assertTravelOrder(startsAt,endsAt);
    const trip = await createTrip({ title: tripForm.value.title.trim(), destination: tripForm.value.destination.trim() || undefined, startsAt, endsAt });
    if(!current(scope))return;
    tripForm.value={title:'',destination:'',startsAt:'',endsAt:''};creatingTrip.value=false;pageBusy.value=false;replaceTrip(trip);await openTrip(trip.id);
  } catch(error){scopedError(scope,error);}finally{if(current(scope))pageBusy.value=false;}
}
function startTripEdit() {
  const trip = selectedTrip.value;
  if (!trip||!canEditTrip.value||tripBusy.value) return;
  tripEditForm.value = { title: trip.title, destination: trip.destination || '', startsAt: dateText(trip.startsAt), endsAt: trip.endsAt ? dateText(trip.endsAt) : '' };
  editingTrip.value = true;
}
async function saveTripEdit() {
  const trip = selectedTrip.value, form = tripEditForm.value;
  if (!trip || !form.title.trim() || !form.startsAt) { uni.showToast({ title: '请填写行程名称和出发日期', icon: 'none' }); return; }
  if (form.endsAt && form.endsAt < form.startsAt) { uni.showToast({ title: '返回日期不能早于出发日期', icon: 'none' }); return; }
  try {
    const startsAt=travelTimestamp(form.startsAt,'08',trip.startsAt)!,endsAt=travelTimestamp(form.endsAt,'20',trip.endsAt);
    assertTravelOrder(startsAt,endsAt);
    await mutateTrip(currentTrip=>updateTrip(currentTrip,{title:form.title.trim(),destination:form.destination.trim(),startsAt,endsAt:endsAt??null}),updated=>{replaceTrip(updated);editingTrip.value=false;uni.showToast({title:'行程已更新',icon:'success'});});
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}

function newTemplate() {
  if(!current(stamp())||pageBusy.value||!canAccess(session.value,'packing_templates','EDIT'))return;
  detailEpoch++;
  editingTemplateId.value = ''; templateForm.value = { name: '', description: '', items: [{ name: '', quantity: '', unit: '', note: '' }] }; showingTemplateForm.value = true;
}
function editTemplate(template: PackingTemplate) {
  if(!current(stamp())||pageBusy.value||!canEditTemplate(template))return;
  detailEpoch++;
  editingTemplateId.value = template.id;
  templateForm.value = { name: template.name, description: template.description || '', items: template.items.map((item) => ({ id: item.id, name: item.name, quantity: item.defaultQuantity === null ? '' : String(Number(item.defaultQuantity)), unit: item.unit || '', note: item.note || '' })) };
  showingTemplateForm.value = true;
}
function addTemplateItem() { templateForm.value.items.push({ name: '', quantity: '', unit: '', note: '' }); }
function removeTemplateItem(index: number) { if (templateForm.value.items.length > 1) templateForm.value.items.splice(index, 1); }
async function saveTemplate() {
  const scope=stamp();if(!current(scope)||pageBusy.value||!canAccess(session.value,'packing_templates','EDIT'))return;
  const rows = templateForm.value.items.filter((item) => item.name.trim());
  if (!templateForm.value.name.trim() || !rows.length) { uni.showToast({ title: '请填写模板名称和至少一件物品', icon: 'none' }); return; }
  const payload = { name: templateForm.value.name.trim(), description: templateForm.value.description.trim() || null, items: rows.map((item, index) => ({ id: item.id, name: item.name.trim(), quantity: item.quantity === '' ? null : Number(item.quantity), unit: item.unit.trim() || null, note: item.note.trim() || null, sortOrder: index })) };
  pageBusy.value=true;
  try {
    const editing = templates.value.find((template) => template.id === editingTemplateId.value);
    if (editingTemplateId.value && !editing) throw new Error('行李模板已变更，请刷新后重试');
    if(editing&&!canEditTemplate(editing))throw new Error('没有模板编辑权限');
    if (editing) await updatePackingTemplate(editing, payload); else await createPackingTemplate(payload);
    if(!current(scope))return;const updated=await listPackingTemplates();if(!current(scope))return;templates.value=updated;showingTemplateForm.value=false;uni.showToast({title:editing?'模板已更新':'模板已创建',icon:'success'});
  }catch(error){scopedError(scope,error);}finally{if(current(scope))pageBusy.value=false;}
}
function archiveTemplate(template: PackingTemplate) {
  const scope=stamp();if(!current(scope)||!canEditTemplate(template)||pageBusy.value)return;
  uni.showModal({ title: '归档模板', content: `归档“${template.name}”后，已生成的行程行李不会受影响。`, success: async (result) => {
    if(!result.confirm||!current(scope)||!canEditTemplate(template)||pageBusy.value)return;
    pageBusy.value=true;
    try{await updatePackingTemplate(template,{archived:true});if(!current(scope))return;const rows=await listPackingTemplates();if(current(scope))templates.value=rows;}
    catch(error){scopedError(scope,error);}finally{if(current(scope))pageBusy.value=false;}
  } });
}
async function applyTemplateByIndex(event: { detail: { value: string } }) {
  const template = templates.value[Number(event.detail.value)];
  if(!template||!canAccess(session.value,'packing_templates'))return;
  await mutateTrip(trip=>applyPackingTemplate(trip.id,template.id),(result)=>{packingItems.value=result.items;uni.showToast({title:result.addedCount?`已加入 ${result.addedCount} 项`:'该模板已套用',icon:'none'});});
}
async function saveTripItem() {
  if (!selectedTrip.value || !itemForm.value.name.trim()) { uni.showToast({ title: '请输入行李名称', icon: 'none' }); return; }
  const form={...itemForm.value};
  await mutateTrip(trip=>createTripPackingItem(trip.id,{name:form.name.trim(),quantity:form.quantity===''?undefined:Number(form.quantity),unit:form.unit.trim()||undefined,note:form.note.trim()||undefined}),async(_,scope)=>{itemForm.value={name:'',quantity:'',unit:'',note:''};showingItemForm.value=false;await refreshPacking(scope);});
}
async function togglePacked(item: TripPackingItem) {
  await mutateTrip(trip=>updateTripPackingItem(trip.id,item,{status:item.status==='PACKED'?'PENDING':'PACKED'}),(_,scope)=>refreshPacking(scope));
}
async function assign(item: TripPackingItem, pickerIndex: number) {
  const trip = selectedTrip.value; const member = pickerIndex ? assignableMembers(item)[pickerIndex - 1] : undefined;
  if (!trip||(pickerIndex&&!member)) return;
  await mutateTrip(currentTrip=>updateTripPackingItem(currentTrip.id,item,{responsibleMembershipId:member?.membershipId||''}),(_,scope)=>refreshPacking(scope));
}
function assignableMembers(item:TripPackingItem){const trip=selectedTrip.value;if(!trip)return[];const active=trip.members.filter(member=>member.status==='ACTIVE');if(!item.groupId)return active;const group=trip.preparationGroups.find(entry=>entry.id===item.groupId);return group?active.filter(member=>group.members.some(entry=>entry.membershipId===member.membershipId)):active;}
function assignableMemberNames(item:TripPackingItem){return ['未分配',...assignableMembers(item).map((entry,index)=>entry.membership.user.nickname||`成员${index+1}`)];}
async function assignGroup(item:TripPackingItem,pickerIndex:number){const trip=selectedTrip.value,group=pickerIndex?trip?.preparationGroups[pickerIndex-1]:undefined;if(!trip||(pickerIndex&&!group))return;const keepResponsible=!group||item.responsibleMembershipId&&group.members.some(m=>m.membershipId===item.responsibleMembershipId);await mutateTrip(currentTrip=>updateTripPackingItem(currentTrip.id,item,{groupId:group?.id||'',...(keepResponsible?{}:{responsibleMembershipId:''})}),(_,scope)=>refreshPacking(scope));}
function removeItem(item: TripPackingItem) {
  const trip=selectedTrip.value,scope=stamp();if(!trip||!current(scope)||!canEditTrip.value||tripBusy.value)return;
  uni.showModal({ title: '移除行李', content: `从本次行程移除“${item.name}”？不会影响原模板。`, success: async (result) => {
    if(!result.confirm||!current(scope))return;
    await mutateTrip(()=>removeTripPackingItem(trip.id,item),(_,currentScope)=>refreshPacking(currentScope));
  } });
}

async function addMemberByIndex(event:{detail:{value:string}}){const candidate=candidates.value[Number(event.detail.value)];if(!candidate)return;await mutateTrip(trip=>addTripMember(trip.id,candidate.id),async(updated,scope)=>{replaceTrip(updated);await refreshCandidates(scope);},true);}
function revokeMember(member: Trip['members'][number]){const trip=selectedTrip.value,scope=stamp();if(!trip||!current(scope)||!isTripOwner.value||tripBusy.value)return;uni.showModal({title:'撤销行程访问',content:`撤销“${member.membership.user.nickname||'该成员'}”后会立即失去访问，未完成的负责人分配将被清空。`,success:async result=>{if(!result.confirm||!current(scope))return;await mutateTrip(()=>updateTripMember(trip.id,member,{status:'REVOKED',clearResponsibilities:true}),async(updated,latest)=>{replaceTrip(updated);await refreshPacking(latest);await refreshCandidates(latest);},true);}});}
async function advanceStatus(){const trip=selectedTrip.value,scope=stamp();if(!trip||!current(scope)||!isTripOwner.value||tripBusy.value)return;const next=({PLANNING:'PENDING',PENDING:'DEPARTING',DEPARTING:'COMPLETED'} as Partial<Record<Trip['status'],Trip['status']>>)[trip.status];if(!next)return;uni.showModal({title:next==='COMPLETED'?'完成行程':'更新行程状态',content:next==='COMPLETED'?'完成后保留历史查看和有权限成员补照片，行程及行李不能继续修改。':`将行程更新为“${statusText(next)}”？`,success:async result=>{if(!result.confirm||!current(scope))return;await mutateTrip(()=>updateTripStatus(trip,next),updated=>{replaceTrip(updated);candidates.value=[];},true);}});}
function groupSelection(event:{detail:{value:string[]}}){groupMemberIds.value=event.detail.value;}
function editGroup(group:TripPreparationGroup){editingGroupId.value=group.id;groupName.value=group.name;groupMemberIds.value=group.members.map(member=>member.membershipId);}
function resetGroupForm(){editingGroupId.value='';groupName.value='';groupMemberIds.value=[];}
async function saveGroup(){const trip=selectedTrip.value;if(!trip||!groupName.value.trim()||!groupMemberIds.value.length){uni.showToast({title:'填写小组名并选择成员',icon:'none'});return;}const name=groupName.value.trim(),members=[...groupMemberIds.value],editingId=editingGroupId.value;await mutateTrip(async currentTrip=>{const editing=currentTrip.preparationGroups.find(group=>group.id===editingId);if(editingId&&!editing)throw new Error('准备小组已变更，请刷新后重试');if(editing)return updateTripPreparationGroup(currentTrip.id,editing,name,members);return createTripPreparationGroup(currentTrip.id,name,members);},async(_,scope)=>{resetGroupForm();await refreshTrip(scope);},true);}

function startOverviewPulse() {
  if (overviewTimer) clearInterval(overviewTimer);
  overviewTimer=setInterval(() => { overviewPulse.value=!overviewPulse.value; }, 850);
}
function hidePage(){if(session.value)returnTarget={id:selectedTripId.value,householdId:session.value.householdId,membershipId:session.value.membershipId};pageVisible.value=false;if(overviewTimer){clearInterval(overviewTimer);overviewTimer=undefined;}clearView();}
function unloadPage(){disposed=true;cancelNative();hidePage();returnTarget=undefined;}
function showPage(){if(disposed)return;pageVisible.value=true;startOverviewPulse();if(nativeBusy.value)return;if(nativeReturn)return restoreNative();return loadData();}
watch(active,()=>{closeTrip();pageBusy.value=false;},{flush:'sync'});
onShow(showPage);
onHide(hidePage);
onUnload(unloadPage);
onUnmounted(unloadPage);
</script>

<template>
  <view class="page">
    <view class="heading"><text class="label">去露营</text><text class="title">{{ active === 'trips' ? '我的行程' : '行李模板' }}</text><text class="subtitle">{{ active === 'trips' ? '只有行程成员可以查看和协作' : '模板名称和物品都由你自己定义' }}</text></view>
    <view class="tabs"><view class="tab" :class="{ chosen: active === 'trips' }" @tap="active = 'trips'">行程</view><view v-if="canAccess(session,'packing_templates')" class="tab" :class="{ chosen: active === 'templates' }" @tap="active = 'templates'">行李模板</view></view>
    <text v-if="loadingTrip" class="empty">正在核对行程权限并读取行李…</text>
    <text v-if="tripBusy || pageBusy" class="map-note">正在保存，请稍候…</text>
    <text v-if="nativeBusy" class="empty">正在处理选点或照片，请稍候…</text>

    <view v-if="active === 'trips' && !selectedTrip">
      <map v-if="overviewPoints.length" class="overview-map" :latitude="overviewCenter.latitude" :longitude="overviewCenter.longitude" :scale="4" :markers="overviewMarkers" :polyline="overviewPolylines" :include-points="overviewPoints" show-scale />
      <view v-else class="map"><text class="map-icon">🗺️</text><text>中国行程地图</text><text class="map-note">进入行程添加地点后，这里会汇总展示路线</text></view>
      <text v-if="overviewPoints.length" class="map-note overview-note">待出行显示闪烁虚线，旅途中和已完成显示实线箭头。</text>
      <view v-if="!trips.length" class="empty">{{canAccess(session,'trips')?'尚未加入任何行程；拥有露营角色不自动加入行程':'尚未获得露营功能权限'}}</view>
      <view v-for="trip in trips" :key="trip.id" class="trip" @tap="openTrip(trip.id)"><view class="pin">📍</view><view class="trip-info"><text class="trip-title">{{ trip.title }}</text><text class="trip-sub">{{ trip.destination || '未填写目的地' }} · {{ dateText(trip.startsAt) }}{{ trip.endsAt ? ` 至 ${dateText(trip.endsAt)}` : '' }}</text><text class="trip-sub">行李 {{ trip._count?.packingItems || 0 }} 项</text></view><text class="state">{{ statusText(trip.status) }}</text></view>
      <view v-if="creatingTrip && canAccess(session,'trips','EDIT')" class="editor"><input v-model="tripForm.title" class="input" placeholder="行程名称" /><input v-model="tripForm.destination" class="input" placeholder="目的地" /><view class="date-row"><picker mode="date" @change="tripForm.startsAt = $event.detail.value"><view class="input">{{ tripForm.startsAt || '出发日期' }}</view></picker><picker mode="date" @change="tripForm.endsAt = $event.detail.value"><view class="input">{{ tripForm.endsAt || '结束日期' }}</view></picker></view><view class="button" @tap="saveTrip">保存行程</view></view>
      <view v-else-if="canAccess(session,'trips','EDIT')" class="button" @tap="creatingTrip = true">＋ 创建露营行程</view>
    </view>

    <view v-else-if="active === 'trips' && selectedTrip">
      <view class="back" @tap="closeTrip">‹ 返回行程</view>
      <view class="trip-head"><view class="trip-head-row"><view><text class="trip-title">{{ selectedTrip.title }}</text><text class="trip-sub">{{ selectedTrip.destination || '未填写目的地' }} · {{dateText(selectedTrip.startsAt)}}{{selectedTrip.endsAt?` 至 ${dateText(selectedTrip.endsAt)}`:''}} · 已准备 {{ packedCount }}/{{ packingItems.length }}</text></view><text v-if="canEditTrip" class="edit" @tap="startTripEdit">编辑行程</text></view></view>
      <view v-if="editingTrip" class="editor"><text class="editor-title">编辑行程</text><input v-model="tripEditForm.title" class="input" placeholder="行程名称"/><input v-model="tripEditForm.destination" class="input" placeholder="目的地（可清空）"/><view class="date-row"><picker mode="date" :value="tripEditForm.startsAt" @change="tripEditForm.startsAt=$event.detail.value"><view class="input">{{tripEditForm.startsAt||'出发日期'}}</view></picker><picker mode="date" :value="tripEditForm.endsAt" @change="tripEditForm.endsAt=$event.detail.value"><view class="input">{{tripEditForm.endsAt||'返回日期（可不填）'}}</view></picker></view><text v-if="tripEditForm.endsAt" class="clear" @tap="tripEditForm.endsAt=''">清空返回日期</text><view class="button small" @tap="saveTripEdit">保存行程</view><view class="cancel" @tap="editingTrip=false">取消</view></view>
      <TripItinerary :key="`${session?.membershipId}:${selectedTrip.id}:${detailEpoch}`" :trip="selectedTrip" :can-edit="canEditTrip && !nativeBusy" :active="pageVisible" :restored-draft="returnedStop" @choose-location="chooseStopLocation" @draft-consumed="returnedStop=undefined" @access-lost="childAccessLost" @changed="itineraryChanged" />
      <TripPhotos :key="`${session?.membershipId}:${selectedTrip.id}:${detailEpoch}`" :trip="selectedTrip" :can-upload="canAddTripPhotos && !nativeBusy" :active="pageVisible" @choose-photos="chooseTripPhotos" @preview="previewTripPhoto" @access-lost="childAccessLost" />
      <view class="collab-summary" @tap="showingCollaboration=!showingCollaboration"><text>同行 {{selectedTrip.members.length}} 人 · 准备小组 {{selectedTrip.preparationGroups.length}} 个</text><text>{{showingCollaboration?'收起':'管理协作'}} ›</text></view>
      <view v-if="showingCollaboration" class="editor collab-panel">
        <view v-for="member in selectedTrip.members" :key="member.membershipId" class="member-row"><view><text class="member-name">{{member.membership.user.nickname||'家庭成员'}}</text><text class="member-role">{{member.tripRole==='OWNER'?'行程负责人':'同行成员'}} · {{member.status==='HISTORY'?'历史可见':member.canEdit?'可协作':'只读'}}</text></view><text v-if="isTripOwner && member.membershipId!==session?.membershipId" class="danger-link" @tap="revokeMember(member)">撤销</text></view>
        <picker v-if="isTripOwner && candidates.length" :range="candidateNames" @change="addMemberByIndex"><view class="action full">＋ 添加家庭或朋友账号</view></picker>
        <view v-if="selectedTrip.preparationGroups.length" class="group-list"><view v-for="group in selectedTrip.preparationGroups" :key="group.id" class="group-row"><text class="chip">{{group.name}} · {{group.members.length}}人</text><text v-if="isTripOwner" class="edit" @tap="editGroup(group)">编辑</text></view></view>
        <view v-if="isTripOwner" class="group-editor"><text class="editor-title">{{editingGroupId?'编辑准备小组':'新建准备小组'}}</text><input v-model="groupName" class="input" placeholder="准备小组，例如：我们家"/><checkbox-group @change="groupSelection"><label v-for="member in selectedTrip.members.filter(m=>m.status==='ACTIVE')" :key="member.membershipId" class="check-member"><checkbox :value="member.membershipId" :checked="groupMemberIds.includes(member.membershipId)" color="#69a778"/>{{member.membership.user.nickname||'家庭成员'}}</label></checkbox-group><view class="button small" @tap="saveGroup">{{editingGroupId?'保存准备小组':'创建准备小组'}}</view><view v-if="editingGroupId" class="cancel" @tap="resetGroupForm">取消编辑</view></view>
        <view v-if="isTripOwner && ['PLANNING','PENDING','DEPARTING'].includes(selectedTrip.status)" class="button small" @tap="advanceStatus">{{selectedTrip.status==='DEPARTING'?'完成本次行程':`进入${statusText(selectedTrip.status==='PLANNING'?'PENDING':'DEPARTING')}`}}</view>
      </view>
      <view v-if="canEditTrip" class="packing-actions"><picker v-if="templates.length" :range="templates" range-key="name" @change="applyTemplateByIndex"><view class="action">套用自定义模板</view></picker><view class="action" @tap="showingItemForm = !showingItemForm">手工加一项</view></view>
      <view v-if="canAccess(session,'packing_templates','EDIT') && !templates.length" class="notice" @tap="active = 'templates'">还没有行李模板，先去创建一个 ›</view>
      <view v-if="showingItemForm" class="editor"><input v-model="itemForm.name" class="input" placeholder="本次要带什么" /><view class="item-inputs"><input v-model="itemForm.quantity" type="digit" class="input" placeholder="数量" /><input v-model="itemForm.unit" class="input" placeholder="单位" /></view><input v-model="itemForm.note" class="input" placeholder="备注（可选）" /><view class="button small" @tap="saveTripItem">加入本次行程</view></view>
      <view v-if="!packingItems.length" class="empty">本次行程还没有行李项</view>
      <view v-for="item in packingItems" :key="item.id" class="packing-item" :class="{ packed: item.status === 'PACKED' }"><text class="check" @tap="canEditTrip && togglePacked(item)">{{ item.status === 'PACKED' ? '✓' : '' }}</text><view class="packing-info"><text class="packing-name">{{ item.name }}<text v-if="quantityText(item.quantity,item.unit)" class="quantity"> · {{ quantityText(item.quantity,item.unit) }}</text></text><text class="packing-meta">{{ item.sourceTemplateNameSnapshot ? `来自模板：${item.sourceTemplateNameSnapshot}` : '本次手工添加' }}{{ item.note ? ` · ${item.note}` : '' }}</text><text v-if="!canEditTrip" class="responsible">{{item.group?`准备组：${item.group.name} · `:''}}负责人：{{ responsibleName(item) }} · 只读</text><view v-else class="assignment"><picker :range="groupNames" @change="assignGroup(item,Number($event.detail.value))"><text class="responsible">准备组：{{item.group?.name||'未分组'}} ›</text></picker><picker :range="assignableMemberNames(item)" @change="assign(item, Number($event.detail.value))"><text class="responsible">负责人：{{ responsibleName(item) }} ›</text></picker></view></view><text v-if="canEditTrip" class="remove" @tap="removeItem(item)">×</text></view>
    </view>

    <view v-else>
      <view class="template-explain">模板名称和物品均由家庭成员自定义。套用到行程后会生成独立清单，不会反向修改模板。</view>
      <view v-if="!templates.length && !showingTemplateForm" class="empty">还没有自定义模板</view>
      <view v-for="template in templates" :key="template.id" class="template-card"><view class="template-top"><view><text class="template-name">{{ template.name }}</text><text class="template-description">{{ template.description || `${template.items.length} 件物品` }}</text></view><text v-if="canEditTemplate(template)" class="edit" @tap="editTemplate(template)">编辑</text></view><view class="chips"><text v-for="item in template.items.slice(0,6)" :key="item.id" class="chip">{{ item.name }}</text><text v-if="template.items.length > 6" class="chip">+{{ template.items.length - 6 }}</text></view><text v-if="canEditTemplate(template)" class="archive" @tap="archiveTemplate(template)">归档模板</text></view>
      <view v-if="showingTemplateForm" class="editor template-editor"><text class="editor-title">{{ editingTemplateId ? '编辑模板' : '新建自定义模板' }}</text><input v-model="templateForm.name" class="input" placeholder="模板名称，例如：烧烤" /><input v-model="templateForm.description" class="input" placeholder="说明（可选）" /><view v-for="(item,index) in templateForm.items" :key="index" class="template-row"><input v-model="item.name" class="input template-item-name" placeholder="物品名称" /><input v-model="item.quantity" type="digit" class="input template-amount" placeholder="数量" /><input v-model="item.unit" class="input template-unit" placeholder="单位" /><text class="remove" @tap="removeTemplateItem(index)">×</text><input v-model="item.note" class="input template-note" placeholder="备注（可选）" /></view><text class="add-row" @tap="addTemplateItem">＋ 添加模板物品</text><view class="button small" @tap="saveTemplate">{{ editingTemplateId ? '保存修改' : '创建模板' }}</view><view class="cancel" @tap="showingTemplateForm = false">取消</view></view>
      <view v-else-if="canAccess(session,'packing_templates','EDIT')" class="button" @tap="newTemplate">＋ 新建自定义模板</view>
    </view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:38rpx 28rpx 70rpx;background:#edf5eb}.heading .label,.heading .title,.heading .subtitle,.trip-title,.trip-sub,.map-note,.packing-name,.packing-meta,.responsible,.template-name,.template-description{display:block}.label{font-size:24rpx;letter-spacing:3rpx;color:#6e9770}.title{margin-top:10rpx;font-size:42rpx;font-weight:700;color:#3f5844}.subtitle{margin-top:11rpx;font-size:23rpx;color:#819183}.tabs{display:flex;margin-top:28rpx;padding:7rpx;border-radius:20rpx;background:#dcebd8}.tab{flex:1;padding:16rpx;border-radius:15rpx;text-align:center;color:#6d886f;font-size:24rpx}.tab.chosen{background:#fff;color:#43704a;font-weight:600}.map{margin-top:20rpx;padding:30rpx;border-radius:28rpx;background:linear-gradient(135deg,#dcefd8,#dbeaf0);color:#4e6b54;text-align:center;font-size:28rpx}.map-icon{display:block;margin-bottom:10rpx;font-size:62rpx}.map-note{margin-top:8rpx;color:#819687;font-size:21rpx}.trip{display:flex;align-items:center;gap:18rpx;margin-top:16rpx;padding:24rpx;border-radius:24rpx;background:#fffdf7}.pin{font-size:39rpx}.trip-info{min-width:0;flex:1}.trip-title{font-size:29rpx;color:#465a49}.trip-sub{margin-top:7rpx;color:#909c91;font-size:21rpx}.state{padding:9rpx 12rpx;border-radius:99rpx;background:#e2f0df;color:#5a8160;font-size:20rpx}.empty{padding:65rpx 0;text-align:center;color:#87988a;font-size:25rpx}.button{margin-top:28rpx;padding:25rpx;border-radius:24rpx;background:#69a778;color:#fff;text-align:center;font-size:27rpx}.button.small{margin-top:18rpx;padding:19rpx;font-size:24rpx}.editor{margin-top:20rpx;padding:22rpx;border-radius:24rpx;background:#fff}.input{box-sizing:border-box;width:100%;margin-top:12rpx;padding:19rpx;border:2rpx solid #e3ebe2;border-radius:15rpx;background:#fff;font-size:24rpx;color:#58675a}.date-row,.item-inputs{display:grid;grid-template-columns:1fr 1fr;gap:12rpx}.back{margin:24rpx 0 14rpx;color:#5e8663;font-size:24rpx}.trip-head{padding:24rpx;border-radius:24rpx;background:#fffdf7}.trip-head-row,.group-row{display:flex;align-items:center;justify-content:space-between;gap:16rpx}.trip-head-row>view{min-width:0}.clear{display:inline-block;margin-top:12rpx;color:#8b796d;font-size:21rpx}.packing-actions{display:flex;gap:14rpx;margin-top:16rpx}.packing-actions picker,.packing-actions>.action{flex:1}.action{padding:18rpx;border-radius:18rpx;background:#d8ead7;color:#4f7955;text-align:center;font-size:23rpx}.notice,.template-explain{margin-top:16rpx;padding:20rpx;border-radius:18rpx;background:#fff8dc;color:#7a704f;font-size:22rpx;line-height:1.6}.packing-item{display:flex;align-items:center;gap:16rpx;margin-top:14rpx;padding:21rpx;border-radius:22rpx;background:#fffdf7}.packing-item.packed{opacity:.62}.check{display:flex;align-items:center;justify-content:center;width:42rpx;height:42rpx;border:2rpx solid #90b492;border-radius:12rpx;color:#fff}.packed .check{background:#69a778}.packing-info{min-width:0;flex:1}.packing-name{font-size:27rpx;color:#48584a}.packed .packing-name{text-decoration:line-through}.quantity{color:#6f7f71;font-size:22rpx}.packing-meta{margin-top:6rpx;color:#9a9b93;font-size:19rpx}.responsible{margin-top:9rpx;color:#5e8b66;font-size:21rpx}.remove{padding:10rpx;color:#ba8373;font-size:34rpx}.template-card{margin-top:16rpx;padding:23rpx;border-radius:24rpx;background:#fffdf7}.template-top{display:flex;justify-content:space-between}.template-name{font-size:29rpx;color:#435747}.template-description{margin-top:7rpx;color:#92998f;font-size:21rpx}.edit{flex:none;color:#579064;font-size:23rpx}.chips{display:flex;flex-wrap:wrap;gap:9rpx;margin-top:18rpx}.chip{padding:9rpx 13rpx;border-radius:99rpx;background:#e5f0df;color:#627a62;font-size:20rpx}.archive{display:inline-block;margin-top:18rpx;color:#a09283;font-size:20rpx}.editor-title{display:block;font-size:28rpx;font-weight:600;color:#485b4b}.template-row{display:grid;grid-template-columns:1fr 120rpx 100rpx 50rpx;gap:8rpx;align-items:center}.template-note{grid-column:1/4}.template-row .remove{grid-column:4;grid-row:1}.add-row{display:inline-block;margin-top:18rpx;color:#56855d;font-size:23rpx}.cancel{padding:20rpx;text-align:center;color:#8a958b;font-size:23rpx}
.collab-summary{display:flex;justify-content:space-between;margin-top:14rpx;padding:19rpx 22rpx;border-radius:20rpx;background:#dcebd8;color:#55765b;font-size:22rpx}.member-row{display:flex;align-items:center;justify-content:space-between;padding:15rpx 0;border-bottom:1rpx solid #edf0e9}.member-name,.member-role{display:block}.member-name{color:#465a49;font-size:25rpx}.member-role{margin-top:5rpx;color:#94a096;font-size:19rpx}.danger-link{color:#b87568;font-size:21rpx}.action.full{margin-top:16rpx}.group-list{display:flex;flex-wrap:wrap;gap:8rpx;margin-top:15rpx}.group-editor{margin-top:15rpx;padding-top:8rpx;border-top:1rpx solid #edf0e9}.check-member{display:inline-flex;align-items:center;margin:14rpx 20rpx 0 0;color:#607163;font-size:22rpx}.check-member checkbox{transform:scale(.8)}
.overview-map{width:100%;height:430rpx;margin-top:20rpx;border-radius:28rpx;overflow:hidden}.overview-note{display:block;padding:0 6rpx 8rpx}
</style>
