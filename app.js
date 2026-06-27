// OSF Water Management App v6 (performance optimized)
const GAS='https://script.google.com/macros/s/AKfycbwcV7O5APU32iUPODpt6UOl_M-7_FavWZjGKaFfwaHYLLj4QU0w07UjZv7dt0s-6zqy/exec';
const BM={"AR":"有富","NK":"中村","SS":"篠坂","KM":"北村","NI":"西今在家","SB":"菖蒲","FM":"古海","MD":"本高","BB":"馬場","HT":"服部","KR":"高路","TN":"徳尾","YG":"山が鼻","AJ":"味野","MW":"美和"};
// [NEW] 水管理項目：GASの設定シートから動的に読み込む（初期値はデフォルト）
let S_OPTS=['入水','ちょい入れ','止水','中干し','水尻外し','除草剤投入','確認のみ'];
// 管理者セッション
let adminPassword=null;
let allStatusItems=[]; // 管理者設定の全項目（OFF含む）
let S_COL={入水:'#3498db',ちょい入れ:'#1abc9c',止水:'#e67e22',中干し:'#d68910',水尻外し:'#a04000',除草剤投入:'#8e44ad',確認のみ:'#95a5a6'};
const LOCKED_STATUSES=new Set(['入水','ちょい入れ','止水','中干し','水尻外し','除草剤投入','確認のみ']);
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
  mizushi:[{c:'#8e44ad',l:'設置済み'},{c:'#e67e22',l:'外し済み'},{c:'#95a5a6',l:'未記録'}],
  ankyo:[{c:'#2980b9',l:'はめ済み'},{c:'#e67e22',l:'外し済み'},{c:'#27ae60',l:'なし'},{c:'#95a5a6',l:'未登録'}],
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
let mizushiData={},ankyoMaster={},ankyoOpData={},plantingDates={};
let statusFilters=new Set();
let mode='date',selBlocks=new Set(),selCrops=new Set(),alertFilters=new Set(),mizushiFilters=new Set(),ankyoFilters=new Set(),ankyoSpecialFilter=false;

// ============================================================
// 個人設定・フィルター定義
// ============================================================
const FILTER_DEFS=[
  {id:'block',         label:'🗂 ブロック', modes:['date','status','mizushi','ankyo']},
  {id:'planting',      label:'🌱 田植後',   modes:['date','status']},
  {id:'kandoshi',      label:'🌾 中干し',   modes:['date','status']},
  {id:'alert',         label:'🚨 アラート', modes:['date','status']},
  {id:'status_filter', label:'💧 水状態',   modes:['date','status']},
  {id:'crop',          label:'🌾 品種',     modes:['date','status']},
];
const DEFAULT_PERSONAL={
  filterOrder:   ['block','planting','kandoshi','alert','status_filter','crop'],
  filterVisible: {block:true,planting:true,kandoshi:true,alert:true,status_filter:false,crop:false},
  defaultMode:   'date',
  plantingDefault:{minDays:0,maxDays:60,type:'all'},
};
let plantingFilter={active:false,minDays:0,maxDays:60,type:'all'};
let kandoshiFilter=new Set(); // 'active'/'done' の複数選択可
let nakaboshiIndex={}; // {圃場名:{start:ISO, end:ISO|null}}
let kandoshiDays={}; // {品種グループ名:日数} - 管理者設定から
let herbHours=72; // 除草剤カウントダウン時間（管理者設定から）
let alertDays=4;  // 要確認アラート閾値（管理者設定から）
let personalSettings=null;

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
let pendingPhotoBase64=null;
let pendingPhotoMimeType=null;
let pendingPhotoFileId=null;
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
let showFieldIdLabels=false;
let fieldIdMarkers={};
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

  personalSettings=loadPersonalSettings();
  buildRightControls();
  initMap();
  initFilters();
  updateLegend();

  // [NEW] 初回1回だけレイヤー・マーカーを生成
  buildLayers();

  // 起動直後から0件の状態でフィルターメニューを構築（パカパカ防止）
  buildStatusFilterMenu();
  buildAlertFilterMenu();

  // 個人設定のデフォルトモードで起動
  setMode(personalSettings.defaultMode||'date');

  loadRecords();
  setInterval(loadRecords,60000);
}

function initMap(){
  // [NEW] Canvas レンダラー追加（SVG→Canvas で380枚が1枚の画像として描画）
  map=L.map('map',{zoomControl:false,renderer:L.canvas()}).setView([35.465,134.19],13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{attribution:'© OpenStreetMap © CARTO',maxZoom:19,crossOrigin:true}).addTo(map);
  // ズームコントロール非表示（2本指ズームで操作）
  const locCtrl=L.control({position:'bottomright'});
  locCtrl.onAdd=function(){
    const d=L.DomUtil.create('div','leaflet-control');
    d.style.cssText='background:#fff;border-radius:8px;box-shadow:0 2px 6px rgba(0,0,0,0.3);width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;margin-bottom:10px;';
    d.innerHTML='📍';
    d.onclick=e=>{e.preventDefault();e.stopPropagation();map.locate({setView:true,maxZoom:17});};
    return d;
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
    }).on('click',()=>multiMode?toggleFieldSelect(nm):openPanelByMode(feat)).addTo(map);
    layers[nm]=layer;

    // マーカー生成（初期は map に addTo しない＝浮かせた状態）
    try{
      const center=getPolygonCentroid(feat);
      if(center){
        const mk=L.marker(center,{
          icon:L.divIcon({className:'',html:'',iconSize:[44,22],iconAnchor:[22,11]}),
          interactive:false
        });
        markers[nm]=mk;
        // 圃場番号ラベル
        const fid=(feat.properties.field_id||'').trim();
        if(fid){
          const lbl=L.marker(center,{
            icon:L.divIcon({
              className:'',
              html:'<div style="font-size:9px;font-weight:700;color:#fff;background:rgba(0,0,0,0.65);padding:1px 5px;border-radius:4px;white-space:nowrap;pointer-events:none;text-shadow:0 0 2px #000,0 0 2px #000;">'+fid+'</div>',
              iconAnchor:[0,0]
            }),
            interactive:false
          });
          fieldIdMarkers[nm]=lbl;
        }
      }
    }catch(e){}
  });
}

// ============================================================
// ポリゴン中心（バウンディングボックス中心）
// ============================================================
function getPolygonCentroid(feat){
  try{
    const bounds=L.geoJSON(feat).getBounds();
    return bounds.isValid()?bounds.getCenter():null;
  }catch(e){return null;}
}
function initFilters(){
  // 再生成時の重複防止クリア
  const bo=document.getElementById('block-options');if(bo)bo.innerHTML='';
  const co=document.getElementById('crop-options');if(co)co.innerHTML='';
  // ブロックフィルター（件数バッジ付き）
  const blockCodes=[...new Set(GJ.features.map(f=>(f.properties.field_id||'').replace(/-.*/, '')).filter(c=>c&&BM[c]))].sort();
  blockCodes.forEach(c=>{
    const cnt=GJ.features.filter(f=>(f.properties.field_id||'').replace(/-.*/, '')===c).length;
    const d=document.createElement('div');d.className='fopt';
    d.style.cssText='display:flex;align-items:center;';
    d.innerHTML='<div class="fchk" id="bfc-'+c+'"></div>'
      +'<span style="flex-grow:1;">'+BM[c]+'('+c+')</span>'
      +'<span style="font-size:12px;color:#666;background:#f0f0f0;padding:2px 8px;border-radius:10px;font-weight:bold;margin-left:auto;">'+cnt+'</span>';
    d.addEventListener('click',()=>toggleBlock(c));
    document.getElementById('block-options').appendChild(d);
  });
  // 品種フィルター（件数バッジ付き・グループ単位）
  CROP_GROUPS.slice(0,6).forEach(g=>{
    const cnt=GJ.features.filter(f=>getCropGroup(normalizeCropName((f.properties.crop||'').trim())).key===g.key).length;
    if(cnt===0)return;
    const d=document.createElement('div');d.className='fopt';
    d.style.cssText='display:flex;align-items:center;';
    d.innerHTML='<div class="fchk" id="cgfc-'+g.key+'"></div>'
      +'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+g.color+';margin-right:4px;flex-shrink:0;"></span>'
      +'<span style="flex-grow:1;">'+g.label+'</span>'
      +'<span style="font-size:12px;color:#666;background:#f0f0f0;padding:2px 8px;border-radius:10px;font-weight:bold;margin-left:auto;">'+cnt+'</span>';
    d.addEventListener('click',()=>toggleCrop(g.key,'cgfc-'+g.key,false));
    document.getElementById('crop-options').appendChild(d);
  });
  // 「その他」個別品種（件数バッジ付き）
  const otherCrops=[...new Set(GJ.features.map(f=>normalizeCropName((f.properties.crop||'').trim())).filter(c=>c&&getCropGroup(c).key==='その他'))].sort();
  otherCrops.forEach(cropName=>{
    const cnt=GJ.features.filter(f=>normalizeCropName((f.properties.crop||'').trim())===cropName).length;
    const safeId='cgfc-other-'+cropName.replace(/\s+/g,'_').replace(/[^\w\u3040-\u9fff]/g,'X');
    const d=document.createElement('div');d.className='fopt';
    d.style.cssText='display:flex;align-items:center;';
    d.innerHTML='<div class="fchk" id="'+safeId+'"></div>'
      +'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#95a5a6;margin-right:4px;flex-shrink:0;"></span>'
      +'<span style="flex-grow:1;">'+cleanCropName(cropName)+'</span>'
      +'<span style="font-size:12px;color:#666;background:#f0f0f0;padding:2px 8px;border-radius:10px;font-weight:bold;margin-left:auto;">'+cnt+'</span>';
    d.addEventListener('click',()=>toggleCrop(cropName,safeId,true));
    document.getElementById('crop-options').appendChild(d);
  });
}

function toggleDropdown(type){
  const ids={block:'block-menu',crop:'crop-menu',alert:'alert-menu',mizushi_status:'mizushi-status-menu',ankyo_status:'ankyo-status-menu',status_filter:'status-filter-menu',planting:'planting-menu',kandoshi:'kandoshi-menu'};
  const menuId=ids[type];
  if(!menuId)return;
  Object.values(ids).forEach(id=>{const el=document.getElementById(id);if(el&&id!==menuId)el.classList.remove('open');});
  document.getElementById(menuId)?.classList.toggle('open');
}
document.addEventListener('click',e=>{
  const rc=document.getElementById('right-controls');
  if(rc&&!rc.contains(e.target)){
    document.querySelectorAll('.filter-dropdown.open').forEach(m=>m.classList.remove('open'));
  }
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
  if(layer&&multiSelected.has(nm))layer.bringToFront();
  if(document.getElementById('panel').classList.contains('open')&&selField===null){
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
  if(mode==='mizushi'){openMizushiMultiPanel();return;}
  if(mode==='ankyo'){openAnkyoMultiPanel();return;}
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
  memoInput.addEventListener('input',()=>{
    bulkMemoSaved=false;updateSaveBtnState();
    // 登録済み状態のまま新しい文字を打ち始めたらボタンを復活
    if(memoBtn.disabled&&memoBtn.textContent==='✅ 登録済み'){
      memoBtn.disabled=false;memoBtn.textContent='⚠️ 一括登録';
      memoBtn.style.cssText='white-space:nowrap;background:#fff8f0;border-color:#e67e22;color:#e67e22;font-weight:700;';
    }
  });
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
    b.style.setProperty('--c',S_COL[s]||'#115522');
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

function herbActive(rec){if(!rec||rec.status!=='除草剤投入')return false;return(Date.now()-new Date(rec.time).getTime())/3600000<herbHours;}
function herbRemain(rec){const h=herbHours-(Date.now()-new Date(rec.time).getTime())/3600000;if(h<=0)return '間もなく終了';return Math.floor(h)+'時間'+Math.floor((h%1)*60)+'分';}

function fieldColor(nm){
  if(mode==='mizushi'){
    const m=mizushiData[nm];
    if(!m)return '#95a5a6';
    return m.status==='設置済み'?'#8e44ad':m.status==='外し済み'?'#e67e22':'#95a5a6';
  }
  if(mode==='ankyo'){
    const master=ankyoMaster[nm];
    if(!master)return '#95a5a6';
    if(master.hasAnkyo==='なし')return '#27ae60';
    const op=ankyoOpData[nm];
    if(!op)return '#2980b9'; // マスタあり・操作未記録ははめ済みとみなす
    return op.status==='はめた'?'#2980b9':'#e67e22';
  }
  const r=records[nm];
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

function getLayerStyle(nm,feat,modeFilterMatch,statusFilterMatch){
  const col=fieldColor(nm);
  const isSel=multiSelected.has(nm);
  const isCurrent=!!(selField&&selField.properties&&selField.properties.name.trim()===nm);
  const blockCode=feat?(feat.properties.field_id||'').replace(/-.*/, ''):'';
  const cropName=feat?(feat.properties.crop||'').trim():'';
  const blockHighlight=selBlocks.size>0&&selBlocks.has(blockCode);
  const cropHighlight=selCrops.size>0&&cropMatchesFilter(cropName);
  const isHighlighted=blockHighlight||cropHighlight||isSel;
  let opacity=0.75;
  if(modeFilterMatch!==undefined||statusFilterMatch!==undefined){
    if((mode==='mizushi'&&mizushiFilters.size>0)||(mode==='ankyo'&&(ankyoFilters.size>0||ankyoSpecialFilter))){
      opacity=modeFilterMatch?0.85:0.05;
    }else if(statusFilters.size>0&&(mode==='date'||mode==='status')){
      opacity=statusFilterMatch?0.85:0.05;
    }else if(alertFilters.size>0){opacity=matchesAlertFilter(nm)?0.85:0.05;}
    else if(selBlocks.size>0||selCrops.size>0){opacity=isHighlighted?0.85:0.18;}
  }else{
    if(mode==='mizushi'&&mizushiFilters.size>0){
      const m=mizushiData[nm];const ms=m?m.status:'未記録';
      opacity=mizushiFilters.has(ms)?0.85:0.05;
    }else if(mode==='ankyo'&&(ankyoFilters.size>0||ankyoSpecialFilter)){
      const master=ankyoMaster[nm];
      let as='未登録';
      if(master){if(master.hasAnkyo==='なし')as='なし';else{const op=ankyoOpData[nm];as=(!op||op.status==='はめた')?'はめ済み':'外し済み';}}
      let match=ankyoFilters.size===0||ankyoFilters.has(as);
      if(ankyoSpecialFilter)match=match&&!!(master&&master.note);
      opacity=match?0.85:0.05;
    }else if(statusFilters.size>0&&(mode==='date'||mode==='status')){
      const r=records[nm];const st=r?r.status:'未記録';
      opacity=statusFilters.has(st)?0.85:0.05;
    }else if(alertFilters.size>0){opacity=matchesAlertFilter(nm)?0.85:0.05;}
    else if(selBlocks.size>0||selCrops.size>0){opacity=isHighlighted?0.85:0.18;}
  }
  // 田植後フィルター（最終判定）
  if(plantingFilter.active&&(mode==='date'||mode==='status')&&feat){
    if(!matchesPlantingFilter(feat.properties.field_id||''))opacity=0.05;
  }
  // 中干しフィルター（最終判定）
  if(kandoshiFilter.size>0&&(mode==='date'||mode==='status')&&feat){
    if(!matchesKandoshiFilter(feat.properties.name.trim()))opacity=0.05;
  }
  if(isSel||isCurrent)opacity=0.9;
  let color='#fff',weight=0.8;
  if(isSel){color='#000';weight=3.5;}
  else if(isCurrent){color='#000';weight=3.5;}
  else if((mode==='mizushi'||mode==='ankyo')&&modeFilterMatch===true){color='#2C4A1E';weight=2;}
  else if((mode==='date'||mode==='status')&&statusFilterMatch===true){color='#2C4A1E';weight=2;}
  else if(statusFilters.size>0&&statusFilterMatch===false){color='#fff';weight=0.8;}
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

    // [NEW] レイヤーは setStyle のみ（renderMap下部で計算後に実行）
    const layer=layers[nm];

    const blockCode=(feat.properties.field_id||'').replace(/-.*/, '');
    const cropName=(feat.properties.crop||'').trim();
    const inBlock=selBlocks.size===0||selBlocks.has(blockCode);
    const inCrop=cropMatchesFilter(cropName);
    const inPlanting=matchesPlantingFilter(feat.properties.field_id||'');
    const inKandoshi=matchesKandoshiFilter(feat.properties.name.trim());
    // 水状態フィルター判定
    let inStatusFilter=true;
    if(statusFilters.size>0&&(mode==='date'||mode==='status')){
      const r=records[nm];
      const st=r?r.status:'未記録';
      inStatusFilter=statusFilters.has(st);
    }
    // 水尻・暗渠フィルター判定（1回だけ計算してgetLayerStyleに渡す）
    let inModeFilter=true;
    if(mode==='mizushi'&&mizushiFilters.size>0){
      const m=mizushiData[nm];const ms=m?m.status:'未記録';
      inModeFilter=mizushiFilters.has(ms);
    }else if(mode==='ankyo'&&(ankyoFilters.size>0||ankyoSpecialFilter)){
      const master=ankyoMaster[nm];
      let as='未登録';
      if(master){if(master.hasAnkyo==='なし')as='なし';else{const op=ankyoOpData[nm];as=(!op||op.status==='はめた')?'はめ済み':'外し済み';}}
      inModeFilter=ankyoFilters.size===0||ankyoFilters.has(as);
      if(ankyoSpecialFilter)inModeFilter=inModeFilter&&!!(master&&master.note);
    }
    // setStyleにmodeFilterMatchを渡して二重計算を防ぐ
    const hasModeFilter=(mode==='mizushi'&&mizushiFilters.size>0)||(mode==='ankyo'&&(ankyoFilters.size>0||ankyoSpecialFilter));
    const hasStatusFilter=statusFilters.size>0&&(mode==='date'||mode==='status');
    if(layer)layer.setStyle(getLayerStyle(nm,feat,hasModeFilter?inModeFilter:undefined,hasStatusFilter?inStatusFilter:undefined));
    if(inBlock&&inCrop&&inModeFilter&&inStatusFilter&&inPlanting&&inKandoshi){
      filteredCount++;totalArea+=(parseFloat(feat.properties.area_a)||0);
      // フィルター表示中の圃場のみカウント
      if(col==='#e74c3c'&&mode==='date')a4++;
    }

    // [NEW] マーカーは着脱式（hasLayerチェック付き）
    const mk=markers[nm];
    if(!mk)return;
    let shouldShow=false;
    const parts=[];
    if(mode==='mizushi'||mode==='ankyo'){
      // 水尻・暗渠モード：通常アラートは非表示、暗渠特記事項のみ表示
      if(mode==='ankyo'){
        const master=ankyoMaster[nm];
        if(master&&master.note){
          parts.push('<span style="background:#e67e22;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;box-shadow:0 1px 3px rgba(0,0,0,0.4)">🔧</span>');
          shouldShow=true;
        }
      }
    }else{
      // 通常モード：草刈り・メモアラートを表示
      if(hasAlert(nm)&&(alertFilters.size===0||matchesAlertFilter(nm))){
        if(hasKusaAlert(nm))parts.push(getKusaIconHtml(nm));
        if(hasMemoAlert(nm))parts.push('<span style="font-size:14px;text-shadow:0 0 3px #fff">⚠️</span>');
        shouldShow=true;
      }
    }
    if(shouldShow){
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
  if(mode==='mizushi'){
    const cnt={設置済み:0,外し済み:0,未記録:0};
    GJ.features.forEach(f=>{
      const blockCode=(f.properties.field_id||'').replace(/-.*/, '');
      if(selBlocks.size>0&&!selBlocks.has(blockCode))return;
      const nm=f.properties.name.trim();
      const m=mizushiData[nm];
      if(!m)cnt['未記録']++;
      else if(m.status==='設置済み')cnt['設置済み']++;
      else if(m.status==='外し済み')cnt['外し済み']++;
      else cnt['未記録']++;
    });
    document.getElementById('summary').innerHTML=
      [{l:'設置済み',c:'#8e44ad',n:cnt['設置済み']},{l:'外し済み',c:'#e67e22',n:cnt['外し済み']},{l:'未記録',c:'#95a5a6',n:cnt['未記録']}]
      .filter(i=>i.n>0).map(i=>'<div class="sum-item"><div class="sum-dot" style="background:'+i.c+'"></div>'+i.l+' <span class="sum-num">'+i.n+'</span></div>').join('');
    return;
  }
  if(mode==='ankyo'){
    const cnt={はめ済み:0,外し済み:0,なし:0,未登録:0};
    GJ.features.forEach(f=>{
      const blockCode=(f.properties.field_id||'').replace(/-.*/, '');
      if(selBlocks.size>0&&!selBlocks.has(blockCode))return;
      const nm=f.properties.name.trim();
      const master=ankyoMaster[nm];
      if(!master){cnt['未登録']++;return;}
      if(master.hasAnkyo==='なし'){cnt['なし']++;return;}
      const op=ankyoOpData[nm];
      if(!op||op.status==='はめた')cnt['はめ済み']++;
      else cnt['外し済み']++;
    });
    document.getElementById('summary').innerHTML=
      [{l:'はめ済み',c:'#2980b9',n:cnt['はめ済み']},{l:'外し済み',c:'#e67e22',n:cnt['外し済み']},{l:'なし',c:'#27ae60',n:cnt['なし']},{l:'未登録',c:'#95a5a6',n:cnt['未登録']}]
      .filter(i=>i.n>0).map(i=>'<div class="sum-item"><div class="sum-dot" style="background:'+i.c+'"></div>'+i.l+' <span class="sum-num">'+i.n+'</span></div>').join('');
    return;
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
    if(r&&!herbActive(r)&&(Date.now()-new Date(r.time).getTime())/86400000>=alertDays)d4++;
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
  if(d4>0)items.push({l:'要確認('+alertDays+'日超)',c:'#e74c3c',n:d4});
  const filteredItems=items.filter(i=>i.n>0);
  document.getElementById('summary').innerHTML=filteredItems.map(i=>
    '<div class="sum-item"><div class="sum-dot" style="background:'+i.c+'"></div>'+i.l+' <span class="sum-num">'+i.n+'</span></div>'
  ).join('');
}

function setMode(m){
  mode=m;
  ['btn-date','btn-status','btn-mizushi','btn-ankyo'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.classList.toggle('active',id==='btn-'+m);
  });
  // 他モードのフィルターをクリーン（ゴースト干渉防止）
  if(m!=='date'&&m!=='status'){
    statusFilters.clear();
    document.querySelectorAll('[id^="sfc-"]').forEach(el=>el.classList.remove('on'));
    const sBtn=document.getElementById('status-filter-btn');if(sBtn){sBtn.textContent='💧 水状態 ▾';sBtn.classList.remove('filtered');}
    selCrops.clear();selCropMeta.clear();
    document.querySelectorAll('[id^="cgfc-"]').forEach(el=>el.classList.remove('on'));
    const cropBtn=document.getElementById('crop-toggle-btn');if(cropBtn){cropBtn.textContent='🌾 品種 ▾';cropBtn.classList.remove('filtered');}
    kandoshiFilter.clear();
    ['kdf-active','kdf-done'].forEach(id=>{const el=document.getElementById(id);if(el){const chk=el.querySelector('.fchk');if(chk)chk.classList.remove('on');}});
    const kBtn=document.getElementById('kandoshi-filter-btn');if(kBtn){kBtn.textContent='🌾 中干し ▾';kBtn.classList.remove('filtered');}
    alertFilters.clear();
    ['kusa_new','kusa_mid','kusa_old','memo'].forEach(t=>{const el=document.getElementById('afc-'+t);if(el)el.classList.remove('on');});
    const alertBtn=document.getElementById('alert-toggle-btn');if(alertBtn){alertBtn.textContent='🚨 アラート ▾';alertBtn.classList.remove('filtered');}
  }
  if(m!=='mizushi'){
    mizushiFilters.clear();
    ['設置済み','外し済み','未記録'].forEach(s=>{const el=document.getElementById('mfc-'+s);if(el)el.classList.remove('on');});
    const mizushiBtn=document.getElementById('mizushi-filter-btn');if(mizushiBtn){mizushiBtn.textContent='💧 水尻状態 ▾';mizushiBtn.classList.remove('filtered');}
  }
  if(m!=='ankyo'){
    ankyoFilters.clear();ankyoSpecialFilter=false;
    ['はめ済み','外し済み','なし','未登録'].forEach(s=>{const el=document.getElementById('akyfc-'+s);if(el)el.classList.remove('on');});
    const ankyoBtn=document.getElementById('ankyo-status-btn');if(ankyoBtn){ankyoBtn.textContent='🕳 暗渠状態 ▾';ankyoBtn.classList.remove('filtered');}
    const specBtn=document.getElementById('ankyo-special-btn');if(specBtn){specBtn.textContent='🔧 特記事項あり';specBtn.classList.remove('filtered');}
  }
  // モード別フィルター表示切り替え
  const isNormal=m!=='mizushi'&&m!=='ankyo';
  if(isNormal){buildStatusFilterMenu();}
  updateFilterVisibility();
  updateLegend();renderMap();
}
function updateLegend(){
  let legs;
  if(mode==='status'){
    legs=S_OPTS.filter(s=>s!=='確認のみ').map(s=>({c:S_COL[s]||'#115522',l:s}));
    legs.push({c:'#95a5a6',l:'未記録'});
  }else{
    legs=LEGS[mode]||LEGS['date'];
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
    // 写真サムネイル（未対応メモ）
    if(memo.photoId){
      const photoWrap=document.createElement('div');photoWrap.style.cssText='margin:6px 0;position:relative;';
      const photoThumb=document.createElement('img');
      photoThumb.src='https://drive.google.com/thumbnail?id='+memo.photoId+'&sz=w400';
      photoThumb.style.cssText='max-width:100%;border-radius:6px;cursor:pointer;display:block;';
      photoThumb.onerror=()=>{photoThumb.src='https://drive.google.com/uc?export=view&id='+memo.photoId;};
      const zoomHint=document.createElement('div');
      zoomHint.style.cssText='position:absolute;bottom:4px;right:4px;background:rgba(0,0,0,0.45);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px;pointer-events:none;';
      zoomHint.textContent='🔍 タップで拡大';
      photoThumb.addEventListener('click',()=>showPhotoLightbox(memo.photoId));
      photoWrap.appendChild(photoThumb);photoWrap.appendChild(zoomHint);
      photoWrap.appendChild(buildPhotoEditRow(nm,memo.time,'before'));
      metaDiv.appendChild(photoWrap);
    } else {
      // 写真未添付の場合：追加ボタンを表示
      const addPhotoWrap=document.createElement('div');addPhotoWrap.style.cssText='margin-top:6px;display:flex;gap:6px;';
      const addCameraBtn=document.createElement('button');addCameraBtn.className='sub-btn';
      addCameraBtn.textContent='📷 写真を追加';
      addCameraBtn.style.cssText='font-size:11px;padding:4px 10px;color:#888;border-color:#ddd;background:#fafafa;';
      const addLibraryBtn=document.createElement('button');addLibraryBtn.className='sub-btn';
      addLibraryBtn.textContent='🖼 ライブラリ';
      addLibraryBtn.style.cssText='font-size:11px;padding:4px 10px;color:#888;border-color:#ddd;background:#fafafa;';
      const addPhotoInputCamera=document.createElement('input');addPhotoInputCamera.type='file';addPhotoInputCamera.accept='image/*';addPhotoInputCamera.capture='environment';addPhotoInputCamera.style.display='none';
      const addPhotoInputLibrary=document.createElement('input');addPhotoInputLibrary.type='file';addPhotoInputLibrary.accept='image/*';addPhotoInputLibrary.style.display='none';
      async function handleAddPhoto(file){
        if(!file)return;
        addCameraBtn.disabled=true;addLibraryBtn.disabled=true;addCameraBtn.textContent='アップロード中...';
        try{
          const compressed=await compressImage(file,1200,0.82);
          const pr=await postToGAS({action:'photo_upload',base64:compressed.base64,mimeType:'image/jpeg'});
          if(!pr||!pr.fileId){showToast('⚠️ 写真のアップロードに失敗しました');addCameraBtn.disabled=false;addLibraryBtn.disabled=false;addCameraBtn.textContent='📷 写真を追加';return;}
          await postToGAS({action:'memo_add_photo',name:nm,memoTime:memo.time,photoId:pr.fileId});
          await loadRecords();updateMemoUI(nm);
        }catch(e){showToast('⚠️ 写真追加エラー：'+e.message);addCameraBtn.disabled=false;addLibraryBtn.disabled=false;addCameraBtn.textContent='📷 写真を追加';}
      }
      addCameraBtn.addEventListener('click',()=>addPhotoInputCamera.click());
      addLibraryBtn.addEventListener('click',()=>addPhotoInputLibrary.click());
      addPhotoInputCamera.addEventListener('change',async(e)=>{await handleAddPhoto(e.target.files[0]);e.target.value='';});
      addPhotoInputLibrary.addEventListener('change',async(e)=>{await handleAddPhoto(e.target.files[0]);e.target.value='';});
      addPhotoWrap.appendChild(addCameraBtn);addPhotoWrap.appendChild(addLibraryBtn);
      addPhotoWrap.appendChild(addPhotoInputCamera);addPhotoWrap.appendChild(addPhotoInputLibrary);
      metaDiv.appendChild(addPhotoWrap);
    }
    const btnRow=document.createElement('div');btnRow.style.cssText='display:flex;gap:6px;margin-top:6px;';
    const resolveBtn=document.createElement('button');resolveBtn.className='sub-btn memo-resolve-btn';
    resolveBtn.textContent='✅ 対応済み';resolveBtn.style.cssText='flex:1;background:#27ae60;color:#fff;border-color:#27ae60;font-weight:700;padding:7px;';
    resolveBtn.addEventListener('click',()=>showResolveDialog(nm,memo));
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
      row.innerHTML=html;
      // 登録時写真（before）
      if(h[7]){
        const photoId=h[7];
        const label=document.createElement('div');label.style.cssText='font-size:10px;color:#aaa;margin-top:5px;';label.textContent='📷 登録時の写真';
        const histThumb=document.createElement('img');
        histThumb.src='https://drive.google.com/thumbnail?id='+photoId+'&sz=w300';
        histThumb.style.cssText='max-width:100%;border-radius:6px;margin-top:3px;cursor:pointer;display:block;opacity:0.9;';
        histThumb.onerror=()=>{histThumb.src='https://drive.google.com/uc?export=view&id='+photoId;};
        histThumb.addEventListener('click',()=>showPhotoLightbox(photoId));
        row.appendChild(label);row.appendChild(histThumb);
        row.appendChild(buildPhotoEditRow(h[0],h[3],'before'));
      }
      // 対応済み写真（after）
      if(h[8]){
        const photoId=h[8];
        const label=document.createElement('div');label.style.cssText='font-size:10px;color:#27ae60;margin-top:6px;';label.textContent='✅ 対応後の写真';
        const histThumb=document.createElement('img');
        histThumb.src='https://drive.google.com/thumbnail?id='+photoId+'&sz=w300';
        histThumb.style.cssText='max-width:100%;border-radius:6px;border:1.5px solid #27ae60;margin-top:3px;cursor:pointer;display:block;';
        histThumb.onerror=()=>{histThumb.src='https://drive.google.com/uc?export=view&id='+photoId;};
        histThumb.addEventListener('click',()=>showPhotoLightbox(photoId));
        row.appendChild(label);row.appendChild(histThumb);
        row.appendChild(buildPhotoEditRow(h[0],h[3],'after'));
      } else if(h[4]==='対応済み'){
        // 対応済みで写真なし→後付け追加ボタン
        const addWrap=document.createElement('div');addWrap.style.cssText='display:flex;gap:6px;margin-top:6px;';
        const aCameraBtn=document.createElement('button');aCameraBtn.className='sub-btn';
        aCameraBtn.textContent='📷 対応写真を追加';aCameraBtn.style.cssText='font-size:11px;padding:4px 8px;color:#27ae60;border-color:#27ae60;background:#f0fff4;';
        const aLibraryBtn=document.createElement('button');aLibraryBtn.className='sub-btn';
        aLibraryBtn.textContent='🖼';aLibraryBtn.style.cssText='font-size:11px;padding:4px 8px;color:#27ae60;border-color:#27ae60;background:#f0fff4;';
        const aInputCamera=document.createElement('input');aInputCamera.type='file';aInputCamera.accept='image/*';aInputCamera.capture='environment';aInputCamera.style.display='none';
        const aInputLibrary=document.createElement('input');aInputLibrary.type='file';aInputLibrary.accept='image/*';aInputLibrary.style.display='none';
        const memoTime=h[3];const fieldName=h[0];
        async function handleAddResolvePhoto(file){
          if(!file)return;
          aCameraBtn.disabled=true;aLibraryBtn.disabled=true;aCameraBtn.textContent='アップロード中...';
          try{
            const compressed=await compressImage(file,1200,0.82);
            const pr=await postToGAS({action:'photo_upload',base64:compressed.base64,mimeType:'image/jpeg'});
            if(!pr||!pr.fileId){showToast('⚠️ 写真のアップロードに失敗しました');aCameraBtn.disabled=false;aLibraryBtn.disabled=false;aCameraBtn.textContent='📷 対応写真を追加';return;}
            await postToGAS({action:'memo_add_resolve_photo',name:fieldName,memoTime,photoId:pr.fileId});
            await loadRecords();updateMemoUI(nm);
          }catch(e){showToast('⚠️ 写真追加エラー：'+e.message);aCameraBtn.disabled=false;aLibraryBtn.disabled=false;aCameraBtn.textContent='📷 対応写真を追加';}
        }
        aCameraBtn.addEventListener('click',()=>aInputCamera.click());
        aLibraryBtn.addEventListener('click',()=>aInputLibrary.click());
        aInputCamera.addEventListener('change',async(e)=>{await handleAddResolvePhoto(e.target.files[0]);e.target.value='';});
        aInputLibrary.addEventListener('change',async(e)=>{await handleAddResolvePhoto(e.target.files[0]);e.target.value='';});
        addWrap.appendChild(aCameraBtn);addWrap.appendChild(aLibraryBtn);addWrap.appendChild(aInputCamera);addWrap.appendChild(aInputLibrary);
        row.appendChild(addWrap);
      }
      histWrap.appendChild(row);
    });
    toggle.addEventListener('click',()=>{open=!open;histWrap.style.display=open?'block':'none';toggle.textContent=(open?'▼':'▶')+' メモ履歴（'+hist.length+'件）';});
    list.appendChild(toggle);list.appendChild(histWrap);
  }
}

// 写真の差し替え・削除共通ヘルパー
// photoType: 'before'=登録時写真(col8) / 'after'=対応後写真(col9)
// file: Fileオブジェクト(差し替え) / null(削除)
async function updateMemoPhoto(nm, memoTime, photoType, file){
  const action = photoType==='before' ? 'memo_add_photo' : 'memo_add_resolve_photo';
  let photoId='';
  if(file){
    try{
      const compressed=await compressImage(file,1200,0.82);
      const pr=await postToGAS({action:'photo_upload',base64:compressed.base64,mimeType:'image/jpeg'});
      if(!pr||!pr.fileId){showToast('⚠️ 写真のアップロードに失敗しました');return;}
      photoId=pr.fileId;
    }catch(e){showToast('⚠️ 写真アップロードエラー：'+e.message);return;}
  }
  try{
    await postToGAS({action,name:nm,memoTime,photoId});
    await loadRecords();updateMemoUI(nm);
  }catch(e){showToast('⚠️ 写真の更新に失敗しました');}
}

// 写真編集ボタン行を生成するヘルパー
function buildPhotoEditRow(nm, memoTime, photoType){
  const row=document.createElement('div');row.style.cssText='display:flex;gap:6px;margin-top:4px;';
  const input=document.createElement('input');input.type='file';input.accept='image/*';input.style.display='none';
  const repBtn=document.createElement('button');repBtn.className='sub-btn';
  repBtn.textContent='🔄 差し替え';repBtn.style.cssText='font-size:10px;padding:3px 8px;color:#3498db;border-color:#3498db;background:#eaf4fb;';
  const delBtn=document.createElement('button');delBtn.className='sub-btn';
  delBtn.textContent='🗑 削除';delBtn.style.cssText='font-size:10px;padding:3px 8px;color:#e74c3c;border-color:#e74c3c;background:#fdf0f0;';
  repBtn.addEventListener('click',()=>input.click());
  input.addEventListener('change',async(e)=>{
    const f=e.target.files[0];e.target.value='';if(!f)return;
    repBtn.disabled=true;delBtn.disabled=true;repBtn.textContent='処理中...';
    await updateMemoPhoto(nm,memoTime,photoType,f);
  });
  delBtn.addEventListener('click',async()=>{
    if(!confirm('写真を削除します。よろしいですか？'))return;
    delBtn.disabled=true;delBtn.textContent='削除中...';
    await updateMemoPhoto(nm,memoTime,photoType,null);
  });
  row.appendChild(repBtn);row.appendChild(delBtn);row.appendChild(input);
  return row;
}

// 対応済みダイアログ（写真添付オプション付き）
function showResolveDialog(nm, memo){
  const dlg=document.createElement('div');
  dlg.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.55);z-index:99998;display:flex;align-items:flex-end;justify-content:center;';
  const sheet=document.createElement('div');
  sheet.style.cssText='background:#fff;border-radius:16px 16px 0 0;padding:20px 16px 32px;width:100%;max-width:520px;';

  // タイトル
  const title=document.createElement('div');
  title.style.cssText='font-size:14px;font-weight:700;color:#1a1a2e;margin-bottom:4px;';
  title.textContent='✅ 対応済みにする';
  const sub=document.createElement('div');
  sub.style.cssText='font-size:12px;color:#888;margin-bottom:16px;border-bottom:1px solid #eee;padding-bottom:12px;';
  sub.textContent='「'+memo.content+'」';

  // 写真プレビュー（選択後に表示）
  const previewWrap=document.createElement('div');previewWrap.style.cssText='display:none;margin-bottom:12px;position:relative;';
  const previewImg=document.createElement('img');previewImg.style.cssText='max-width:100%;border-radius:8px;border:2px solid #27ae60;display:block;';
  const previewRemove=document.createElement('button');previewRemove.textContent='✕ 写真を外す';
  previewRemove.style.cssText='margin-top:6px;font-size:11px;color:#e74c3c;border:none;background:none;cursor:pointer;padding:0;';
  previewRemove.addEventListener('click',()=>{selectedPhotoBase64=null;selectedPhotoMimeType=null;previewImg.src='';previewWrap.style.display='none';cameraBtn.style.display='';libraryBtn.style.display='';});
  previewWrap.appendChild(previewImg);previewWrap.appendChild(previewRemove);

  let selectedPhotoBase64=null,selectedPhotoMimeType=null;
  async function handleFile(file){
    if(!file)return;
    cameraBtn.disabled=true;libraryBtn.disabled=true;cameraBtn.textContent='処理中...';
    const compressed=await compressImage(file,1200,0.82);
    selectedPhotoBase64=compressed.base64;selectedPhotoMimeType=compressed.mimeType;
    previewImg.src='data:image/jpeg;base64,'+compressed.base64;
    previewWrap.style.display='block';
    cameraBtn.style.display='none';libraryBtn.style.display='none';
    cameraBtn.disabled=false;libraryBtn.disabled=false;cameraBtn.textContent='📷 カメラ';
  }

  // 写真ボタン
  const photoRow=document.createElement('div');photoRow.style.cssText='display:flex;gap:8px;margin-bottom:12px;';
  const cameraBtn=document.createElement('button');cameraBtn.className='sub-btn';
  cameraBtn.textContent='📷 カメラ';cameraBtn.style.cssText='flex:1;padding:10px;font-size:13px;';
  const libraryBtn=document.createElement('button');libraryBtn.className='sub-btn';
  libraryBtn.textContent='🖼 ライブラリ';libraryBtn.style.cssText='flex:1;padding:10px;font-size:13px;';
  const inputCamera=document.createElement('input');inputCamera.type='file';inputCamera.accept='image/*';inputCamera.capture='environment';inputCamera.style.display='none';
  const inputLibrary=document.createElement('input');inputLibrary.type='file';inputLibrary.accept='image/*';inputLibrary.style.display='none';
  cameraBtn.addEventListener('click',()=>inputCamera.click());
  libraryBtn.addEventListener('click',()=>inputLibrary.click());
  inputCamera.addEventListener('change',async(e)=>{await handleFile(e.target.files[0]);e.target.value='';});
  inputLibrary.addEventListener('change',async(e)=>{await handleFile(e.target.files[0]);e.target.value='';});
  photoRow.appendChild(cameraBtn);photoRow.appendChild(libraryBtn);
  photoRow.appendChild(inputCamera);photoRow.appendChild(inputLibrary);

  // 対応済みボタン
  const confirmBtn=document.createElement('button');
  confirmBtn.style.cssText='width:100%;padding:13px;background:#27ae60;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:8px;';
  confirmBtn.textContent='✅ 対応済みにする';
  confirmBtn.addEventListener('click',async()=>{
    confirmBtn.disabled=true;confirmBtn.textContent='送信中...';
    dlg.remove();
    await resolveMemo(nm,memo.time,selectedPhotoBase64,selectedPhotoMimeType);
  });

  // キャンセル
  const cancelBtn=document.createElement('button');
  cancelBtn.style.cssText='width:100%;padding:10px;background:#f5f5f5;border:none;border-radius:10px;font-size:13px;cursor:pointer;color:#666;';
  cancelBtn.textContent='キャンセル';
  cancelBtn.addEventListener('click',()=>dlg.remove());
  dlg.addEventListener('click',(e)=>{if(e.target===dlg)dlg.remove();});

  sheet.appendChild(title);sheet.appendChild(sub);sheet.appendChild(previewWrap);sheet.appendChild(photoRow);sheet.appendChild(confirmBtn);sheet.appendChild(cancelBtn);
  dlg.appendChild(sheet);document.body.appendChild(dlg);
}

async function resolveMemo(nm,memoTime,resolvePhotoBase64,resolvePhotoMimeType){
  if(!curUser){const n=prompt('担当者名を入力してください');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
  const memos=memoData[nm]||[];
  const target=memos.find(m=>Math.abs(new Date(m.time).getTime()-new Date(memoTime).getTime())<1000);
  if(!target)return;
  try{
    let resolvePhotoId='';
    if(resolvePhotoBase64){
      const pr=await postToGAS({action:'photo_upload',base64:resolvePhotoBase64,mimeType:resolvePhotoMimeType||'image/jpeg'});
      if(pr&&pr.fileId)resolvePhotoId=pr.fileId;
      else showToast('⚠️ 対応写真のアップロードに失敗しました。対応済みは記録します。');
    }
    await postToGAS({action:'memo_resolve',name:nm,person:curUser,memoTime,resolvePhotoId});
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
  const canSave=!!(selStatus||pendingKusa||hasMemoText||hasBulkMemo);
  btn.disabled=!canSave;
  // カメレオン化：選択した水状態に応じてボタンの色・テキストを変更
  if(selStatus&&selStatus!=='確認のみ'){
    const col=S_COL[selStatus]||'#2C4A1E';
    btn.style.background=col;btn.style.borderColor=col;btn.style.color='#fff';
    btn.textContent='✓ '+selStatus+'を記録する';
  }else if(selStatus==='確認のみ'){
    btn.style.background='#95a5a6';btn.style.borderColor='#95a5a6';btn.style.color='#fff';
    btn.textContent='✓ 確認のみ記録する';
  }else{
    btn.style.background='';btn.style.borderColor='';btn.style.color='';
    btn.textContent='記録する';
  }
}

function getPlantingInfoHtml(fieldId){
  const info=plantingDates[fieldId];
  if(!info||!info.date)return '';
  // YYYY/MM/DD・YYYY-MM-DD どちらの形式でも対応
  const d=new Date(info.date.replace(/-/g,'/'));
  if(isNaN(d.getTime()))return '';
  const days=Math.floor((Date.now()-d.getTime())/86400000);
  const dateLabel=(d.getMonth()+1)+'月'+d.getDate()+'日';
  return '🌱 '+info.type+'後 '+days+'日目（'+dateLabel+' '+info.type+'）';
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
  // 田植日表示
  const ptEl=document.getElementById('planting-info');
  if(ptEl){const ptText=getPlantingInfoHtml(p.field_id);ptEl.textContent=ptText;ptEl.style.display=ptText?'block':'none';}
  // 中干し表示
  const kdEl=document.getElementById('kandoshi-info');
  if(kdEl){const kdText=getKandoshiHtml(p.name.trim());kdEl.textContent=kdText;kdEl.style.display=kdText?'block':'none';}
  document.getElementById('kusa-section').style.display='none';
  document.getElementById('task-section').style.display='none';
  // バッジボタンの状態をリセット
  const kusaBadge=document.getElementById('kusa-badge-btn');
  const memoBadge=document.getElementById('memo-badge-btn');
  if(kusaBadge)kusaBadge.classList.remove('active');
  if(memoBadge)memoBadge.classList.remove('active');
  // アラートがある場合は自動展開
  const fieldNm=feat.properties.name.trim();
  if(hasKusaAlert(fieldNm)){
    document.getElementById('kusa-section').style.display='block';
    if(kusaBadge){kusaBadge.classList.add('active');kusaBadge.style.background='#27ae60';kusaBadge.style.color='#fff';}
  }
  if(hasMemoAlert(fieldNm)){
    document.getElementById('task-section').style.display='block';
    if(memoBadge){memoBadge.classList.add('active');memoBadge.style.background='#e67e22';memoBadge.style.color='#fff';}
  }
  document.getElementById('bulk-extra').innerHTML='';
  updateKusaUI(p.name.trim());
  updateMemoUI(p.name.trim());
  const sg=document.getElementById('sgrid');sg.innerHTML='';
  const hasRecord=!!records[p.name.trim()];
  S_OPTS.forEach(s=>{
    const b=document.createElement('button');b.className='sbtn s'+s;b.textContent=s;
    b.style.setProperty('--c',S_COL[s]||'#115522');
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
  setTimeout(()=>{focusOnFeature(feat);},50);
  // 選択圃場を即時ハイライト
  const selNm=feat.properties.name.trim();
  if(layers[selNm])layers[selNm].setStyle(getLayerStyle(selNm,feat));
  if(layers[selNm])layers[selNm].bringToFront();
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
    const tmp=document.createElement('button');tmp.id='tmp-edit-btn';
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
  const tmpBtn=document.getElementById('tmp-edit-btn');if(tmpBtn)tmpBtn.remove();
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
  const ptEl2=document.getElementById('planting-info');if(ptEl2)ptEl2.style.display='none';
  const kdEl2=document.getElementById('kandoshi-info');if(kdEl2)kdEl2.style.display='none';
  exitEditMode();
  // ハイライト解除
  const prevField=selField;
  selField=null; // 先にnullにしてからsetStyle（ハイライト解除のため）
  if(prevField){const nm=prevField.properties.name.trim();const feat=fieldFeatureMap.get(nm);if(layers[nm]&&feat)layers[nm].setStyle(getLayerStyle(nm,feat));}
  pendingKusa=null;singleSaved=false;bulkKusaSaved=false;
  pendingPhotoBase64=null;pendingPhotoMimeType=null;pendingPhotoFileId=null;
  const prevWrap=document.getElementById('photo-preview-wrap');if(prevWrap){prevWrap.style.display='none';}
  const prevImg=document.getElementById('photo-preview');if(prevImg){prevImg.src='';}
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

// 写真ライトボックス（タップで拡大・ピンチズーム対応）
function showPhotoLightbox(fileId){
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;';
  const img=document.createElement('img');
  img.src='https://drive.google.com/uc?export=view&id='+fileId;
  img.style.cssText='max-width:100%;max-height:90vh;object-fit:contain;touch-action:pan-x pan-y pinch-zoom;border-radius:6px;';
  img.onerror=()=>{img.src='https://drive.google.com/thumbnail?id='+fileId+'&sz=w800';};
  const closeBtn=document.createElement('button');
  closeBtn.textContent='✕';
  closeBtn.style.cssText='position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.2);color:#fff;border:none;border-radius:50%;width:40px;height:40px;font-size:20px;cursor:pointer;z-index:100000;';
  closeBtn.addEventListener('click',()=>ov.remove());
  ov.addEventListener('click',(e)=>{if(e.target===ov)ov.remove();});
  ov.appendChild(img);ov.appendChild(closeBtn);
  document.body.appendChild(ov);
}

// 写真圧縮（Canvas APIで長辺1200px・JPEG変換）
function compressImage(file,maxSize,quality){
  return new Promise((resolve)=>{
    const img=new Image();
    const reader=new FileReader();
    reader.onload=(e)=>{
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(w>maxSize||h>maxSize){
          if(w>h){h=Math.round(h*maxSize/w);w=maxSize;}
          else{w=Math.round(w*maxSize/h);h=maxSize;}
        }
        const canvas=document.createElement('canvas');
        canvas.width=w;canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        const dataUrl=canvas.toDataURL('image/jpeg',quality);
        resolve({base64:dataUrl.split(',')[1],mimeType:'image/jpeg'});
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
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
    if(r.mizushi&&typeof r.mizushi==='object')mizushiData=r.mizushi;
    if(r.ankyoMaster&&typeof r.ankyoMaster==='object')ankyoMaster=r.ankyoMaster;
    if(r.ankyoOp&&typeof r.ankyoOp==='object')ankyoOpData=r.ankyoOp;
    if(r.plantingDates&&typeof r.plantingDates==='object')plantingDates=r.plantingDates;
    // [NEW] 設定シートから水管理項目を反映
    if(r.settings&&r.settings.kandoshi_days&&typeof r.settings.kandoshi_days==='object')kandoshiDays=r.settings.kandoshi_days;
    if(r.settings&&typeof r.settings.herb_hours==='number')herbHours=r.settings.herb_hours;
    if(r.settings&&typeof r.settings.alert_days==='number')alertDays=r.settings.alert_days;
    if(r.settings&&Array.isArray(r.settings.notify_times))window._notifyTimes=r.settings.notify_times;
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
  // 中干しインデックス構築
  buildNakaboshiIndex();
  renderMap();
  document.getElementById('last-update').textContent=new Date().toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'})+'更新';
  // フィルターメニューを再構築（S_OPTSの更新・件数変化に対応）
  buildStatusFilterMenu();
  buildAlertFilterMenu();
  buildMizushiFilterMenu();
  buildAnkyoFilterMenu();
  // 初回のみフィルターラップを表示
  const sfw=document.getElementById('status-filter-wrap');
  if(sfw&&(mode==='date'||mode==='status'))sfw.style.display='';
}
function changeUser(){const n=prompt('担当者名を入力してください',curUser);if(n!==null){curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n||'未設定';}}

document.addEventListener('DOMContentLoaded',()=>{
  const searchInput=document.getElementById('search-input');
  const searchResults=document.getElementById('search-results');
  function normalizeForSearch(str){
    return str
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)) // 全角英数→半角
      .replace(/[（）「」【】『』〔〕]/g,c=>({'（':'(','）':')','「':'[','」':']','【':'[','】':']','『':'[','』':']','〔':'[','〕':']'}[c]||c)) // 全角括弧→半角
      .toLowerCase();
  }
  searchInput.addEventListener('input',()=>{
    const q=searchInput.value.trim();
    if(!q){searchResults.classList.remove('open');searchResults.innerHTML='';return;}
    // スペース区切りで複数キーワードAND検索
    const terms=normalizeForSearch(q).split(/[\s　]+/).filter(Boolean);
    const hits=GJ?GJ.features.filter(f=>{
      const name=normalizeForSearch(f.properties.name||'');
      const fid=normalizeForSearch(f.properties.field_id||'');
      const block=normalizeForSearch(f.properties.block||'');
      // 全タームが名前・圃場ID・ブロック名のいずれかにマッチすればOK
      return terms.every(t=>name.includes(t)||fid.includes(t)||block.includes(t));
    }).slice(0,10):[];
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

  // 写真ボタン（カメラ・ライブラリ）
  async function handlePhotoFile(file){
    if(!file)return;
    const compressed=await compressImage(file,1200,0.82);
    pendingPhotoBase64=compressed.base64;
    pendingPhotoMimeType=compressed.mimeType;
    pendingPhotoFileId=null;
    document.getElementById('photo-preview').src='data:image/jpeg;base64,'+compressed.base64;
    document.getElementById('photo-preview-wrap').style.display='block';
    singleSaved=false;updateSaveBtnState();
  }
  document.getElementById('photo-camera-btn').addEventListener('click',()=>document.getElementById('photo-input-camera').click());
  document.getElementById('photo-library-btn').addEventListener('click',()=>document.getElementById('photo-input-library').click());
  document.getElementById('photo-input-camera').addEventListener('change',async(e)=>{await handlePhotoFile(e.target.files[0]);e.target.value='';});
  document.getElementById('photo-input-library').addEventListener('change',async(e)=>{await handlePhotoFile(e.target.files[0]);e.target.value='';});
  document.getElementById('photo-remove-btn').addEventListener('click',()=>{
    pendingPhotoBase64=null;pendingPhotoMimeType=null;pendingPhotoFileId=null;
    document.getElementById('photo-preview-wrap').style.display='none';
    document.getElementById('photo-preview').src='';
  });

  document.getElementById('savebtn').addEventListener('click',async()=>{
    // 一括処理を最優先で判定（早期returnより前に置く）
    // 水尻一括
    if(mode==='mizushi'&&multiSelected.size>0&&selField===null){
      if(!selStatus)return;
      setButtonLoading('savebtn',true);
      if(!curUser){const n=prompt('担当者名を入力してください');if(!n){setButtonLoading('savebtn',false,'記録する');return;}curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
      const time=getSelectedTime();
      try{
        if(!bulkStatusSaved){
          await postToGAS({action:'mizushi_bulk',names:[...multiSelected],status:selStatus,person:curUser,time});
          bulkStatusSaved=true;
        }
        await loadRecords();
        bulkStatusSaved=false;
      }catch(e){alert('保存に失敗しました');setButtonLoading('savebtn',false,'記録する');return;}
      setButtonLoading('savebtn',false,'記録する');clearMultiSelect();closePanel();renderMap();showToast('✅ 一括記録を保存しました');return;
    }
    // 暗渠一括
    if(mode==='ankyo'&&multiSelected.size>0&&selField===null){
      if(!selStatus)return;
      setButtonLoading('savebtn',true);
      if(!curUser){const n=prompt('担当者名を入力してください');if(!n){setButtonLoading('savebtn',false,'記録する');return;}curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
      const time=getSelectedTime();
      try{
        if(!bulkStatusSaved){
          await postToGAS({action:'ankyo_operation_bulk',names:[...multiSelected],status:selStatus,person:curUser,time});
          bulkStatusSaved=true;
        }
        await loadRecords();
        bulkStatusSaved=false;
      }catch(e){alert('保存に失敗しました');setButtonLoading('savebtn',false,'記録する');return;}
      setButtonLoading('savebtn',false,'記録する');clearMultiSelect();closePanel();renderMap();showToast('✅ 一括記録を保存しました');return;
    }
    // 水尻・暗渠単件処理（一括判定をすり抜けた場合）
    if(mode==='mizushi'||mode==='ankyo'){await saveMizushiOrAnkyo();return;}

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
          // 中干し→水尻外し連動（一括）
          if(selStatus==='中干し'){
            const doMizushi=confirm(targets.length+'枚を「中干し」で記録します。\nあわせて水尻を「外し済み」にしますか？');
            if(doMizushi){
              await postToGAS({action:'mizushi_bulk',names:targets,status:'外し済み',person:curUser,time});
            }
          }
          // 入水/ちょい入れ → 中干し終了 → 水尻設置ダイアログ（一括）
          if(selStatus==='入水'||selStatus==='ちょい入れ'){
            const kdTargets=targets.filter(nm=>nakaboshiIndex[nm]&&nakaboshiIndex[nm].end===null);
            if(kdTargets.length>0){
              const doSet=confirm(kdTargets.length+'枚が中干し終了です。\nあわせて水尻を「設置済み」にしますか？');
              if(doSet){
                await postToGAS({action:'mizushi_bulk',names:kdTargets,status:'設置済み',person:curUser,time});
              }
            }
          }
          bulkStatusSaved=true;
        }
        if(bulkMemoText&&!bulkMemoSaved){
          await postToGAS({action:'memo_bulk',names:targets,content:bulkMemoText,person:curUser,time});
          bulkMemoSaved=true;
        }
        await loadRecords();
        bulkStatusSaved=false;bulkMemoSaved=false;
      }catch(e){alert('保存に失敗しました。電波の良い場所で再度「記録する」を押してください。');setButtonLoading('savebtn',false,'記録する');return;}
      setButtonLoading('savebtn',false,'記録する');clearMultiSelect();closePanel();renderMap();showToast('✅ 一括記録を保存しました');return;
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
    if(hasMemoToAdd){
      // 写真がある場合はまず写真をアップロード（初回のみ）
      let photoId=pendingPhotoFileId||'';
      if(pendingPhotoBase64&&!pendingPhotoFileId){
        try{
          const pr=await postToGAS({action:'photo_upload',base64:pendingPhotoBase64,mimeType:pendingPhotoMimeType||'image/jpeg'});
          if(pr&&pr.fileId){photoId=pr.fileId;pendingPhotoFileId=pr.fileId;}
          else{showToast('⚠️ 写真のアップロードに失敗（'+(pr&&pr.error||'不明')+'）メモは保存します');}
        }catch(e){showToast('⚠️ 写真アップロードエラー：'+e.message);}
      }
      payload.memo={content:memoText,photoId};
    }

    // 中干し→水尻外し連動
    let mizushiWithKandoshi=false;
    if(waterNewS==='中干し'){
      mizushiWithKandoshi=confirm('あわせて水尻を「外し済み」にしますか？');
    }
    // 入水/ちょい入れ → 中干し終了 → 水尻設置ダイアログ
    let mizushiSetWithNyusui=false;
    if((waterNewS==='入水'||waterNewS==='ちょい入れ')&&nakaboshiIndex[nm]&&nakaboshiIndex[nm].end===null){
      mizushiSetWithNyusui=confirm('中干し終了です。あわせて水尻を「設置済み」にしますか？');
    }
    try{
      if(!singleSaved){
        await postToGAS(payload);
        if(mizushiWithKandoshi){
          await postToGAS({action:'mizushi_save',name:nm,status:'外し済み',person:curUser,time});
        }
        if(mizushiSetWithNyusui){
          await postToGAS({action:'mizushi_save',name:nm,status:'設置済み',person:curUser,time});
        }
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
    showToast('✅ 記録を保存しました');
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
    setButtonLoading('edit-savebtn',false,'✏ 修正を保存');closePanel();showToast('✅ 修正を保存しました');
  });
  document.getElementById('overlay').addEventListener('click',()=>closePanel());
  document.getElementById('ulabel').textContent=curUser||'未設定';
  init();
});

// ============================================================
// [NEW] 管理者機能
// ============================================================

// 管理者ログイン

// ============================================================
// 個人設定：読み書き
// ============================================================
function loadPersonalSettings(){
  try{
    const raw=localStorage.getItem('osf_personal_settings');
    if(!raw)return JSON.parse(JSON.stringify(DEFAULT_PERSONAL));
    const saved=JSON.parse(raw);
    const result=JSON.parse(JSON.stringify(DEFAULT_PERSONAL));
    if(saved.filterOrder)result.filterOrder=saved.filterOrder;
    if(saved.filterVisible)Object.assign(result.filterVisible,saved.filterVisible);
    if(saved.defaultMode)result.defaultMode=saved.defaultMode;
    if(saved.plantingDefault)Object.assign(result.plantingDefault,saved.plantingDefault);
    return result;
  }catch(e){return JSON.parse(JSON.stringify(DEFAULT_PERSONAL));}
}
function savePersonalSettings(){
  localStorage.setItem('osf_personal_settings',JSON.stringify(personalSettings));
}

// ============================================================
// 右上コントロール動的生成
// ============================================================
function buildRightControls(){
  const container=document.getElementById('dynamic-filters');
  if(!container)return;
  container.innerHTML='';
  personalSettings.filterOrder.forEach(id=>{
    const def=FILTER_DEFS.find(d=>d.id===id);
    if(!def)return;
    const wrap=document.createElement('div');
    wrap.id='fw-'+id;
    wrap.style.cssText='position:relative;display:none;';
    if(id==='block'){
      wrap.innerHTML='<button class="filter-toggle" id="block-toggle-btn" onclick="toggleDropdown(\'block\')">🗂 ブロック ▾</button>'
        +'<div class="filter-dropdown" id="block-menu"><div id="block-options"></div><div class="filter-reset" onclick="resetFilter(\'block\')">✕ すべて表示にリセット</div></div>';
    }else if(id==='planting'){
      const pd=personalSettings.plantingDefault;
      wrap.innerHTML='<button class="filter-toggle" id="planting-filter-btn" onclick="toggleDropdown(\'planting\')">🌱 田植後 ▾</button>'
        +'<div class="filter-dropdown" id="planting-menu" style="padding:12px 14px;min-width:230px;">'
        +'<div style="font-size:11px;color:#666;margin-bottom:8px;">移植後・播種後の経過日数で絞り込み</div>'
        +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">'
        +'<input type="number" id="pt-min" min="0" max="365" value="'+pd.minDays+'" style="width:52px;padding:5px;border:1.5px solid #ddd;border-radius:6px;font-size:14px;text-align:center;">'
        +'<span style="font-size:12px;color:#666;">〜</span>'
        +'<input type="number" id="pt-max" min="0" max="365" value="'+pd.maxDays+'" style="width:52px;padding:5px;border:1.5px solid #ddd;border-radius:6px;font-size:14px;text-align:center;">'
        +'<span style="font-size:12px;color:#666;">日目</span></div>'
        +'<div style="display:flex;gap:14px;margin-bottom:12px;flex-wrap:wrap;">'
        +'<label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="radio" name="pt-type" value="all"'+(pd.type==='all'?' checked':'')+'>全種別</label>'
        +'<label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="radio" name="pt-type" value="移植"'+(pd.type==='移植'?' checked':'')+'>移植のみ</label>'
        +'<label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="radio" name="pt-type" value="播種"'+(pd.type==='播種'?' checked':'')+'>播種のみ</label></div>'
        +'<div style="display:flex;gap:8px;">'
        +'<button onclick="applyPlantingFilter()" style="flex:1;padding:8px;background:#2C4A1E;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">適用</button>'
        +'<button onclick="clearPlantingFilter()" style="flex:1;padding:8px;background:#f5f5f5;color:#666;border:1px solid #ddd;border-radius:8px;font-size:12px;cursor:pointer;">クリア</button>'
        +'</div></div>';
    }else if(id==='alert'){
      wrap.innerHTML='<button class="filter-toggle" id="alert-toggle-btn" onclick="toggleDropdown(\'alert\')">🚨 アラート ▾</button>'
        +'<div class="filter-dropdown" id="alert-menu"></div>';
    }else if(id==='status_filter'){
      wrap.innerHTML='<button class="filter-toggle" id="status-filter-btn" onclick="toggleDropdown(\'status_filter\')">💧 水状態 ▾</button>'
        +'<div class="filter-dropdown" id="status-filter-menu"></div>';
    }else if(id==='kandoshi'){
      wrap.innerHTML='<button class="filter-toggle" id="kandoshi-filter-btn" onclick="toggleDropdown(\'kandoshi\')">🌾 中干し ▾</button>'
        +'<div class="filter-dropdown" id="kandoshi-menu" style="min-width:170px;">'
        +'<div class="fopt" id="kdf-active" onclick="toggleKandoshiFilter(\'active\')" style="display:flex;align-items:center;"><div class="fchk" id="kdfchk-active"></div><span style="margin-left:8px;">中干し中</span></div>'
        +'<div class="fopt" id="kdf-done" onclick="toggleKandoshiFilter(\'done\')" style="display:flex;align-items:center;"><div class="fchk" id="kdfchk-done"></div><span style="margin-left:8px;">終了済み</span></div>'
        +'<div class="filter-reset" onclick="clearKandoshiFilter()">✕ リセット</div>'
        +'</div>';
    }else if(id==='crop'){
      wrap.innerHTML='<button class="filter-toggle" id="crop-toggle-btn" onclick="toggleDropdown(\'crop\')">🌾 品種 ▾</button>'
        +'<div class="filter-dropdown" id="crop-menu"><div id="crop-options"></div><div class="filter-reset" onclick="resetFilter(\'crop\')">✕ すべて表示にリセット</div></div>';
    }
    container.appendChild(wrap);
  });
  updateFilterVisibility();
}

function updateFilterVisibility(){
  if(!personalSettings)return;
  const isMizushi=mode==='mizushi';
  const isAnkyo=mode==='ankyo';
  personalSettings.filterOrder.forEach(id=>{
    const def=FILTER_DEFS.find(d=>d.id===id);
    if(!def)return;
    const wrap=document.getElementById('fw-'+id);
    if(!wrap)return;
    const modeOk=def.modes.includes(mode);
    const visOk=!!personalSettings.filterVisible[id];
    wrap.style.display=(modeOk&&visOk)?'':'none';
  });
  const mw=document.getElementById('mizushi-filter-wrap');
  const aw=document.getElementById('ankyo-filter-wrap');
  const asw=document.getElementById('ankyo-special-wrap');
  if(mw)mw.style.display=isMizushi?'':'none';
  if(aw)aw.style.display=isAnkyo?'':'none';
  if(asw)asw.style.display=isAnkyo?'':'none';
}

// ============================================================
// 田植後フィルター
// ============================================================
function matchesPlantingFilter(fieldId){
  if(!plantingFilter.active)return true;
  if(mode!=='date'&&mode!=='status')return true;
  const info=plantingDates[fieldId];
  if(!info)return false;
  const days=Math.floor((Date.now()-new Date(info.date).getTime())/86400000);
  if(days<plantingFilter.minDays||days>plantingFilter.maxDays)return false;
  if(plantingFilter.type!=='all'&&info.type!==plantingFilter.type)return false;
  return true;
}

// ============================================================
// 中干し機能
// ============================================================
function buildNakaboshiIndex(){
  nakaboshiIndex={};
  // allHist: [name, status, person, memo, time] - 時系列昇順でソート
  const sorted=[...allHist].sort((a,b)=>new Date(a[4])-new Date(b[4]));
  sorted.forEach(([name,status,,,time])=>{
    if(status==='中干し'){
      // 最新の中干しで上書き（複数回は想定外だが念のため）
      nakaboshiIndex[name]={start:time,end:null};
    }else if(nakaboshiIndex[name]&&nakaboshiIndex[name].end===null){
      if(status==='入水'||status==='ちょい入れ'){
        nakaboshiIndex[name].end=time;
      }
    }
  });
}

function getKandoshiTargetDays(fieldName){
  const feat=fieldFeatureMap.get(fieldName);
  if(!feat)return kandoshiDays['default']||7;
  const crop=normalizeCropName((feat.properties.crop||'').trim());
  const group=getCropGroup(crop).key;
  return kandoshiDays[group]||kandoshiDays['default']||7;
}

function getKandoshiHtml(fieldName){
  const info=nakaboshiIndex[fieldName];
  if(!info)return '';
  const startDate=new Date(info.start);
  if(info.end===null){
    // 中干し中
    const days=Math.floor((Date.now()-startDate.getTime())/86400000);
    const target=getKandoshiTargetDays(fieldName);
    const rem=target-days;
    let sub='';
    if(rem>0)sub='（目安まであと'+rem+'日）';
    else if(rem===0)sub='（⚠️ 目安に達しました）';
    else sub='（⚠️ 目安を'+Math.abs(rem)+'日超過）';
    return '🌾 中干し '+days+'日目'+sub;
  }else{
    // 終了後
    const endDate=new Date(info.end);
    const days=Math.floor((endDate.getTime()-startDate.getTime())/86400000);
    const s=(startDate.getMonth()+1)+'/'+(startDate.getDate());
    const e=(endDate.getMonth()+1)+'/'+(endDate.getDate());
    return '🌾 中干し '+days+'日で終了（'+s+'〜'+e+'）';
  }
}

function matchesKandoshiFilter(fieldName){
  if(kandoshiFilter.size===0)return true;
  if(mode!=='date'&&mode!=='status')return true;
  const info=nakaboshiIndex[fieldName];
  if(!info)return false;
  if(kandoshiFilter.has('active')&&info.end===null)return true;
  if(kandoshiFilter.has('done')&&info.end!==null)return true;
  return false;
}

function toggleKandoshiFilter(type){
  kandoshiFilter.has(type)?kandoshiFilter.delete(type):kandoshiFilter.add(type);
  const chkEl=document.getElementById('kdfchk-'+type);
  if(chkEl)chkEl.classList.toggle('on',kandoshiFilter.has(type));
  const btn=document.getElementById('kandoshi-filter-btn');
  if(btn){
    if(kandoshiFilter.size===0){btn.textContent='🌾 中干し ▾';btn.classList.remove('filtered');}
    else{
      const labels=[];
      if(kandoshiFilter.has('active'))labels.push('中干し中');
      if(kandoshiFilter.has('done'))labels.push('終了済み');
      btn.textContent='🌾 '+labels.join('・')+' ▾';
      btn.classList.add('filtered');
    }
  }
  renderMap();
}

function clearKandoshiFilter(){
  kandoshiFilter.clear();
  ['active','done'].forEach(t=>{const el=document.getElementById('kdfchk-'+t);if(el)el.classList.remove('on');});
  const btn=document.getElementById('kandoshi-filter-btn');
  if(btn){btn.textContent='🌾 中干し ▾';btn.classList.remove('filtered');}
  document.getElementById('kandoshi-menu')?.classList.remove('open');
  renderMap();
}

function applyPlantingFilter(){
  const minEl=document.getElementById('pt-min');
  const maxEl=document.getElementById('pt-max');
  const typeEl=document.querySelector('input[name="pt-type"]:checked');
  if(!minEl||!maxEl)return;
  plantingFilter.active=true;
  plantingFilter.minDays=parseInt(minEl.value)||0;
  plantingFilter.maxDays=parseInt(maxEl.value)||60;
  plantingFilter.type=typeEl?typeEl.value:'all';
  const btn=document.getElementById('planting-filter-btn');
  if(btn){btn.classList.add('filtered');btn.textContent='🌱 田植後（'+plantingFilter.minDays+'〜'+plantingFilter.maxDays+'日）▾';}
  document.getElementById('planting-menu')?.classList.remove('open');
  personalSettings.plantingDefault={minDays:plantingFilter.minDays,maxDays:plantingFilter.maxDays,type:plantingFilter.type};
  savePersonalSettings();
  renderMap();
}
function clearPlantingFilter(){
  plantingFilter.active=false;
  const btn=document.getElementById('planting-filter-btn');
  if(btn){btn.classList.remove('filtered');btn.textContent='🌱 田植後 ▾';}
  document.getElementById('planting-menu')?.classList.remove('open');
  renderMap();
}

// ============================================================
// 設定メニュー（個人設定 + 管理者設定の入口）
// ============================================================
function openSettingsMenu(){
  const existing=document.getElementById('settings-modal');
  if(existing)existing.remove();
  const modal=document.createElement('div');
  modal.id='settings-modal';
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px 0;box-sizing:border-box;';
  const box=document.createElement('div');
  box.style.cssText='background:#fff;border-radius:14px;width:92%;max-width:480px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.3);margin:auto;';
  const header=document.createElement('div');
  header.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
  header.innerHTML='<h2 style="margin:0;font-size:17px;color:#2C4A1E">⚙️ 設定</h2>';
  const closeBtn=document.createElement('button');
  closeBtn.textContent='✕';
  closeBtn.style.cssText='background:none;border:none;font-size:20px;cursor:pointer;color:#888;padding:4px 8px;';
  closeBtn.onclick=()=>modal.remove();
  header.appendChild(closeBtn);
  box.appendChild(header);
  const personalBtn=document.createElement('button');
  personalBtn.style.cssText='width:100%;padding:14px 16px;margin-bottom:10px;border-radius:10px;border:2px solid #3498db;background:#f0f8ff;color:#1a5276;font-size:15px;font-weight:700;text-align:left;cursor:pointer;display:flex;justify-content:space-between;align-items:center;';
  personalBtn.innerHTML='<span>👤 個人設定</span><span style="font-size:12px;font-weight:400">▶</span>';
  personalBtn.onclick=()=>{modal.remove();openPersonalSettings();};
  box.appendChild(personalBtn);
  const adminBtn=document.createElement('button');
  adminBtn.style.cssText='width:100%;padding:14px 16px;margin-bottom:10px;border-radius:10px;border:2px solid #2C4A1E;background:#f0fff4;color:#2C4A1E;font-size:15px;font-weight:700;text-align:left;cursor:pointer;display:flex;justify-content:space-between;align-items:center;';
  adminBtn.innerHTML='<span>🔒 管理者設定</span><span style="font-size:12px;font-weight:400">▶</span>';
  adminBtn.onclick=()=>{modal.remove();openAdminLogin();};
  box.appendChild(adminBtn);
  modal.appendChild(box);
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
  document.body.appendChild(modal);
}

// ============================================================
// 個人設定パネル
// ============================================================
function openPersonalSettings(){
  const existing=document.getElementById('personal-modal');
  if(existing)existing.remove();
  const modal=document.createElement('div');
  modal.id='personal-modal';
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px 0;box-sizing:border-box;';
  const box=document.createElement('div');
  box.style.cssText='background:#fff;border-radius:14px;width:92%;max-width:480px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.3);margin:auto;';
  const header=document.createElement('div');
  header.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
  header.innerHTML='<h2 style="margin:0;font-size:17px;color:#1a5276">👤 個人設定</h2>';
  const closeBtn=document.createElement('button');
  closeBtn.textContent='✕';
  closeBtn.style.cssText='background:none;border:none;font-size:20px;cursor:pointer;color:#888;padding:4px 8px;';
  closeBtn.onclick=()=>modal.remove();
  header.appendChild(closeBtn);
  box.appendChild(header);
  const subNote=document.createElement('p');
  subNote.textContent='この端末のみに保存されます。';
  subNote.style.cssText='font-size:11px;color:#888;margin:0 0 16px;';
  box.appendChild(subNote);
  // フィルター設定
  const secTitle=document.createElement('h3');
  secTitle.textContent='表示するフィルター';
  secTitle.style.cssText='font-size:13px;color:#333;margin:0 0 4px;border-bottom:1px solid #eee;padding-bottom:6px;';
  box.appendChild(secTitle);
  const hint=document.createElement('p');
  hint.textContent='▲▼ で並び順を変更できます。';
  hint.style.cssText='font-size:11px;color:#888;margin:0 0 10px;';
  box.appendChild(hint);
  const filterList=document.createElement('div');
  filterList.id='personal-filter-list';
  renderPersonalFilterList(filterList);
  box.appendChild(filterList);
  // デフォルトモード
  const modeTitle=document.createElement('h3');
  modeTitle.textContent='起動時のモード';
  modeTitle.style.cssText='font-size:13px;color:#333;margin:16px 0 8px;border-bottom:1px solid #eee;padding-bottom:6px;';
  box.appendChild(modeTitle);
  const modeWrap=document.createElement('div');
  modeWrap.style.cssText='display:flex;gap:8px;flex-wrap:wrap;';
  [['date','確認日'],['status','水状態'],['mizushi','水尻'],['ankyo','暗渠']].forEach(([val,label])=>{
    const btn=document.createElement('button');
    btn.textContent=label;btn.dataset.mode=val;
    const isActive=personalSettings.defaultMode===val;
    btn.style.cssText='padding:6px 14px;border-radius:8px;border:1.5px solid '+(isActive?'#3498db':'#ddd')+';background:'+(isActive?'#ebf5fb':'#fff')+';color:'+(isActive?'#1a5276':'#666')+';font-size:12px;cursor:pointer;';
    btn.onclick=()=>{
      personalSettings.defaultMode=val;
      modeWrap.querySelectorAll('button').forEach(b=>{
        const act=b.dataset.mode===val;
        b.style.borderColor=act?'#3498db':'#ddd';
        b.style.background=act?'#ebf5fb':'#fff';
        b.style.color=act?'#1a5276':'#666';
      });
    };
    modeWrap.appendChild(btn);
  });
  box.appendChild(modeWrap);
  // 保存ボタン
  const saveBtn=document.createElement('button');
  saveBtn.textContent='保存して閉じる';
  saveBtn.style.cssText='width:100%;padding:13px;background:#3498db;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-top:20px;';
  saveBtn.onclick=()=>{
    savePersonalSettings();
    modal.remove();
    buildRightControls();
    buildAlertFilterMenu();
    buildStatusFilterMenu();
    initFilters();
    updateFilterVisibility();
  };
  box.appendChild(saveBtn);
  modal.appendChild(box);
  modal.addEventListener('click',e=>{if(e.target===modal)modal.remove();});
  document.body.appendChild(modal);
}

function renderPersonalFilterList(container){
  container.innerHTML='';
  personalSettings.filterOrder.forEach((id,idx)=>{
    const def=FILTER_DEFS.find(d=>d.id===id);
    if(!def)return;
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0;';
    const chk=document.createElement('input');
    chk.type='checkbox';chk.checked=!!personalSettings.filterVisible[id];
    chk.style.cssText='width:18px;height:18px;cursor:pointer;accent-color:#2C4A1E;';
    chk.onchange=()=>{personalSettings.filterVisible[id]=chk.checked;};
    const lbl=document.createElement('span');
    lbl.textContent=def.label;lbl.style.cssText='flex:1;font-size:13px;';
    const upBtn=document.createElement('button');
    upBtn.textContent='▲';
    upBtn.style.cssText='padding:4px 8px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;'+(idx===0?'opacity:0.3;pointer-events:none;':'');
    upBtn.onclick=()=>{
      if(idx===0)return;
      [personalSettings.filterOrder[idx-1],personalSettings.filterOrder[idx]]=[personalSettings.filterOrder[idx],personalSettings.filterOrder[idx-1]];
      renderPersonalFilterList(container);
    };
    const dnBtn=document.createElement('button');
    dnBtn.textContent='▼';
    dnBtn.style.cssText='padding:4px 8px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;'+(idx===personalSettings.filterOrder.length-1?'opacity:0.3;pointer-events:none;':'');
    dnBtn.onclick=()=>{
      if(idx===personalSettings.filterOrder.length-1)return;
      [personalSettings.filterOrder[idx],personalSettings.filterOrder[idx+1]]=[personalSettings.filterOrder[idx+1],personalSettings.filterOrder[idx]];
      renderPersonalFilterList(container);
    };
    row.appendChild(chk);row.appendChild(lbl);row.appendChild(upBtn);row.appendChild(dnBtn);
    container.appendChild(row);
  });
}

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
    { id: 'status_items', label: '📋 水管理項目の設定',           status: 'active' },
    { id: 'water_rules',  label: '💧 水管理ルール（除草剤・中干し）', status: 'active' },
    { id: 'alert_thresh', label: '🚨 アラート閾値の設定',          status: 'active' },
    { id: 'notify',       label: '🔔 LINE WORKS通知設定',          status: 'planned' },
    { id: 'data_mgmt',    label: '🗄 データ管理',                 status: 'planned' },
  ];

  const modal = document.createElement('div');
  modal.id = 'admin-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px 0;box-sizing:border-box;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:14px;width:92%;max-width:480px;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,0.3);margin:auto;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;';
  header.innerHTML = '<h2 style="margin:0;font-size:17px;color:#2C4A1E">🔒 管理者設定</h2>';
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
  if (sectionId === 'water_rules')  openWaterRulesEditor(modal, box);
  if (sectionId === 'alert_thresh') openAlertThreshEditor(modal, box);
  if (sectionId === 'notify')       openNotifyEditor(modal, box);
}

async function confirmMizushiInit(modal) {
  if (!confirm('全圃場（'+GJ.features.length+'枚）の水尻を「設置済み」として一括登録します。\nよろしいですか？')) return;
  if (!curUser) { const n = prompt('担当者名を入力してください'); if (!n) return; curUser = n; localStorage.setItem('osf_user', n); document.getElementById('ulabel').textContent = n; }
  const time = new Date().toISOString();
  const names = GJ.features.map(f => f.properties.name.trim());
  try {
    await postToGAS({ action: 'mizushi_bulk', names, status: '設置済み', person: curUser, time });
    await loadRecords();
    alert('✅ 全圃場の水尻を設置済みに登録しました');
    modal.remove();
  } catch(e) {
    alert('保存に失敗しました。電波状況を確認してください。');
  }
}


// ============================================================
// 管理者設定：水管理ルール（除草剤・中干し目安）
// ============================================================
async function openWaterRulesEditor(modal, box) {
  box.innerHTML = '';
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:16px;';
  const backBtn = document.createElement('button');
  backBtn.textContent = '◀ 戻る';
  backBtn.style.cssText = 'background:none;border:none;color:#2C4A1E;font-size:14px;cursor:pointer;font-weight:700;padding:0;';
  backBtn.onclick = () => openAdminMenu();
  header.innerHTML = '<h2 style="margin:0;font-size:17px;color:#2C4A1E;flex:1;">💧 水管理ルール</h2>';
  header.insertBefore(backBtn, header.firstChild);
  box.appendChild(header);

  // 除草剤カウントダウン時間
  const herbSection = document.createElement('div');
  herbSection.style.cssText = 'margin-bottom:20px;';
  herbSection.innerHTML = '<h3 style="font-size:13px;color:#333;margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:6px;">除草剤カウントダウン</h3>'
    +'<div style="display:flex;align-items:center;gap:10px;">'
    +'<label style="font-size:13px;">止水まで</label>'
    +'<input type="number" id="admin-herb-hours" min="1" max="240" value="'+herbHours+'" style="width:70px;padding:6px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;text-align:center;">'
    +'<label style="font-size:13px;">時間</label></div>'
    +'<p style="font-size:11px;color:#888;margin:6px 0 0;">現在の設定：'+herbHours+'時間</p>';
  box.appendChild(herbSection);

  // 品種別中干し目安日数
  const kdSection = document.createElement('div');
  kdSection.innerHTML = '<h3 style="font-size:13px;color:#333;margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:6px;">品種別 中干し目安日数</h3>';
  const kdGrid = document.createElement('div');
  kdGrid.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;';
  CROP_GROUPS.forEach(g => {
    const lbl = document.createElement('span');
    lbl.textContent = g.label;
    lbl.style.cssText = 'font-size:13px;';
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.id = 'kd-'+g.key;
    inp.min = 1; inp.max = 30;
    inp.value = kandoshiDays[g.key] || 7;
    inp.style.cssText = 'width:60px;padding:5px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;text-align:center;';
    const unit = document.createElement('span');
    unit.textContent = '日';
    unit.style.cssText = 'font-size:12px;color:#666;';
    kdGrid.appendChild(lbl);
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;';
    wrap.appendChild(inp); wrap.appendChild(unit);
    kdGrid.appendChild(wrap);
  });
  kdSection.appendChild(kdGrid);
  box.appendChild(kdSection);

  // 保存ボタン
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '保存';
  saveBtn.style.cssText = 'width:100%;padding:13px;background:#2C4A1E;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-top:16px;';
  saveBtn.onclick = async () => {
    const newHerbHours = parseInt(document.getElementById('admin-herb-hours').value) || 72;
    const newKd = {};
    CROP_GROUPS.forEach(g => { newKd[g.key] = parseInt(document.getElementById('kd-'+g.key).value) || 7; });
    saveBtn.textContent = '保存中...'; saveBtn.disabled = true;
    try {
      await postToGAS({action:'save_settings',password:adminPassword,key:'herb_hours',value:newHerbHours});
      await postToGAS({action:'save_settings',password:adminPassword,key:'kandoshi_days',value:newKd});
      await loadRecords();
      showToast('✅ 水管理ルールを保存しました');
      modal.remove();
    } catch(e) { alert('保存に失敗しました'); saveBtn.textContent='保存'; saveBtn.disabled=false; }
  };
  box.appendChild(saveBtn);
}

// ============================================================
// 管理者設定：アラート閾値
// ============================================================
async function openAlertThreshEditor(modal, box) {
  box.innerHTML = '';
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:16px;';
  const backBtn = document.createElement('button');
  backBtn.textContent = '◀ 戻る';
  backBtn.style.cssText = 'background:none;border:none;color:#2C4A1E;font-size:14px;cursor:pointer;font-weight:700;padding:0;';
  backBtn.onclick = () => openAdminMenu();
  header.innerHTML = '<h2 style="margin:0;font-size:17px;color:#2C4A1E;flex:1;">🚨 アラート閾値</h2>';
  header.insertBefore(backBtn, header.firstChild);
  box.appendChild(header);

  const section = document.createElement('div');
  section.style.cssText = 'margin-bottom:16px;';
  section.innerHTML = '<h3 style="font-size:13px;color:#333;margin:0 0 8px;border-bottom:1px solid #eee;padding-bottom:6px;">要確認アラート</h3>'
    +'<div style="display:flex;align-items:center;gap:10px;">'
    +'<label style="font-size:13px;">最終記録から</label>'
    +'<input type="number" id="admin-alert-days" min="1" max="30" value="'+alertDays+'" style="width:60px;padding:6px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;text-align:center;">'
    +'<label style="font-size:13px;">日超でアラート</label></div>'
    +'<p style="font-size:11px;color:#888;margin:6px 0 0;">現在の設定：'+alertDays+'日超</p>';
  box.appendChild(section);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '保存';
  saveBtn.style.cssText = 'width:100%;padding:13px;background:#2C4A1E;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px;';
  saveBtn.onclick = async () => {
    const val = parseInt(document.getElementById('admin-alert-days').value) || 4;
    saveBtn.textContent = '保存中...'; saveBtn.disabled = true;
    try {
      await postToGAS({action:'save_settings',password:adminPassword,key:'alert_days',value:val});
      await loadRecords();
      showToast('✅ アラート閾値を保存しました');
      modal.remove();
    } catch(e) { alert('保存に失敗しました'); saveBtn.textContent='保存'; saveBtn.disabled=false; }
  };
  box.appendChild(saveBtn);
}

// ============================================================
// 管理者設定：LINE WORKS通知設定
// ============================================================
async function openNotifyEditor(modal, box) {
  box.innerHTML = '';
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:16px;';
  const backBtn = document.createElement('button');
  backBtn.textContent = '◀ 戻る';
  backBtn.style.cssText = 'background:none;border:none;color:#2C4A1E;font-size:14px;cursor:pointer;font-weight:700;padding:0;';
  backBtn.onclick = () => openAdminMenu();
  header.appendChild(backBtn);
  header.innerHTML += '<h2 style="margin:0;font-size:17px;color:#2C4A1E;flex:1;">🔔 通知設定</h2>';
  header.insertBefore(backBtn, header.firstChild);
  box.appendChild(header);

  // 現在の設定を取得（GASのsettingsから読む想定、app側ではr.settings.notify_timesを保持）
  const currentTimes = (window._notifyTimes || [7, 12]);
  const note = document.createElement('p');
  note.style.cssText = 'font-size:11px;color:#888;margin:0 0 14px;background:#f9f9f9;padding:8px 10px;border-radius:8px;';
  note.innerHTML = '⚠️ GASのトリガーを「毎時1回」に変更してください。<br>設定した時間台に自動通知されます。';
  box.appendChild(note);

  const section = document.createElement('div');
  section.innerHTML = '<h3 style="font-size:13px;color:#333;margin:0 0 10px;border-bottom:1px solid #eee;padding-bottom:6px;">通知時間帯（複数選択可）</h3>';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:16px;';
  [6,7,8,9,10,11,12,13,14,15,16,17].forEach(h => {
    const btn = document.createElement('button');
    btn.textContent = h+'時';
    btn.dataset.hour = h;
    const isSelected = currentTimes.includes(h);
    btn.style.cssText = 'padding:8px 4px;border-radius:8px;border:1.5px solid '+(isSelected?'#2C4A1E':'#ddd')+';background:'+(isSelected?'#f0fff4':'#fff')+';color:'+(isSelected?'#2C4A1E':'#666')+';font-size:13px;cursor:pointer;';
    btn.onclick = () => {
      const active = btn.style.borderColor === 'rgb(44, 74, 30)';
      btn.style.borderColor = active?'#ddd':'#2C4A1E';
      btn.style.background = active?'#fff':'#f0fff4';
      btn.style.color = active?'#666':'#2C4A1E';
    };
    grid.appendChild(btn);
  });
  section.appendChild(grid);
  box.appendChild(section);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '保存';
  saveBtn.style.cssText = 'width:100%;padding:13px;background:#2C4A1E;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;';
  saveBtn.onclick = async () => {
    const selected = [...grid.querySelectorAll('button')].filter(b=>b.style.borderColor==='rgb(44, 74, 30)').map(b=>parseInt(b.dataset.hour));
    if(selected.length===0){alert('少なくとも1つの時間を選択してください');return;}
    saveBtn.textContent = '保存中...'; saveBtn.disabled = true;
    try {
      await postToGAS({action:'save_settings',password:adminPassword,key:'notify_times',value:selected});
      window._notifyTimes = selected;
      showToast('✅ 通知設定を保存しました');
      modal.remove();
    } catch(e) { alert('保存に失敗しました'); saveBtn.textContent='保存'; saveBtn.disabled=false; }
  };
  box.appendChild(saveBtn);
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

      // 項目名（基幹ステータスはロック）
      const isLocked = LOCKED_STATUSES.has(item.label);
      const input = document.createElement('input');
      input.type = 'text';
      input.value = item.label;
      input.style.cssText = 'flex:1;border:1px solid #ddd;border-radius:6px;padding:5px 8px;font-size:13px;'+(isLocked?'background:#f5f5f5;color:#999;cursor:not-allowed;':'');
      if(isLocked){input.readOnly=true;input.title='基幹ステータスは名前を変更できません';}
      else{input.oninput = () => { currentItems[idx].label = input.value.trim(); };}

      // ロックアイコン or 削除ボタン
      const delBtn = document.createElement('button');
      if(isLocked){
        delBtn.textContent='🔒';
        delBtn.style.cssText='background:none;border:none;font-size:15px;color:#aaa;flex-shrink:0;cursor:default;';
        delBtn.title='基幹ステータスは削除できません';
      }else{
        delBtn.textContent='🗑';
        delBtn.style.cssText='background:none;border:none;font-size:15px;cursor:pointer;color:#e74c3c;flex-shrink:0;';
        delBtn.onclick=()=>{if(confirm('「'+item.label+'」を削除しますか？')){currentItems.splice(idx,1);renderList();}};
      }

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

// ============================================================
// 圃場番号ラベル表示ON/OFF
// ============================================================
function toggleFieldIdLabels(){
  showFieldIdLabels=!showFieldIdLabels;
  const btn=document.getElementById('fieldid-btn');
  if(btn){
    btn.style.borderColor=showFieldIdLabels?'#2C4A1E':'#888';
    btn.style.color=showFieldIdLabels?'#2C4A1E':'#555';
    btn.style.background=showFieldIdLabels?'#f0fff4':'rgba(255,255,255,0.96)';
  }
  Object.entries(fieldIdMarkers).forEach(([nm,lbl])=>{
    if(showFieldIdLabels){if(!map.hasLayer(lbl))map.addLayer(lbl);}
    else{if(map.hasLayer(lbl))map.removeLayer(lbl);}
  });
}

// ============================================================
// 水尻・暗渠モード：モード別パネル分岐
// ============================================================
function openPanelByMode(feat){
  if(mode==='mizushi')openMizushiPanel(feat);
  else if(mode==='ankyo')openAnkyoPanel(feat);
  else openPanel(feat);
}

// ============================================================
// 水尻パネル
// ============================================================
function openMizushiPanel(feat){
  const nm=feat.properties.name.trim();
  const p=feat.properties;
  const m=mizushiData[nm];

  // 複数選択モードの場合
  if(multiMode){toggleFieldSelect(nm);return;}

  selField=feat;selStatus=null;pendingKusa=null;exitEditMode();

  document.getElementById('pt').textContent=p.name.trim();
  const bn=BM[(p.field_id||'').replace(/-.*/, '')]||'';
  document.getElementById('pm').textContent=[p.field_id,bn,p.area_a?p.area_a+'a':''].filter(Boolean).join(' | ')||'詳細なし';

  // 現在の状態表示
  const pl=document.getElementById('pl');
  if(m){
    const d=new Date(m.time);
    pl.textContent='水尻：'+m.status+'　'+d.toLocaleDateString('ja')+' '+m.person;
    pl.style.cssText='background:#f0fff4;color:#27ae60;padding:7px 10px;border-radius:8px;';
  }else{
    pl.textContent='水尻：未記録';
    pl.style.cssText='background:#fff8f0;color:#e67e22;padding:7px 10px;border-radius:8px;';
  }
  document.getElementById('htimer').style.display='none';
  document.getElementById('kusa-section').style.display='none';
  document.getElementById('task-section').style.display='none';
  document.getElementById('hist-section').style.display='none';
  document.getElementById('multi-banner').style.display='none';
  document.getElementById('bulk-extra').innerHTML='';
  document.getElementById('edit-savebtn').style.display='none';
  document.getElementById('cancel-edit-btn').style.display='none';

  // 水尻専用ボタン
  const sg=document.getElementById('sgrid');sg.innerHTML='';
  ['設置済み','外し済み'].forEach(s=>{
    const b=document.createElement('button');b.className='sbtn';b.textContent=s;
    b.style.cssText='background:'+(s==='設置済み'?'#f4eaff':'#fff3e0')+';border-color:'+(s==='設置済み'?'#8e44ad':'#e67e22')+';color:'+(s==='設置済み'?'#8e44ad':'#e67e22')+';';
    if(m&&m.status===s)b.classList.add('sel');
    b.addEventListener('click',()=>{
      document.querySelectorAll('.sbtn').forEach(x=>x.classList.remove('sel'));
      b.classList.add('sel');selStatus=s;
      document.getElementById('savebtn').disabled=false;
    });
    sg.appendChild(b);
  });

  initTimeSelector(0,new Date().getHours());
  document.getElementById('savebtn').style.display='block';
  document.getElementById('savebtn').textContent='記録する';
  document.getElementById('savebtn').disabled=true;
  document.getElementById('panel').classList.add('open');
  document.getElementById('overlay').classList.add('on');
  setTimeout(()=>{focusOnFeature(feat);},50);
}

// ============================================================
// 暗渠パネル
// ============================================================
function openAnkyoPanel(feat){
  const nm=feat.properties.name.trim();
  const p=feat.properties;
  const master=ankyoMaster[nm];
  const op=ankyoOpData[nm];

  if(multiMode){toggleFieldSelect(nm);return;}

  selField=feat;selStatus=null;pendingKusa=null;exitEditMode();

  document.getElementById('pt').textContent=p.name.trim();
  const bn=BM[(p.field_id||'').replace(/-.*/, '')]||'';
  document.getElementById('pm').textContent=[p.field_id,bn,p.area_a?p.area_a+'a':''].filter(Boolean).join(' | ')||'詳細なし';
  document.getElementById('htimer').style.display='none';
  document.getElementById('kusa-section').style.display='none';
  document.getElementById('task-section').style.display='none';
  document.getElementById('hist-section').style.display='none';
  document.getElementById('multi-banner').style.display='none';
  document.getElementById('edit-savebtn').style.display='none';
  document.getElementById('cancel-edit-btn').style.display='none';
  document.getElementById('savebtn').style.display='none';

  const pl=document.getElementById('pl');
  const sg=document.getElementById('sgrid');sg.innerHTML='';
  const bulkExtra=document.getElementById('bulk-extra');bulkExtra.innerHTML='';

  if(!master){
    // 未登録：登録フォームを表示
    pl.textContent='暗渠情報：未登録';
    pl.style.cssText='background:#fff8f0;color:#e67e22;padding:7px 10px;border-radius:8px;';
    renderAnkyoForm(nm, null, bulkExtra);
  }else{
    // 登録済み：情報表示＋操作
    const hasAnkyo=master.hasAnkyo==='あり';
    const sizesText=master.sizes&&master.sizes.length>0?master.sizes.join('・'):'';
    pl.textContent='暗渠：'+master.hasAnkyo+(hasAnkyo?' | '+master.count+'本'+(sizesText?' | '+sizesText:''):'');
    pl.style.cssText='background:#f0fff4;color:#27ae60;padding:7px 10px;border-radius:8px;';

    // 特記事項アラート
    if(master.note){
      const noteDiv=document.createElement('div');
      noteDiv.style.cssText='background:#fff3cd;border:1px solid #f39c12;border-radius:8px;padding:7px 10px;margin-bottom:8px;font-size:13px;color:#856404;';
      noteDiv.textContent='⚠️ '+master.note;
      bulkExtra.appendChild(noteDiv);
    }

    // 編集ボタン
    const editBtn=document.createElement('button');editBtn.className='sub-btn';
    editBtn.textContent='✏ 暗渠情報を編集';
    editBtn.style.cssText='width:100%;margin-bottom:10px;';
    editBtn.addEventListener('click',()=>{bulkExtra.innerHTML='';renderAnkyoForm(nm,master,bulkExtra);});
    bulkExtra.appendChild(editBtn);

    // はめた/外した操作（暗渠ありの場合のみ）
    if(hasAnkyo){
      const opDiv=document.createElement('div');
      opDiv.style.cssText='margin-bottom:8px;';
      const curStatus=op?op.status==='はめた'?'はめ済み':'外し済み':'未記録';
      const curDiv=document.createElement('div');
      curDiv.style.cssText='font-size:13px;color:#666;margin-bottom:8px;';
      curDiv.textContent='現在の状態：'+curStatus+(op?' ('+new Date(op.time).toLocaleDateString('ja')+' '+op.person+')':'');
      opDiv.appendChild(curDiv);

      ['はめた','外した'].forEach(s=>{
        const b=document.createElement('button');b.className='sbtn';b.textContent=s;
        b.style.cssText='background:'+(s==='はめた'?'#e8f0fe':'#fff3e0')+';border-color:'+(s==='はめた'?'#2980b9':'#e67e22')+';color:'+(s==='はめた'?'#2980b9':'#e67e22')+';margin-right:8px;';
        if(op&&((s==='はめた'&&op.status==='はめた')||(s==='外した'&&op.status==='外した')))b.classList.add('sel');
        b.addEventListener('click',()=>{
          document.querySelectorAll('.sbtn').forEach(x=>x.classList.remove('sel'));
          b.classList.add('sel');selStatus=s;
          document.getElementById('savebtn').style.display='block';
          document.getElementById('savebtn').disabled=false;
        });
        opDiv.appendChild(b);
      });
      sg.appendChild(opDiv);
      initTimeSelector(0,new Date().getHours());
      document.getElementById('savebtn').style.display='block';
      document.getElementById('savebtn').disabled=true;
    }
  }

  document.getElementById('panel').classList.add('open');
  document.getElementById('overlay').classList.add('on');
  setTimeout(()=>{focusOnFeature(feat);},50);
}

// 暗渠登録・編集フォーム
function renderAnkyoForm(nm, existing, container){
  container.innerHTML='';

  const title=document.createElement('div');
  title.style.cssText='font-weight:700;font-size:14px;color:#2C4A1E;margin-bottom:10px;';
  title.textContent=existing?'暗渠情報を編集':'暗渠情報を登録';
  container.appendChild(title);

  // あり/なし
  const radioWrap=document.createElement('div');radioWrap.style.cssText='display:flex;gap:16px;margin-bottom:12px;';
  let hasAnkyoVal=existing?existing.hasAnkyo:'あり';
  ['あり','なし'].forEach(v=>{
    const label=document.createElement('label');label.style.cssText='display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer;';
    const radio=document.createElement('input');radio.type='radio';radio.name='ankyo-has';radio.value=v;
    if(hasAnkyoVal===v)radio.checked=true;
    radio.addEventListener('change',()=>{hasAnkyoVal=v;updateCountSection();});
    label.appendChild(radio);label.appendChild(document.createTextNode(v));
    radioWrap.appendChild(label);
  });
  container.appendChild(radioWrap);

  // 本数・サイズセクション
  const countSection=document.createElement('div');
  container.appendChild(countSection);

  function updateCountSection(){
    countSection.innerHTML='';
    if(hasAnkyoVal!=='あり')return;

    // 本数
    const countWrap=document.createElement('div');countWrap.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:10px;';
    const countLabel=document.createElement('span');countLabel.textContent='本数：';countLabel.style.fontSize='14px';
    const countSel=document.createElement('select');countSel.style.cssText='border:1px solid #ddd;border-radius:6px;padding:5px 8px;font-size:14px;';
    for(let i=1;i<=10;i++){const o=document.createElement('option');o.value=i;o.textContent=i+'本';if(existing&&existing.count===i)o.selected=true;countSel.appendChild(o);}
    countSel.addEventListener('change',renderSizeInputs);
    countWrap.appendChild(countLabel);countWrap.appendChild(countSel);
    countSection.appendChild(countWrap);

    // サイズ入力
    const sizeWrap=document.createElement('div');sizeWrap.id='ankyo-sizes';sizeWrap.style.cssText='margin-bottom:12px;';
    countSection.appendChild(sizeWrap);

    function renderSizeInputs(){
      sizeWrap.innerHTML='';
      const n=parseInt(countSel.value);
      for(let i=0;i<n;i++){
        const row=document.createElement('div');row.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:6px;';
        const lbl=document.createElement('span');lbl.textContent=(i+1)+'本目：';lbl.style.fontSize='13px;';
        const sel=document.createElement('select');sel.className='ankyo-size-sel';sel.style.cssText='border:1px solid #ddd;border-radius:6px;padding:5px 8px;font-size:13px;flex:1;';
        ['65mm','75mm','100mm','その他'].forEach(sz=>{
          const o=document.createElement('option');o.value=sz;o.textContent=sz;
          if(existing&&existing.sizes&&existing.sizes[i]){
            if(existing.sizes[i]===sz||(sz==='その他'&&!['65mm','75mm','100mm'].includes(existing.sizes[i])))o.selected=true;
          }
          sel.appendChild(o);
        });
        const otherInput=document.createElement('input');otherInput.type='text';otherInput.placeholder='数字のみ';
        otherInput.style.cssText='border:1px solid #ddd;border-radius:6px;padding:5px 8px;font-size:13px;width:80px;display:none;';
        otherInput.addEventListener('input',()=>{otherInput.value=otherInput.value.replace(/[^0-9]/g,'');});
        if(existing&&existing.sizes&&existing.sizes[i]&&!['65mm','75mm','100mm'].includes(existing.sizes[i])){
          otherInput.style.display='block';otherInput.value=existing.sizes[i].replace('mm','');
        }
        sel.addEventListener('change',()=>{otherInput.style.display=sel.value==='その他'?'block':'none';});
        row.appendChild(lbl);row.appendChild(sel);row.appendChild(otherInput);
        sizeWrap.appendChild(row);
      }
    }
    renderSizeInputs();
    countSel.addEventListener('change',renderSizeInputs);
  }
  updateCountSection();

  // 特記事項
  const noteWrap=document.createElement('div');noteWrap.style.cssText='margin-bottom:12px;';
  const noteLbl=document.createElement('div');noteLbl.textContent='特記事項：';noteLbl.style.cssText='font-size:13px;color:#666;margin-bottom:4px;';
  const noteInput=document.createElement('input');noteInput.type='text';noteInput.className='sub-input';
  noteInput.placeholder='ネジ破損・ビニール対処など';noteInput.style.cssText='width:100%;';
  if(existing&&existing.note)noteInput.value=existing.note;
  noteWrap.appendChild(noteLbl);noteWrap.appendChild(noteInput);
  container.appendChild(noteWrap);

  // 登録ボタン
  const saveBtn=document.createElement('button');
  saveBtn.textContent=existing?'✏ 更新する':'📝 登録する';
  saveBtn.style.cssText='width:100%;padding:11px;border-radius:10px;border:none;background:#2C4A1E;color:#fff;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:6px;';
  saveBtn.addEventListener('click',async()=>{
    if(!curUser){const n=prompt('担当者名を入力してください');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
    const hasAnkyo=document.querySelector('input[name="ankyo-has"]:checked')?.value||'あり';
    let sizes=[];
    let count=0;
    if(hasAnkyo==='あり'){
      const countSel=countSection.querySelector('select');
      count=countSel?parseInt(countSel.value):0;
      document.querySelectorAll('.ankyo-size-sel').forEach((sel,i)=>{
        if(sel.value==='その他'){
          const inputs=sel.parentElement.querySelectorAll('input[type=text]');
          const v=inputs[0]?inputs[0].value.trim():'';
          sizes.push(v?v+'mm':'?mm');
        }else{sizes.push(sel.value);}
      });
    }
    // その他バリデーション
    const hasInvalidOther=sizes.some(s=>s==='?mm');
    if(hasInvalidOther){alert('「その他」のサイズを半角数字で入力してください');return;}
    saveBtn.disabled=true;saveBtn.textContent='保存中...';
    try{
      await postToGAS({action:'ankyo_master_save',name:nm,hasAnkyo,count,sizes,note:noteInput.value.trim()});
      await loadRecords();
      openAnkyoPanel(selField);
    }catch(e){alert('保存に失敗しました');saveBtn.disabled=false;saveBtn.textContent=existing?'✏ 更新する':'📝 登録する';}
  });
  container.appendChild(saveBtn);
}

// ============================================================
// 水尻・暗渠の savebtn クリック処理（モード別）
// ============================================================
async function saveMizushiOrAnkyo(){
  if(!selField||!selStatus)return;
  if(!curUser){const n=prompt('担当者名を入力してください');if(!n)return;curUser=n;localStorage.setItem('osf_user',n);document.getElementById('ulabel').textContent=n;}
  const nm=selField.properties.name.trim();
  const time=getSelectedTime();
  setButtonLoading('savebtn',true);
  try{
    if(!singleSaved){
      if(mode==='mizushi'){
        await postToGAS({action:'mizushi_save',name:nm,status:selStatus,person:curUser,time});
      }else if(mode==='ankyo'){
        await postToGAS({action:'ankyo_operation_save',name:nm,status:selStatus,person:curUser,time});
      }
      singleSaved=true;
    }
    await loadRecords();
  }catch(e){alert('保存に失敗しました');setButtonLoading('savebtn',false,'記録する');return;}
  setButtonLoading('savebtn',false,'記録する');
  singleSaved=false;
  closePanel();
  showToast('✅ 記録を保存しました');
}

// ============================================================
// 水尻・暗渠の複数選択一括操作
// ============================================================
function openMizushiMultiPanel(){
  if(multiSelected.size===0)return;
  selField=null;selStatus=null;exitEditMode();
  const targets=[...multiSelected];
  document.getElementById('pt').textContent=multiSelected.size+'枚の一括記録（水尻）';
  document.getElementById('pm').textContent=targets.slice(0,3).join('、')+(targets.length>3?' 他'+(targets.length-3)+'枚':'');
  document.getElementById('pl').textContent='';document.getElementById('pl').style.cssText='';
  document.getElementById('htimer').style.display='none';
  document.getElementById('multi-banner').style.display='block';
  document.getElementById('multi-banner').textContent='☑ '+multiSelected.size+'枚に一括記録します';
  document.getElementById('kusa-section').style.display='none';
  document.getElementById('task-section').style.display='none';
  document.getElementById('hist-section').style.display='none';
  document.getElementById('bulk-extra').innerHTML='';
  document.getElementById('edit-savebtn').style.display='none';
  document.getElementById('cancel-edit-btn').style.display='none';
  document.getElementById('savebtn').style.display='block';
  document.getElementById('savebtn').disabled=true;
  const sg=document.getElementById('sgrid');sg.innerHTML='';
  ['設置済み','外し済み'].forEach(s=>{
    const b=document.createElement('button');b.className='sbtn';b.textContent=s;
    b.style.cssText='background:'+(s==='設置済み'?'#f4eaff':'#fff3e0')+';border-color:'+(s==='設置済み'?'#8e44ad':'#e67e22')+';color:'+(s==='設置済み'?'#8e44ad':'#e67e22')+';';
    b.addEventListener('click',()=>{document.querySelectorAll('.sbtn').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');selStatus=s;document.getElementById('savebtn').disabled=false;});
    sg.appendChild(b);
  });
  initTimeSelector(0,new Date().getHours());
  document.getElementById('panel').classList.add('open');
  document.getElementById('overlay').classList.add('on');
  document.getElementById('multi-bar').style.display='none';
}

function openAnkyoMultiPanel(){
  if(multiSelected.size===0)return;
  selField=null;selStatus=null;exitEditMode();
  const targets=[...multiSelected];
  document.getElementById('pt').textContent=multiSelected.size+'枚の一括記録（暗渠）';
  document.getElementById('pm').textContent=targets.slice(0,3).join('、')+(targets.length>3?' 他'+(targets.length-3)+'枚':'');
  document.getElementById('pl').textContent='';document.getElementById('pl').style.cssText='';
  document.getElementById('htimer').style.display='none';
  document.getElementById('multi-banner').style.display='block';
  document.getElementById('multi-banner').textContent='☑ '+multiSelected.size+'枚に一括記録します';
  document.getElementById('kusa-section').style.display='none';
  document.getElementById('task-section').style.display='none';
  document.getElementById('hist-section').style.display='none';
  document.getElementById('bulk-extra').innerHTML='';
  document.getElementById('edit-savebtn').style.display='none';
  document.getElementById('cancel-edit-btn').style.display='none';
  document.getElementById('savebtn').style.display='block';
  document.getElementById('savebtn').disabled=true;
  const sg=document.getElementById('sgrid');sg.innerHTML='';
  ['はめた','外した'].forEach(s=>{
    const b=document.createElement('button');b.className='sbtn';b.textContent=s;
    b.style.cssText='background:'+(s==='はめた'?'#e8f0fe':'#fff3e0')+';border-color:'+(s==='はめた'?'#2980b9':'#e67e22')+';color:'+(s==='はめた'?'#2980b9':'#e67e22')+';';
    b.addEventListener('click',()=>{document.querySelectorAll('.sbtn').forEach(x=>x.classList.remove('sel'));b.classList.add('sel');selStatus=s;document.getElementById('savebtn').disabled=false;});
    sg.appendChild(b);
  });
  initTimeSelector(0,new Date().getHours());
  document.getElementById('panel').classList.add('open');
  document.getElementById('overlay').classList.add('on');
  document.getElementById('multi-bar').style.display='none';
}

// ============================================================
// 水尻フィルター
// ============================================================
function toggleMizushiFilter(status){
  mizushiFilters.has(status)?mizushiFilters.delete(status):mizushiFilters.add(status);
  const el=document.getElementById('mfc-'+status);if(el)el.classList.toggle('on',mizushiFilters.has(status));
  const btn=document.getElementById('mizushi-filter-btn');
  btn.classList.toggle('filtered',mizushiFilters.size>0);
  btn.textContent=mizushiFilters.size>0?'💧 水尻状態（'+mizushiFilters.size+'）▾':'💧 水尻状態 ▾';
  renderMap();
}
function resetMizushiFilter(){
  mizushiFilters.clear();
  ['設置済み','外し済み','未記録'].forEach(s=>{const el=document.getElementById('mfc-'+s);if(el)el.classList.remove('on');});
  const btn=document.getElementById('mizushi-filter-btn');
  if(btn){btn.classList.remove('filtered');btn.textContent='💧 水尻状態 ▾';}
  document.getElementById('mizushi-status-menu')?.classList.remove('open');
  renderMap();
}

// ============================================================
// 暗渠フィルター
// ============================================================
function toggleAnkyoFilter(status){
  ankyoFilters.has(status)?ankyoFilters.delete(status):ankyoFilters.add(status);
  const el=document.getElementById('akyfc-'+status);if(el)el.classList.toggle('on',ankyoFilters.has(status));
  const btn=document.getElementById('ankyo-status-btn');
  btn.classList.toggle('filtered',ankyoFilters.size>0);
  btn.textContent=ankyoFilters.size>0?'🕳 暗渠状態（'+ankyoFilters.size+'）▾':'🕳 暗渠状態 ▾';
  renderMap();
}
function resetAnkyoFilter(){
  ankyoFilters.clear();
  ['はめ済み','外し済み','なし','未登録'].forEach(s=>{const el=document.getElementById('akyfc-'+s);if(el)el.classList.remove('on');});
  const btn=document.getElementById('ankyo-status-btn');
  if(btn){btn.classList.remove('filtered');btn.textContent='🕳 暗渠状態 ▾';}
  document.getElementById('ankyo-status-menu')?.classList.remove('open');
  renderMap();
}
function toggleAnkyoSpecialFilter(){
  ankyoSpecialFilter=!ankyoSpecialFilter;
  const btn=document.getElementById('ankyo-special-btn');
  if(btn){btn.classList.toggle('filtered',ankyoSpecialFilter);btn.textContent=ankyoSpecialFilter?'🔧 特記事項あり ✓':'🔧 特記事項あり';}
  renderMap();
}

// ============================================================
// 水状態フィルター
// ============================================================
function buildStatusFilterMenu(){
  const menu=document.getElementById('status-filter-menu');
  if(!menu)return;
  menu.innerHTML=''; // 毎回再構築（S_OPTSが変わっても追従）

  // 件数を集計（GJ未ロード時は0件で表示）
  const counts={'未記録':0};
  S_OPTS.forEach(s=>counts[s]=0);
  if(GJ){
    GJ.features.forEach(feat=>{
      const nm=feat.properties.name.trim();
      const rec=records[nm];
      const st=rec?rec.status:'未記録';
      if(counts[st]!==undefined)counts[st]++;
      else counts['未記録']++;
    });
  }

  const allStatuses=['未記録',...S_OPTS.filter(s=>s!=='確認のみ')];
  allStatuses.forEach(s=>{
    const safeId='sfc-'+s.replace(/\s/g,'_');
    const col=s==='未記録'?'#95a5a6':(S_COL[s]||'#95a5a6');
    const div=document.createElement('div');div.className='fopt';
    div.style.cssText='display:flex;align-items:center;';
    div.innerHTML='<div class="fchk" id="'+safeId+'"></div>'
      +'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+col+';margin-right:4px;flex-shrink:0;"></span>'
      +'<span style="flex-grow:1;">'+s+'</span>'
      +'<span style="font-size:12px;color:#666;background:#f0f0f0;padding:2px 8px;border-radius:10px;font-weight:bold;margin-left:auto;">'+(counts[s]||0)+'</span>';
    div.addEventListener('click',()=>toggleStatusFilter(s,safeId));
    menu.appendChild(div);
  });
  const reset=document.createElement('div');
  reset.className='filter-reset';reset.textContent='✕ すべて表示にリセット';
  reset.addEventListener('click',resetStatusFilter);
  menu.appendChild(reset);

  // フィルター選択状態を復元
  statusFilters.forEach(s=>{
    const el=document.getElementById('sfc-'+s.replace(/\s/g,'_'));
    if(el)el.classList.add('on');
  });
}

// ============================================================
// アラートフィルターメニューの構築（件数表示付き・動的生成）
// ============================================================
function buildAlertFilterMenu(){
  const menu=document.getElementById('alert-menu');
  if(!menu)return;
  menu.innerHTML='';

  // 件数を集計
  const cntNew=Object.keys(kusaData).filter(nm=>{const d=getKusaDays(nm);return d>0&&d<3;}).length;
  const cntMid=Object.keys(kusaData).filter(nm=>{const d=getKusaDays(nm);return d>=3&&d<7;}).length;
  const cntOld=Object.keys(kusaData).filter(nm=>getKusaDays(nm)>=7).length;
  const cntMemo=Object.keys(memoData).filter(nm=>memoData[nm]&&memoData[nm].length>0).length;

  const items=[
    {key:'kusa_new',label:'草刈り（3日未満）',bg:'#27ae60',icon:'🌿',cnt:cntNew},
    {key:'kusa_mid',label:'草刈り（3〜7日）', bg:'#e67e22',icon:'🌿',cnt:cntMid},
    {key:'kusa_old',label:'草刈り（7日以上）',bg:'#e74c3c',icon:'🌿',cnt:cntOld},
    {key:'memo',    label:'メモあり',          bg:null,   icon:'⚠️',cnt:cntMemo},
  ];

  items.forEach(item=>{
    const div=document.createElement('div');div.className='fopt';
    div.style.cssText='display:flex;align-items:center;';
    const iconHtml=item.bg
      ?'<span style="background:'+item.bg+';border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;margin-right:4px;flex-shrink:0;">'+item.icon+'</span>'
      :'<span style="margin-right:4px;flex-shrink:0;">'+item.icon+'</span>';
    div.innerHTML='<div class="fchk" id="afc-'+item.key+'"></div>'
      +iconHtml
      +'<span style="flex-grow:1;">'+item.label+'</span>'
      +'<span style="font-size:12px;color:#666;background:#f0f0f0;padding:2px 8px;border-radius:10px;font-weight:bold;margin-left:auto;">'+item.cnt+'</span>';
    div.addEventListener('click',()=>toggleAlertFilter(item.key));
    menu.appendChild(div);
  });

  const reset=document.createElement('div');
  reset.className='filter-reset';reset.textContent='✕ すべて表示にリセット';
  reset.addEventListener('click',resetAlertFilter);
  menu.appendChild(reset);

  // フィルター選択状態を復元
  alertFilters.forEach(t=>{
    const el=document.getElementById('afc-'+t);
    if(el)el.classList.add('on');
  });
}

// ============================================================
// 水尻フィルターメニューの構築（件数表示付き・動的生成）
// ============================================================
function buildMizushiFilterMenu(){
  const menu=document.getElementById('mizushi-status-menu');
  if(!menu||!GJ)return;
  menu.innerHTML='';

  // 件数を集計
  const counts={設置済み:0,外し済み:0,未記録:0};
  GJ.features.forEach(f=>{
    const nm=f.properties.name.trim();
    const m=mizushiData[nm];
    if(!m)counts['未記録']++;
    else if(m.status==='設置済み')counts['設置済み']++;
    else if(m.status==='外し済み')counts['外し済み']++;
    else counts['未記録']++;
  });

  const items=[
    {key:'設置済み',col:'#8e44ad'},
    {key:'外し済み',col:'#e67e22'},
    {key:'未記録',  col:'#95a5a6'},
  ];
  items.forEach(item=>{
    const div=document.createElement('div');div.className='fopt';
    div.style.cssText='display:flex;align-items:center;';
    div.innerHTML='<div class="fchk" id="mfc-'+item.key+'"></div>'
      +'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+item.col+';margin-right:4px;flex-shrink:0;"></span>'
      +'<span style="flex-grow:1;">'+item.key+'</span>'
      +'<span style="font-size:12px;color:#666;background:#f0f0f0;padding:2px 8px;border-radius:10px;font-weight:bold;margin-left:auto;">'+counts[item.key]+'</span>';
    div.addEventListener('click',()=>toggleMizushiFilter(item.key));
    menu.appendChild(div);
  });
  const reset=document.createElement('div');
  reset.className='filter-reset';reset.textContent='✕ すべて表示にリセット';
  reset.addEventListener('click',resetMizushiFilter);
  menu.appendChild(reset);

  mizushiFilters.forEach(s=>{
    const el=document.getElementById('mfc-'+s);
    if(el)el.classList.add('on');
  });
}

// ============================================================
// 暗渠フィルターメニューの構築（件数表示付き・動的生成）
// ============================================================
function buildAnkyoFilterMenu(){
  const menu=document.getElementById('ankyo-status-menu');
  if(!menu||!GJ)return;
  menu.innerHTML='';

  // 件数を集計（updateSummaryの暗渠ロジックと同じ）
  const counts={はめ済み:0,外し済み:0,なし:0,未登録:0};
  GJ.features.forEach(f=>{
    const nm=f.properties.name.trim();
    const master=ankyoMaster[nm];
    if(!master){counts['未登録']++;return;}
    if(master.hasAnkyo==='なし'){counts['なし']++;return;}
    const op=ankyoOpData[nm];
    if(!op||op.status==='はめた')counts['はめ済み']++;
    else counts['外し済み']++;
  });

  const items=[
    {key:'はめ済み',col:'#2980b9'},
    {key:'外し済み',col:'#e67e22'},
    {key:'なし',    col:'#27ae60'},
    {key:'未登録',  col:'#95a5a6'},
  ];
  items.forEach(item=>{
    const div=document.createElement('div');div.className='fopt';
    div.style.cssText='display:flex;align-items:center;';
    div.innerHTML='<div class="fchk" id="akyfc-'+item.key+'"></div>'
      +'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+item.col+';margin-right:4px;flex-shrink:0;"></span>'
      +'<span style="flex-grow:1;">'+item.key+'</span>'
      +'<span style="font-size:12px;color:#666;background:#f0f0f0;padding:2px 8px;border-radius:10px;font-weight:bold;margin-left:auto;">'+counts[item.key]+'</span>';
    div.addEventListener('click',()=>toggleAnkyoFilter(item.key));
    menu.appendChild(div);
  });
  const reset=document.createElement('div');
  reset.className='filter-reset';reset.textContent='✕ すべて表示にリセット';
  reset.addEventListener('click',resetAnkyoFilter);
  menu.appendChild(reset);

  ankyoFilters.forEach(s=>{
    const el=document.getElementById('akyfc-'+s);
    if(el)el.classList.add('on');
  });
}

function toggleStatusFilter(status,safeId){
  statusFilters.has(status)?statusFilters.delete(status):statusFilters.add(status);
  const el=document.getElementById(safeId||'sfc-'+status.replace(/\s/g,'_'));
  if(el)el.classList.toggle('on',statusFilters.has(status));
  const btn=document.getElementById('status-filter-btn');
  btn.classList.toggle('filtered',statusFilters.size>0);
  btn.textContent=statusFilters.size>0?'💧 水状態（'+statusFilters.size+'）▾':'💧 水状態 ▾';
  renderMap();
}

function resetStatusFilter(){
  statusFilters.clear();
  document.querySelectorAll('[id^="sfc-"]').forEach(el=>el.classList.remove('on'));
  const btn=document.getElementById('status-filter-btn');
  if(btn){btn.classList.remove('filtered');btn.textContent='💧 水状態 ▾';}
  document.getElementById('status-filter-menu')?.classList.remove('open');
  renderMap();
}

// ============================================================
// トースト通知
// ============================================================
function showToast(msg){
  let toast=document.getElementById('toast-msg');
  if(!toast){
    toast=document.createElement('div');
    toast.id='toast-msg';
    toast.style.cssText='position:fixed;bottom:120px;left:50%;transform:translateX(-50%);background:rgba(39,174,96,0.95);color:#fff;padding:12px 24px;border-radius:30px;font-size:14px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,0.25);z-index:9999;opacity:0;pointer-events:none;transition:opacity 0.3s ease;white-space:nowrap;';
    document.body.appendChild(toast);
  }
  toast.textContent=msg;
  clearTimeout(toast._timer);
  setTimeout(()=>{toast.style.opacity='1';},10);
  toast._timer=setTimeout(()=>{toast.style.opacity='0';},3000);
}

// ============================================================
// バッジボタン：草刈り・メモセクションの展開/折りたたみ
// ============================================================
function toggleBadgeSection(type){
  const sectionId=type==='kusa'?'kusa-section':'task-section';
  const btnId=type==='kusa'?'kusa-badge-btn':'memo-badge-btn';
  const section=document.getElementById(sectionId);
  const btn=document.getElementById(btnId);
  if(!section||!btn)return;
  const isOpen=section.style.display!=='none';
  section.style.display=isOpen?'none':'block';
  btn.classList.toggle('active',!isOpen);
  if(!isOpen){
    btn.style.background=type==='kusa'?'#27ae60':'#e67e22';
    btn.style.color='#fff';
  }else{
    btn.style.background='#fff';
    btn.style.color=type==='kusa'?'#27ae60':'#e67e22';
  }
}

// ============================================================
// 圃場を画面の見やすい位置にスマートにセンタリング
// ============================================================
function focusOnFeature(feat){
  if(!map||!feat)return;
  try{
    const center=getPolygonCentroid(feat)||L.geoJSON(feat).getBounds().getCenter();
    const pt=map.project(center,map.getZoom());
    pt.y+=120; // パネルの上・ヘッダーの下のゴールデンゾーンへ
    const newCenter=map.unproject(pt,map.getZoom());
    map.panTo(newCenter,{animate:true,duration:0.3});
  }catch(e){}
}
