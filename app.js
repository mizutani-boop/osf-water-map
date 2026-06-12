// OSF Water Management App v4
const GAS='https://script.google.com/macros/s/AKfycbwcV7O5APU32iUPODpt6UOl_M-7_FavWZjGKaFfwaHYLLj4QU0w07UjZv7dt0s-6zqy/exec';
const BM={"AR": "有富", "NK": "中村", "SS": "篠坂", "KM": "北村", "NI": "西今在家", "SB": "菖蒲", "FM": "古海", "MD": "本高", "BB": "馬場", "HT": "服部", "KR": "高路", "TN": "徳尾", "YG": "山が鼻", "AJ": "味野"};
const S_OPTS=['入水','ちょい入れ','止水','中干し','水尻外し','除草剤投入','確認のみ'];
const S_COL={入水:'#3498db',ちょい入れ:'#5dade2',止水:'#e67e22',中干し:'#e74c3c',水尻外し:'#a04000',除草剤投入:'#8e44ad',確認のみ:'#95a5a6'};

const CROP_GROUPS=[
  {key:'ZR1',color:'#1abc9c',label:'ZR1'},
  {key:'きぬむすめ',color:'#9b59b6',label:'きぬむすめ'},
  {key:'たちはるか',color:'#3498db',label:'たちはるか'},
  {key:'にじのきらめき',color:'#e67e22',label:'にじのきらめき'},
  {key:'みのりゆたか',color:'#f1c40f',label:'みのりゆたか'},
  {key:'こしひかり',color:'#e74c3c',label:'こしひかり'},
  {key:'その他',color:'#95a5a6',label:'その他'},
];
function getCropGroup(crop){
  if(!crop)return CROP_GROUPS[6];
  for(let i=0;i<CROP_GROUPS.length-1;i++){if(crop.includes(CROP_GROUPS[i].key))return CROP_GROUPS[i];}
  return CROP_GROUPS[6];
}
const LEGS={
  date:[{c:'#2ecc71',l:'2日以内'},{c:'#f39c12',l:'3日'},{c:'#e74c3c',l:'4日以上'},{c:'#8e44ad',l:'除草剤投入中'},{c:'#95a5a6',l:'未記録'}],
  status:[{c:'#3498db',l:'入水'},{c:'#5dade2',l:'ちょい入れ'},{c:'#e67e22',l:'止水'},{c:'#e74c3c',l:'中干し'},{c:'#a04000',l:'水尻外し'},{c:'#8e44ad',l:'除草剤投入'},{c:'#95a5a6',l:'未記録'}],
  crop:CROP_GROUPS.map(g=>({c:g.color,l:g.label})),
};

let GJ=null;
let records={},allHist=[],kusaData={},taskData={};
let mode='date',selBlocks=new Set(),selCrops=new Set(),alertFilter=false;
let curUser=localStorage.getItem('osf_user')||'';
let selField=null,selStatus=null,histOpen=false,editMode=false,editOrigTime=null;
let multiMode=false,multiSelected=new Set();
let layers={},markers={};
let map;

async function init(){
  try{
    const r=await fetch('fields.geojson');
    GJ=await r.json();
  }catch(e){
    document.getElementById('loading').textContent='圃場データの読み込みに失敗しました';
    return;
  }
  document.getElementById('loading').style.display='none';
  initMap();
  initFilters();
  updateLegend();
  renderMap();
  loadRecords();
  setInterval(loadRecords,60000);
}

function initMap(){
  map=L.map('map',{zoomControl:false}).setView([35.465,134.19],13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{attribution:'© OpenStreetMap © CARTO',maxZoom:19,crossOrigin:true}).addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map);
  const locCtrl=L.control({position:'bottomright'});
  locCtrl.onAdd=function(){
    const d=L.DomUtil.create('div','leaflet-bar leaflet-control');
    d.innerHTML='<a href="#" style="font-size:16px;display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:#fff">📍</a>';
    d.onclick=e=>{e.preventDefault();map.locate({setView:true,maxZoom:17});};
    return d;
  };
  locCtrl.addTo(map);
  let locMk=null;
  map.on('locationfound',e=>{
    if(locMk)map.removeLayer(locMk);
    locMk=L.circleMarker(e.latlng,{radius:10,color:'#fff',weight:2,fillColor:'#3498db',fillOpacity:0.9}).addTo(map);
  });
  map.on('locationerror',()=>alert('現在地を取得できませんでした'));
}

function initFilters(){
  const blockCodes=[...new Set(GJ.features.map(f=>(f.properties.field_id||'').replace(/-.*/, '')).filter(c=>c&&BM[c]))].sort();
  blockCodes.forEach(c=>{
    const d=document.createElement('div');d.className='fopt';d.dataset.c=c;
    d.innerHTML='<div class="fchk" id="bfc-'+c+'"></div>'+BM[c]+'('+c+')';
    d.addEventListener('click',()=>toggleBlock(c));
    document.getElementById('block-options').appendChild(d);
  });
  CROP_GROUPS.forEach(g=>{
    const cnt=GJ.features.filter(f=>getCropGroup(f.properties.crop||'').key===g.key).length;
    if(cnt===0)return;
    const d=document.createElement('div');d.className='fopt';
    d.innerHTML='<div class="fchk" id="cgfc-'+g.key+'"></div><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+g.color+';margin-right:4px;"></span>'+g.label+' ('+cnt+'枚)';
    d.addEventListener('click',()=>toggleCropGroup(g.key));
    document.getElementById('crop-options').appendChild(d);
  });
}

function toggleDropdown(type){
  const ids={block:'block-menu',crop:'crop-menu'};
  const menuId=ids[type];
  Object.values(ids).forEach(id=>{if(id!==menuId)document.getElementById(id).classList.remove('open');});
  document.getElementById(menuId).classList.toggle('open');
}
document.addEventListener('click',e=>{
  if(!document.getElementById('filter-wrap').contains(e.target))document.getElementById('block-menu').classList.remove('open');
  if(!document.getElementById('crop-wrap').contains(e.target))document.getElementById('crop-menu').classList.remove('open');
});

function toggleBlock(c){
  selBlocks.has(c)?selBlocks.delete(c):selBlocks.add(c);
  const el=document.getElementById('bfc-'+c);if(el)el.classList.toggle('on',selBlocks.has(c));
  const btn=document.getElementById('block-toggle-btn');
  btn.textContent=selBlocks.size===0?'🗂 ブロック ▾':[...selBlocks].map(x=>BM[x]).join('・')+' ▾';
  btn.classList.toggle('filtered',selBlocks.size>0);
  renderMap();
  if(selBlocks.size>0){
    const feats=GJ.features.filter(f=>selBlocks.has((f.properties.field_id||'').replace(/-.*/, '')));
    if(feats.length>0){const g=L.geoJSON({type:'FeatureCollection',features:feats});map.fitBounds(g.getBounds().pad(0.1));}
  }
}
function toggleCropGroup(key){
  selCrops.has(key)?selCrops.delete(key):selCrops.add(key);
  const el=document.getElementById('cgfc-'+key);if(el)el.classList.toggle('on',selCrops.has(key));
  const btn=document.getElementById('crop-toggle-btn');
  btn.textContent=selCrops.size===0?'🌾 品種 ▾':[...selCrops].join('・')+' ▾';
  btn.classList.toggle('filtered',selCrops.size>0);
  renderMap();
  if(selCrops.size>0){
    const feats=GJ.features.filter(f=>selCrops.has(getCropGroup(f.properties.crop||'').key));
    if(feats.length>0){const g=L.geoJSON({type:'FeatureCollection',features:feats});map.fitBounds(g.getBounds().pad(0.1));}
  }
}
function resetFilter(type){
  if(type==='block'){
    selBlocks.clear();
    document.querySelectorAll('[id^="bfc-"]').forEach(el=>el.classList.remove('on'));
    document.getElementById('block-toggle-btn').textContent='🗂 ブロック ▾';
    document.getElementById('block-toggle-btn').classList.remove('filtered');
    document.getElementById('block-menu').classList.remove('open');
  }else{
    selCrops.clear();
    document.querySelectorAll('[id^="cgfc-"]').forEach(el=>el.classList.remove('on'));
    document.getElementById('crop-toggle-btn').textContent='🌾 品種 ▾';
    document.getElementById('crop-toggle-btn').classList.remove('filtered');
    document.getElementById('crop-menu').classList.remove('open');
  }
  renderMap();
}
function toggleAlertFilter(){
  alertFilter=!alertFilter;
  document.getElementById('alert-filter-btn').classList.toggle('active',alertFilter);
  renderMap();
}

function toggleMultiMode(){multiMode=!multiMode;document.getElementById('multi-btn').classList.toggle('active',multiMode);if(!multiMode)clearMultiSelect();}
function clearMultiSelect(){
  multiSelected.clear();multiMode=false;
  document.getElementById('multi-btn').classList.remove('active');
  document.getElementById('multi-bar').classList.remove('show');
  document.getElementById('multi-bar').style.display='';
  renderMap();
}
function toggleFieldSelect(nm){
  multiSelected.has(nm)?multiSelected.delete(nm):multiSelected.add(nm);
  const cnt=multiSelected.size;
  document.getElementById('multi-count').textContent=cnt+'枚選択中';
  document.getElementById('multi-bar').classList.toggle('show',cnt>0);
  updateConfirmOnlyBtn();
  const feat=GJ.features.find(f=>f.properties.name===nm);
  const layer=layers[nm];
  if(layer)layer.setStyle(getLayerStyle(nm,feat));
}
function updateConfirmOnlyBtn(){
  const btn=document.getElementById('multi-confirm-btn');
  btn.disabled=[...multiSelected].some(nm=>!records[nm]);
}
async function bulkConfirmOnly(){
  if([...multiSelected].some(nm=>!records[nm]))return;
  if(!confirm(multiSelected.size+'枚を確認済みにします。よろしいですか？'))return;
  if(!curUser){const n=prompt('担当者名を入力してください');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
  const time=new Date().toISOString();const targets=[...multiSelected];
  targets.forEach(nm=>{const prev=records[nm];records[nm]={...prev,checkedOnly:true,person:curUser,time};});
  clearMultiSelect();renderMap();
  try{await postToGAS({action:'bulk',records:targets.map(nm=>({name:nm,status:records[nm].status,person:curUser,memo:'',time}))});}
  catch(e){alert('保存に失敗しました');}
}

function openMultiPanel(){
  if(multiSelected.size===0)return;
  selField=null;selStatus=null;exitEditMode();
  const targets=[...multiSelected];
  const hasKusa=targets.some(nm=>kusaData[nm]&&kusaData[nm].status==='要草刈り');
  const hasTask=targets.some(nm=>taskData[nm]&&taskData[nm].status==='未完了');
  document.getElementById('pt').textContent=multiSelected.size+'枚の一括記録';
  document.getElementById('pm').textContent=targets.slice(0,3).join('、')+(targets.length>3?' 他'+(targets.length-3)+'枚':'');
  document.getElementById('pl').textContent='';document.getElementById('pl').style.cssText='';
  document.getElementById('htimer').style.display='none';
  document.getElementById('multi-banner').style.display='block';
  document.getElementById('multi-banner').textContent='☑ '+multiSelected.size+'枚に一括記録します';
  document.getElementById('savebtn').style.display='block';
  document.getElementById('edit-savebtn').style.display='none';
  document.getElementById('cancel-edit-btn').style.display='none';
  document.getElementById('kusa-section').style.display='none';
  document.getElementById('task-section').style.display='none';
  const bulkExtra=document.getElementById('bulk-extra');
  bulkExtra.innerHTML='';
  if(hasKusa){
    const btn=document.createElement('button');
    btn.className='sub-btn';
    btn.style.cssText='width:100%;padding:9px;background:#27ae60;color:#fff;border-color:#27ae60;font-weight:700;margin-bottom:6px;';
    btn.textContent='✅ 草刈り完了（選択圃場すべて）';
    btn.addEventListener('click',async()=>{
      const cnt=targets.filter(nm=>kusaData[nm]&&kusaData[nm].status==='要草刈り').length;
      if(!confirm(cnt+'枚の草刈りを完了にします'))return;
      for(const nm of targets){
        if(kusaData[nm]&&kusaData[nm].status==='要草刈り'){
          kusaData[nm]={status:'草刈り済み',person:curUser,time:new Date().toISOString()};
          await postToGAS({action:'kusa',name:nm,status:'草刈り済み',person:curUser}).catch(()=>{});
        }
      }
      closePanel();clearMultiSelect();renderMap();
    });
    bulkExtra.appendChild(btn);
  }
  if(hasTask){
    const btn=document.createElement('button');
    btn.className='sub-btn';
    btn.style.cssText='width:100%;padding:9px;background:#e67e22;color:#fff;border-color:#e67e22;font-weight:700;margin-bottom:6px;';
    btn.textContent='✅ タスク対応済み（選択圃場すべて）';
    btn.addEventListener('click',async()=>{
      const cnt=targets.filter(nm=>taskData[nm]&&taskData[nm].status==='未完了').length;
      if(!confirm(cnt+'件のタスクを完了にします'))return;
      for(const nm of targets){
        if(taskData[nm]&&taskData[nm].status==='未完了'){
          const prev=taskData[nm];
          taskData[nm]={...prev,status:'完了',person:curUser,time:new Date().toISOString()};
          await postToGAS({action:'task',name:nm,status:'完了',content:prev.content||'',person:curUser}).catch(()=>{});
        }
      }
      closePanel();clearMultiSelect();renderMap();
    });
    bulkExtra.appendChild(btn);
  }
  const sg=document.getElementById('sgrid');sg.innerHTML='';
  const hasUnrecorded=targets.some(nm=>!records[nm]);
  S_OPTS.forEach(s=>{
    const b=document.createElement('button');b.className='sbtn s'+s;b.textContent=s;
    if(s==='確認のみ'&&hasUnrecorded){b.disabled=true;}
    else{b.addEventListener('click',()=>{document.querySelectorAll('.sbtn').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');selStatus=s;});}
    sg.appendChild(b);
  });
  initTimeSelector(0,new Date().getHours());
  document.getElementById('memo').value='';
  document.getElementById('hist-section').style.display='none';
  document.getElementById('panel').classList.add('open');
  document.getElementById('overlay').classList.add('on');
  document.getElementById('multi-bar').style.display='none';
}

function herbActive(rec){if(!rec||rec.status!=='除草剤投入')return false;return(Date.now()-new Date(rec.time).getTime())/3600000<72;}
function herbRemain(rec){const h=72-(Date.now()-new Date(rec.time).getTime())/3600000;if(h<=0)return '間もなく終了';return Math.floor(h)+'時間'+Math.floor((h%1)*60)+'分';}

function fieldColor(nm){
  const r=records[nm];
  if(mode==='crop'){
    const feat=GJ.features.find(f=>f.properties.name===nm);
    return getCropGroup(feat?feat.properties.crop||'':'').color;
  }
  if(!r)return '#95a5a6';
  if(herbActive(r))return '#8e44ad';
  if(mode==='status')return S_COL[r.status]||'#95a5a6';
  const d=(Date.now()-new Date(r.time).getTime())/86400000;
  return d<2?'#2ecc71':d<4?'#f39c12':'#e74c3c';
}
function hasAlert(nm){
  return (kusaData[nm]&&kusaData[nm].status==='要草刈り')||(taskData[nm]&&taskData[nm].status==='未完了');
}
function getLayerStyle(nm,feat){
  const col=fieldColor(nm);
  const isSel=multiSelected.has(nm);
  const blockCode=(feat.properties.field_id||'').replace(/-.*/, '');
  const cropGroup=getCropGroup(feat.properties.crop||'').key;
  const blockHighlight=selBlocks.size>0&&selBlocks.has(blockCode);
  const cropHighlight=selCrops.size>0&&selCrops.has(cropGroup);
  const isHighlighted=blockHighlight||cropHighlight||isSel;
  let opacity=0.75;
  if(alertFilter){opacity=hasAlert(nm)?0.85:0.05;}
  else if(selBlocks.size>0||selCrops.size>0){opacity=isHighlighted?0.85:0.18;}
  if(isSel)opacity=0.85;
  let color='#fff',weight=0.8;
  if(isSel){color='#f39c12';weight=3;}
  else if(alertFilter&&hasAlert(nm)){color='#e74c3c';weight=2.5;}
  else if(isHighlighted&&!alertFilter){color='#e74c3c';weight=2.5;}
  return{color,weight,fillColor:col,fillOpacity:opacity};
}

function renderMap(){
  if(!GJ||!map)return;
  Object.values(layers).forEach(l=>map.removeLayer(l));layers={};
  Object.values(markers).forEach(m=>map.removeLayer(m));markers={};
  let a4=0,totalArea=0,filteredCount=0;
  GJ.features.forEach(feat=>{
    const nm=feat.properties.name;
    const col=fieldColor(nm);
    if(col==='#e74c3c'&&mode==='date')a4++;
    const style=getLayerStyle(nm,feat);
    const layer=L.geoJSON(feat,{style}).on('click',()=>multiMode?toggleFieldSelect(nm):openPanel(feat)).addTo(map);
    layers[nm]=layer;
    const blockCode=(feat.properties.field_id||'').replace(/-.*/, '');
    const inBlock=selBlocks.size===0||selBlocks.has(blockCode);
    const inCrop=selCrops.size===0||selCrops.has(getCropGroup(feat.properties.crop||'').key);
    if(inBlock&&inCrop){filteredCount++;totalArea+=(parseFloat(feat.properties.area_a)||0);}
    if(hasAlert(nm)){
      try{
        const bounds=L.geoJSON(feat).getBounds();
        if(!bounds.isValid())return;
        const center=bounds.getCenter();
        const icons=[];
        if(kusaData[nm]&&kusaData[nm].status==='要草刈り')icons.push('🌿');
        if(taskData[nm]&&taskData[nm].status==='未完了')icons.push('⚠️');
        const mk=L.marker(center,{icon:L.divIcon({className:'',html:'<div style="font-size:14px;line-height:1;text-shadow:0 0 3px #fff">'+icons.join('')+'</div>',iconSize:[28,16],iconAnchor:[14,8]})}).addTo(map);
        markers[nm]=mk;
      }catch(e){}
    }
  });
  const isFiltered=selBlocks.size>0||selCrops.size>0;
  document.getElementById('tc').textContent=isFiltered?filteredCount+'/'+GJ.features.length:GJ.features.length;
  document.getElementById('area-total').textContent=totalArea>0?'計 '+totalArea.toFixed(1)+'a':'';
  document.getElementById('ac').textContent=a4>0?a4+'枚 要確認':'';
  updateSummary();
}

function updateSummary(){
  if(!GJ)return;
  if(mode==='crop'){
    const cnt={};
    GJ.features.forEach(f=>{const g=getCropGroup(f.properties.crop||'');cnt[g.label]=(cnt[g.label]||0)+1;});
    document.getElementById('summary').innerHTML=CROP_GROUPS.filter(g=>cnt[g.label]>0).map(g=>
      '<div class="sum-item"><div class="sum-dot" style="background:'+g.color+'"></div>'+g.label+' <span class="sum-num">'+cnt[g.label]+'</span></div>'
    ).join('');
    return;
  }
  const cnt={};let unr=0;
  GJ.features.forEach(f=>{
    const r=records[f.properties.name];
    if(!r){unr++;return;}
    if(herbActive(r)){cnt['除草剤投入中']=(cnt['除草剤投入中']||0)+1;return;}
    cnt[r.status]=(cnt[r.status]||0)+1;
  });
  const d4=Object.values(records).filter(r=>!herbActive(r)&&(Date.now()-new Date(r.time).getTime())/86400000>=4).length;
  const items=[
    {l:'未記録',c:'#95a5a6',n:unr},{l:'入水',c:'#3498db',n:cnt['入水']||0},
    {l:'止水',c:'#e67e22',n:cnt['止水']||0},{l:'中干し',c:'#e74c3c',n:cnt['中干し']||0},
    {l:'除草剤',c:'#8e44ad',n:cnt['除草剤投入中']||0},{l:'水尻外し',c:'#a04000',n:cnt['水尻外し']||0},
    {l:'要確認(4日超)',c:'#e74c3c',n:d4},
  ].filter(i=>i.n>0);
  document.getElementById('summary').innerHTML=items.map(i=>
    '<div class="sum-item"><div class="sum-dot" style="background:'+i.c+'"></div>'+i.l+' <span class="sum-num">'+i.n+'</span></div>'
  ).join('');
}

function setMode(m){
  mode=m;
  ['btn-date','btn-status','btn-crop'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.classList.toggle('active',id==='btn-'+m);
  });
  updateLegend();renderMap();
}
function updateLegend(){
  document.getElementById('legend').innerHTML=LEGS[mode].map(l=>
    '<div class="leg-item"><div class="leg-dot" style="background:'+l.c+'"></div>'+l.l+'</div>'
  ).join('');
}
function initTimeSelector(d,h){
  document.getElementById('sel-date').value=String(d||0);
  const hs=document.getElementById('sel-hour');hs.innerHTML='';
  for(let i=0;i<24;i++){
    const o=document.createElement('option');o.value=i;o.textContent=i+'時';
    if(i===(h!==undefined?h:new Date().getHours()))o.selected=true;
    hs.appendChild(o);
  }
}
function getSelectedTime(){
  const d=new Date();
  d.setDate(d.getDate()-parseInt(document.getElementById('sel-date').value));
  d.setHours(parseInt(document.getElementById('sel-hour').value),0,0,0);
  return d.toISOString();
}
function setButtonLoading(btnId,loading,defaultText){
  const btn=document.getElementById(btnId);
  btn.disabled=loading;btn.textContent=loading?'送信中...':(defaultText||'記録する');
}

function setKusa(status,nm){
  if(!nm&&selField)nm=selField.properties.name.trim();
  if(!nm)return;
  if(!curUser){const n=prompt('担当者名を入力してください');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
  kusaData[nm]={status,person:curUser,time:new Date().toISOString()};
  updateKusaUI(nm);renderMap();
  postToGAS({action:'kusa',name:nm,status,person:curUser}).catch(()=>alert('畦草の保存に失敗しました'));
}
function updateKusaUI(nm){
  const body=document.getElementById('kusa-body');if(!body)return;
  const kusa=kusaData[nm];body.innerHTML='';
  if(!kusa||!kusa.status){
    const btn=document.createElement('button');btn.className='sub-btn';btn.textContent='🌿 要草刈りに設定';
    btn.style.cssText='width:100%;padding:8px;margin-top:2px;';
    btn.addEventListener('click',()=>setKusa('要草刈り',nm));body.appendChild(btn);
  }else if(kusa.status==='要草刈り'){
    const d=kusa.time?new Date(kusa.time):null;
    const info=document.createElement('div');info.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    const badge=document.createElement('span');badge.className='sub-status kusa-need';badge.textContent='🌿 要草刈り';
    const meta=document.createElement('span');meta.style.cssText='font-size:11px;color:#888;';
    meta.textContent=d?(d.toLocaleDateString('ja')+' '+kusa.person):'';
    info.appendChild(badge);info.appendChild(meta);body.appendChild(info);
    const btn=document.createElement('button');btn.className='sub-btn';btn.textContent='✅ 草刈り完了にする';
    btn.style.cssText='width:100%;padding:8px;background:#27ae60;color:#fff;border-color:#27ae60;font-weight:700;';
    btn.addEventListener('click',()=>setKusa('草刈り済み',nm));body.appendChild(btn);
  }else{
    const d=kusa.time?new Date(kusa.time):null;
    const info=document.createElement('div');info.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:8px;';
    const badge=document.createElement('span');badge.className='sub-status kusa-done';badge.textContent='✅ 草刈り済み';
    const meta=document.createElement('span');meta.style.cssText='font-size:11px;color:#888;';
    meta.textContent=d?(d.toLocaleDateString('ja')+' '+kusa.person):'';
    info.appendChild(badge);info.appendChild(meta);body.appendChild(info);
    const btn=document.createElement('button');btn.className='sub-btn';btn.textContent='🌿 要草刈りに戻す';
    btn.style.cssText='width:100%;padding:8px;';
    btn.addEventListener('click',()=>setKusa('要草刈り',nm));body.appendChild(btn);
  }
}

function addTask(){
  if(!selField)return;
  const input=document.getElementById('task-input');const content=input.value.trim();if(!content)return;
  const nm=selField.properties.name.trim();
  if(!curUser){const n=prompt('担当者名を入力してください');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
  taskData[nm]={status:'未完了',content,person:curUser,time:new Date().toISOString()};
  input.value='';updateTaskUI(nm);renderMap();
  postToGAS({action:'task',name:nm,status:'未完了',content,person:curUser}).catch(()=>alert('タスクの保存に失敗しました'));
}
function completeTask(nm){
  if(!curUser){const n=prompt('担当者名を入力してください');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
  const prev=taskData[nm];
  taskData[nm]={...prev,status:'完了',person:curUser,time:new Date().toISOString()};
  updateTaskUI(nm);renderMap();
  postToGAS({action:'task',name:nm,status:'完了',content:prev.content||'',person:curUser}).catch(()=>alert('タスクの保存に失敗しました'));
}
function updateTaskUI(nm){
  const task=taskData[nm];const list=document.getElementById('task-list');if(!list)return;
  if(!task||!task.content){list.innerHTML='';return;}
  const d=task.time?new Date(task.time):null;
  const dateStr=d?(d.toLocaleDateString('ja')+' '+task.person):'';
  list.innerHTML='';
  const wrap=document.createElement('div');wrap.style.cssText='display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap;';
  const span1=document.createElement('span');span1.className='sub-status '+(task.status==='未完了'?'task-open':'task-done');span1.textContent=task.status;
  const span2=document.createElement('span');span2.style.cssText='font-size:12px;flex:1';span2.textContent=task.content;
  wrap.appendChild(span1);wrap.appendChild(span2);
  if(task.status==='未完了'){
    const btn=document.createElement('button');btn.className='sub-btn';
    btn.style.cssText='background:#27ae60;color:#fff;border-color:#27ae60';btn.textContent='完了';
    btn.addEventListener('click',()=>completeTask(nm));wrap.appendChild(btn);
  }
  list.appendChild(wrap);
  const hist=document.createElement('div');hist.className='sub-hist';hist.textContent=dateStr;list.appendChild(hist);
}

function openPanel(feat){
  const p=feat.properties;selField=feat;selStatus=null;histOpen=false;exitEditMode();
  document.getElementById('pt').textContent=p.name.trim();
  const bn=BM[(p.field_id||'').replace(/-.*/, '')]||'';
  const cropLabel=getCropGroup(p.crop||'').label;
  document.getElementById('pm').textContent=[p.field_id,bn,p.area_a?p.area_a+'a':'',cropLabel&&cropLabel!=='その他'?cropLabel:''].filter(Boolean).join(' | ')||'詳細なし';
  const r=records[p.name.trim()];
  const pl=document.getElementById('pl');const ht=document.getElementById('htimer');
  if(r){
    const d=new Date(r.time),days=Math.floor((Date.now()-d.getTime())/86400000);
    pl.textContent='最終：'+d.toLocaleDateString('ja')+' '+d.toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'})+'（'+days+'日前）'+(r.checkedOnly?'（確認のみ）':'')+'　状態：'+r.status;
    pl.style.cssText='background:'+(days>=4?'#fff0f0':'#f0fff4')+';color:'+(days>=4?'#e74c3c':'#27ae60')+';padding:7px 10px;border-radius:8px;';
    ht.style.display=herbActive(r)?'block':'none';
    if(herbActive(r))ht.textContent='🟣 除草剤投入中 — あと'+herbRemain(r)+'で止水';
  }else{
    pl.textContent='最終確認：未記録';pl.style.cssText='background:#fff8f0;color:#e67e22;padding:7px 10px;border-radius:8px;';ht.style.display='none';
  }
  document.getElementById('kusa-section').style.display='block';
  document.getElementById('task-section').style.display='block';
  document.getElementById('bulk-extra').innerHTML='';
  updateKusaUI(p.name.trim());updateTaskUI(p.name.trim());
  const sg=document.getElementById('sgrid');sg.innerHTML='';
  const hasRecord=!!records[p.name.trim()];
  S_OPTS.forEach(s=>{
    const b=document.createElement('button');b.className='sbtn s'+s;b.textContent=s;
    if(s==='確認のみ'&&!hasRecord){b.disabled=true;b.title='未記録の圃場には使用できません';}
    else{b.addEventListener('click',()=>{document.querySelectorAll('.sbtn').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');selStatus=s;});}
    sg.appendChild(b);
  });
  initTimeSelector(0,new Date().getHours());
  document.getElementById('memo').value='';
  document.getElementById('multi-banner').style.display='none';
  const fh=allHist.filter(h=>h[0]===p.name.trim()).slice(-10).reverse();
  const hs=document.getElementById('hist-section');
  if(fh.length>0){
    hs.style.display='block';
    document.getElementById('hist-toggle').textContent='▶ 過去の記録（'+fh.length+'件）';
    document.getElementById('hist-list').style.display='none';
    const now=new Date();const todayStr=now.toLocaleDateString('ja');
    const yest=new Date(now);yest.setDate(yest.getDate()-1);const yesterdayStr=yest.toLocaleDateString('ja');
    const histContainer=document.getElementById('hist-list');histContainer.innerHTML='';
    fh.forEach(h=>{
      const d=new Date(h[4]);const dStr=d.toLocaleDateString('ja');
      const editable=dStr===todayStr||dStr===yesterdayStr;
      const row=document.createElement('div');row.className='hrow';
      row.innerHTML=dStr+' '+d.toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'})+' <b>'+(h[1]||'')+'</b> '+(h[2]||'')+(h[3]?' — '+h[3]:'');
      if(editable){
        const eb=document.createElement('button');eb.className='hrow-edit';eb.textContent='✏';
        eb.dataset.time=h[4];eb.dataset.status=h[1];eb.dataset.memo=h[3]||'';
        eb.addEventListener('click',function(){enterEditMode(this.dataset.time,this.dataset.status,this.dataset.memo);});
        const db=document.createElement('button');db.className='hrow-del';db.textContent='🗑';
        db.dataset.time=h[4];
        db.addEventListener('click',function(){
          const t=this.dataset.time;const dd=new Date(t);
          if(confirm('削除しますか?\n'+dd.toLocaleDateString('ja')+' '+dd.toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'}))){
            deleteRecord(p.name.trim(),t);
          }
        });
        row.appendChild(eb);row.appendChild(db);
      }
      histContainer.appendChild(row);
    });
  }else{hs.style.display='none';}
  document.getElementById('panel').classList.add('open');
  document.getElementById('overlay').classList.add('on');
}

function enterEditMode(origTime,origStatus,origMemo){
  editMode=true;editOrigTime=origTime;
  document.getElementById('panel').classList.add('edit-mode');
  document.getElementById('edit-banner').style.display='block';
  document.getElementById('savebtn').style.display='none';
  document.getElementById('edit-savebtn').style.display='block';
  document.getElementById('cancel-edit-btn').style.display='block';
  document.querySelectorAll('.sbtn').forEach(b=>{b.disabled=false;b.classList.toggle('sel',b.textContent===origStatus);if(b.textContent===origStatus)selStatus=origStatus;});
  document.getElementById('memo').value=origMemo||'';
  const d=new Date(origTime);const now=new Date();
  const diff=Math.floor((new Date(now.getFullYear(),now.getMonth(),now.getDate())-new Date(d.getFullYear(),d.getMonth(),d.getDate()))/86400000);
  initTimeSelector(Math.min(Math.max(diff,0),2),d.getHours());
  document.getElementById('panel').scrollTop=0;
}
function exitEditMode(){
  editMode=false;editOrigTime=null;
  document.getElementById('panel').classList.remove('edit-mode');
  document.getElementById('edit-banner').style.display='none';
  document.getElementById('savebtn').style.display='block';document.getElementById('savebtn').textContent='記録する';document.getElementById('savebtn').disabled=false;
  document.getElementById('edit-savebtn').style.display='none';document.getElementById('edit-savebtn').textContent='✏ 修正を保存';document.getElementById('edit-savebtn').disabled=false;
  document.getElementById('cancel-edit-btn').style.display='none';
}
function toggleHist(){
  histOpen=!histOpen;
  document.getElementById('hist-list').style.display=histOpen?'block':'none';
  document.getElementById('hist-toggle').textContent=(histOpen?'▼':'▶')+document.getElementById('hist-toggle').textContent.slice(1);
}
function closePanel(){
  document.getElementById('panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('on');
  exitEditMode();selField=null;
  document.getElementById('multi-banner').style.display='none';
  if(multiSelected.size>0)document.getElementById('multi-bar').style.display='flex';
}
async function deleteRecord(fieldName,origTime){
  allHist=allHist.filter(h=>!(h[0]===fieldName&&Math.abs(new Date(h[4]).getTime()-new Date(origTime).getTime())<1000));
  const remaining=allHist.filter(h=>h[0]===fieldName);
  if(remaining.length>0){const latest=remaining[remaining.length-1];records[fieldName]={status:latest[1],person:latest[2],memo:latest[3],time:latest[4]};}
  else{delete records[fieldName];}
  closePanel();renderMap();
  try{await postToGAS({action:'delete',name:fieldName,time:origTime,person:curUser});}
  catch(e){alert('削除の保存に失敗しました');}
}
async function postToGAS(body){const res=await fetch(GAS,{method:'POST',body:JSON.stringify(body)});return res.json();}
async function safeFetch(url){try{const r=await fetch(url);return await r.json();}catch(e){return null;}}
async function loadRecords(){
  const t=Date.now();
  const[r1,r2,r3,r4]=await Promise.all([
    safeFetch(GAS+'?t='+t),
    safeFetch(GAS+'?mode=history&t='+t),
    safeFetch(GAS+'?mode=kusa&t='+t),
    safeFetch(GAS+'?mode=task&t='+t),
  ]);
  if(r1&&typeof r1==='object')records=r1;
  if(r2&&Array.isArray(r2))allHist=r2;
  if(r3&&typeof r3==='object')kusaData=r3;
  if(r4&&typeof r4==='object')taskData=r4;
  Object.keys(records).forEach(nm=>{const r=records[nm];if(r&&r.status==='除草剤投入'&&!herbActive(r))records[nm]={...r,status:'止水'};});
  renderMap();
  document.getElementById('last-update').textContent=new Date().toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'})+'更新';
}
function changeUser(){const n=prompt('担当者名を入力してください',curUser);if(n!==null){curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n||'未設定';}}

document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('savebtn').addEventListener('click',async()=>{
    if(!selStatus){
      const ov=document.getElementById('overlay');ov.style.pointerEvents='none';
      alert('水の状態を選択してください');
      setTimeout(()=>ov.style.pointerEvents='',100);return;
    }
    if(multiSelected.size>0&&selField===null){
      setButtonLoading('savebtn',true);
      if(!curUser){const n=prompt('担当者名を入力してください');if(!n){setButtonLoading('savebtn',false,'記録する');return;}curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
      const memo=document.getElementById('memo').value;const time=getSelectedTime();const targets=[...multiSelected];
      targets.forEach(nm=>{const prev=records[nm];const newS=selStatus==='確認のみ'&&prev&&prev.status&&prev.status!=='確認のみ'?prev.status:selStatus;records[nm]={status:newS,checkedOnly:selStatus==='確認のみ',person:curUser,memo,time};});
      try{await postToGAS({action:'bulk',records:targets.map(nm=>({name:nm,status:records[nm].status,person:curUser,memo,time}))});}
      catch(e){alert('保存に失敗しました');}
      setButtonLoading('savebtn',false,'記録する');clearMultiSelect();closePanel();renderMap();return;
    }
    if(!selField)return;
    setButtonLoading('savebtn',true);
    if(!curUser){const n=prompt('担当者名を入力してください');if(!n){setButtonLoading('savebtn',false,'記録する');return;}curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
    const nm=selField.properties.name.trim();const memo=document.getElementById('memo').value;
    const prev=records[nm];const newS=selStatus==='確認のみ'&&prev&&prev.status&&prev.status!=='確認のみ'?prev.status:selStatus;const time=getSelectedTime();
    records[nm]={status:newS,checkedOnly:selStatus==='確認のみ',person:curUser,memo,time};
    try{await postToGAS({name:nm,status:newS,person:curUser,memo,time});}catch(e){alert('保存に失敗しました');}
    setButtonLoading('savebtn',false,'記録する');closePanel();renderMap();
  });
  document.getElementById('edit-savebtn').addEventListener('click',async()=>{
    if(!selField||!selStatus){alert('水の状態を選択してください');return;}
    setButtonLoading('edit-savebtn',true,'✏ 修正を保存');
    const nm=selField.properties.name.trim();const memo=document.getElementById('memo').value;const time=getSelectedTime();
    records[nm]={status:selStatus,checkedOnly:false,person:curUser,memo,time};
    try{await postToGAS({name:nm,status:selStatus,person:curUser,memo,time,correction:true,originalTime:editOrigTime});}catch(e){alert('保存に失敗しました');}
    setButtonLoading('edit-savebtn',false,'✏ 修正を保存');closePanel();renderMap();
  });
  document.getElementById('overlay').addEventListener('click',()=>closePanel());
  document.getElementById('ulabel').textContent=curUser||'未設定';
  init();
});
