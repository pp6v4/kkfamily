<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { canAccess, refreshAccess, type HouseholdContext } from '../../services/session';
import { addShoppingItem, listInventory, listShoppingLists, setInventoryItem, updateShoppingItem, repeatShoppingItem, type InventoryItem, type ShoppingItem, type SetInventoryInput } from '../../services/family-api';
const active=ref<'shopping'|'inventory'>('shopping'),items=ref<ShoppingItem[]>([]),inventory=ref<InventoryItem[]>([]),loading=ref(false),errorText=ref('');
const session=ref<HouseholdContext>();
const statusLabels:Record<string,string>={ALL:'全部',WISHLIST:'以后想买',NEXT_TRIP:'下次超市',REPLENISH:'常备补货',PURCHASED:'已购买'};
const statusOptions=['WISHLIST','NEXT_TRIP','REPLENISH'];
const filter=ref('ALL'),newStatus=ref(1),newItem=ref({name:'',quantity:'',unit:''});
const emptyStock=()=>({name:'',quantity:'',unit:'g',location:'厨房',expiresAt:'',kind:'FOOD' as 'FOOD'|'SEASONING',availability:'UNKNOWN' as 'PRESENT'|'ABSENT'|'UNKNOWN'});
const stockItem=ref(emptyStock()),editingStock=ref<InventoryItem>();
const repeatRequests=new Map<string,string>();
const pendingCount=computed(()=>items.value.filter(i=>i.status!=='PURCHASED').length);
const visibleItems=computed(()=>items.value.filter(i=>filter.value==='ALL'||i.status===filter.value));
function fail(error:unknown){errorText.value=error instanceof Error?error.message:'操作失败';uni.showToast({title:errorText.value,icon:'none'});}
function quantityText(value:string|number|null,unit:string|null){return value===null?'数量待确认':Number(value)+(unit?' '+unit:'');}
async function loadShopping(){items.value=(await listShoppingLists()).flatMap(l=>l.items);}
async function loadStock(){inventory.value=await listInventory();}
async function loadPage(){
  loading.value=true;items.value=[];inventory.value=[];session.value=undefined;errorText.value='';
  try{session.value=await refreshAccess();await Promise.all([canAccess(session.value,'shopping')?loadShopping():Promise.resolve(),canAccess(session.value,'inventory')?loadStock():Promise.resolve()]);}
  catch(error){items.value=[];inventory.value=[];fail(error);}finally{loading.value=false;}
}
async function setStatus(item:ShoppingItem,status:ShoppingItem['status']){
  if(loading.value)return;loading.value=true;errorText.value='';
  try{await updateShoppingItem(item,status);await loadShopping();}catch(error){fail(error);}finally{loading.value=false;}
}
async function createItem(){
  if(loading.value)return;loading.value=true;errorText.value='';
  try{await addShoppingItem({name:newItem.value.name.trim(),quantity:newItem.value.quantity===''?undefined:Number(newItem.value.quantity),unit:newItem.value.unit.trim()||undefined,status:statusOptions[newStatus.value] as 'WISHLIST'|'NEXT_TRIP'|'REPLENISH'});newItem.value={name:'',quantity:'',unit:''};await loadShopping();}
  catch(error){fail(error);}finally{loading.value=false;}
}
async function repeat(item:ShoppingItem){
  if(loading.value)return;loading.value=true;errorText.value='';
  const requestId=repeatRequests.get(item.id)??('repeat-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));repeatRequests.set(item.id,requestId);
  try{await repeatShoppingItem(item.id,requestId);repeatRequests.delete(item.id);await loadShopping();uni.showToast({title:'已新建待购项，历史保留',icon:'none'});}catch(error){fail(error);}finally{loading.value=false;}
}
function editStock(item:InventoryItem){
  editingStock.value=item;stockItem.value={name:item.ingredient.name,quantity:item.quantity===null?'':String(Number(item.quantity)),unit:item.unit,location:item.location??'',kind:item.ingredient.kind,availability:item.availability,expiresAt:item.expiresAt?.slice(0,10)??''};
}
function resetStock(){editingStock.value=undefined;stockItem.value=emptyStock();}
function chooseKind(kind:'FOOD'|'SEASONING'){if(editingStock.value)return;stockItem.value.kind=kind;stockItem.value.quantity='';stockItem.value.unit=kind==='FOOD'?'g':'';stockItem.value.availability='UNKNOWN';}
async function saveStock(){
  if(loading.value)return;loading.value=true;errorText.value='';
  try{
    const form=stockItem.value;
    const input:SetInventoryInput={name:form.name.trim(),kind:form.kind,unit:form.kind==='FOOD'?form.unit.trim():undefined,quantity:form.kind==='FOOD'&&form.quantity!==''?Number(form.quantity):undefined,location:form.location.trim()||undefined,
      availability:form.kind==='SEASONING'||form.quantity===''?form.availability:undefined,expiresAt:form.expiresAt?form.expiresAt+'T23:59:59+08:00':undefined,id:editingStock.value?.id,expectedVersion:editingStock.value?.version};
    await setInventoryItem(input);resetStock();await loadStock();uni.showToast({title:'库存已保存',icon:'success'});
  }catch(error){fail(error);}finally{loading.value=false;}
}
onShow(loadPage);
</script>
<template>
  <view class="page">
    <view class="heading"><text class="label">买东西</text><text class="title">{{active==='shopping'?'记下想买的小东西':'家中食材与调料'}}</text></view>
    <view class="tabs"><view class="tab" :class="{selected:active==='shopping'}" @tap="active='shopping'">购物清单</view><view v-if="canAccess(session,'inventory')" class="tab" :class="{selected:active==='inventory'}" @tap="active='inventory'">家中库存</view></view>
    <view v-if="errorText" class="error">{{errorText}}<button @tap="loadPage">刷新数据</button></view><view v-if="loading" class="hint">正在同步…</view>
    <view v-if="active==='shopping'">
      <view class="bag">🛍️ 待购买 {{pendingCount}} 件</view>
      <view v-if="canAccess(session,'shopping','EDIT')" class="stock-form"><input v-model="newItem.name" class="input" placeholder="想买什么" /><view class="form-row"><input v-model="newItem.quantity" type="digit" class="input" placeholder="数量，可不填" /><input v-model="newItem.unit" class="input" placeholder="单位" /></view><picker :range="statusOptions.map(s=>statusLabels[s])" :value="newStatus" @change="newStatus=Number($event.detail.value)"><text class="hint">放入：{{statusLabels[statusOptions[newStatus]]}} ›</text></picker><button :disabled="loading" @tap="createItem">记到清单</button></view>
      <view class="filters"><text v-for="(label,key) in statusLabels" :key="key" class="filter" :class="{selected:filter===key}" @tap="filter=key">{{label}}</text></view>
      <view v-if="!loading&&!visibleItems.length" class="empty">{{canAccess(session,'shopping')?'这里还没有物品':'尚未获得购物权限'}}</view>
      <view v-for="item in visibleItems" :key="item.id" class="item"><text class="box" :class="{done:item.status==='PURCHASED'}">{{item.status==='PURCHASED'?'✓':''}}</text><view class="item-info"><text class="item-name" :class="{cross:item.status==='PURCHASED'}">{{item.name}}</text><text class="category">{{statusLabels[item.status]}} · {{quantityText(item.quantity,item.unit)}}</text><text v-if="item.sourceType==='MEAL_SHORTAGE'" class="category">餐单缺料 · 菜单快照{{item.sourceVersion}}版</text><text v-if="item.previousItemId" class="category">复购项，原购买记录已保留</text><text v-if="item.purchasedAt" class="category">购买记录：{{item.purchasedAt}}</text>
        <view v-if="canAccess(session,'shopping','EDIT')" class="actions"><button v-if="item.status!=='PURCHASED'" :disabled="loading" @tap="setStatus(item,'PURCHASED')">买到了</button><button v-if="item.status==='WISHLIST'" :disabled="loading" @tap="setStatus(item,'NEXT_TRIP')">下次买</button><button v-if="item.status==='PURCHASED'" :disabled="loading" @tap="repeat(item)">再买一次</button><button v-if="item.status==='PURCHASED'" :disabled="loading" @tap="setStatus(item,'NEXT_TRIP')">撤销勾选</button></view>
      </view></view>
    </view>
    <view v-else>
      <view class="stock-note">库存仅辅助判断，不自动换算单位。数量留空表示待确认；调料只登记有无。</view>
      <view v-if="canAccess(session,'inventory','EDIT')" class="stock-form">
        <view class="filters"><text class="filter" :class="{selected:stockItem.kind==='FOOD'}" @tap="chooseKind('FOOD')">食材</text><text class="filter" :class="{selected:stockItem.kind==='SEASONING'}" @tap="chooseKind('SEASONING')">调料</text></view>
        <input v-model="stockItem.name" :disabled="!!editingStock" class="input" placeholder="名称" /><view v-if="stockItem.kind==='FOOD'" class="form-row"><input v-model="stockItem.quantity" type="digit" class="input" placeholder="数量，留空待确认" /><input v-model="stockItem.unit" :disabled="!!editingStock" class="input" placeholder="单位" /></view>
        <view v-if="stockItem.kind==='SEASONING'||stockItem.quantity===''" class="filters"><text v-for="(label,key) in {PRESENT:'有',ABSENT:'无',UNKNOWN:'待确认'}" :key="key" class="filter" :class="{selected:stockItem.availability===key}" @tap="stockItem.availability=key">{{label}}</text></view>
        <input v-model="stockItem.location" :disabled="!!editingStock" class="input" placeholder="存放位置" /><picker mode="date" :value="stockItem.expiresAt" @change="stockItem.expiresAt=$event.detail.value"><text class="hint">到期日：{{stockItem.expiresAt||'未填写'}} ›</text></picker><text class="hint" @tap="stockItem.expiresAt=''">清空到期日</text>
        <button :disabled="loading" @tap="saveStock">{{editingStock?'保存核实后的库存':'登记库存'}}</button><button v-if="editingStock" @tap="resetStock">取消修改</button>
      </view>
      <view v-if="!loading&&!inventory.length" class="empty">还没有录入库存</view>
      <view v-for="item in inventory" :key="item.id" class="stock-item"><view><text class="item-name">{{item.ingredient.name}}</text><text class="category">{{item.ingredient.kind==='SEASONING'?'调料':'食材'}} · {{item.location||'未设位置'}}</text><text v-if="item.expiresAt" class="category">到期日 {{item.expiresAt.slice(0,10)}}</text><button v-if="canAccess(session,'inventory','EDIT')" @tap="editStock(item)">核实 / 调整</button></view><text class="stock-quantity">{{item.ingredient.kind==='SEASONING'?({PRESENT:'有',ABSENT:'无',UNKNOWN:'待确认'})[item.availability]:quantityText(item.quantity,item.unit)}}</text></view>
    </view>
  </view>
</template>
<style scoped>
.page{min-height:100vh;padding:38rpx 28rpx;background:#eef4fd}.heading .label,.heading .title,.item-name,.category{display:block}.label{font-size:24rpx;letter-spacing:3rpx;color:#758aa7}.title{margin-top:10rpx;font-size:40rpx;font-weight:700;color:#465a79}.tabs{display:flex;margin-top:28rpx;padding:7rpx;border-radius:20rpx;background:#dce9fc}.tab{flex:1;padding:16rpx;border-radius:15rpx;text-align:center;color:#6e83a2;font-size:24rpx}.tab.selected{background:#fff;color:#49678f;font-weight:600}.bag{margin-top:22rpx;padding:25rpx;border-radius:24rpx;background:#dce9fc;color:#54739f;font-size:26rpx}.form{display:flex;gap:8rpx;margin-top:16rpx;padding:15rpx;border-radius:20rpx;background:#fff}.input{box-sizing:border-box;min-width:0;padding:15rpx;border:2rpx solid #e3eaf4;border-radius:13rpx;background:#fff;font-size:23rpx}.form .name{flex:1}.form .quantity{width:120rpx}.form .unit{width:100rpx}.add{padding:16rpx 20rpx;border-radius:13rpx;background:#769fda;color:#fff;font-size:23rpx}.item,.stock-item{display:flex;align-items:center;gap:18rpx;margin-top:16rpx;padding:24rpx;border-radius:23rpx;background:#fffdfb}.box{display:flex;align-items:center;justify-content:center;width:37rpx;height:37rpx;border:2rpx solid #a5b8d4;border-radius:12rpx;color:#fff}.box.done{background:#75a984;border-color:#75a984}.item-info{min-width:0;flex:1}.item-name{font-size:29rpx;color:#4d5870}.cross{text-decoration:line-through;color:#a9b1bf}.category{margin-top:6rpx;font-size:21rpx;color:#9aa5b8}.stock-note{margin-top:22rpx;padding:22rpx;border-radius:20rpx;background:#dce9fc;color:#657c9c;font-size:22rpx;line-height:1.6}.stock-form{margin-top:16rpx;padding:20rpx;border-radius:22rpx;background:#fff}.stock-form>.input{width:100%}.form-row{display:flex;gap:10rpx;margin-top:10rpx}.form-row .input{width:33.33%}.save-stock{margin-top:16rpx;padding:18rpx;border-radius:16rpx;background:#769fda;color:#fff;text-align:center;font-size:25rpx}.stock-item{justify-content:space-between}.stock-quantity{color:#5575a0;font-size:27rpx}.empty{padding:70rpx 0;text-align:center;color:#91a0b3;font-size:25rpx}
.actions{display:flex;flex-wrap:wrap;gap:14rpx;margin-top:12rpx}.actions button{font-size:25rpx;margin:0;min-height:80rpx}.error{padding:22rpx;background:#fff1e9;color:#a85d32}.stock-form button{font-size:28rpx;margin-top:16rpx}.hint{display:block;margin-top:16rpx;color:#75869b;font-size:26rpx}.item{align-items:flex-start}.stock-item{align-items:flex-start}.filters{display:flex;flex-wrap:wrap;gap:12rpx;margin:20rpx 0}.filter{padding:18rpx;background:#fff;border-radius:18rpx;font-size:26rpx}.filter.selected{background:#769fda;color:white}.input{min-height:88rpx}.stock-note{font-size:26rpx}</style>
