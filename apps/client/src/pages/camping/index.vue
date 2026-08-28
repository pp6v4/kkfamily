<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { applyPackingTemplate, createPackingTemplate, createTrip, createTripPackingItem, listPackingTemplates, listTripPackingItems, listTrips, removeTripPackingItem, updatePackingTemplate, updateTripPackingItem, type PackingTemplate, type Trip, type TripPackingItem } from '../../services/family-api';

type ViewName = 'trips' | 'templates';
interface TemplateItemForm { id?: string; name: string; quantity: string; unit: string; note: string }
const active = ref<ViewName>('trips');
const trips = ref<Trip[]>([]);
const templates = ref<PackingTemplate[]>([]);
const selectedTripId = ref('');
const packingItems = ref<TripPackingItem[]>([]);
const creatingTrip = ref(false);
const editingTemplateId = ref('');
const showingTemplateForm = ref(false);
const showingItemForm = ref(false);
const tripForm = ref({ title: '', destination: '', startsAt: '', endsAt: '' });
const templateForm = ref<{ name: string; description: string; items: TemplateItemForm[] }>({ name: '', description: '', items: [{ name: '', quantity: '', unit: '', note: '' }] });
const itemForm = ref({ name: '', quantity: '', unit: '', note: '' });

const selectedTrip = computed(() => trips.value.find((trip) => trip.id === selectedTripId.value));
const memberNames = computed(() => (selectedTrip.value?.members ?? []).map((entry, index) => entry.membership.user.nickname || `成员${index + 1}`));
const packedCount = computed(() => packingItems.value.filter((item) => item.status === 'PACKED').length);

function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
function dateText(value: string) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function statusText(status: Trip['status']) { return ({ PLANNING: '规划中', PENDING: '待出行', DEPARTING: '旅途中', COMPLETED: '已完成', CANCELLED: '已取消' } as Record<Trip['status'], string>)[status]; }
function quantityText(quantity: string | number | null, unit: string | null) { return quantity === null ? '' : `${Number(quantity)}${unit ? ` ${unit}` : ''}`; }
function responsibleName(item: TripPackingItem) { return item.responsibleMembership?.user.nickname || (item.responsibleMembership ? '家庭成员' : '未分配'); }

async function loadData() {
  try {
    const [tripRows, templateRows] = await Promise.all([listTrips(), listPackingTemplates()]);
    trips.value = tripRows; templates.value = templateRows;
    if (selectedTripId.value && !tripRows.some((trip) => trip.id === selectedTripId.value)) selectedTripId.value = '';
    if (selectedTripId.value) packingItems.value = await listTripPackingItems(selectedTripId.value);
  } catch (error) { uni.showToast({ title: message(error), icon: 'none', duration: 3000 }); }
}
async function openTrip(tripId: string) {
  selectedTripId.value = tripId;
  try { packingItems.value = await listTripPackingItems(tripId); }
  catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
function closeTrip() { selectedTripId.value = ''; packingItems.value = []; showingItemForm.value = false; }
async function saveTrip() {
  if (!tripForm.value.title.trim() || !tripForm.value.startsAt) { uni.showToast({ title: '请填写行程名称和出发日期', icon: 'none' }); return; }
  try {
    const trip = await createTrip({ title: tripForm.value.title.trim(), destination: tripForm.value.destination.trim() || undefined, startsAt: `${tripForm.value.startsAt}T08:00:00+08:00`, endsAt: tripForm.value.endsAt ? `${tripForm.value.endsAt}T20:00:00+08:00` : undefined });
    tripForm.value = { title: '', destination: '', startsAt: '', endsAt: '' }; creatingTrip.value = false; await loadData(); await openTrip(trip.id); uni.showToast({ title: '行程已创建', icon: 'success' });
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}

function newTemplate() {
  editingTemplateId.value = ''; templateForm.value = { name: '', description: '', items: [{ name: '', quantity: '', unit: '', note: '' }] }; showingTemplateForm.value = true;
}
function editTemplate(template: PackingTemplate) {
  editingTemplateId.value = template.id;
  templateForm.value = { name: template.name, description: template.description || '', items: template.items.map((item) => ({ id: item.id, name: item.name, quantity: item.defaultQuantity === null ? '' : String(Number(item.defaultQuantity)), unit: item.unit || '', note: item.note || '' })) };
  showingTemplateForm.value = true;
}
function addTemplateItem() { templateForm.value.items.push({ name: '', quantity: '', unit: '', note: '' }); }
function removeTemplateItem(index: number) { if (templateForm.value.items.length > 1) templateForm.value.items.splice(index, 1); }
async function saveTemplate() {
  const rows = templateForm.value.items.filter((item) => item.name.trim());
  if (!templateForm.value.name.trim() || !rows.length) { uni.showToast({ title: '请填写模板名称和至少一件物品', icon: 'none' }); return; }
  const payload = { name: templateForm.value.name.trim(), description: templateForm.value.description.trim() || undefined, items: rows.map((item, index) => ({ id: item.id, name: item.name.trim(), quantity: item.quantity === '' ? undefined : Number(item.quantity), unit: item.unit.trim() || undefined, note: item.note.trim() || undefined, sortOrder: index })) };
  try {
    if (editingTemplateId.value) await updatePackingTemplate(editingTemplateId.value, payload); else await createPackingTemplate(payload);
    showingTemplateForm.value = false; await loadData(); uni.showToast({ title: editingTemplateId.value ? '模板已更新' : '模板已创建', icon: 'success' });
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
function archiveTemplate(template: PackingTemplate) {
  uni.showModal({ title: '归档模板', content: `归档“${template.name}”后，已生成的行程行李不会受影响。`, success: async (result) => {
    if (!result.confirm) return;
    try { await updatePackingTemplate(template.id, { archived: true }); await loadData(); }
    catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
  } });
}
async function applyTemplateByIndex(event: { detail: { value: string } }) {
  const template = templates.value[Number(event.detail.value)];
  if (!selectedTrip.value || !template) return;
  try {
    const result = await applyPackingTemplate(selectedTrip.value.id, template.id); packingItems.value = result.items;
    uni.showToast({ title: result.addedCount ? `已加入 ${result.addedCount} 项` : '该模板已套用', icon: 'none' });
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
async function saveTripItem() {
  if (!selectedTrip.value || !itemForm.value.name.trim()) { uni.showToast({ title: '请输入行李名称', icon: 'none' }); return; }
  try {
    await createTripPackingItem(selectedTrip.value.id, { name: itemForm.value.name.trim(), quantity: itemForm.value.quantity === '' ? undefined : Number(itemForm.value.quantity), unit: itemForm.value.unit.trim() || undefined, note: itemForm.value.note.trim() || undefined });
    itemForm.value = { name: '', quantity: '', unit: '', note: '' }; showingItemForm.value = false; packingItems.value = await listTripPackingItems(selectedTrip.value.id);
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
async function togglePacked(item: TripPackingItem) {
  if (!selectedTrip.value) return;
  try { await updateTripPackingItem(selectedTrip.value.id, item.id, { status: item.status === 'PACKED' ? 'PENDING' : 'PACKED' }); packingItems.value = await listTripPackingItems(selectedTrip.value.id); }
  catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
async function assign(item: TripPackingItem, memberIndex: number) {
  const trip = selectedTrip.value; const member = trip?.members[memberIndex];
  if (!trip || !member) return;
  try { await updateTripPackingItem(trip.id, item.id, { responsibleMembershipId: member.membershipId }); packingItems.value = await listTripPackingItems(trip.id); }
  catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
function removeItem(item: TripPackingItem) {
  if (!selectedTrip.value) return;
  uni.showModal({ title: '移除行李', content: `从本次行程移除“${item.name}”？不会影响原模板。`, success: async (result) => {
    if (!result.confirm || !selectedTrip.value) return;
    try { await removeTripPackingItem(selectedTrip.value.id, item.id); packingItems.value = await listTripPackingItems(selectedTrip.value.id); }
    catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
  } });
}

onShow(loadData);
</script>

<template>
  <view class="page">
    <view class="heading"><text class="label">去露营</text><text class="title">{{ active === 'trips' ? '我的行程' : '行李模板' }}</text><text class="subtitle">{{ active === 'trips' ? '只有行程成员可以查看和协作' : '模板名称和物品都由你自己定义' }}</text></view>
    <view class="tabs"><view class="tab" :class="{ chosen: active === 'trips' }" @tap="active = 'trips'">行程</view><view class="tab" :class="{ chosen: active === 'templates' }" @tap="active = 'templates'">行李模板</view></view>

    <view v-if="active === 'trips' && !selectedTrip">
      <view class="map"><text class="map-icon">🗺️</text><text>中国行程地图</text><text class="map-note">路线绘制将在行程详情中继续完善</text></view>
      <view v-if="!trips.length" class="empty">还没有可查看的行程</view>
      <view v-for="trip in trips" :key="trip.id" class="trip" @tap="openTrip(trip.id)"><view class="pin">📍</view><view class="trip-info"><text class="trip-title">{{ trip.title }}</text><text class="trip-sub">{{ trip.destination || '未填写目的地' }} · {{ dateText(trip.startsAt) }}{{ trip.endsAt ? ` 至 ${dateText(trip.endsAt)}` : '' }}</text><text class="trip-sub">行李 {{ trip._count?.packingItems || 0 }} 项</text></view><text class="state">{{ statusText(trip.status) }}</text></view>
      <view v-if="creatingTrip" class="editor"><input v-model="tripForm.title" class="input" placeholder="行程名称" /><input v-model="tripForm.destination" class="input" placeholder="目的地" /><view class="date-row"><picker mode="date" @change="tripForm.startsAt = $event.detail.value"><view class="input">{{ tripForm.startsAt || '出发日期' }}</view></picker><picker mode="date" @change="tripForm.endsAt = $event.detail.value"><view class="input">{{ tripForm.endsAt || '结束日期' }}</view></picker></view><view class="button" @tap="saveTrip">保存行程</view></view>
      <view v-else class="button" @tap="creatingTrip = true">＋ 创建露营行程</view>
    </view>

    <view v-else-if="active === 'trips' && selectedTrip">
      <view class="back" @tap="closeTrip">‹ 返回行程</view>
      <view class="trip-head"><text class="trip-title">{{ selectedTrip.title }}</text><text class="trip-sub">{{ selectedTrip.destination || '未填写目的地' }} · 已准备 {{ packedCount }}/{{ packingItems.length }}</text></view>
      <view class="packing-actions"><picker v-if="templates.length" :range="templates" range-key="name" @change="applyTemplateByIndex"><view class="action">套用自定义模板</view></picker><view class="action" @tap="showingItemForm = !showingItemForm">手工加一项</view></view>
      <view v-if="!templates.length" class="notice" @tap="active = 'templates'">还没有行李模板，先去创建一个 ›</view>
      <view v-if="showingItemForm" class="editor"><input v-model="itemForm.name" class="input" placeholder="本次要带什么" /><view class="item-inputs"><input v-model="itemForm.quantity" type="digit" class="input" placeholder="数量" /><input v-model="itemForm.unit" class="input" placeholder="单位" /></view><input v-model="itemForm.note" class="input" placeholder="备注（可选）" /><view class="button small" @tap="saveTripItem">加入本次行程</view></view>
      <view v-if="!packingItems.length" class="empty">本次行程还没有行李项</view>
      <view v-for="item in packingItems" :key="item.id" class="packing-item" :class="{ packed: item.status === 'PACKED' }"><text class="check" @tap="togglePacked(item)">{{ item.status === 'PACKED' ? '✓' : '' }}</text><view class="packing-info"><text class="packing-name">{{ item.name }}<text v-if="quantityText(item.quantity,item.unit)" class="quantity"> · {{ quantityText(item.quantity,item.unit) }}</text></text><text class="packing-meta">{{ item.sourceTemplate ? `来自模板：${item.sourceTemplate.name}` : '本次手工添加' }}{{ item.note ? ` · ${item.note}` : '' }}</text><picker v-if="memberNames.length" :range="memberNames" @change="assign(item, Number($event.detail.value))"><text class="responsible">负责人：{{ responsibleName(item) }} ›</text></picker></view><text class="remove" @tap="removeItem(item)">×</text></view>
    </view>

    <view v-else>
      <view class="template-explain">模板名称和物品均由家庭成员自定义。套用到行程后会生成独立清单，不会反向修改模板。</view>
      <view v-if="!templates.length && !showingTemplateForm" class="empty">还没有自定义模板</view>
      <view v-for="template in templates" :key="template.id" class="template-card"><view class="template-top"><view><text class="template-name">{{ template.name }}</text><text class="template-description">{{ template.description || `${template.items.length} 件物品` }}</text></view><text class="edit" @tap="editTemplate(template)">编辑</text></view><view class="chips"><text v-for="item in template.items.slice(0,6)" :key="item.id" class="chip">{{ item.name }}</text><text v-if="template.items.length > 6" class="chip">+{{ template.items.length - 6 }}</text></view><text class="archive" @tap="archiveTemplate(template)">归档模板</text></view>
      <view v-if="showingTemplateForm" class="editor template-editor"><text class="editor-title">{{ editingTemplateId ? '编辑模板' : '新建自定义模板' }}</text><input v-model="templateForm.name" class="input" placeholder="模板名称，例如：烧烤" /><input v-model="templateForm.description" class="input" placeholder="说明（可选）" /><view v-for="(item,index) in templateForm.items" :key="index" class="template-row"><input v-model="item.name" class="input template-item-name" placeholder="物品名称" /><input v-model="item.quantity" type="digit" class="input template-amount" placeholder="数量" /><input v-model="item.unit" class="input template-unit" placeholder="单位" /><text class="remove" @tap="removeTemplateItem(index)">×</text><input v-model="item.note" class="input template-note" placeholder="备注（可选）" /></view><text class="add-row" @tap="addTemplateItem">＋ 添加模板物品</text><view class="button small" @tap="saveTemplate">{{ editingTemplateId ? '保存修改' : '创建模板' }}</view><view class="cancel" @tap="showingTemplateForm = false">取消</view></view>
      <view v-else class="button" @tap="newTemplate">＋ 新建自定义模板</view>
    </view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:38rpx 28rpx 70rpx;background:#edf5eb}.heading .label,.heading .title,.heading .subtitle,.trip-title,.trip-sub,.map-note,.packing-name,.packing-meta,.responsible,.template-name,.template-description{display:block}.label{font-size:24rpx;letter-spacing:3rpx;color:#6e9770}.title{margin-top:10rpx;font-size:42rpx;font-weight:700;color:#3f5844}.subtitle{margin-top:11rpx;font-size:23rpx;color:#819183}.tabs{display:flex;margin-top:28rpx;padding:7rpx;border-radius:20rpx;background:#dcebd8}.tab{flex:1;padding:16rpx;border-radius:15rpx;text-align:center;color:#6d886f;font-size:24rpx}.tab.chosen{background:#fff;color:#43704a;font-weight:600}.map{margin-top:20rpx;padding:30rpx;border-radius:28rpx;background:linear-gradient(135deg,#dcefd8,#dbeaf0);color:#4e6b54;text-align:center;font-size:28rpx}.map-icon{display:block;margin-bottom:10rpx;font-size:62rpx}.map-note{margin-top:8rpx;color:#819687;font-size:21rpx}.trip{display:flex;align-items:center;gap:18rpx;margin-top:16rpx;padding:24rpx;border-radius:24rpx;background:#fffdf7}.pin{font-size:39rpx}.trip-info{min-width:0;flex:1}.trip-title{font-size:29rpx;color:#465a49}.trip-sub{margin-top:7rpx;color:#909c91;font-size:21rpx}.state{padding:9rpx 12rpx;border-radius:99rpx;background:#e2f0df;color:#5a8160;font-size:20rpx}.empty{padding:65rpx 0;text-align:center;color:#87988a;font-size:25rpx}.button{margin-top:28rpx;padding:25rpx;border-radius:24rpx;background:#69a778;color:#fff;text-align:center;font-size:27rpx}.button.small{margin-top:18rpx;padding:19rpx;font-size:24rpx}.editor{margin-top:20rpx;padding:22rpx;border-radius:24rpx;background:#fff}.input{box-sizing:border-box;width:100%;margin-top:12rpx;padding:19rpx;border:2rpx solid #e3ebe2;border-radius:15rpx;background:#fff;font-size:24rpx;color:#58675a}.date-row,.item-inputs{display:grid;grid-template-columns:1fr 1fr;gap:12rpx}.back{margin:24rpx 0 14rpx;color:#5e8663;font-size:24rpx}.trip-head{padding:24rpx;border-radius:24rpx;background:#fffdf7}.packing-actions{display:flex;gap:14rpx;margin-top:16rpx}.packing-actions picker,.packing-actions>.action{flex:1}.action{padding:18rpx;border-radius:18rpx;background:#d8ead7;color:#4f7955;text-align:center;font-size:23rpx}.notice,.template-explain{margin-top:16rpx;padding:20rpx;border-radius:18rpx;background:#fff8dc;color:#7a704f;font-size:22rpx;line-height:1.6}.packing-item{display:flex;align-items:center;gap:16rpx;margin-top:14rpx;padding:21rpx;border-radius:22rpx;background:#fffdf7}.packing-item.packed{opacity:.62}.check{display:flex;align-items:center;justify-content:center;width:42rpx;height:42rpx;border:2rpx solid #90b492;border-radius:12rpx;color:#fff}.packed .check{background:#69a778}.packing-info{min-width:0;flex:1}.packing-name{font-size:27rpx;color:#48584a}.packed .packing-name{text-decoration:line-through}.quantity{color:#6f7f71;font-size:22rpx}.packing-meta{margin-top:6rpx;color:#9a9b93;font-size:19rpx}.responsible{margin-top:9rpx;color:#5e8b66;font-size:21rpx}.remove{padding:10rpx;color:#ba8373;font-size:34rpx}.template-card{margin-top:16rpx;padding:23rpx;border-radius:24rpx;background:#fffdf7}.template-top{display:flex;justify-content:space-between}.template-name{font-size:29rpx;color:#435747}.template-description{margin-top:7rpx;color:#92998f;font-size:21rpx}.edit{color:#579064;font-size:23rpx}.chips{display:flex;flex-wrap:wrap;gap:9rpx;margin-top:18rpx}.chip{padding:9rpx 13rpx;border-radius:99rpx;background:#e5f0df;color:#627a62;font-size:20rpx}.archive{display:inline-block;margin-top:18rpx;color:#a09283;font-size:20rpx}.editor-title{display:block;font-size:28rpx;font-weight:600;color:#485b4b}.template-row{display:grid;grid-template-columns:1fr 120rpx 100rpx 50rpx;gap:8rpx;align-items:center}.template-note{grid-column:1/4}.template-row .remove{grid-column:4;grid-row:1}.add-row{display:inline-block;margin-top:18rpx;color:#56855d;font-size:23rpx}.cancel{padding:20rpx;text-align:center;color:#8a958b;font-size:23rpx}
</style>
