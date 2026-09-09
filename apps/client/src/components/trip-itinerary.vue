<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { assertTravelOrder, isCalendarDate, parseCoordinates, shanghaiDate, travelTimestamp } from '../services/trip-form';
import { createAccommodation, createTripLeg, createTripStop, getTripItinerary, getTripStopDeleteImpact, removeAccommodation, removeTripLeg, removeTripStop, reorderTripStops, updateAccommodation, updateTripLeg, updateTripStop, type Accommodation, type Trip, type TripItinerary, type TripLeg, type TripStop } from '../services/family-api';

const props=defineProps<{trip:Trip;canEdit:boolean;active:boolean}>();
const emit=defineEmits<{changed:[version:number]}>();
const itinerary=ref<TripItinerary>({tripVersion:props.trip.version,stops:[],legs:[],accommodations:[]});
const loading=ref(false),section=ref<'stops'|'lodging'>('stops'),pulse=ref(false);
const showingStopForm=ref(false),editingStop=ref<TripStop>(),showingLodgingForm=ref(false),editingLodging=ref<Accommodation>();
const stopTypes:Array<{value:TripStop['stopType'];label:string}>=[{value:'MEETING',label:'集合点'},{value:'WAYPOINT',label:'途经点'},{value:'CAMPSITE',label:'营地'},{value:'ATTRACTION',label:'景点'},{value:'HOTEL',label:'酒店'},{value:'RETURN',label:'返程点'}];
const transportModes:Array<{value:TripLeg['mode'];label:string}>=[{value:'DRIVING',label:'自驾'},{value:'RAIL',label:'火车'},{value:'FLIGHT',label:'飞机'},{value:'WALKING',label:'步行'},{value:'OTHER',label:'其他'}];
const stopForm=ref({title:'',typeIndex:2,latitude:'',longitude:'',arriveDate:'',leaveDate:'',note:''});
const legModeIndex=ref(0);
const lodgingForm=ref({name:'',address:'',checkInDate:'',checkOutDate:'',contact:'',reservationNote:'',stopIndex:0});
let timer:ReturnType<typeof setInterval>|undefined;

function message(error:unknown){return error instanceof Error?error.message:'操作失败';}
function toast(error:unknown){uni.showToast({title:message(error),icon:'none',duration:3000});}
function labelStop(type:TripStop['stopType']){return stopTypes.find(item=>item.value===type)?.label||type;}
function labelMode(mode:TripLeg['mode']){return transportModes.find(item=>item.value===mode)?.label||mode;}
function dateOnly(value:string){return value.slice(0,10);}
function emitVersion(version:number){itinerary.value.tripVersion=version;emit('changed',version);}

async function load(){loading.value=true;try{itinerary.value=await getTripItinerary(props.trip.id);}catch(error){toast(error);}finally{loading.value=false;}}
watch(()=>props.trip.id,load,{immediate:true});
watch(()=>props.active,value=>{if(timer){clearInterval(timer);timer=undefined;}if(value)timer=setInterval(()=>pulse.value=!pulse.value,850);},{immediate:true});
onUnmounted(()=>{if(timer)clearInterval(timer);});

const mapCenter=computed(()=>itinerary.value.stops[0]||{latitude:35.8617,longitude:104.1954});
const mapPoints=computed(()=>itinerary.value.stops.map(stop=>({latitude:Number(stop.latitude),longitude:Number(stop.longitude)})));
const markers=computed(()=>itinerary.value.stops.map((stop,index)=>({id:index+1,latitude:Number(stop.latitude),longitude:Number(stop.longitude),title:stop.title,label:{content:`${index+1} ${stop.title}`,color:'#3f5844',fontSize:12,borderRadius:8,bgColor:'#fffdf7',padding:5}})));
const polylines=computed(()=>itinerary.value.legs.map(leg=>{const planned=leg.routeKind==='PLANNED'&&!leg.staleAt&&Array.isArray(leg.geometryJson);const raw=planned?leg.geometryJson!:[[Number(leg.fromStop.longitude),Number(leg.fromStop.latitude)],[Number(leg.toStop.longitude),Number(leg.toStop.latitude)]];const dotted=props.trip.status==='PLANNING'||props.trip.status==='PENDING'||Boolean(leg.staleAt);return{points:raw.map(point=>({longitude:Number(point[0]),latitude:Number(point[1])})),color:dotted?(pulse.value?'#6ea979':'#b6cfb7'):'#4f8d66',width:5,dottedLine:dotted,arrowLine:!dotted&&(props.trip.status==='DEPARTING'||props.trip.status==='COMPLETED')}}));

function newStop(){editingStop.value=undefined;stopForm.value={title:'',typeIndex:2,latitude:'',longitude:'',arriveDate:'',leaveDate:'',note:''};showingStopForm.value=true;}
function editStop(stop:TripStop){editingStop.value=stop;stopForm.value={title:stop.title,typeIndex:Math.max(0,stopTypes.findIndex(item=>item.value===stop.stopType)),latitude:String(Number(stop.latitude)),longitude:String(Number(stop.longitude)),arriveDate:stop.arriveAt?shanghaiDate(stop.arriveAt):'',leaveDate:stop.leaveAt?shanghaiDate(stop.leaveAt):'',note:stop.note||''};showingStopForm.value=true;}
function choosePoint(){uni.chooseLocation({success:result=>{stopForm.value.latitude=String(result.latitude);stopForm.value.longitude=String(result.longitude);if(!stopForm.value.title)stopForm.value.title=result.name||result.address||'行程地点';},fail:()=>uni.showToast({title:'未选择位置，可继续手工填写经纬度',icon:'none'})});}
async function saveStop(){
  if(!props.canEdit)return;
  const form=stopForm.value,original=editingStop.value;
  try{
    if(!form.title.trim())throw new Error('请填写节点名称');
    const coordinates=parseCoordinates(form.latitude,form.longitude);
    const stopType=stopTypes[form.typeIndex]?.value;
    if(!stopType)throw new Error('请选择节点类型');
    const arriveAt=travelTimestamp(form.arriveDate,'08',original?.arriveAt);
    const leaveAt=travelTimestamp(form.leaveDate,'18',original?.leaveAt);
    assertTravelOrder(arriveAt,leaveAt);
    const input={title:form.title.trim(),stopType,...coordinates,arriveAt,leaveAt,note:form.note.trim()};
    const result=original?await updateTripStop(props.trip,original,{...input,arriveAt:arriveAt??null,leaveAt:leaveAt??null}):await createTripStop(props.trip,input);
    emitVersion(result.tripVersion);showingStopForm.value=false;await load();
  }catch(error){toast(error);}
}
async function moveStop(index:number,direction:-1|1){const target=index+direction;if(target<0||target>=itinerary.value.stops.length)return;const ids=itinerary.value.stops.map(stop=>stop.id);[ids[index],ids[target]]=[ids[target],ids[index]];try{const result=await reorderTripStops(props.trip,ids);emitVersion(result.tripVersion);await load();}catch(error){toast(error);}}
function deleteStop(stop:TripStop){getTripStopDeleteImpact(props.trip.id,stop.id).then(impact=>{const detail=`关联路线 ${impact.legs.length} 条、住宿 ${impact.accommodations.length} 条。路线会归档，住宿会保留为行程级记录。`;uni.showModal({title:'移除行程节点',content:detail,success:async result=>{if(!result.confirm)return;try{const removed=await removeTripStop(props.trip,stop,true);emitVersion(removed.tripVersion);await load();}catch(error){toast(error);}}});}).catch(toast);}

function legBetween(from:TripStop,to:TripStop){return itinerary.value.legs.find(leg=>leg.fromStopId===from.id&&leg.toStopId===to.id);}
async function addLeg(from:TripStop,to:TripStop){try{const result=await createTripLeg(props.trip,{fromStopId:from.id,toStopId:to.id,mode:transportModes[legModeIndex.value].value,routeKind:'SCHEMATIC'});emitVersion(result.tripVersion);await load();}catch(error){toast(error);}}
async function changeLegMode(leg:TripLeg,index:number){try{const result=await updateTripLeg(props.trip,leg,{mode:transportModes[index].value});emitVersion(result.tripVersion);await load();}catch(error){toast(error);}}
function deleteLeg(leg:TripLeg){uni.showModal({title:'移除路线',content:`移除“${leg.fromStop.title} → ${leg.toStop.title}”？`,success:async result=>{if(!result.confirm)return;try{const removed=await removeTripLeg(props.trip,leg);emitVersion(removed.tripVersion);await load();}catch(error){toast(error);}}});}

function newLodging(){editingLodging.value=undefined;lodgingForm.value={name:'',address:'',checkInDate:'',checkOutDate:'',contact:'',reservationNote:'',stopIndex:0};showingLodgingForm.value=true;}
function editLodging(item:Accommodation){editingLodging.value=item;lodgingForm.value={name:item.name,address:item.address||'',checkInDate:dateOnly(item.checkInDate),checkOutDate:dateOnly(item.checkOutDate),contact:item.contact||'',reservationNote:item.reservationNote||'',stopIndex:item.stopId?itinerary.value.stops.findIndex(stop=>stop.id===item.stopId)+1:0};showingLodgingForm.value=true;}
async function saveLodging(){
  if(!props.canEdit)return;
  const form=lodgingForm.value;
  try{
    if(!form.name.trim()||!isCalendarDate(form.checkInDate)||!isCalendarDate(form.checkOutDate))throw new Error('填写住宿名称和有效的入住退房日期');
    if(form.checkOutDate<=form.checkInDate)throw new Error('退房日期必须晚于入住日期');
    const stopId=form.stopIndex?itinerary.value.stops[form.stopIndex-1]?.id:undefined;
    if(form.stopIndex&&!stopId)throw new Error('关联节点已变更，请重新选择');
    const input={stopId,name:form.name.trim(),address:form.address.trim(),checkInDate:form.checkInDate,checkOutDate:form.checkOutDate,contact:form.contact.trim(),reservationNote:form.reservationNote.trim()};
    const result=editingLodging.value?await updateAccommodation(props.trip,editingLodging.value,{...input,stopId:stopId??null}):await createAccommodation(props.trip,input);
    emitVersion(result.tripVersion);showingLodgingForm.value=false;await load();
  }catch(error){toast(error);}
}
function deleteLodging(item:Accommodation){uni.showModal({title:'移除住宿',content:`移除“${item.name}”？`,success:async result=>{if(!result.confirm)return;try{const removed=await removeAccommodation(props.trip,item);emitVersion(removed.tripVersion);await load();}catch(error){toast(error);}}});}
</script>

<template>
  <view class="itinerary-card">
    <view class="section-title"><view><text class="eyebrow">行程地图</text><text class="title">路线与住宿</text></view><text class="coordinate">GCJ-02</text></view>
    <map class="trip-map" :latitude="Number(mapCenter.latitude)" :longitude="Number(mapCenter.longitude)" :scale="itinerary.stops.length?8:3" :markers="markers" :polyline="polylines" :include-points="mapPoints" show-scale />
    <text v-if="!itinerary.stops.length" class="empty-note">还没有地图节点，可用微信选点或手工填写坐标。</text>
    <text v-else class="route-note">虚线为待出行或已过期路线，实线箭头用于进行中/已完成路线；示意路线会明确标注，不作为导航。</text>
    <view class="mini-tabs"><text :class="{selected:section==='stops'}" @tap="section='stops'">节点与路线</text><text :class="{selected:section==='lodging'}" @tap="section='lodging'">住宿</text></view>

    <view v-if="section==='stops'">
      <view v-for="(stop,index) in itinerary.stops" :key="stop.id">
        <view class="stop-row"><text class="number">{{index+1}}</text><view class="grow" @tap="canEdit&&editStop(stop)"><text class="row-title">{{stop.title}}</text><text class="row-meta">{{labelStop(stop.stopType)}} · {{Number(stop.latitude).toFixed(4)}}, {{Number(stop.longitude).toFixed(4)}}</text></view><view v-if="canEdit" class="row-actions"><text @tap="moveStop(index,-1)">↑</text><text @tap="moveStop(index,1)">↓</text><text class="danger" @tap="deleteStop(stop)">×</text></view></view>
        <view v-if="index<itinerary.stops.length-1" class="leg-row"><template v-if="legBetween(stop,itinerary.stops[index+1])"><view class="grow"><text class="leg-title">{{labelMode(legBetween(stop,itinerary.stops[index+1])!.mode)}} · {{legBetween(stop,itinerary.stops[index+1])!.routeKind==='SCHEMATIC'?'示意路线':'规划路线'}}</text><text v-if="legBetween(stop,itinerary.stops[index+1])!.staleAt" class="stale">节点已变化，路线待重新规划</text></view><picker v-if="canEdit" :range="transportModes.map(item=>item.label)" @change="changeLegMode(legBetween(stop,itinerary.stops[index+1])!,Number($event.detail.value))"><text class="link">改方式</text></picker><text v-if="canEdit" class="link danger" @tap="deleteLeg(legBetween(stop,itinerary.stops[index+1])!)">移除</text></template><template v-else-if="canEdit"><picker :range="transportModes.map(item=>item.label)" @change="legModeIndex=Number($event.detail.value)"><text class="link">{{transportModes[legModeIndex].label}} ›</text></picker><text class="link" @tap="addLeg(stop,itinerary.stops[index+1])">＋ 添加示意路线</text></template></view>
      </view>
      <view v-if="showingStopForm" class="form"><input v-model="stopForm.title" class="input" placeholder="节点名称"/><picker :range="stopTypes.map(item=>item.label)" @change="stopForm.typeIndex=Number($event.detail.value)"><view class="input">{{stopTypes[stopForm.typeIndex].label}} ›</view></picker><view class="pick-location" @tap="choosePoint">📍 微信选点（可取消后手填）</view><view class="grid"><input v-model="stopForm.latitude" type="digit" class="input" placeholder="纬度"/><input v-model="stopForm.longitude" type="digit" class="input" placeholder="经度"/></view><view class="grid"><picker mode="date" @change="stopForm.arriveDate=$event.detail.value"><view class="input">{{stopForm.arriveDate||'到达日期'}}</view></picker><picker mode="date" @change="stopForm.leaveDate=$event.detail.value"><view class="input">{{stopForm.leaveDate||'离开日期'}}</view></picker></view><input v-model="stopForm.note" class="input" placeholder="备注（可选）"/><view class="save" @tap="saveStop">{{editingStop?'保存节点':'添加节点'}}</view><view class="cancel" @tap="showingStopForm=false">取消</view></view>
      <view v-else-if="canEdit" class="add" @tap="newStop">＋ 添加地图节点</view>
    </view>

    <view v-else>
      <view v-for="item in itinerary.accommodations" :key="item.id" class="lodging-row"><view class="grow" @tap="canEdit&&editLodging(item)"><text class="row-title">{{item.name}}</text><text class="row-meta">{{dateOnly(item.checkInDate)}} 至 {{dateOnly(item.checkOutDate)}}{{item.stop?` · ${item.stop.title}`:''}}</text><text v-if="item.address" class="row-meta">{{item.address}}</text></view><text v-if="canEdit" class="danger" @tap="deleteLodging(item)">移除</text></view>
      <view v-if="showingLodgingForm" class="form"><input v-model="lodgingForm.name" class="input" placeholder="酒店或营地住宿名称"/><input v-model="lodgingForm.address" class="input" placeholder="地址（可选）"/><picker :range="['不关联节点',...itinerary.stops.map(stop=>stop.title)]" @change="lodgingForm.stopIndex=Number($event.detail.value)"><view class="input">{{lodgingForm.stopIndex?itinerary.stops[lodgingForm.stopIndex-1]?.title:'不关联节点'}} ›</view></picker><view class="grid"><picker mode="date" @change="lodgingForm.checkInDate=$event.detail.value"><view class="input">{{lodgingForm.checkInDate||'入住日期'}}</view></picker><picker mode="date" @change="lodgingForm.checkOutDate=$event.detail.value"><view class="input">{{lodgingForm.checkOutDate||'退房日期'}}</view></picker></view><input v-model="lodgingForm.contact" class="input" placeholder="联系人/电话（可选）"/><textarea v-model="lodgingForm.reservationNote" class="textarea" placeholder="预订备注（不记录金额）"/><view class="save" @tap="saveLodging">{{editingLodging?'保存住宿':'添加住宿'}}</view><view class="cancel" @tap="showingLodgingForm=false">取消</view></view>
      <view v-else-if="canEdit" class="add" @tap="newLodging">＋ 添加住宿</view>
      <text v-if="!itinerary.accommodations.length&&!showingLodgingForm" class="empty-note">还没有住宿安排。</text>
    </view>
  </view>
</template>

<style scoped>
.itinerary-card{margin-top:16rpx;padding:22rpx;border-radius:26rpx;background:#fffdf7}.section-title{display:flex;align-items:flex-start;justify-content:space-between}.eyebrow,.title,.empty-note,.route-note,.row-title,.row-meta,.leg-title,.stale{display:block}.eyebrow{color:#759078;font-size:19rpx}.title{margin-top:4rpx;color:#435747;font-size:29rpx;font-weight:650}.coordinate{padding:7rpx 10rpx;border-radius:10rpx;background:#e9f1e5;color:#6d816d;font-size:17rpx}.trip-map{width:100%;height:370rpx;margin-top:18rpx;border-radius:20rpx;overflow:hidden}.empty-note,.route-note{margin-top:12rpx;color:#8b988d;font-size:20rpx;line-height:1.55}.mini-tabs{display:flex;gap:14rpx;margin-top:18rpx}.mini-tabs text{flex:1;padding:14rpx;text-align:center;border-radius:14rpx;background:#edf3e9;color:#718274;font-size:21rpx}.mini-tabs .selected{background:#d7e9d5;color:#4e7455;font-weight:600}.stop-row,.lodging-row{display:flex;align-items:center;gap:12rpx;padding:18rpx 0;border-bottom:1rpx solid #edf0e9}.number{display:flex;align-items:center;justify-content:center;width:38rpx;height:38rpx;border-radius:50%;background:#6fa47a;color:#fff;font-size:19rpx}.grow{min-width:0;flex:1}.row-title{color:#455849;font-size:25rpx}.row-meta{margin-top:5rpx;color:#909b91;font-size:19rpx}.row-actions{display:flex;gap:16rpx;color:#5f8a67;font-size:25rpx}.danger{color:#b97668}.leg-row{display:flex;align-items:center;gap:14rpx;margin-left:19rpx;padding:12rpx 0 12rpx 31rpx;border-left:2rpx dashed #a8c3a7}.leg-title{color:#66806a;font-size:20rpx}.stale{margin-top:4rpx;color:#b28a5f;font-size:17rpx}.link{color:#57835f;font-size:19rpx}.form{margin-top:16rpx;padding:18rpx;border-radius:18rpx;background:#f4f7ef}.input,.textarea{box-sizing:border-box;width:100%;margin-top:10rpx;padding:17rpx;border:2rpx solid #e1eadf;border-radius:14rpx;background:#fff;color:#536356;font-size:22rpx}.textarea{height:130rpx}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10rpx}.pick-location{margin-top:12rpx;padding:16rpx;border-radius:14rpx;background:#dcebd8;color:#54765a;text-align:center;font-size:21rpx}.save,.add{margin-top:16rpx;padding:18rpx;border-radius:17rpx;background:#6ba578;color:#fff;text-align:center;font-size:23rpx}.cancel{padding:16rpx;text-align:center;color:#8a958b;font-size:21rpx}
</style>
