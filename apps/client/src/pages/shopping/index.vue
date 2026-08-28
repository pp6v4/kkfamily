<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { addShoppingItem, listInventory, listShoppingLists, setInventoryItem, updateShoppingItem, type InventoryItem, type ShoppingItem } from '../../services/family-api';

type ViewName = 'shopping' | 'inventory';
const active = ref<ViewName>('shopping');
const items = ref<ShoppingItem[]>([]);
const inventory = ref<InventoryItem[]>([]);
const loading = ref(false);
const newItem = ref({ name: '', quantity: '', unit: '' });
const stockItem = ref({ name: '', quantity: '', unit: 'g', location: '厨房' });
const pendingCount = computed(() => items.value.filter((item) => item.status !== 'PURCHASED').length);

function message(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
function quantityText(quantity: string | number | null, unit: string | null) { return quantity === null ? '' : `${Number(quantity)}${unit ? ` ${unit}` : ''}`; }
async function loadShopping() { items.value = (await listShoppingLists()).flatMap((list) => list.items); }
async function loadStock() { inventory.value = await listInventory(); }
async function loadPage() {
  loading.value = true;
  try { await Promise.all([loadShopping(), loadStock()]); }
  catch (error) { uni.showToast({ title: message(error), icon: 'none', duration: 3000 }); }
  finally { loading.value = false; }
}
async function toggle(item: ShoppingItem) {
  try { await updateShoppingItem(item.id, item.status === 'PURCHASED' ? 'NEXT_TRIP' : 'PURCHASED'); await loadShopping(); }
  catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
async function createItem() {
  if (!newItem.value.name.trim()) { uni.showToast({ title: '请输入要买的东西', icon: 'none' }); return; }
  try {
    await addShoppingItem({ name: newItem.value.name.trim(), quantity: newItem.value.quantity === '' ? undefined : Number(newItem.value.quantity), unit: newItem.value.unit.trim() || undefined });
    newItem.value = { name: '', quantity: '', unit: '' };
    await loadShopping();
    uni.showToast({ title: '已加入清单', icon: 'success' });
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}
async function saveStock() {
  if (!stockItem.value.name.trim() || stockItem.value.quantity === '' || !stockItem.value.unit.trim()) { uni.showToast({ title: '请填写物品、数量和单位', icon: 'none' }); return; }
  try {
    await setInventoryItem({ name: stockItem.value.name.trim(), quantity: Number(stockItem.value.quantity), unit: stockItem.value.unit.trim(), location: stockItem.value.location.trim() || undefined });
    stockItem.value = { name: '', quantity: '', unit: 'g', location: '厨房' };
    await loadStock();
    uni.showToast({ title: '库存已更新', icon: 'success' });
  } catch (error) { uni.showToast({ title: message(error), icon: 'none' }); }
}

onShow(loadPage);
</script>

<template>
  <view class="page">
    <view class="heading"><text class="label">买东西</text><text class="title">{{ active === 'shopping' ? '购物清单' : '家中库存' }}</text></view>
    <view class="tabs"><view class="tab" :class="{ selected: active === 'shopping' }" @tap="active = 'shopping'">购物清单</view><view class="tab" :class="{ selected: active === 'inventory' }" @tap="active = 'inventory'">家中库存</view></view>

    <view v-if="active === 'shopping'">
      <view class="bag">🛍️　待购买 {{ pendingCount }} 件</view>
      <view class="form"><input v-model="newItem.name" class="input name" placeholder="要买什么" /><input v-model="newItem.quantity" type="digit" class="input quantity" placeholder="数量" /><input v-model="newItem.unit" class="input unit" placeholder="单位" /><text class="add" @tap="createItem">添加</text></view>
      <view v-if="!loading && !items.length" class="empty">购物清单还是空的</view>
      <view v-for="item in items" :key="item.id" class="item" @tap="toggle(item)"><text class="box" :class="{ done:item.status === 'PURCHASED' }">{{ item.status === 'PURCHASED' ? '✓' : '' }}</text><view class="item-info"><text class="item-name" :class="{ cross:item.status === 'PURCHASED' }">{{ item.name }}</text><text class="category">{{ item.sourceType === 'MEAL_SHORTAGE' ? '餐单缺料' : '手工添加' }}{{ quantityText(item.quantity, item.unit) ? ` · ${quantityText(item.quantity, item.unit)}` : '' }}</text></view></view>
    </view>

    <view v-else>
      <view class="stock-note">库存用于点餐时辅助判断食材是否充足。修改后会保留调整记录。</view>
      <view class="stock-form"><input v-model="stockItem.name" class="input" placeholder="食材或调料名称" /><view class="form-row"><input v-model="stockItem.quantity" type="digit" class="input" placeholder="现有数量" /><input v-model="stockItem.unit" class="input" placeholder="单位" /><input v-model="stockItem.location" class="input" placeholder="位置" /></view><view class="save-stock" @tap="saveStock">保存库存</view></view>
      <view v-if="!loading && !inventory.length" class="empty">还没有录入库存</view>
      <view v-for="item in inventory" :key="item.id" class="stock-item"><view><text class="item-name">{{ item.ingredient.name }}</text><text class="category">{{ item.location || '未设置位置' }}</text></view><text class="stock-quantity">{{ Number(item.quantity) }} {{ item.unit }}</text></view>
    </view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;padding:38rpx 28rpx;background:#eef4fd}.heading .label,.heading .title,.item-name,.category{display:block}.label{font-size:24rpx;letter-spacing:3rpx;color:#758aa7}.title{margin-top:10rpx;font-size:40rpx;font-weight:700;color:#465a79}.tabs{display:flex;margin-top:28rpx;padding:7rpx;border-radius:20rpx;background:#dce9fc}.tab{flex:1;padding:16rpx;border-radius:15rpx;text-align:center;color:#6e83a2;font-size:24rpx}.tab.selected{background:#fff;color:#49678f;font-weight:600}.bag{margin-top:22rpx;padding:25rpx;border-radius:24rpx;background:#dce9fc;color:#54739f;font-size:26rpx}.form{display:flex;gap:8rpx;margin-top:16rpx;padding:15rpx;border-radius:20rpx;background:#fff}.input{box-sizing:border-box;min-width:0;padding:15rpx;border:2rpx solid #e3eaf4;border-radius:13rpx;background:#fff;font-size:23rpx}.form .name{flex:1}.form .quantity{width:120rpx}.form .unit{width:100rpx}.add{padding:16rpx 20rpx;border-radius:13rpx;background:#769fda;color:#fff;font-size:23rpx}.item,.stock-item{display:flex;align-items:center;gap:18rpx;margin-top:16rpx;padding:24rpx;border-radius:23rpx;background:#fffdfb}.box{display:flex;align-items:center;justify-content:center;width:37rpx;height:37rpx;border:2rpx solid #a5b8d4;border-radius:12rpx;color:#fff}.box.done{background:#75a984;border-color:#75a984}.item-info{min-width:0;flex:1}.item-name{font-size:29rpx;color:#4d5870}.cross{text-decoration:line-through;color:#a9b1bf}.category{margin-top:6rpx;font-size:21rpx;color:#9aa5b8}.stock-note{margin-top:22rpx;padding:22rpx;border-radius:20rpx;background:#dce9fc;color:#657c9c;font-size:22rpx;line-height:1.6}.stock-form{margin-top:16rpx;padding:20rpx;border-radius:22rpx;background:#fff}.stock-form>.input{width:100%}.form-row{display:flex;gap:10rpx;margin-top:10rpx}.form-row .input{width:33.33%}.save-stock{margin-top:16rpx;padding:18rpx;border-radius:16rpx;background:#769fda;color:#fff;text-align:center;font-size:25rpx}.stock-item{justify-content:space-between}.stock-quantity{color:#5575a0;font-size:27rpx}.empty{padding:70rpx 0;text-align:center;color:#91a0b3;font-size:25rpx}
</style>
