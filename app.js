// OSF Water Management App v6 (performance optimized)
const GAS='https://script.google.com/macros/s/AKfycbwcV7O5APU32iUPODpt6UOl_M-7_FavWZjGKaFfwaHYLLj4QU0w07UjZv7dt0s-6zqy/exec';
const BM={"AR":"有富","NK":"中村","SS":"篠坂","KM":"北村","NI":"西今在家","SB":"菖蒲","FM":"古海","MD":"本高","BB":"馬場","HT":"服部","KR":"高路","TN":"徳尾","YG":"山が鼻","AJ":"味野","MW":"美和"};
// [NEW] 水管理項目：GASの設定シートから動的に読み込む（初期値はデフォルト）
let S_OPTS=['入水','ちょい入れ','止水','中干し','水尻外し','除草剤投入','確認のみ'];
// 管理者セッション
let adminPassword=null;
let allStatusItems=[]; // 管理者設定の全項目（OFF含む）
let S_COL={入水:'#3498db',ちょい入れ:'#1abc9c',止水:'#e67e22',中干し:'#e74c3c',水尻外し:'#a04000',除草剤投入:'#8e44ad',確認のみ:'#95a5a6'};
const CROP_GROUPS=[
  {key:'ZR1',color:'#1abc9c',label:'ZR1'},
  {key:'きぬむすめ',color:'#9b59b6',label:'きぬむすめ'},
  {key:'たちはるか',color:'#3498db',label:'たちはるか'},
  {key:'にじのきらめき',color:'#e67e22',label:'にじのきらめき'},
  {key:'みのりゆたか',color:'#f1c40f',label:'みのりゆたか'},
  {key:'こしひかり',color:'#e74c3c',label:'こしひかり'},
  {key:'その他',color:'#95a5a6',label:'その他'},
];
const LEGS={
  date:[{c:'#2ecc71',l:'2日以内'},{c:'#f39c12',l:'3日'},{c:'#e74c3c',l:'4日以上'},{c:'#8e44ad',l:'除草剤投入中'},{c:'#95a5a6',l:'未記録'}],
  status:[{c:'#3498db',l:'入水'},{c:'#1abc9c',l:'ちょい入れ'},{c:'#e67e22',l:'止水'},{c:'#e74c3c',l:'中干し'},{c:'#a04000',l:'水尻外し'},{c:'#8e44ad',l:'除草剤投入'},{c:'#95a5a6',l:'未記録'}],
  crop:CROP_GROUPS.map(g=>({c:g.color,l:g.label})),
};
function getCropGroup(crop){
  if(!crop)return CROP_GROUPS[6];
  for(let i=0;i<6;i++){if(crop.includes(CROP_GROUPS[i].key))return CROP_GROUPS[i];}
  return CROP_GROUPS[6];
}
function normalizeCropName(crop){
  if(!crop)return '';
  return crop
    .replace(/^(令和|R|H|平成)?\d+年度?[\s　]*/,'')
    .replace(/^\d{2}年度?[\s　]*/,'')
    .trim();
}
function cleanCropName(name) {
  return name.replace(/^(令和|平成|昭和)?\d+年[産～~]?\s*/,'').trim() || name;
}

let records={},allHist=[],kusaData={},memoData={},memoHistAll=[];
let mode='date',selBlocks=new Set(),selCrops=new Set(),alertFilters=new Set();

// ============================================================
// [NEW] O(1)インデックス: name → feature
// ============================================================
let GJ; // 圃場GeoJSONデータ
let fieldFeatureMap=new Map();

function getKusaDays(nm){
  const k=kusaData[nm];if(!k||!k.time)return 0;
  return (Date.now()-new Date(k.time).getTime())/86400000;
}
function getKusaIconHtml(nm){
  const d=getKusaDays(nm);
  const bg=d>=7?'#e74c3c':d>=3?'#e67e22':'#27ae60';
  return '<span style="background:'+bg+';border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 1px 3px rgba(0,0,0,0.4)">🌿</span>';
}
function matchesAlertFilter(nm){
  if(alertFilters.size===0)return true;
  if(hasKusaAlert(nm)){
    const d=getKusaDays(nm);
    if(alertFilters.has('kusa_new')&&d<3)return true;
    if(alertFilters.has('kusa_mid')&&d>=3&&d<7)return true;
    if(alertFilters.has('kusa_old')&&d>=7)return true;
  }
  if(alertFilters.has('memo')&&memoData[nm]&&memoData[nm].length>0)return true;
  return false;
}

let curUser=localStorage.getItem('osf_user')||'';
let selField=null,selStatus=null,histOpen=false,editMode=false,editOrigTime=null;
let multiMode=false,multiSelected=new Set();
let layers={},markers={};
let map;
let pendingKusa=null;
let editKeepMemo='';
let bulkMemoInputRef=null;
let bulkStatusSaved=false;
let bulkMemoSaved=false;
let singleSaved=false;
let bulkConfirmSaved=false;
let bulkKusaSaved=false;

// ============================================================
// [NEW] デバウンス
// ============================================================
let renderTimer=null;
function debouncedRenderMap(){
  clearTimeout(renderTimer);
  renderTimer=setTimeout(renderMap,50);
}

async function init(){
  try{const r=await fetch('fields.geojson');GJ=await r.json();}
  catch(e){document.getElementById('loading').textContent='圃場データの読み込みに失敗しました';return;}
  document.getElementById('loading').style.display='none';

  // [NEW] O(1)インデックス構築
  GJ.features.forEach(f=>fieldFeatureMap.set(f.properties.name.trim(),f));

  initMap();
  initFilters();
  updateLegend();

  // [NEW] 初回1回だけレイヤー・マーカーを生成
  buildLayers();

  loadRecords();
  setInterval(loadRecords,60000);
}

function initMap(){
  // [NEW] Canvas レンダラー追加（SVG→Canvas で380枚が1枚の画像として描画）
  map=L.map('map',{zoomControl:false,renderer:L.canvas()}).setView([35.465,134.19],13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{attribution:'© OpenStreetMap © CARTO',maxZoom:19,crossOrigin:true}).addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map);
  const locCtrl=L.control({position:'bottomright'});
  locCtrl.onAdd=function(){
    const d=L.DomUtil.create('div','leaflet-bar leaflet-control');
    d.innerHTML='<a href="#" style="font-size:16px;display:flex;align-items:center;justify-content:center;width:34px;height:34px;background:#fff">📍</a>';
    d.onclick=e=>{e.preventDefault();map.locate({setView:true,maxZoom:17});};return d;
  };
  locCtrl.addTo(map);
  let locMk=null;
  map.on('locationfound',e=>{if(locMk)map.removeLayer(locMk);locMk=L.circleMarker(e.latlng,{radius:10,color:'#fff',weight:2,fillColor:'#3498db',fillOpacity:0.9}).addTo(map);});
  map.on('locationerror',()=>alert('現在地を取得できませんでした'));
}

// ============================================================
// [NEW] buildLayers: 初回1回だけ全圃場のレイヤー・マーカーを生成
// ============================================================
function buildLayers(){
  GJ.features.forEach(feat=>{
    const nm=feat.properties.name.trim();

    // レイヤー生成（クリックイベントもここで1回バインド）
    const layer=L.geoJSON(feat,{
      style:{color:'#fff',weight:0.8,fillColor:'#95a5a6',fillOpacity:0.75,fill:true}
    }).on('click',()=>multiMode?toggleFieldSelect(nm):openPanel(feat)).addTo(map);
    layers[nm]=layer;

    // マーカー生成（初期は map に addTo しない＝浮かせた状態）
    try{
      const bounds=L.geoJSON(feat).getBounds();
      if(bounds.isValid()){
        const center=bounds.getCenter();
        const mk=L.marker(center,{
          icon:L.divIcon({className:'',html:'',iconSize:[44,22],iconAnchor:[22,11]}),
          interactive:false
        });
        markers[nm]=mk;
      }
    }catch(e){}
  });
}

function initFilters(){
  const blockCodes=[...new Set(GJ.features.map(f=>(f.properties.field_id||'').replace(/-.*/, '')).filter(c=>c&&BM[c]))].sort();
  blockCodes.forEach(c=>{
    const d=document.createElement('div');d.className='fopt';
    d.innerHTML='<div class="fchk" id="bfc-'+c+'"></div>'+BM[c]+'('+c+')';
    d.addEventListener('click',()=>toggleBlock(c));
    document.getElementById('block-options').appendChild(d);
  });
  CROP_GROUPS.slice(0,6).forEach(g=>{
    const cnt=GJ.features.filter(f=>getCropGroup(normalizeCropName((f.properties.crop||'').trim())).key===g.key).length;
    if(cnt===0)return;
    const d=document.createElement('div');d.className='fopt';
    d.innerHTML='<div class="fchk" id="cgfc-'+g.key+'"></div>'
      +'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+g.color+';margin-right:4px;vertical-align:middle;"></span>'
      +g.label+' <span style="color:#aaa">('+cnt+'枚)</span>';
    d.addEventListener('click',()=>toggleCrop(g.key,'cgfc-'+g.key,false));
    document.getElementById('crop-options').appendChild(d);
  });
  const otherCrops=[...new Set(GJ.features.map(f=>normalizeCropName((f.properties.crop||'').trim())).filter(c=>c&&getCropGroup(c).key==='その他'))].sort();
  otherCrops.forEach(cropName=>{
    const cnt=GJ.features.filter(f=>normalizeCropName((f.properties.crop||'').trim())===cropName).length;
    const safeId='cgfc-other-'+cropName.replace(/\s+/g,'_').replace(/[^\w\u3040-\u9fff]/g,'X');
    const d=document.createElement('div');d.className='fopt';
    d.innerHTML='<div class="fchk" id="'+safeId+'"></div>'
      +'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#95a5a6;margin-right:4px;vertical-align:middle;"></span>'
      +cleanCropName(cropName)+' <span style="color:#aaa">('+cnt+'枚)</span>';
    d.addEventListener('click',()=>toggleCrop(cropName,safeId,true));
    document.getElementById('crop-options').appendChild(d);
  });
}

function toggleDropdown(type){
  const ids={block:'block-menu',crop:'crop-menu',alert:'alert-menu'};
  const menuId=ids[type];
  Object.values(ids).forEach(id=>{if(id!==menuId)document.getElementById(id).classList.remove('open');});
  document.getElementById(menuId).classList.toggle('open');
}
document.addEventListener('click',e=>{
  if(!document.getElementById('filter-wrap').contains(e.target))document.getElementById('block-menu').classList.remove('open');
  if(!document.getElementById('crop-wrap').contains(e.target))document.getElementById('crop-menu').classList.remove('open');
  if(!document.getElementById('alert-wrap').contains(e.target))document.getElementById('alert-menu').classList.remove('open');
});

function toggleBlock(c){
  selBlocks.has(c)?selBlocks.delete(c):selBlocks.add(c);
  const el=document.getElementById('bfc-'+c);if(el)el.classList.toggle('on',selBlocks.has(c));
  const btn=document.getElementById('block-toggle-btn');
  btn.textContent=selBlocks.size===0?'🗂 ブロック ▾':[...selBlocks].map(x=>BM[x]).join('・')+' ▾';
  btn.classList.toggle('filtered',selBlocks.size>0);
  // [NEW] デバウンス経由
  debouncedRenderMap();
  if(selBlocks.size>0){
    const feats=GJ.features.filter(f=>selBlocks.has((f.properties.field_id||'').replace(/-.*/, '')));
    if(feats.length>0){const g=L.geoJSON({type:'FeatureCollection',features:feats});map.fitBounds(g.getBounds().pad(0.1));}
  }
}
const selCropMeta=new Map();
function toggleCrop(key,safeId,isExact){
  if(selCrops.has(key)){selCrops.delete(key);selCropMeta.delete(key);}
  else{selCrops.add(key);selCropMeta.set(key,!!isExact);}
  const el=document.getElementById(safeId);if(el)el.classList.toggle('on',selCrops.has(key));
  const btn=document.getElementById('crop-toggle-btn');
  btn.textContent=selCrops.size===0?'🌾 品種 ▾':[...selCrops].map(k=>{const g=CROP_GROUPS.find(x=>x.key===k);return g?g.label:k;}).join('・')+' ▾';
  btn.classList.toggle('filtered',selCrops.size>0);
  // [NEW] デバウンス経由
  debouncedRenderMap();
  if(selCrops.size>0){
    const feats=GJ.features.filter(f=>cropMatchesFilter((f.properties.crop||'').trim()));
    if(feats.length>0){const g=L.geoJSON({type:'FeatureCollection',features:feats});map.fitBounds(g.getBounds().pad(0.1));}
  }
}
function cropMatchesFilter(cropName){
  if(selCrops.size===0)return true;
  const normalized=normalizeCropName(cropName);
  for(const[key,isExact]of selCropMeta){
    if(isExact){if(normalized===key)return true;}
    else{if(getCropGroup(normalized).key===key)return true;}
  }
  return false;
}
function resetFilter(type){
  if(type==='block'){
    selBlocks.clear();
    document.querySelectorAll('[id^="bfc-"]').forEach(el=>el.classList.remove('on'));
    document.getElementById('block-toggle-btn').textContent='🗂 ブロック ▾';
    document.getElementById('block-toggle-btn').classList.remove('filtered');
    document.getElementById('block-menu').classList.remove('open');
  }else{
    selCrops.clear();selCropMeta.clear();
    document.querySelectorAll('[id^="cgfc-"]').forEach(el=>el.classList.remove('on'));
    document.getElementById('crop-toggle-btn').textContent='🌾 品種 ▾';
    document.getElementById('crop-toggle-btn').classList.remove('filtered');
    document.getElementById('crop-menu').classList.remove('open');
  }
  renderMap();
}
function toggleAlertFilter(type){
  alertFilters.has(type)?alertFilters.delete(type):alertFilters.add(type);
  const el=document.getElementById('afc-'+type);if(el)el.classList.toggle('on',alertFilters.has(type));
  const btn=document.getElementById('alert-toggle-btn');
  btn.classList.toggle('filtered',alertFilters.size>0);
  btn.textContent=alertFilters.size>0?'🚨 アラート（'+alertFilters.size+'）▾':'🚨 アラート ▾';
  renderMap();
}
function resetAlertFilter(){
  alertFilters.clear();
  ['kusa_new','kusa_mid','kusa_old','memo'].forEach(t=>{const el=document.getElementById('afc-'+t);if(el)el.classList.remove('on');});
  const btn=document.getElementById('alert-toggle-btn');
  btn.classList.remove('filtered');btn.textContent='🚨 アラート ▾';
  document.getElementById('alert-menu').classList.remove('open');
  renderMap();
}
function toggleMultiMode(){multiMode=!multiMode;document.getElementById('multi-btn').classList.toggle('active',multiMode);if(!multiMode)clearMultiSelect();}
function clearMultiSelect(){
  multiSelected.clear();multiMode=false;bulkConfirmSaved=false;
  document.getElementById('multi-btn').classList.remove('active');
  document.getElementById('multi-bar').classList.remove('show');
  document.getElementById('multi-bar').style.display='';
  renderMap();
}
function toggleFieldSelect(nm){
  multiSelected.has(nm)?multiSelected.delete(nm):multiSelected.add(nm);
  const cnt=multiSelected.size;
  const area=[...multiSelected].reduce((sum,n)=>{
    // [NEW] find() → fieldFeatureMap.get()
    const feat=fieldFeatureMap.get(n);
    return sum+(parseFloat(feat&&feat.properties.area_a)||0);
  },0);
  document.getElementById('multi-count').textContent=cnt+'枚 / 計'+area.toFixed(1)+'a';
  document.getElementById('multi-bar').classList.toggle('show',cnt>0);
  updateConfirmOnlyBtn();
  // [NEW] setStyle のみ（再生成なし）
  const feat=fieldFeatureMap.get(nm);
  const layer=layers[nm];
  if(layer)layer.setStyle(getLayerStyle(nm,feat));
  if(document.getElementById('panel').classList.contains('open')&&selField===null){
    document.getElementById('pt').textContent=cnt+'枚の一括記録';
    const tgts=[...multiSelected];
    document.getElementById('pm').textContent=tgts.slice(0,3).join('、')+(tgts.length>3?' 他'+(tgts.length-3)+'枚':'');
    updateConfirmOnlyBtn();
  }
}
function updateConfirmOnlyBtn(){
  const btn=document.getElementById('multi-confirm-btn');
  const warn=document.getElementById('multi-warn-text');
  const hasUnrecorded=[...multiSelected].some(nm=>!records[nm]);
  btn.disabled=hasUnrecorded;
  if(warn)warn.style.display=hasUnrecorded?'block':'none';
}
async function bulkConfirmOnly(){
  if([...multiSelected].some(nm=>!records[nm]))return;
  if(!confirm(multiSelected.size+'枚を確認済みにします。よろしいですか？'))return;
  if(!curUser){const n=prompt('担当者名を入力してください');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
  const time=new Date().toISOString();const targets=[...multiSelected];
  try{
    if(!bulkConfirmSaved){
      await postToGAS({action:'bulk',records:targets.map(nm=>({name:nm,status:records[nm].status,person:curUser,memo:'',time}))});
      bulkConfirmSaved=true;
    }
    await loadRecords();
    bulkConfirmSaved=false;
  }catch(e){alert('保存に失敗しました。電波の良い場所で再度「✓ 確認のみ」を押してください。');return;}
  clearMultiSelect();
}

function openMultiPanel(){
  if(multiSelected.size===0)return;
  selField=null;selStatus=null;pendingKusa=null;exitEditMode();
  const targets=[...multiSelected];
  const hasKusa=targets.some(nm=>kusaData[nm]);
  const hasNoKusa=targets.some(nm=>!kusaData[nm]);
  const hasMemo=targets.some(nm=>memoData[nm]);
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
  const bulkExtra=document.getElementById('bulk-extra');bulkExtra.innerHTML='';
  const bulkNotice=document.createElement('div');
  bulkNotice.style.cssText='font-size:11px;color:#856404;background:#fff3cd;border:1px solid #f39c12;border-radius:8px;padding:6px 10px;margin-bottom:8px;';
  bulkNotice.textContent='※ 選択した状態・日時はすべての圃場に一括で記録されます';
  bulkExtra.appendChild(bulkNotice);
  if(hasNoKusa){
    const btn=document.createElement('button');btn.className='sub-btn';
    btn.style.cssText='width:100%;padding:9px;background:#e8f5e9;border:2px solid #27ae60;color:#1b5e20;font-weight:700;margin-bottom:6px;font-size:13px;border-radius:10px;';
    btn.textContent='🌿 草刈りアラートを発令する（選択圃場すべて）';
    btn.addEventListener('click',async()=>{
      const noKusaTargets=targets.filter(nm=>!kusaData[nm]);
      if(!confirm(noKusaTargets.length+'枚に草刈りアラートを発令します'))return;
      if(!curUser){const n=prompt('担当者名');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
      btn.disabled=true;btn.textContent='送信中...';
      const time=getSelectedTime();
      try{
        if(!bulkKusaSaved){
          await postToGAS({action:'kusa_bulk',names:noKusaTargets,status:'要草刈り',person:curUser,time});
          bulkKusaSaved=true;
        }
        await loadRecords();
        bulkKusaSaved=false;
        btn.disabled=true;
        btn.textContent='✅ 発令済み';btn.style.cssText='width:100%;padding:9px;background:#95a5a6;border:2px solid #95a5a6;color:#fff;font-weight:700;margin-bottom:6px;font-size:13px;border-radius:10px;cursor:not-allowed;';
      }catch(e){alert('草刈りアラート発令の保存に失敗しました');btn.disabled=false;btn.textContent='🌿 草刈りアラートを発令する（選択圃場すべて）';return;}
    });
    bulkExtra.appendChild(btn);
  }
  if(hasKusa){
    const btn=document.createElement('button');btn.className='sub-btn';
    btn.style.cssText='width:100%;padding:9px;background:#27ae60;color:#fff;border-color:#27ae60;font-weight:700;margin-bottom:6px;font-size:13px;border-radius:10px;';
    btn.textContent='✅ 草刈りアラート解除（選択圃場すべて）';
    btn.addEventListener('click',async()=>{
      const kusaTargets=targets.filter(nm=>kusaData[nm]);
      if(!confirm(kusaTargets.length+'枚の草刈りアラートを解除します'))return;
      if(!curUser){const n=prompt('担当者名');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
      btn.disabled=true;btn.textContent='送信中...';
      const time=getSelectedTime();
      try{
        if(!bulkKusaSaved){
          await postToGAS({action:'kusa_bulk',names:kusaTargets,status:'解除',person:curUser,time});
          bulkKusaSaved=true;
        }
        await loadRecords();
        bulkKusaSaved=false;
        btn.disabled=true;
        btn.textContent='✅ 解除済み';btn.style.cssText='width:100%;padding:9px;background:#95a5a6;border:2px solid #95a5a6;color:#fff;font-weight:700;margin-bottom:6px;font-size:13px;border-radius:10px;cursor:not-allowed;';
      }catch(e){alert('草刈りアラート解除の保存に失敗しました');btn.disabled=false;btn.textContent='✅ 草刈りアラート解除（選択圃場すべて）';return;}
    });
    bulkExtra.appendChild(btn);
  }
  if(hasMemo){
    const btn=document.createElement('button');btn.className='sub-btn';
    btn.style.cssText='width:100%;padding:9px;background:#e67e22;color:#fff;border-color:#e67e22;font-weight:700;margin-bottom:6px;font-size:13px;border-radius:10px;';
    btn.textContent='✅ メモ対応済み（選択圃場すべて）';
    btn.addEventListener('click',async()=>{
      const memoTargets=targets.filter(nm=>memoData[nm]&&memoData[nm].length>0);
      const totalMemoCount=memoTargets.reduce((sum,nm)=>sum+(memoData[nm]||[]).length,0);
      if(!confirm(totalMemoCount+'件のメモを対応済みにします（'+memoTargets.length+'枚分）'))return;
      if(!curUser){const n=prompt('担当者名');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
      btn.disabled=true;btn.textContent='送信中...';
      try{
        await postToGAS({action:'memo_resolve_bulk',names:memoTargets,person:curUser});
        const resolvedTime=new Date().toISOString();
        memoTargets.forEach(nm=>{
          memoData[nm]=[];
          memoHistAll=memoHistAll.map(h=>(h[0]===nm&&h[4]==='未対応')
            ?[h[0],h[1],h[2],h[3],'対応済み',curUser,resolvedTime]:h);
        });
      }catch(e){alert('メモ対応済みの保存に失敗しました');btn.disabled=false;btn.textContent='✅ メモ対応済み（選択圃場すべて）';return;}
      closePanel();clearMultiSelect();renderMap();
    });
    bulkExtra.appendChild(btn);
  }
  const memoWrap=document.createElement('div');
  memoWrap.style.cssText='display:flex;gap:6px;margin-bottom:6px;';
  const memoInput=document.createElement('input');
  memoInput.type='text';memoInput.className='sub-input';
  memoInput.placeholder='選択圃場に同じメモを一括登録...';
  bulkMemoInputRef=memoInput;
  memoInput.addEventListener('input',()=>{bulkMemoSaved=false;updateSaveBtnState();});
  const memoBtn=document.createElement('button');memoBtn.className='sub-btn';
  memoBtn.textContent='⚠️ 一括登録';
  memoBtn.style.cssText='white-space:nowrap;background:#fff8f0;border-color:#e67e22;color:#e67e22;font-weight:700;';
  memoBtn.addEventListener('click',async()=>{
    const content=memoInput.value.trim();if(!content)return;
    if(!confirm(targets.length+'枚にメモを一括登録します'))return;
    if(!curUser){const n=prompt('担当者名');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
    memoBtn.disabled=true;memoBtn.textContent='送信中...';
    const time=new Date().toISOString();
    try{
      if(!bulkMemoSaved){
        await postToGAS({action:'memo_bulk',names:targets,content,person:curUser,time});
        bulkMemoSaved=true;
      }
      await loadRecords();
      bulkMemoSaved=false;
      // パネルを閉じず踏みとどまる（草刈りボタンと同じ動線）
      memoInput.value='';
      memoBtn.textContent='✅ 登録済み';
      memoBtn.style.cssText='white-space:nowrap;background:#95a5a6;border-color:#95a5a6;color:#fff;font-weight:700;cursor:not-allowed;';
      memoBtn.disabled=true;
    }catch(e){alert('メモ一括登録の保存に失敗しました。電波の良い場所で再度お試しください。');memoBtn.disabled=false;memoBtn.textContent='⚠️ 一括登録';return;}
  });
  memoWrap.appendChild(memoInput);memoWrap.appendChild(memoBtn);
  bulkExtra.appendChild(memoWrap);
  const sg=document.getElementById('sgrid');sg.innerHTML='';
  const hasUnrecorded=targets.some(nm=>!records[nm]);
  S_OPTS.forEach(s=>{
    const b=document.createElement('button');b.className='sbtn s'+s;b.textContent=s;
    if(s==='確認のみ'&&hasUnrecorded){b.disabled=true;}
    else{b.addEventListener('click',()=>{bulkStatusSaved=false;document.querySelectorAll('.sbtn').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');selStatus=s;updateSaveBtnState();});}
    sg.appendChild(b);
  });
  initTimeSelector(0,new Date().getHours());
  document.getElementById('hist-section').style.display='none';
  document.getElementById('panel').classList.add('open');
  document.getElementById('overlay').classList.add('on');
  document.getElementById('multi-bar').style.display='none';
  updateSaveBtnState();
}

function herbActive(rec){if(!rec||rec.status!=='除草剤投入')return false;return(Date.now()-new Date(rec.time).getTime())/3600000<72;}
function herbRemain(rec){const h=72-(Date.now()-new Date(rec.time).getTime())/3600000;if(h<=0)return '間もなく終了';return Math.floor(h)+'時間'+Math.floor((h%1)*60)+'分';}

function fieldColor(nm){
  const r=records[nm];
  if(mode==='crop'){
    // [NEW] find() → fieldFeatureMap.get()
    const feat=fieldFeatureMap.get(nm);
    return getCropGroup(normalizeCropName(feat?feat.properties.crop||'':'')).color;
  }
  if(!r)return '#95a5a6';
  if(herbActive(r))return '#8e44ad';
  if(r.status==='除草剤投入'){
    if(mode==='status')return S_COL['止水']||'#e67e22';
    const d=(Date.now()-new Date(r.time).getTime())/86400000;
    return d<2?'#2ecc71':d<4?'#f39c12':'#e74c3c';
  }
  if(mode==='status')return S_COL[r.status]||'#115522'; // カスタム項目は深緑
  const d=(Date.now()-new Date(r.time).getTime())/86400000;
  return d<2?'#2ecc71':d<4?'#f39c12':'#e74c3c';
}
function hasKusaAlert(nm){return !!(kusaData[nm]);}
function hasMemoAlert(nm){return !!(memoData[nm]&&memoData[nm].length>0);}
function hasAlert(nm){return hasKusaAlert(nm)||hasMemoAlert(nm);}

function getLayerStyle(nm,feat){
  const col=fieldColor(nm);
  const isSel=multiSelected.has(nm);
  const blockCode=feat?(feat.properties.field_id||'').replace(/-.*/, ''):'';
  const cropName=feat?(feat.properties.crop||'').trim():'';
  const blockHighlight=selBlocks.size>0&&selBlocks.has(blockCode);
  const cropHighlight=selCrops.size>0&&cropMatchesFilter(cropName);
  const isHighlighted=blockHighlight||cropHighlight||isSel;
  let opacity=0.75;
  if(alertFilters.size>0){opacity=matchesAlertFilter(nm)?0.85:0.05;}
  else if(selBlocks.size>0||selCrops.size>0){opacity=isHighlighted?0.85:0.18;}
  if(isSel)opacity=0.85;
  let color='#fff',weight=0.8;
  if(isSel){color='#f39c12';weight=3;}
  else if(alertFilters.size>0&&matchesAlertFilter(nm)){color='#e74c3c';weight=2.5;}
  else if(isHighlighted&&!alertFilters.size){color='#e74c3c';weight=2.5;}
  return{color,weight,fillColor:col,fillOpacity:opacity,fill:true};
}

// ============================================================
// [NEW] renderMap: setStyle で色だけ更新、マーカーは着脱式
// ============================================================
function renderMap(){
  if(!GJ||!map)return;
  let a4=0,totalArea=0,filteredCount=0;

  fieldFeatureMap.forEach((feat,nm)=>{
    const col=fieldColor(nm);

    // [NEW] レイヤーは setStyle のみ（removeLayer/addLayer なし）
    const layer=layers[nm];
    if(layer)layer.setStyle(getLayerStyle(nm,feat));

    const blockCode=(feat.properties.field_id||'').replace(/-.*/, '');
    const cropName=(feat.properties.crop||'').trim();
    const inBlock=selBlocks.size===0||selBlocks.has(blockCode);
    const inCrop=cropMatchesFilter(cropName);
    if(inBlock&&inCrop){
      filteredCount++;totalArea+=(parseFloat(feat.properties.area_a)||0);
      // フィルター表示中の圃場のみカウント
      if(col==='#e74c3c'&&mode==='date')a4++;
    }

    // [NEW] マーカーは着脱式（hasLayerチェック付き）
    const mk=markers[nm];
    if(!mk)return;
    const shouldShow=hasAlert(nm)&&(alertFilters.size===0||matchesAlertFilter(nm));
    if(shouldShow){
      // [NEW] setIcon で最新の色に更新してから表示（草刈り色は時間経過で変わるため毎回更新）
      const parts=[];
      if(hasKusaAlert(nm))parts.push(getKusaIconHtml(nm));
      if(hasMemoAlert(nm))parts.push('<span style="font-size:14px;text-shadow:0 0 3px #fff">⚠️</span>');
      const html='<div style="display:flex;gap:2px;align-items:center">'+parts.join('')+'</div>';
      mk.setIcon(L.divIcon({className:'',html,iconSize:[44,22],iconAnchor:[22,11]}));
      if(!map.hasLayer(mk))map.addLayer(mk);
    }else{
      if(map.hasLayer(mk))map.removeLayer(mk);
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
    GJ.features.forEach(f=>{
      // フィルター連動
      const blockCode=(f.properties.field_id||'').replace(/-.*/, '');
      const cropName=(f.properties.crop||'').trim();
      const inBlock=selBlocks.size===0||selBlocks.has(blockCode);
      const inCrop=cropMatchesFilter(cropName);
      if(!inBlock||!inCrop)return;
      const g=getCropGroup(f.properties.crop||'');
      cnt[g.label]=(cnt[g.label]||0)+1;
    });
    document.getElementById('summary').innerHTML=CROP_GROUPS.filter(g=>cnt[g.label]>0).map(g=>
      '<div class="sum-item"><div class="sum-dot" style="background:'+g.color+'"></div>'+g.label+' <span class="sum-num">'+cnt[g.label]+'</span></div>'
    ).join('');return;
  }
  // S_OPTSベースで動的にカウント箱を生成（フィルター連動・カスタム項目対応）
  const cnt={};let unr=0;
  S_OPTS.forEach(opt=>{cnt[opt]=0;});
  cnt['除草剤投入中']=0;
  GJ.features.forEach(f=>{
    // フィルター判定：選択中のブロック・品種に絞る
    const blockCode=(f.properties.field_id||'').replace(/-.*/, '');
    const cropName=(f.properties.crop||'').trim();
    const inBlock=selBlocks.size===0||selBlocks.has(blockCode);
    const inCrop=cropMatchesFilter(cropName);
    if(!inBlock||!inCrop)return;
    const r=records[f.properties.name];
    if(!r){unr++;return;}
    if(herbActive(r)){cnt['除草剤投入中']++;return;}
    const status=r.status==='除草剤投入'?'止水':r.status;
    if(cnt[status]!==undefined){cnt[status]++;}else{cnt[status]=1;}
  });
  // フィルター表示中の圃場のみ4日超をカウント
  let d4=0;
  fieldFeatureMap.forEach((feat,nm)=>{
    const blockCode=(feat.properties.field_id||'').replace(/-.*/, '');
    const cropName=(feat.properties.crop||'').trim();
    const inBlock=selBlocks.size===0||selBlocks.has(blockCode);
    const inCrop=cropMatchesFilter(cropName);
    if(!inBlock||!inCrop)return;
    const r=records[nm];
    if(r&&!herbActive(r)&&(Date.now()-new Date(r.time).getTime())/86400000>=4)d4++;
  });
  // S_OPTSの順番でサマリーを動的生成
  const items=[{l:'未記録',c:'#95a5a6',n:unr}];
  S_OPTS.forEach(opt=>{
    if(opt==='除草剤投入'){if(cnt['除草剤投入中']>0)items.push({l:'除草剤',c:'#8e44ad',n:cnt['除草剤投入中']});}
    else if(opt!=='確認のみ'&&cnt[opt]>0){items.push({l:opt,c:S_COL[opt]||'#115522',n:cnt[opt]});}
  });
  // S_OPTSにない過去項目も救い上げ
  Object.keys(cnt).forEach(k=>{
    if(k==='除草剤投入中')return;
    if(S_OPTS.includes(k))return;
    if(cnt[k]>0)items.push({l:k,c:S_COL[k]||'#115522',n:cnt[k]});
  });
  if(d4>0)items.push({l:'要確認(4日超)',c:'#e74c3c',n:d4});
  const filteredItems=items.filter(i=>i.n>0);
  document.getElementById('summary').innerHTML=filteredItems.map(i=>
    '<div class="sum-item"><div class="sum-dot" style="background:'+i.c+'"></div>'+i.l+' <span class="sum-num">'+i.n+'</span></div>'
  ).join('');
}

function setMode(m){
  mode=m;
  ['btn-date','btn-status','btn-crop'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.classList.toggle('active',id==='btn-'+m);
  });
  updateLegend();renderMap();
}
function updateLegend(){
  let legs;
  if(mode==='status'){
    // S_OPTS・S_COLベースで動的生成（管理者変更に追従）
    legs=S_OPTS.filter(s=>s!=='確認のみ').map(s=>({c:S_COL[s]||'#115522',l:s}));
    legs.push({c:'#95a5a6',l:'未記録'});
  }else{
    legs=LEGS[mode];
  }
  document.getElementById('legend').innerHTML=legs.map(l=>'<div class="leg-item"><div class="leg-dot" style="background:'+l.c+'"></div>'+l.l+'</div>').join('');
}
function initTimeSelector(d,h){
  document.getElementById('sel-date').value=String(d||0);
  const hs=document.getElementById('sel-hour');hs.innerHTML='';
  for(let i=0;i<24;i++){const o=document.createElement('option');o.value=i;o.textContent=i+'時';if(i===(h!==undefined?h:new Date().getHours()))o.selected=true;hs.appendChild(o);}
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

function setPendingKusa(status){
  pendingKusa=(pendingKusa===status)?null:status;
  if(selField)updateKusaUI(selField.properties.name.trim());
  updateSaveBtnState();
}

function updateKusaUI(nm){
  const body=document.getElementById('kusa-body');if(!body)return;
  const currentActive=hasKusaAlert(nm);
  body.innerHTML='';
  if(pendingKusa){
    const notice=document.createElement('div');notice.className='pending-notice';
    notice.textContent='⏳ 「記録する」で '+(pendingKusa==='要草刈り'?'🌿 アラート発令':'✅ アラート解除')+'されます　（もう一度押すと取り消し）';
    body.appendChild(notice);
  }
  if(!currentActive){
    if(pendingKusa==='要草刈り'){
      const btn=document.createElement('button');btn.className='sub-btn kusa-cancel-btn';
      btn.textContent='✕ 発令を取り消す';
      btn.addEventListener('click',()=>setPendingKusa('要草刈り'));
      body.appendChild(btn);
    }else{
      const btn=document.createElement('button');btn.className='sub-btn kusa-alert-btn';
      btn.textContent='🌿 草刈りアラートを発令する';
      btn.addEventListener('click',()=>setPendingKusa('要草刈り'));
      body.appendChild(btn);
    }
  }else{
    const kusa=kusaData[nm];
    const d=kusa&&kusa.time?new Date(kusa.time):null;
    const info=document.createElement('div');info.className='kusa-active-info';
    const badge=document.createElement('span');badge.className='sub-status kusa-need';badge.textContent='🌿 草刈りアラート発令中';
    const meta=document.createElement('span');meta.className='kusa-meta';
    meta.textContent=d?(d.toLocaleDateString('ja')+' '+kusa.person):'';
    info.appendChild(badge);info.appendChild(meta);body.appendChild(info);
    if(pendingKusa==='解除'){
      const btn=document.createElement('button');btn.className='sub-btn kusa-cancel-btn';
      btn.textContent='✕ 解除を取り消す';
      btn.addEventListener('click',()=>setPendingKusa('解除'));
      body.appendChild(btn);
    }else{
      const btn=document.createElement('button');btn.className='sub-btn kusa-resolve-btn';
      btn.textContent='✅ 草刈りアラートを解除する';
      btn.addEventListener('click',()=>setPendingKusa('解除'));
      body.appendChild(btn);
    }
  }
}

function updateMemoUI(nm){
  const list=document.getElementById('task-list');
  const inputRow=document.getElementById('task-input-row');
  if(!list)return;
  const actives=memoData[nm]||[];
  list.innerHTML='';
  actives.forEach(memo=>{
    const d=memo.time?new Date(memo.time):null;
    const wrap=document.createElement('div');wrap.className='memo-active-wrap';wrap.style.marginBottom='6px';
    const contentDiv=document.createElement('div');contentDiv.className='memo-content';contentDiv.textContent=memo.content;
    const metaDiv=document.createElement('div');metaDiv.className='memo-meta';
    metaDiv.textContent=(d?d.toLocaleDateString('ja')+' '+d.toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'})+' ':'')+(memo.person||'');
    const btnRow=document.createElement('div');btnRow.style.cssText='display:flex;gap:6px;margin-top:6px;';
    const resolveBtn=document.createElement('button');resolveBtn.className='sub-btn memo-resolve-btn';
    resolveBtn.textContent='✅ 対応済み';resolveBtn.style.cssText='flex:1;background:#27ae60;color:#fff;border-color:#27ae60;font-weight:700;padding:7px;';
    resolveBtn.addEventListener('click',()=>{
      if(confirm('「'+memo.content+'」\nを対応済みにします。よろしいですか？'))resolveMemo(nm,memo.time);
    });
    const editBtn=document.createElement('button');editBtn.className='sub-btn';
    editBtn.textContent='✏ 編集';editBtn.style.cssText='font-size:11px;padding:5px 10px;color:#888;border-color:#ddd;background:#fafafa;';
    editBtn.addEventListener('click',()=>{
      contentDiv.style.display='none';editBtn.style.display='none';
      resolveBtn.style.display='none';
      const editInput=document.createElement('input');editInput.type='text';editInput.className='sub-input';
      editInput.value=memo.content;editInput.style.cssText='width:100%;margin-bottom:4px;';
      const saveBtn=document.createElement('button');saveBtn.className='sub-btn';
      saveBtn.textContent='編集して保存';saveBtn.style.cssText='flex:1;background:#2C4A1E;color:#fff;border-color:#2C4A1E;padding:7px;';
      const cancelBtn=document.createElement('button');cancelBtn.className='sub-btn';
      cancelBtn.textContent='キャンセル';cancelBtn.style.cssText='flex:1;padding:7px;';
      saveBtn.addEventListener('click',async()=>{
        const newContent=editInput.value.trim();if(!newContent)return;
        saveBtn.disabled=true;saveBtn.textContent='送信中...';
        await editMemo(nm,memo.time,newContent);
      });
      cancelBtn.addEventListener('click',()=>{
        contentDiv.style.display='';editBtn.style.display='';
        resolveBtn.style.display='';
        editInput.remove();saveBtn.remove();cancelBtn.remove();
      });
      wrap.insertBefore(editInput,metaDiv);
      btnRow.appendChild(saveBtn);btnRow.appendChild(cancelBtn);
    });
    btnRow.appendChild(resolveBtn);btnRow.appendChild(editBtn);
    wrap.appendChild(contentDiv);wrap.appendChild(metaDiv);wrap.appendChild(btnRow);
    list.appendChild(wrap);
  });
  if(inputRow)inputRow.style.display='flex';
  const hist=memoHistAll.filter(h=>h[0]===nm);
  if(hist.length>0){
    const toggle=document.createElement('div');toggle.className='memo-hist-toggle';
    toggle.textContent='▶ メモ履歴（'+hist.length+'件）';
    let open=false;const histWrap=document.createElement('div');histWrap.style.display='none';
    [...hist].reverse().forEach(h=>{
      const row=document.createElement('div');row.className='memo-hist-row';
      const d=h[3]?new Date(h[3]):null;
      const dStr=d?d.toLocaleDateString('ja')+' '+d.toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'}):'';
      let html='<b style="color:#333">'+h[1]+'</b><br><span style="color:#aaa">登録：'+dStr+' '+(h[2]||'')+'</span>';
      if(h[4]==='対応済み'&&h[5]){
        const rd=h[6]?new Date(h[6]):null;
        const rdStr=rd?rd.toLocaleDateString('ja')+' '+rd.toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'}):'';
        html+='<br><span style="color:#27ae60">✅ 対応済：'+rdStr+' '+(h[5]||'')+'</span>';
      }else if(h[4]==='未対応'){html+='<br><span style="color:#e67e22">● 未対応</span>';}
      row.innerHTML=html;histWrap.appendChild(row);
    });
    toggle.addEventListener('click',()=>{open=!open;histWrap.style.display=open?'block':'none';toggle.textContent=(open?'▼':'▶')+' メモ履歴（'+hist.length+'件）';});
    list.appendChild(toggle);list.appendChild(histWrap);
  }
}

async function resolveMemo(nm,memoTime){
  if(!curUser){const n=prompt('担当者名を入力してください');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
  const memos=memoData[nm]||[];
  const target=memos.find(m=>Math.abs(new Date(m.time).getTime()-new Date(memoTime).getTime())<1000);
  if(!target)return;
  try{
    await postToGAS({action:'memo_resolve',name:nm,person:curUser,memoTime});
    await loadRecords();
    updateMemoUI(nm);
  }catch(e){alert('対応済みの保存に失敗しました。電波の良い場所で再度お試しください。');}
}

async function editMemo(nm,memoTime,newContent){
  try{
    await postToGAS({action:'memo_edit',name:nm,person:curUser,memoTime,content:newContent});
    await loadRecords();
    updateMemoUI(nm);
  }catch(e){alert('メモの編集に失敗しました。電波の良い場所で再度お試しください。');}
}

function updateSaveBtnState(){
  const btn=document.getElementById('savebtn');
  if(!btn||btn.style.display==='none')return;
  const memoInput=document.getElementById('task-input');
  const hasMemoText=memoInput&&memoInput.value.trim().length>0;
  const hasBulkMemo=bulkMemoInputRef&&bulkMemoInputRef.value.trim().length>0;
  btn.disabled=!(selStatus||pendingKusa||hasMemoText||hasBulkMemo);
}

function openPanel(feat){
  const p=feat.properties;selField=feat;selStatus=null;pendingKusa=null;histOpen=false;exitEditMode();
  document.getElementById('pt').textContent=p.name.trim();
  const bn=BM[(p.field_id||'').replace(/-.*/, '')]||'';
  const cropLabel=p.crop||'';
  document.getElementById('pm').textContent=[p.field_id,bn,p.area_a?p.area_a+'a':'',cropLabel].filter(Boolean).join(' | ')||'詳細なし';
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
  updateKusaUI(p.name.trim());
  updateMemoUI(p.name.trim());
  const sg=document.getElementById('sgrid');sg.innerHTML='';
  const hasRecord=!!records[p.name.trim()];
  S_OPTS.forEach(s=>{
    const b=document.createElement('button');b.className='sbtn s'+s;b.textContent=s;
    if(s==='確認のみ'&&!hasRecord){b.disabled=true;b.title='未記録の圃場には使用できません';}
    else{b.addEventListener('click',()=>{
      const r=records[p.name.trim()];
      if(s!=='確認のみ'&&herbActive(r)){
        if(!confirm('現在除草剤投入中（あと'+herbRemain(r)+'）です。\n本当に状態を上書きしますか？')){return;}
      }
      document.querySelectorAll('.sbtn').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');selStatus=s;singleSaved=false;updateSaveBtnState();
    });}
    sg.appendChild(b);
  });
  initTimeSelector(0,new Date().getHours());
  document.getElementById('multi-banner').style.display='none';
  const fh=allHist.filter(h=>h[0]===p.name.trim()).slice(-10).reverse();
  const hs=document.getElementById('hist-section');
  if(fh.length>0){
    hs.style.display='block';
    document.getElementById('hist-toggle').textContent='▶ 過去の記録（'+fh.length+'件）';
    document.getElementById('hist-list').style.display='none';histOpen=false;
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
          if(confirm('削除しますか?\n'+dd.toLocaleDateString('ja')+' '+dd.toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'}))){deleteRecord(p.name.trim(),t);}
        });
        row.appendChild(eb);row.appendChild(db);
      }
      histContainer.appendChild(row);
    });
  }else{hs.style.display='none';}
  document.getElementById('panel').classList.add('open');
  document.getElementById('overlay').classList.add('on');
  updateSaveBtnState();
}

function enterEditMode(origTime,origStatus,origMemo){
  editKeepMemo=origMemo||'';
  editMode=true;editOrigTime=origTime;
  document.getElementById('panel').classList.add('edit-mode');
  document.getElementById('edit-banner').style.display='block';
  document.getElementById('savebtn').style.display='none';
  document.getElementById('edit-savebtn').style.display='block';
  document.getElementById('cancel-edit-btn').style.display='block';
  document.querySelectorAll('.sbtn').forEach(b=>{b.disabled=false;b.classList.toggle('sel',b.textContent===origStatus);if(b.textContent===origStatus)selStatus=origStatus;});
  // 削除済み項目の場合は一時ボタンを追加
  if(!S_OPTS.includes(origStatus)){
    const sg=document.getElementById('sgrid');
    const tmp=document.createElement('button');
    tmp.className='sbtn';tmp.textContent=origStatus;
    tmp.disabled=true;tmp.classList.add('sel');
    tmp.style.cssText='opacity:0.5;cursor:not-allowed;';
    tmp.title='この項目は現在無効です';
    sg.appendChild(tmp);
    selStatus=origStatus;
  }
  const d=new Date(origTime);const now=new Date();
  const diff=Math.floor((new Date(now.getFullYear(),now.getMonth(),now.getDate())-new Date(d.getFullYear(),d.getMonth(),d.getDate()))/86400000);
  initTimeSelector(Math.min(Math.max(diff,0),2),d.getHours());
  document.getElementById('panel').scrollTop=0;
}
function exitEditMode(){
  editMode=false;editOrigTime=null;
  document.getElementById('panel').classList.remove('edit-mode');
  document.getElementById('edit-banner').style.display='none';
  document.getElementById('savebtn').style.display='block';
  document.getElementById('savebtn').textContent='記録する';
  document.getElementById('edit-savebtn').style.display='none';
  document.getElementById('edit-savebtn').textContent='✏ 修正を保存';
  document.getElementById('edit-savebtn').disabled=false;
  document.getElementById('cancel-edit-btn').style.display='none';
  updateSaveBtnState();
}
function toggleHist(){
  histOpen=!histOpen;
  document.getElementById('hist-list').style.display=histOpen?'block':'none';
  document.getElementById('hist-toggle').textContent=(histOpen?'▼':'▶')+document.getElementById('hist-toggle').textContent.slice(1);
}
function closePanel(){
  document.getElementById('panel').classList.remove('open');
  document.getElementById('overlay').classList.remove('on');
  exitEditMode();selField=null;pendingKusa=null;singleSaved=false;bulkKusaSaved=false;
  if(bulkMemoInputRef){bulkMemoInputRef.value='';bulkMemoInputRef=null;}
  bulkStatusSaved=false;bulkMemoSaved=false;bulkConfirmSaved=false;
  document.getElementById('multi-banner').style.display='none';
  if(multiSelected.size>0)document.getElementById('multi-bar').style.display='flex';
}
async function deleteRecord(fieldName,origTime){
  if(!confirm('この記録を削除しますか？'))return;
  try{
    await postToGAS({action:'delete',name:fieldName,time:origTime,person:curUser});
  }catch(e){alert('削除の保存に失敗しました');return;}
  allHist=allHist.filter(h=>!(h[0]===fieldName&&Math.abs(new Date(h[4]).getTime()-new Date(origTime).getTime())<1000));
  const remaining=allHist.filter(h=>h[0]===fieldName);
  if(remaining.length>0){const latest=remaining[remaining.length-1];records[fieldName]={status:latest[1],person:latest[2],memo:latest[3],time:latest[4]};}
  else{delete records[fieldName];}
  closePanel();renderMap();
}
async function postToGAS(body){const res=await fetch(GAS,{method:'POST',body:JSON.stringify(body)});return res.json();}
async function safeFetch(url){try{const r=await fetch(url);return await r.json();}catch(e){return null;}}

async function loadRecords(){
  const t=Date.now();
  const r=await safeFetch(GAS+'?mode=all&t='+t);
  if(r&&typeof r==='object'){
    if(r.latest&&typeof r.latest==='object')records=r.latest;
    if(r.history&&Array.isArray(r.history))allHist=r.history;
    if(r.kusa&&typeof r.kusa==='object')kusaData=r.kusa;
    if(r.memo&&typeof r.memo==='object')memoData=r.memo;
    if(r.memoHist&&Array.isArray(r.memoHist))memoHistAll=r.memoHist;
    // [NEW] 設定シートから水管理項目を反映
    if(r.settings&&r.settings.status_items&&Array.isArray(r.settings.status_items)){
      // 全項目を保持（管理者画面でOFF項目も表示するため）
      allStatusItems=r.settings.status_items.sort((a,b)=>a.order-b.order);
      const enabledItems=allStatusItems.filter(i=>i.enabled);
      if(enabledItems.length>0){
        S_OPTS=enabledItems.map(i=>i.label);
        // 色設定も反映（カスタム項目含む）
        allStatusItems.forEach(i=>{if(i.color)S_COL[i.label]=i.color;});
      }
    }
  }
  renderMap();
  document.getElementById('last-update').textContent=new Date().toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'})+'更新';
}
function changeUser(){const n=prompt('担当者名を入力してください',curUser);if(n!==null){curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n||'未設定';}}

document.addEventListener('DOMContentLoaded',()=>{
  const searchInput=document.getElementById('search-input');
  const searchResults=document.getElementById('search-results');
  function normalizeForSearch(str){
    return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).toLowerCase();
  }
  searchInput.addEventListener('input',()=>{
    const q=searchInput.value.trim();
    if(!q){searchResults.classList.remove('open');searchResults.innerHTML='';return;}
    const qNorm=normalizeForSearch(q);
    const hits=GJ?GJ.features.filter(f=>normalizeForSearch(f.properties.name||'').includes(qNorm)).slice(0,10):[];
    if(hits.length===0){
      searchResults.innerHTML='<div class="sres-item" style="color:#aaa;cursor:default;text-align:center;">✕ 一致する圃場がありません</div>';
      searchResults.classList.add('open');return;
    }
    searchResults.innerHTML=hits.map(f=>{
      const p=f.properties;
      const bn=BM[(p.field_id||'').replace(/-.*/, '')]||'';
      return '<div class="sres-item" data-name="'+p.name.trim()+'">'
        +'<div class="sres-name">'+p.name.trim()+'</div>'
        +'<div class="sres-sub">'+(bn?bn+' / ':'')+( p.area_a?p.area_a+'a / ':'')+( p.crop||'')+'</div>'
        +'</div>';
    }).join('');
    searchResults.classList.add('open');
  });
  searchResults.addEventListener('click',e=>{
    const item=e.target.closest('.sres-item');if(!item||!item.dataset.name)return;
    const name=item.dataset.name;
    // [NEW] find() → fieldFeatureMap.get()
    const feat=fieldFeatureMap.get(name);
    if(!feat)return;
    searchInput.value='';searchResults.classList.remove('open');searchResults.innerHTML='';
    if(multiMode){
      const layer=layers[name];
      if(layer)map.fitBounds(layer.getBounds().pad(0.3));
      toggleFieldSelect(name);
      if(document.getElementById('panel').classList.contains('open')&&selField===null){
        const cnt=multiSelected.size;
        document.getElementById('pt').textContent=cnt+'枚の一括記録';
        const tgts=[...multiSelected];
        document.getElementById('pm').textContent=tgts.slice(0,3).join('、')+(tgts.length>3?' 他'+(tgts.length-3)+'枚':'');
      }
      return;
    }
    const layer=layers[name];
    if(layer)map.fitBounds(layer.getBounds().pad(0.3));
    openPanel(feat);
  });
  document.addEventListener('click',e=>{
    if(!document.getElementById('search-wrap').contains(e.target)){
      searchResults.classList.remove('open');
    }
  });

  document.getElementById('task-input').addEventListener('input',()=>{singleSaved=false;updateSaveBtnState();});

  document.getElementById('savebtn').addEventListener('click',async()=>{
    const memoInput=document.getElementById('task-input');
    const memoText=memoInput?memoInput.value.trim():'';
    const hasMemoToAdd=memoText.length>0;

    if(!selStatus&&!pendingKusa&&!hasMemoToAdd){
      const ov=document.getElementById('overlay');ov.style.pointerEvents='none';
      alert('水の状態を選択するか、草刈りアラートを変更するか、メモを入力してください');
      setTimeout(()=>ov.style.pointerEvents='',100);return;
    }

    if(multiSelected.size>0&&selField===null){
      const bulkMemoText=bulkMemoInputRef?bulkMemoInputRef.value.trim():'';
      if(!selStatus&&!bulkMemoText)return;
      setButtonLoading('savebtn',true);
      if(!curUser){const n=prompt('担当者名を入力してください');if(!n){setButtonLoading('savebtn',false,'記録する');return;}curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
      const time=getSelectedTime();const targets=[...multiSelected];
      try{
        if(selStatus&&!bulkStatusSaved){
          await postToGAS({action:'bulk',records:targets.map(nm=>{const prev=records[nm];const newS=selStatus==='確認のみ'&&prev&&prev.status&&prev.status!=='確認のみ'?prev.status:selStatus;return{name:nm,status:newS,person:curUser,memo:'',time};})});
          bulkStatusSaved=true;
        }
        if(bulkMemoText&&!bulkMemoSaved){
          await postToGAS({action:'memo_bulk',names:targets,content:bulkMemoText,person:curUser,time});
          bulkMemoSaved=true;
        }
        await loadRecords();
        bulkStatusSaved=false;bulkMemoSaved=false;
      }catch(e){alert('保存に失敗しました。電波の良い場所で再度「記録する」を押してください。');setButtonLoading('savebtn',false,'記録する');return;}
      setButtonLoading('savebtn',false,'記録する');clearMultiSelect();closePanel();renderMap();return;
    }

    if(!selField)return;
    setButtonLoading('savebtn',true);
    if(!curUser){const n=prompt('担当者名を入力してください');if(!n){setButtonLoading('savebtn',false,'記録する');return;}curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}

    const nm=selField.properties.name.trim();
    const time=getSelectedTime();
    const payload={action:'save',name:nm,person:curUser,time};
    let waterNewS=null;
    if(selStatus){
      const prev=records[nm];
      waterNewS=selStatus==='確認のみ'&&prev&&prev.status&&prev.status!=='確認のみ'?prev.status:selStatus;
      payload.water={status:waterNewS,checkedOnly:selStatus==='確認のみ',memo:'',time};
    }
    if(pendingKusa)payload.kusa=pendingKusa;
    if(hasMemoToAdd)payload.memo={content:memoText};

    try{
      if(!singleSaved){
        await postToGAS(payload);
        singleSaved=true;
      }
      if(memoInput)memoInput.value='';
      await loadRecords();
    }catch(e){
      alert('保存に失敗しました。電波状況を確認して再度お試しください。');
      setButtonLoading('savebtn',false,'記録する');return;
    }

    setButtonLoading('savebtn',false,'記録する');
    pendingKusa=null;
    closePanel();
  });

  document.getElementById('edit-savebtn').addEventListener('click',async()=>{
    if(!selField||!selStatus){alert('水の状態を選択してください');return;}
    setButtonLoading('edit-savebtn',true,'✏ 修正を保存');
    const nm=selField.properties.name.trim();const time=getSelectedTime();
    try{
      await postToGAS({action:'edit',name:nm,status:selStatus,person:curUser,memo:editKeepMemo,time,originalTime:editOrigTime});
      await loadRecords();
    }
    catch(e){alert('保存に失敗しました');setButtonLoading('edit-savebtn',false,'✏ 修正を保存');return;}
    setButtonLoading('edit-savebtn',false,'✏ 修正を保存');closePanel();
  });
  document.getElementById('overlay').addEventListener('click',()=>closePanel());
  document.getElementById('ulabel').textContent=curUser||'未設定';
  init();
});

// ============================================================
// [NEW] 管理者機能
// ============================================================

// 管理者ログイン
async function openAdminLogin() {
  const pw = prompt('管理者パスワードを入力してください');
  if (pw === null) return;
  try {
    const res = await postToGAS({ action: 'admin_auth', password: pw });
    if (res.ok) {
      adminPassword = pw;
      openAdminMenu();
    } else {
      alert('パスワードが違います');
    }
  } catch(e) {
    alert('認証に失敗しました。電波状況を確認してください。');
  }
}

// 管理者メニュー画面を生成・表示
function openAdminMenu() {
  // 既存のモーダルがあれば削除
  const existing = document.getElementById('admin-modal');
  if (existing) existing.remove();

  const ADMIN_SECTIONS = [
    { id: 'status_items', label: '📋 水管理項目の設定', status: 'active' },
    { id: 'field_info',   label: '🌾 圃場設備情報の管理', status: 'planned' },
    { id: 'alert_thresh', label: '🚨 アラート閾値の設定', status: 'planned' },
  ];

  const modal = document.createElement('div');
  modal.id = 'admin-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px 0;box-sizing:border-box;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;width:92%;max-width:480px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.3);margin:auto;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
  header.innerHTML = '<h2 style="margin:0;font-size:17px;color:#2C4A1E">⚙️ 管理者メニュー</h2>';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;font-size:20px;cursor:pointer;color:#888;padding:4px 8px;';
  closeBtn.onclick = () => modal.remove();
  header.appendChild(closeBtn);
  box.appendChild(header);

  // セクション一覧
  ADMIN_SECTIONS.forEach(sec => {
    const btn = document.createElement('button');
    const isActive = sec.status === 'active';
    btn.style.cssText = 'width:100%;padding:14px 16px;margin-bottom:10px;border-radius:10px;border:2px solid '+(isActive?'#2C4A1E':'#ddd')+';background:'+(isActive?'#f0fff4':'#f9f9f9')+';color:'+(isActive?'#2C4A1E':'#aaa')+';font-size:15px;font-weight:700;text-align:left;cursor:'+(isActive?'pointer':'default')+';display:flex;justify-content:space-between;align-items:center;';
    btn.innerHTML = '<span>'+sec.label+'</span><span style="font-size:12px;font-weight:400">'+(isActive?'▶':'準備中')+'</span>';
    if (isActive) {
      btn.onclick = () => openAdminSection(sec.id, modal, box);
    }
    box.appendChild(btn);
  });

  // ログアウトボタン
  const logoutBtn = document.createElement('button');
  logoutBtn.textContent = 'ログアウト';
  logoutBtn.style.cssText = 'width:100%;padding:10px;margin-top:6px;border-radius:10px;border:1px solid #ddd;background:#fff;color:#888;font-size:13px;cursor:pointer;';
  logoutBtn.onclick = () => { adminPassword = null; modal.remove(); };
  box.appendChild(logoutBtn);

  modal.appendChild(box);
  // モーダル外クリックで閉じる
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// 各セクションの画面を生成
function openAdminSection(sectionId, modal, box) {
  if (sectionId === 'status_items') openStatusItemsEditor(modal, box);
}

// 水管理項目の設定画面
function openStatusItemsEditor(modal, box) {
  box.innerHTML = '';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
  header.innerHTML = '<h2 style="margin:0;font-size:17px;color:#2C4A1E">📋 水管理項目の設定</h2>';
  const backBtn = document.createElement('button');
  backBtn.textContent = '← 戻る';
  backBtn.style.cssText = 'background:none;border:none;font-size:13px;cursor:pointer;color:#3498db;padding:4px 8px;';
  backBtn.onclick = () => openAdminMenu();
  header.appendChild(backBtn);
  box.appendChild(header);

  const notice = document.createElement('div');
  notice.style.cssText = 'font-size:11px;color:#856404;background:#fff3cd;border:1px solid #f39c12;border-radius:8px;padding:8px 10px;margin-bottom:14px;';
  notice.textContent = '※ 「確認のみ」は必須項目のため変更できません。ドラッグで順番を変更できます。';
  box.appendChild(notice);

  // 現在の項目リスト（確認のみ以外が編集対象）
  // allStatusItemsがあればそこから（OFF項目も含めて表示）、なければS_OPTSから
  let currentItems = (allStatusItems.length>0
    ? allStatusItems.filter(i=>i.label!=='確認のみ')
    : S_OPTS.filter(s=>s!=='確認のみ').map(s=>({label:s,enabled:true,order:0}))
  ).map(i=>({label:i.label,enabled:i.enabled!==false,color:i.color||S_COL[i.label]||'#3498db'}));

  const listWrap = document.createElement('div');
  listWrap.id = 'admin-item-list';
  listWrap.style.cssText = 'margin-bottom:14px;';

  function renderList() {
    listWrap.innerHTML = '';
    currentItems.forEach((item, idx) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;background:#f9f9f9;border-radius:8px;border:1px solid #eee;';
      // 上下移動ボタン（スマホ対応）
      const upBtn = document.createElement('button');
      upBtn.textContent = '🔼';
      upBtn.style.cssText = 'background:none;border:none;font-size:13px;cursor:pointer;padding:2px;flex-shrink:0;';
      upBtn.onclick = () => { if(idx===0)return; const tmp=currentItems[idx-1]; currentItems[idx-1]=currentItems[idx]; currentItems[idx]=tmp; renderList(); };
      if(idx===0)upBtn.style.opacity='0.2';

      const downBtn = document.createElement('button');
      downBtn.textContent = '🔽';
      downBtn.style.cssText = 'background:none;border:none;font-size:13px;cursor:pointer;padding:2px;flex-shrink:0;';
      downBtn.onclick = () => { if(idx===currentItems.length-1)return; const tmp=currentItems[idx+1]; currentItems[idx+1]=currentItems[idx]; currentItems[idx]=tmp; renderList(); };
      if(idx===currentItems.length-1)downBtn.style.opacity='0.2';

      // ON/OFFトグル
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = item.enabled;
      toggle.style.cssText = 'width:18px;height:18px;flex-shrink:0;cursor:pointer;';
      toggle.onchange = () => { currentItems[idx].enabled = toggle.checked; };

      // カラーピッカー
      const colorPicker = document.createElement('input');
      colorPicker.type = 'color';
      colorPicker.value = item.color || S_COL[item.label] || '#3498db';
      colorPicker.style.cssText = 'width:34px;height:30px;border:1px solid #ddd;border-radius:6px;padding:2px;cursor:pointer;flex-shrink:0;';
      colorPicker.oninput = () => { currentItems[idx].color = colorPicker.value; };

      // 項目名（編集可能）
      const input = document.createElement('input');
      input.type = 'text';
      input.value = item.label;
      input.style.cssText = 'flex:1;border:1px solid #ddd;border-radius:6px;padding:5px 8px;font-size:13px;';
      input.oninput = () => { currentItems[idx].label = input.value.trim(); };

      // 削除ボタン
      const delBtn = document.createElement('button');
      delBtn.textContent = '🗑';
      delBtn.style.cssText = 'background:none;border:none;font-size:15px;cursor:pointer;color:#e74c3c;flex-shrink:0;';
      delBtn.onclick = () => { if (confirm('「'+item.label+'」を削除しますか？')) { currentItems.splice(idx, 1); renderList(); } };

      row.appendChild(upBtn);
      row.appendChild(downBtn);
      row.appendChild(toggle);
      row.appendChild(colorPicker);
      row.appendChild(input);
      row.appendChild(delBtn);
      listWrap.appendChild(row);
    });
  }
  renderList();
  box.appendChild(listWrap);

  // 項目追加
  const addWrap = document.createElement('div');
  addWrap.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;';
  const addInput = document.createElement('input');
  addInput.type = 'text';
  addInput.placeholder = '新しい項目名を入力...';
  addInput.style.cssText = 'flex:1;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:13px;';
  const addBtn = document.createElement('button');
  addBtn.textContent = '＋ 追加';
  addBtn.style.cssText = 'padding:8px 14px;border-radius:8px;border:2px solid #2C4A1E;background:#f0fff4;color:#2C4A1E;font-weight:700;cursor:pointer;white-space:nowrap;';
  addBtn.onclick = () => {
    const label = addInput.value.trim();
    if (!label) return;
    if (currentItems.some(i => i.label === label)) { alert('同じ名前の項目が既にあります'); return; }
    currentItems.push({ label, enabled: true, color: '#3498db' });
    addInput.value = '';
    renderList();
  };
  addWrap.appendChild(addInput);
  addWrap.appendChild(addBtn);
  box.appendChild(addWrap);

  // 保存ボタン
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 保存する';
  saveBtn.style.cssText = 'width:100%;padding:13px;border-radius:10px;border:none;background:#2C4A1E;color:#fff;font-size:15px;font-weight:700;cursor:pointer;';
  saveBtn.onclick = async () => {
    const enabledItems = currentItems.filter(i => i.label.trim());
    // 確認のみは末尾に必ず追加
    const finalItems = [
      ...enabledItems,
      { label: '確認のみ', enabled: true, color: S_COL['確認のみ']||'#95a5a6', order: enabledItems.length }
    ].map((item, idx) => ({ ...item, order: idx }));

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中...';
    try {
      await postToGAS({ action: 'save_settings', password: adminPassword, key: 'status_items', value: finalItems });
      await loadRecords(); // 全端末に即反映
      saveBtn.textContent = '✅ 保存しました';
      setTimeout(() => { saveBtn.textContent = '💾 保存する'; saveBtn.disabled = false; }, 2000);
    } catch(e) {
      alert('保存に失敗しました');
      saveBtn.textContent = '💾 保存する';
      saveBtn.disabled = false;
    }
  };
  box.appendChild(saveBtn);
}
