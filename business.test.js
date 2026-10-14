import test from 'node:test';
import assert from 'node:assert/strict';
import {seed,dispatch,actors,canDoc,evidence} from './business.js';
const c=actors.client,l=actors.lawyer,a=actors.operator;
function contracted(){const db=seed();const o=dispatch(db,c,'accept-quote',{id:'Q1001'});dispatch(db,c,'start-sign',{id:o.contract});dispatch(db,l,'confirm-doc',{id:o.contract});dispatch(db,c,'confirm-doc',{id:o.contract});return {db,id:o.id};}

test('报价、顺序会签、付款、交付与收悉形成完整订单闭环',()=>{
  const {db,id}=contracted();assert.equal(db.orders.find(o=>o.id===id).status,'待支付');
  dispatch(db,c,'pay',{id,result:'success'});const doc=dispatch(db,l,'create-doc',{orderId:id,title:'交付意见',body:'已经核对的交付内容',type:'交付物',deadline:'2027-01-01'});
  dispatch(db,l,'deliver',{id,docId:doc.id});assert.equal(db.orders.find(o=>o.id===id).status,'待确认');
  dispatch(db,c,'receive',{id});assert.equal(db.orders.find(o=>o.id===id).status,'已完成');assert.equal(db.orders.find(o=>o.id===id).settlement,'待结算');
});
test('重复接受与付款不重复创建订单、不重复记账；付款失败保留重试路径',()=>{
  const {db,id}=contracted();const count=db.orders.length;assert.equal(dispatch(db,c,'accept-quote',{id:'Q1001'}).id,id);assert.equal(db.orders.length,count);
  dispatch(db,c,'pay',{id,result:'fail'});assert.equal(db.orders.find(o=>o.id===id).status,'待支付');dispatch(db,c,'pay',{id,result:'success'});const ledgerCount=db.payments.length;dispatch(db,c,'pay',{id,result:'success'});assert.equal(db.payments.length,ledgerCount);
});
test('会签顺序和锁定版本禁止越级确认或直接修改',()=>{
  const db=seed();const o=dispatch(db,c,'accept-quote',{id:'Q1001'});dispatch(db,c,'start-sign',{id:o.contract});assert.throws(()=>dispatch(db,c,'confirm-doc',{id:o.contract}),/尚未轮到/);
  dispatch(db,l,'confirm-doc',{id:o.contract});dispatch(db,c,'confirm-doc',{id:o.contract});assert.throws(()=>dispatch(db,c,'save-version',{id:o.contract,body:'其他文字'}),/锁定/);
});
test('恢复生成独立新版本并保留历史；无原因退回不污染状态',()=>{
  const db=seed();dispatch(db,l,'save-version',{id:'D1001',body:'修改后的第二版'});dispatch(db,l,'restore-version',{id:'D1001',number:1});const d=db.docs.find(d=>d.id==='D1001');assert.equal(d.versions.length,3);assert.equal(d.current,3);assert.equal(d.versions[2].body,d.versions[0].body);
  dispatch(db,l,'start-sign',{id:d.id});const before=JSON.stringify(db);assert.throws(()=>dispatch(db,l,'return-doc',{id:d.id,reason:''}),/原因/);assert.equal(JSON.stringify(db),before);
});
test('撤销访问后律师无法获取正文；运营存证导出只包含必要元数据',()=>{
  const db=seed();dispatch(db,c,'access-doc',{id:'D1001',user:'L1',grant:false});const d=db.docs.find(d=>d.id==='D1001');assert.equal(canDoc(db,l,d),false);assert.equal(canDoc(db,a,d),false);assert.throws(()=>dispatch(db,l,'comment',{id:d.id,text:'访问尝试'}),/未获得/);
  const data=evidence(db,a,'O1001');assert.ok(data.documents.every(d=>d.versions.every(v=>!('body' in v))));assert.equal('messages' in data.order,false);
});
test('摘要转需求需要明确授权且保持来源，未认证律师不能报价',()=>{
  const db=seed();const s=dispatch(db,c,'session',{domain:'刑事',facts:'亲属已被采取强制措施，需要整理材料',region:'北京',time:'2026-10-01',goal:'联系律师',identity:'亲属',measure:'已采取'});assert.equal(s.risk,true);
  const p={title:'律师服务需求',sourceSession:s.id,facts:s.facts,region:'北京',deadline:'2027-01-01',deliverables:'咨询意见',budget:1000};assert.throws(()=>dispatch(db,c,'request',p),/授权/);const r=dispatch(db,c,'request',{...p,consent:true});assert.equal(r.sourceSession,s.id);
  dispatch(db,a,'review-lawyer',{id:'L1',decision:'freeze',reason:'资质核对中'});assert.throws(()=>dispatch(db,l,'quote',{requestId:r.id,price:1000,days:1,scope:'咨询',deliverables:'意见',validUntil:'2027-01-01'}),/资质/);
});
test('争议冻结结算，售后处理需要运营角色且重复处理被拒绝',()=>{
  const db=seed();const issue=dispatch(db,c,'dispute',{id:'O1001',reason:'交付范围需要重新确认'});assert.equal(db.orders[0].settlement,'暂停结算');assert.throws(()=>dispatch(db,c,'resolve-case',{id:issue.id,decision:'resume',result:'恢复履约'}),/运营/);
  dispatch(db,a,'resolve-case',{id:issue.id,decision:'resume',result:'双方已补充服务范围，恢复履约'});assert.equal(db.orders[0].status,'服务中');assert.throws(()=>dispatch(db,a,'resolve-case',{id:issue.id,decision:'resume',result:'重复处理'}),/已处理/);
});
test('退款金额不得超过已付金额，完整退款关闭订单',()=>{
  const db=seed();assert.throws(()=>dispatch(db,c,'refund',{id:'O1001',reason:'需要退款',amount:1801}),/超过/);const issue=dispatch(db,c,'refund',{id:'O1001',reason:'双方同意取消服务',amount:1800});dispatch(db,a,'resolve-case',{id:issue.id,decision:'approve',result:'审核通过，模拟全额退款'});assert.equal(db.orders[0].status,'已关闭');assert.equal(db.orders[0].paymentStatus,'已退款');
});
