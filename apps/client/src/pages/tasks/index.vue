<script setup lang="ts">
import { computed, ref } from 'vue';
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { addTaskComment, createTask, getTask, listTaskAssignees, listTasks, updateTask, updateTaskStatus, type Task, type TaskPerson } from '../../services/family-api';
import { canAccess, refreshAccess, type HouseholdContext } from '../../services/session';
import { shanghaiDate } from '../../services/trip-form';

const session=ref<HouseholdContext>(),tasks=ref<Task[]>([]),assignees=ref<TaskPerson[]>([]),selected=ref<Task>();
const filter=ref<'OPEN'|'DONE'>('OPEN'),showingForm=ref(false),editing=ref(false),busy=ref(false),initialTaskId=ref(''),initialDate=ref('');
const form=ref({typeIndex:0,title:'',description:'',assigneeIndex:0,dueDate:'',reminderDate:'',priorityIndex:1});
const comment=ref(''),reopenReason=ref('');
let viewEpoch=0;
const types=[{value:'TODO' as const,label:'家庭待办'},{value:'REQUEST' as const,label:'家庭请求'}];
const priorities=[{value:'LOW' as const,label:'不着急'},{value:'NORMAL' as const,label:'普通'},{value:'HIGH' as const,label:'重要'}];
const statusLabels:Record<Task['status'],string>={PENDING:'待开始',IN_PROGRESS:'处理中',COMPLETED:'已完成',CANCELLED:'已取消'};
const shownTasks=computed(()=>tasks.value.filter(task=>filter.value==='OPEN'?['PENDING','IN_PROGRESS'].includes(task.status):['COMPLETED','CANCELLED'].includes(task.status)));
const manager=computed(()=>canAccess(session.value,'tasks','MANAGE'));
const editable=computed(()=>{const task=selected.value;if(!task||!canAccess(session.value,'tasks','EDIT')||!session.value)return false;return manager.value||task.assigneeMembershipId===session.value.membershipId||(task.createdBy.id===session.value.membershipId&&task.status==='PENDING');});
const statusEditable=computed(()=>Boolean(selected.value&&session.value&&canAccess(session.value,'tasks','EDIT')&&(manager.value||selected.value.assigneeMembershipId===session.value.membershipId)));
const reopenReady=computed(()=>Boolean(reopenReason.value.trim())&&!busy.value);
const selectableAssignees=computed(()=>manager.value?assignees.value:assignees.value.filter(item=>item.id===session.value?.membershipId));
const assigneeLabel=computed(()=>{const person=selectableAssignees.value[form.value.assigneeIndex];return person?(person.user.nickname||'家庭成员'):`保持原负责人：${personName(selected.value?.assignee||null)}`;});
const assigneePickerLabels=computed(()=>[...(editing.value?[`保持原负责人：${personName(selected.value?.assignee||null)}`]:[]),...selectableAssignees.value.map(person=>person.user.nickname||'家庭成员')]);
const assigneePickerIndex=computed(()=>form.value.assigneeIndex+(editing.value?1:0));
function chooseAssignee(event:{detail:{value:string|number}}){
  if(busy.value||!canAccess(session.value,'tasks','EDIT')||(editing.value&&!editable.value))return;
  const index=Number(event.detail.value)-(editing.value?1:0);
  if(Number.isInteger(index)&&index>=(editing.value?-1:0)&&index<selectableAssignees.value.length)form.value.assigneeIndex=index;
}

function message(error:unknown){return error instanceof Error?error.message:'操作失败';}
function sameIdentity(a?:HouseholdContext,b?:HouseholdContext){return Boolean(a&&b&&a.householdId===b.householdId&&a.membershipId===b.membershipId);}
function current(token:number,owner?:HouseholdContext){return token===viewEpoch&&sameIdentity(owner,session.value);}
function failure(error:unknown,token:number,owner?:HouseholdContext,targetId?:string){
  if(!current(token,owner))return;
  const status=error&&typeof error==='object'&&'statusCode'in error?error.statusCode:undefined;
  if(status===401||status===403)clearPage();
  else if(status===404&&targetId){tasks.value=tasks.value.filter(row=>row.id!==targetId);closeTask();}
  uni.showToast({title:message(error),icon:'none'});
}
function dateOnly(value:string|null){return value?shanghaiDate(value):'';}
function clockTime(value:string){return new Date(Date.parse(value)+8*60*60*1000).toISOString().slice(11,16);}
function personName(person:TaskPerson|null){return person?.user.nickname||'未分配';}
function statusTime(value:string){const date=dateOnly(value);return `${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日 ${clockTime(value)}`;}
function replaceTask(task:Task){const index=tasks.value.findIndex(row=>row.id===task.id);if(index>=0)tasks.value[index]=task;else tasks.value.unshift(task);selected.value=task;}
async function load(){
  const oldHousehold=session.value?.householdId,oldId=selected.value?.id;
  clearPage();const epoch=viewEpoch;busy.value=true;
  try{
    const context=await refreshAccess();if(epoch!==viewEpoch||!canAccess(context,'tasks'))return;
    const [rows,people]=await Promise.all([listTasks(),canAccess(context,'tasks','EDIT')?listTaskAssignees():Promise.resolve([])]);
    if(epoch!==viewEpoch)return;
    const id=initialTaskId.value||(oldHousehold===context.householdId?oldId:undefined);
    const detail=id?await getTask(id):undefined;if(epoch!==viewEpoch)return;
    session.value=context;tasks.value=rows;assignees.value=people;selected.value=detail;initialTaskId.value='';
    if(!detail&&initialDate.value&&canAccess(context,'tasks','EDIT')){busy.value=false;newTask();initialDate.value='';}
  }catch(error){if(epoch===viewEpoch)uni.showToast({title:message(error),icon:'none'});}finally{if(epoch===viewEpoch)busy.value=false;}
}
async function openTask(task:Task){if(!canAccess(session.value,'tasks'))return;closeTask();const epoch=viewEpoch,owner=session.value;busy.value=true;try{const detail=await getTask(task.id);if(current(epoch,owner))selected.value=detail;}catch(error){failure(error,epoch,owner,task.id);}finally{if(current(epoch,owner))busy.value=false;}}
function closeTask(){viewEpoch++;selected.value=undefined;showingForm.value=false;editing.value=false;busy.value=false;comment.value='';reopenReason.value='';form.value={typeIndex:0,title:'',description:'',assigneeIndex:0,dueDate:'',reminderDate:'',priorityIndex:1};}
function clearPage(){closeTask();session.value=undefined;tasks.value=[];assignees.value=[];}
function newTask(){if(busy.value||!canAccess(session.value,'tasks','EDIT'))return;closeTask();const own=Math.max(0,selectableAssignees.value.findIndex(person=>person.id===session.value?.membershipId));form.value={typeIndex:0,title:'',description:'',assigneeIndex:own,dueDate:initialDate.value,reminderDate:'',priorityIndex:1};showingForm.value=true;}
function editTask(){const task=selected.value;if(!task||busy.value||!editable.value)return;editing.value=true;form.value={typeIndex:Math.max(0,types.findIndex(item=>item.value===task.type)),title:task.title,description:task.description||'',assigneeIndex:-1,dueDate:dateOnly(task.dueAt),reminderDate:dateOnly(task.reminderAt),priorityIndex:Math.max(0,priorities.findIndex(item=>item.value===task.priority))};showingForm.value=true;}
function clearDate(field:'dueDate'|'reminderDate'){
  if(busy.value||!showingForm.value||!canAccess(session.value,'tasks','EDIT')||(editing.value&&!editable.value))return;
  form.value[field]='';
}
function savedDate(date:string,previous:string|null|undefined,time:string){
  if(!date)return undefined;
  // An unrelated text edit must not reset a time originally supplied by another client.
  return previous&&dateOnly(previous)===date?previous:`${date}T${time}+08:00`;
}
async function save(){
  if(busy.value||!showingForm.value||!canAccess(session.value,'tasks','EDIT')||(editing.value&&!editable.value))return;
  const title=form.value.title.trim(),description=form.value.description.trim();
  if(!title){uni.showToast({title:'请填写待办标题',icon:'none'});return;}
  if(title.length>120||description.length>2000){uni.showToast({title:title.length>120?'待办标题最多120字':'待办说明最多2000字',icon:'none'});return;}
  const epoch=viewEpoch,owner=session.value,task=editing.value?selected.value:undefined,person=selectableAssignees.value[form.value.assigneeIndex];
  const input={type:types[form.value.typeIndex].value,title,description:task?description:description||undefined,dueAt:savedDate(form.value.dueDate,task?.dueAt,'18:00:00'),priority:priorities[form.value.priorityIndex].value,reminderAt:savedDate(form.value.reminderDate,task?.reminderAt,'09:00:00')};
  const reassignment=task&&manager.value&&person&&person.id!==task.assigneeMembershipId?{assigneeMembershipId:person.id}:{};
  busy.value=true;
  try{
    const saved=task?await updateTask(task,{...input,dueAt:input.dueAt??null,reminderAt:input.reminderAt??null,...reassignment}):await createTask({...input,...(person?{assigneeMembershipId:person.id}:{})});
    if(!current(epoch,owner))return;
    replaceTask(saved);showingForm.value=false;uni.showToast({title:task?'待办已更新':'待办已创建',icon:'success'});
  }catch(error){failure(error,epoch,owner,task?.id);}finally{if(current(epoch,owner))busy.value=false;}
}
async function changeStatus(status:Task['status'],reason?:string){const task=selected.value;if(!task||busy.value||!statusEditable.value)return;const normalizedReason=reason?.trim();if(status==='PENDING'&&['COMPLETED','CANCELLED'].includes(task.status)&&!normalizedReason){uni.showToast({title:'请填写重新打开原因',icon:'none'});return;}const epoch=viewEpoch,owner=session.value;busy.value=true;try{const saved=await updateTaskStatus(task,status,normalizedReason);if(!current(epoch,owner))return;replaceTask(saved);reopenReason.value='';}catch(error){failure(error,epoch,owner,task.id);}finally{if(current(epoch,owner))busy.value=false;}}
function cancelTask(){const task=selected.value;if(!task||busy.value||!statusEditable.value)return;const epoch=viewEpoch,owner=session.value,id=task.id,version=task.version;uni.showModal({title:'取消待办',content:'取消后不会再出现在日历中，处理记录仍保留。',success:result=>{if(result.confirm&&current(epoch,owner)&&selected.value?.id===id&&selected.value.version===version)changeStatus('CANCELLED');}});}
async function saveComment(){if(!selected.value||!comment.value.trim()||busy.value||!canAccess(session.value,'tasks','EDIT'))return;const epoch=viewEpoch,owner=session.value,targetId=selected.value.id;busy.value=true;try{const saved=await addTaskComment(targetId,comment.value.trim());if(!current(epoch,owner))return;replaceTask(saved);comment.value='';}catch(error){failure(error,epoch,owner,targetId);}finally{if(current(epoch,owner))busy.value=false;}}
onLoad(query=>{initialTaskId.value=String(query?.id||'');initialDate.value=String(query?.date||'');});
onShow(load);
onHide(clearPage);
onUnload(clearPage);
</script>

<template>
  <view class="page">
    <view class="heading"><text class="eyebrow">我的家</text><text class="title">家庭待办</text><text class="subtitle">把需要处理的小事交给明确的人，不做家务排名。</text></view>
    <view v-if="!selected">
      <view class="tabs"><text :class="{chosen:filter==='OPEN'}" @tap="filter='OPEN'">待处理</text><text :class="{chosen:filter==='DONE'}" @tap="filter='DONE'">已结束</text></view>
      <view v-if="!shownTasks.length" class="empty">{{canAccess(session,'tasks')?'这里暂时没有待办':'尚未获得家庭待办权限'}}</view>
      <view v-for="task in shownTasks" :key="task.id" class="task" @tap="openTask(task)"><text class="priority" :class="task.priority.toLowerCase()">{{task.priority==='HIGH'?'!':task.type==='REQUEST'?'📮':'✓'}}</text><view class="grow"><text class="task-title">{{task.title}}</text><text class="meta">{{statusLabels[task.status]}} · {{personName(task.assignee)}}{{task.dueAt?` · ${dateOnly(task.dueAt)}`:''}}</text></view><text class="go">›</text></view>
      <view v-if="showingForm" class="form"><text class="form-title">{{editing?'编辑待办':'新建待办'}}</text><picker :range="types.map(item=>item.label)" @change="form.typeIndex=Number($event.detail.value)"><view class="input">{{types[form.typeIndex].label}} ›</view></picker><input v-model="form.title" class="input" maxlength="120" :disabled="busy" placeholder="例如：清洗空调"/><textarea v-model="form.description" class="textarea" maxlength="2000" :disabled="busy" placeholder="补充说明（可选）"/><picker v-if="selectableAssignees.length&&(!editing||manager)" :value="assigneePickerIndex" :disabled="busy" :range="assigneePickerLabels" @change="chooseAssignee"><view class="input">负责人：{{assigneeLabel}} ›</view></picker><picker :range="priorities.map(item=>item.label)" @change="form.priorityIndex=Number($event.detail.value)"><view class="input">优先级：{{priorities[form.priorityIndex].label}} ›</view></picker><view class="dates"><picker mode="date" @change="form.dueDate=$event.detail.value"><view class="input">{{form.dueDate||'截止日期'}}</view></picker><picker mode="date" @change="form.reminderDate=$event.detail.value"><view class="input">{{form.reminderDate||'提醒日期（可选）'}}</view></picker></view>
        <view class="date-clears"><text v-if="form.dueDate" class="clear" :class="{disabled:busy}" @tap="clearDate('dueDate')">清除截止日期</text><text v-if="form.reminderDate" class="clear" :class="{disabled:busy}" @tap="clearDate('reminderDate')">清除提醒日期</text></view>
        <view class="save" :class="{disabled:busy}" @tap="save">{{busy?'保存中…':'保存待办'}}</view><view class="cancel" @tap="showingForm=false">取消</view></view>
      <view v-else-if="canAccess(session,'tasks','EDIT')" class="add" @tap="newTask">＋ 新建家庭待办</view>
    </view>

    <view v-else>
      <view class="back" @tap="closeTask">‹ 返回待办</view><view class="detail"><view class="detail-top"><text class="kind">{{selected.type==='REQUEST'?'家庭请求':'家庭待办'}}</text><text class="state">{{statusLabels[selected.status]}}</text></view><text class="detail-title">{{selected.title}}</text><text v-if="selected.description" class="description">{{selected.description}}</text><view class="facts"><text>负责人：{{personName(selected.assignee)}}</text><text>优先级：{{priorities.find(item=>item.value===selected?.priority)?.label}}</text><text v-if="selected.dueAt">截止：{{dateOnly(selected.dueAt)}}</text><text v-if="selected.reminderAt">站内提醒：{{dateOnly(selected.reminderAt)}} {{clockTime(selected.reminderAt)}}（完成、取消或改派后自动失效）</text></view><text v-if="editable" class="edit" @tap="editTask">编辑内容</text></view>
      <view v-if="showingForm" class="form"><text class="form-title">编辑待办</text><picker :range="types.map(item=>item.label)" @change="form.typeIndex=Number($event.detail.value)"><view class="input">{{types[form.typeIndex].label}} ›</view></picker><input v-model="form.title" class="input" maxlength="120" :disabled="busy" placeholder="待办标题，例如：清洗客厅空调"/><textarea v-model="form.description" class="textarea" maxlength="2000" :disabled="busy" placeholder="补充说明（可选，最多2000字）"/><picker v-if="selectableAssignees.length&&manager" :value="assigneePickerIndex" :disabled="busy" :range="assigneePickerLabels" @change="chooseAssignee"><view class="input">负责人：{{assigneeLabel}} ›</view></picker><picker :range="priorities.map(item=>item.label)" @change="form.priorityIndex=Number($event.detail.value)"><view class="input">优先级：{{priorities[form.priorityIndex].label}} ›</view></picker><view class="dates"><picker mode="date" @change="form.dueDate=$event.detail.value"><view class="input">{{form.dueDate||'截止日期'}}</view></picker><picker mode="date" @change="form.reminderDate=$event.detail.value"><view class="input">{{form.reminderDate||'提醒日期（可选）'}}</view></picker></view>
        <view class="date-clears"><text v-if="form.dueDate" class="clear" :class="{disabled:busy}" @tap="clearDate('dueDate')">清除截止日期</text><text v-if="form.reminderDate" class="clear" :class="{disabled:busy}" @tap="clearDate('reminderDate')">清除提醒日期</text></view>
        <view class="save" :class="{disabled:busy}" @tap="save">{{busy?'保存中…':'保存修改'}}</view><view class="cancel" @tap="showingForm=false">取消</view></view>
      <view v-if="statusEditable&&!showingForm" class="actions"><view v-if="selected.status==='PENDING'" @tap="changeStatus('IN_PROGRESS')">开始处理</view><view v-if="['PENDING','IN_PROGRESS'].includes(selected.status)" @tap="changeStatus('COMPLETED')">标记完成</view><view v-if="['PENDING','IN_PROGRESS'].includes(selected.status)" class="danger" @tap="cancelTask">取消待办</view></view>
      <view v-if="statusEditable&&['COMPLETED','CANCELLED'].includes(selected.status)" class="reopen"><input v-model="reopenReason" class="input" maxlength="500" placeholder="填写重新打开原因"/><view class="save" :class="{disabled:!reopenReady}" @tap="changeStatus('PENDING',reopenReason)">重新打开</view></view>
      <view class="history"><text class="form-title">处理记录</text><view v-for="item in selected.history||[]" :key="item.id" class="history-row"><text class="dot"></text><view><text class="history-main">{{item.actor.user.nickname||'家庭成员'}}{{item.toStatus?`：${statusLabels[item.toStatus]}`:''}}</text><text v-if="item.comment" class="history-comment">{{item.comment}}</text><text class="history-time">{{statusTime(item.createdAt)}}</text></view></view><view v-if="canAccess(session,'tasks','EDIT')" class="comment"><input v-model="comment" class="input" maxlength="1000" :disabled="busy" placeholder="添加处理记录"/><view class="save small" @tap="saveComment">记录</view></view></view>
    </view>
  </view>
</template>

<style scoped>
.date-clears{display:flex;flex-wrap:wrap;gap:24rpx}
.page{min-height:100vh;padding:34rpx 28rpx 70rpx;background:#eef5f3}.eyebrow,.title,.subtitle,.task-title,.meta,.form-title,.detail-title,.description,.facts text,.history-main,.history-comment,.history-time{display:block}.eyebrow{color:#719a96;font-size:21rpx;letter-spacing:3rpx}.title{margin-top:8rpx;color:#405d5a;font-size:43rpx;font-weight:700}.subtitle{margin-top:10rpx;color:#899794;font-size:22rpx}.tabs{display:flex;margin-top:28rpx;padding:6rpx;border-radius:18rpx;background:#dbeae7}.tabs text{flex:1;padding:15rpx;text-align:center;color:#6e8985;font-size:23rpx}.tabs .chosen{border-radius:14rpx;background:#fff;color:#426e69;font-weight:600}.empty{padding:70rpx 0;text-align:center;color:#8d9996;font-size:24rpx}.task{display:flex;align-items:center;gap:14rpx;margin-top:14rpx;padding:22rpx;border-radius:22rpx;background:#fffdf8}.priority{display:flex;align-items:center;justify-content:center;width:48rpx;height:48rpx;border-radius:15rpx;background:#dcebe7;color:#57827c}.priority.high{background:#ffe0d5;color:#b2604d}.grow{min-width:0;flex:1}.task-title{color:#475a57;font-size:27rpx}.meta{margin-top:6rpx;color:#929d9a;font-size:19rpx}.go{font-size:38rpx;color:#b4c0bd}.add,.save{margin-top:22rpx;padding:21rpx;border-radius:20rpx;background:#67a49c;color:#fff;text-align:center;font-size:25rpx}.form,.detail,.history,.reopen{margin-top:20rpx;padding:22rpx;border-radius:24rpx;background:#fffdf8}.form-title{color:#4a625e;font-size:27rpx;font-weight:650}.input,.textarea{box-sizing:border-box;width:100%;margin-top:12rpx;padding:18rpx;border:2rpx solid #e2ece9;border-radius:15rpx;background:#fff;color:#52635f;font-size:23rpx}.textarea{height:130rpx}.dates{display:grid;grid-template-columns:1fr 1fr;gap:10rpx}.clear,.edit{display:inline-block;margin-top:14rpx;color:#5c8b84;font-size:21rpx}.cancel{padding:18rpx;text-align:center;color:#8d9895;font-size:22rpx}.disabled{opacity:.55}.back{margin:24rpx 0 12rpx;color:#5e8b85;font-size:23rpx}.detail-top{display:flex;justify-content:space-between}.kind,.state{padding:7rpx 11rpx;border-radius:10rpx;background:#e1efec;color:#60817c;font-size:18rpx}.detail-title{margin-top:18rpx;color:#405652;font-size:34rpx;font-weight:700}.description{margin-top:13rpx;color:#6e7976;font-size:23rpx;line-height:1.65}.facts{margin-top:16rpx;padding-top:13rpx;border-top:1rpx solid #edf1ef}.facts text{margin-top:7rpx;color:#89938f;font-size:20rpx}.actions{display:flex;gap:10rpx;margin-top:16rpx}.actions view{flex:1;padding:17rpx;border-radius:17rpx;background:#d8ebe6;color:#4d7c75;text-align:center;font-size:21rpx}.actions .danger{background:#f7e4dc;color:#a76a58}.history-row{display:flex;gap:13rpx;padding:15rpx 0;border-bottom:1rpx solid #eef1ef}.dot{width:14rpx;height:14rpx;margin-top:8rpx;border-radius:50%;background:#77a9a1}.history-main{color:#52645f;font-size:22rpx}.history-comment{margin-top:5rpx;color:#747e7a;font-size:20rpx}.history-time{margin-top:5rpx;color:#a1aaa7;font-size:17rpx}.comment{display:flex;align-items:flex-end;gap:10rpx}.comment .input{flex:1}.save.small{width:105rpx;padding:17rpx;font-size:21rpx}
</style>
