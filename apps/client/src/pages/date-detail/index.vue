<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow } from '@dcloudio/uni-app';
import { setCalendarTarget } from '../../services/calendar-navigation';
import { canAccess, refreshAccess, type HouseholdContext } from '../../services/session';
import {
  archiveAnniversary,
  createAnniversary,
  listCalendarEvents,
  updateAnniversary,
  type Anniversary,
  type CalendarEvent,
} from '../../services/family-api';

const date = ref('');
const events = ref<CalendarEvent[]>([]);
const session = ref<HouseholdContext>();
const adding = ref(false);
const saving = ref(false);
const editing = ref<Pick<Anniversary, 'id' | 'version'> | null>(null);
const title = ref('');
const note = ref('');
const anniversaryDate = ref('');
const recurrence = ref<Anniversary['recurrence']>('YEARLY');
const leapPolicy = ref<Anniversary['leapPolicy']>('FEB_28');
const eventLabels: Record<CalendarEvent['type'], string> = { ANNIVERSARY: '纪念日', MEAL: '吃什么', TRIP: '去露营', TASK: '家庭待办' };
const eventStamps: Record<CalendarEvent['type'], string> = { ANNIVERSARY: '❤', MEAL: '🍲', TRIP: '⛺', TASK: '✓' };
const typeClass: Record<CalendarEvent['type'], string> = { ANNIVERSARY: 'anniversary', MEAL: 'meal', TRIP: 'camping', TASK: 'task' };
const dateTitle = computed(() => date.value ? `${date.value.slice(0, 4)}年${Number(date.value.slice(5, 7))}月${Number(date.value.slice(8, 10))}日` : '当天安排');
const canEdit = computed(() => canAccess(session.value, 'calendar', 'EDIT'));
const canPlanMeal = computed(() => canAccess(session.value, 'meals', 'EDIT'));
const canPlanTrip = computed(() => canAccess(session.value, 'trips', 'EDIT'));
const canPlanTask = computed(() => canAccess(session.value, 'tasks', 'EDIT'));
const quickActionCount = computed(() => [canPlanMeal.value, canPlanTrip.value, canPlanTask.value].filter(Boolean).length);
const hasQuickAction = computed(() => quickActionCount.value > 0);
const isLeapDay = computed(() => anniversaryDate.value.slice(5) === '02-29');
function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }

async function loadEvents() {
  if (!date.value) return;
  events.value = [];
  try {
    session.value = await refreshAccess();
    const from = `${date.value}T00:00:00+08:00`;
    const to = new Date(new Date(from).getTime() + 86400_000).toISOString();
    events.value = await listCalendarEvents(from, to);
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}

function beginCreate() {
  editing.value = null;
  title.value = '';
  note.value = '';
  anniversaryDate.value = date.value;
  recurrence.value = 'YEARLY';
  leapPolicy.value = 'FEB_28';
  adding.value = true;
}

function beginEdit(event: CalendarEvent) {
  if (!event.sourceId || event.version === undefined || !event.localDate || !event.recurrence || !event.leapPolicy) {
    uni.showModal({ title: '纪念日', content: event.title, showCancel: false });
    return;
  }
  if (!canEdit.value) {
    uni.showModal({ title: event.title, content: event.note || (event.recurrence === 'YEARLY' ? '每年重复' : '仅此一次'), showCancel: false });
    return;
  }
  editing.value = { id: event.sourceId, version: event.version };
  title.value = event.title;
  note.value = event.note || '';
  anniversaryDate.value = event.localDate;
  recurrence.value = event.recurrence;
  leapPolicy.value = event.leapPolicy;
  adding.value = true;
}

function closeEditor() { adding.value = false; editing.value = null; }
function pickDate(event: { detail: { value: string } }) { anniversaryDate.value = event.detail.value; }

function openEvent(event: CalendarEvent) {
  if (event.type === 'MEAL') {
    if (!canAccess(session.value, 'meals')) { uni.showToast({ title: '尚未获得点餐详情权限', icon: 'none' }); return; }
    setCalendarTarget({ type: event.type, date: date.value, sourceId: event.sourceId || undefined, mealType: event.type === 'MEAL' ? event.title : undefined });
    uni.switchTab({ url: '/pages/meal/index' });
  } else if (event.type === 'TRIP') {
    if (!canAccess(session.value, 'trips')) { uni.showToast({ title: '尚未获得露营详情权限', icon: 'none' }); return; }
    setCalendarTarget({ type: event.type, date: date.value, sourceId: event.sourceId || undefined });
    uni.switchTab({ url: '/pages/camping/index' });
  } else if (event.type === 'TASK') {
    if (!canAccess(session.value, 'tasks')) { uni.showToast({ title: '尚未获得待办详情权限', icon: 'none' }); return; }
    uni.navigateTo({ url: `/pages/tasks/index?id=${encodeURIComponent(event.sourceId || '')}` });
  } else beginEdit(event);
}

function planMeal() {
  if (!canPlanMeal.value) { uni.showToast({ title: '尚未获得点餐编辑权限', icon: 'none' }); return; }
  setCalendarTarget({ type: 'MEAL', date: date.value }); uni.switchTab({ url: '/pages/meal/index' });
}
function planTrip() {
  if (!canPlanTrip.value) { uni.showToast({ title: '尚未获得露营编辑权限', icon: 'none' }); return; }
  setCalendarTarget({ type: 'TRIP', date: date.value }); uni.switchTab({ url: '/pages/camping/index' });
}
function planTask() {
  if (!canPlanTask.value) { uni.showToast({ title: '尚未获得待办编辑权限', icon: 'none' }); return; }
  uni.navigateTo({ url: `/pages/tasks/index?date=${encodeURIComponent(date.value)}` });
}

async function saveEvent() {
  if (!title.value.trim()) { uni.showToast({ title: '请输入纪念日名称', icon: 'none' }); return; }
  if (!anniversaryDate.value) { uni.showToast({ title: '请选择日期', icon: 'none' }); return; }
  saving.value = true;
  try {
    const wasEditing = Boolean(editing.value);
    const input = { title: title.value.trim(), localDate: anniversaryDate.value, recurrence: recurrence.value, leapPolicy: leapPolicy.value, note: note.value.trim() || undefined };
    if (editing.value) await updateAnniversary(editing.value, { ...input, note: note.value.trim() || null });
    else await createAnniversary(input);
    closeEditor();
    await loadEvents();
    uni.showToast({ title: wasEditing ? '已更新' : '已添加', icon: 'success' });
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
  finally { saving.value = false; }
}

function removeEvent() {
  if (!editing.value || saving.value) return;
  const target = editing.value;
  uni.showModal({
    title: '删除纪念日', content: `确认删除“${title.value}”吗？`, confirmColor: '#b65f62',
    async success(result) {
      if (!result.confirm) return;
      saving.value = true;
      try { await archiveAnniversary(target); closeEditor(); await loadEvents(); uni.showToast({ title: '已删除', icon: 'success' }); }
      catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
      finally { saving.value = false; }
    },
  });
}

onLoad((query) => {
  const now = new Date();
  date.value = String(query.date || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
});
onShow(loadEvents);
</script>

<template>
  <view class="page">
    <view class="heading"><text class="label">{{session?.householdName||'扣扣的家'}} · 日历</text><text class="page-title">{{ dateTitle }}</text><text class="subtitle">点击事件可进入对应功能</text></view>
    <view v-if="events.length" class="event-list">
      <view v-for="event in events" :key="event.id" class="event" @tap="openEvent(event)">
        <text class="stamp" :class="typeClass[event.type]">{{ eventStamps[event.type] }}</text>
        <view><text class="kind">{{ eventLabels[event.type] }}<template v-if="event.type === 'ANNIVERSARY' && event.recurrence"> · {{ event.recurrence === 'YEARLY' ? '每年' : '一次' }}</template></text><text class="event-title">{{ event.title }}</text></view>
        <text class="chevron">›</text>
      </view>
    </view>
    <view v-else class="empty"><text class="empty-icon">☁</text><text>这一天还没有安排</text></view>

    <view v-if="adding" class="editor">
      <view class="editor-head"><text class="editor-title">{{ editing ? '编辑纪念日' : '添加纪念日' }}</text><text class="close" @tap="closeEditor">×</text></view>
      <input v-model="title" class="input" maxlength="80" placeholder="例如：结婚纪念日" />
      <picker mode="date" :value="anniversaryDate" @change="pickDate"><view class="picker-row"><text>日期</text><text>{{ anniversaryDate }} ›</text></view></picker>
      <view class="type-row"><text class="type" :class="{ chosen: recurrence === 'YEARLY' }" @tap="recurrence = 'YEARLY'">每年提醒</text><text class="type" :class="{ chosen: recurrence === 'ONCE' }" @tap="recurrence = 'ONCE'">仅此一次</text></view>
      <view v-if="isLeapDay && recurrence === 'YEARLY'" class="leap"><text class="hint">非闰年的2月29日怎么显示？</text><view class="type-row"><text class="type" :class="{ chosen: leapPolicy === 'FEB_28' }" @tap="leapPolicy = 'FEB_28'">2月28日</text><text class="type" :class="{ chosen: leapPolicy === 'MAR_1' }" @tap="leapPolicy = 'MAR_1'">3月1日</text><text class="type" :class="{ chosen: leapPolicy === 'SKIP' }" @tap="leapPolicy = 'SKIP'">当年跳过</text></view></view>
      <textarea v-model="note" class="textarea" maxlength="500" placeholder="备注（可不填）" />
      <view class="actions"><view v-if="editing" class="danger" @tap="removeEvent">删除</view><view class="save" :class="{ disabled: saving }" @tap="saveEvent">{{ saving ? '保存中…' : '保存' }}</view></view>
    </view>
    <view v-else-if="canEdit" class="add primary" @tap="beginCreate">+ 添加纪念日</view>
    <view v-else class="permission-tip">当前账号可查看日历，但没有编辑权限</view>
    <view v-if="hasQuickAction" class="quick-grid"><view v-if="canPlanMeal" class="add" :class="{wide:quickActionCount===1}" @tap="planMeal">安排当天餐点</view><view v-if="canPlanTrip" class="add" :class="{wide:quickActionCount===1}" @tap="planTrip">从这天计划出行</view><view v-if="canPlanTask" class="add" :class="{wide:quickActionCount===1||quickActionCount===3}" @tap="planTask">添加当天待办</view></view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:40rpx 30rpx 70rpx;background:linear-gradient(180deg,#e9f4df 0,#f7f3e8 28%)}.heading .label,.heading .page-title,.heading .subtitle,.kind,.event-title,.hint{display:block}.label{font-size:23rpx;letter-spacing:3rpx;color:#78917a}.page-title{margin-top:12rpx;font-size:44rpx;font-weight:700;color:#3b5141}.subtitle{margin-top:10rpx;color:#928a7f;font-size:25rpx}.event-list{margin-top:38rpx}.event{display:flex;align-items:center;gap:20rpx;margin-bottom:18rpx;padding:25rpx;border:3rpx solid #fff;border-radius:25rpx;background:#fffdf7;box-shadow:0 8rpx 18rpx rgba(70,90,66,.06)}.stamp{display:flex;align-items:center;justify-content:center;width:64rpx;height:64rpx;border-radius:50%;font-size:32rpx}.anniversary{background:#ffdbe4}.meal{background:#ffe9bd}.camping{background:#d9eee0}.task{background:#ddeaff}.kind{font-size:20rpx;color:#9b9287}.event-title{margin-top:6rpx;font-size:29rpx;color:#4b544b}.chevron{margin-left:auto;font-size:44rpx;color:#baaf9d}.empty{display:flex;flex-direction:column;align-items:center;gap:12rpx;margin-top:70rpx;color:#877f73}.empty-icon{font-size:78rpx}.editor{margin-top:35rpx;padding:28rpx;border:3rpx solid #fff;border-radius:28rpx;background:#fffdf7;box-shadow:0 10rpx 24rpx rgba(73,91,67,.08)}.editor-head{display:flex;align-items:center;justify-content:space-between}.editor-title{font-size:31rpx;font-weight:700;color:#465a49}.close{padding:0 10rpx;font-size:43rpx;color:#a69e91}.input,.textarea{box-sizing:border-box;width:100%;margin-top:20rpx;padding:20rpx;border:2rpx solid #e4e8df;border-radius:16rpx;background:#fff;font-size:27rpx}.textarea{height:150rpx}.picker-row{display:flex;justify-content:space-between;margin-top:18rpx;padding:22rpx;border-radius:16rpx;background:#f3f4ec;color:#607061;font-size:26rpx}.type-row{display:flex;flex-wrap:wrap;gap:12rpx;margin-top:18rpx}.type{padding:15rpx 20rpx;border-radius:99rpx;background:#eef1e9;color:#718072;font-size:23rpx}.type.chosen{background:#d6ead4;color:#3f754a}.leap{margin-top:22rpx;padding:20rpx;border-radius:18rpx;background:#fff4d8}.hint{color:#7b6b4e;font-size:23rpx}.actions{display:flex;gap:16rpx;margin-top:22rpx}.save,.danger,.add{padding:24rpx;border-radius:22rpx;text-align:center;font-size:27rpx}.save{flex:1;background:#75aa78;color:#fff}.danger{width:140rpx;background:#ffe7e6;color:#a85155}.disabled{opacity:.55}.add{margin-top:22rpx;background:#fffdf7;color:#5b705e}.primary{margin-top:35rpx;background:#75aa78;color:#fff}.quick-grid{display:grid;grid-template-columns:1fr 1fr;gap:16rpx}.quick-grid .add{border:2rpx solid #edf0e6}.quick-grid .wide{grid-column:1 / 3}.permission-tip{margin-top:30rpx;padding:22rpx;text-align:center;color:#8e887d;font-size:23rpx}.event-list+.editor{margin-top:24rpx}
</style>
