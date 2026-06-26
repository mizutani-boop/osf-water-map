const SS_ID = '1k9soQORhf54UV6tkX3wWBH01DUKA_ct_lPBmzvgUovY';

// スプレッドシートを1回だけ開いてキャッシュ（openByIdの多重呼び出しを防ぐ）
let ssCache = null;
function getSpreadsheet() {
  if (!ssCache) ssCache = SpreadsheetApp.openById(SS_ID);
  return ssCache;
}

// ==========================================
// LINE WORKS 通知設定
// ※ BOT_PRIVATE_KEY はスクリプトプロパティに保存
// ==========================================
const LW_BOT_ID       = '11848677';
const LW_CLIENT_ID    = '5AE8y878trrNc3te2PSd';
const LW_CLIENT_SECRET= 'njJLqq4ZGf';
const LW_SERVICE_ACCOUNT = 'lytr4.serviceaccount@onceedfarmcoltd';

// アクセストークンを取得（JWT → OAuth2）
function getLWAccessToken() {
  const rawKey = PropertiesService.getScriptProperties().getProperty('BOT_PRIVATE_KEY');
  const privateKey = rawKey.replace(/\\n/g, '\n').trim();
  const now = Math.floor(Date.now() / 1000);
  const header = Utilities.base64EncodeWebSafe(JSON.stringify({alg:'RS256',typ:'JWT'})).replace(/=+$/,'');
  const claim  = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: LW_CLIENT_ID,
    sub: LW_SERVICE_ACCOUNT,
    iat: now,
    exp: now + 3600
  })).replace(/=+$/,'');
  const sigInput = header + '.' + claim;
  const sig = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(sigInput, privateKey)
  ).replace(/=+$/,'');
  const jwt = sigInput + '.' + sig;

  const res = UrlFetchApp.fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      assertion: jwt,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: LW_CLIENT_ID,
      client_secret: LW_CLIENT_SECRET,
      scope: 'bot'
    }
  });
  return JSON.parse(res.getContentText()).access_token;
}

// グループにメッセージを送信
function sendLWMessage(channelId, text) {
  const token = getLWAccessToken();
  UrlFetchApp.fetch(
    'https://www.worksapis.com/v1.0/bots/' + LW_BOT_ID + '/channels/' + channelId + '/messages',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ content: { type: 'text', text: text } })
    }
  );
}

// 草刈りアラートのアクティブ件数を取得
function getKusaAlertCount() {
  const sheet = getKusaSheet();
  const rows = sheet.getDataRange().getValues();
  const latest = {};
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    latest[rows[i][0]] = rows[i][1];
  }
  return Object.values(latest).filter(s => s === '要草刈り').length;
}

// 水管理の要確認件数を取得（入水・ちょい入れ・止水・除草剤投入 で4日超）
function getWaterAlertCount() {
  const sheet = getMainSheet();
  const rows = sheet.getDataRange().getValues();
  const latest = {};
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    latest[rows[i][0]] = { status: rows[i][1], time: rows[i][4] };
  }
  const targetStatuses = new Set(['入水','ちょい入れ','止水','除草剤投入']);
  const now = Date.now();
  let count = 0;
  Object.values(latest).forEach(r => {
    if (!targetStatuses.has(r.status)) return;
    const days = (now - new Date(r.time).getTime()) / 86400000;
    if (days >= 4) count++;
  });
  return count;
}

// 定期通知メイン（トリガーから呼び出す）
function sendDailyAlert() {
  const channelId = PropertiesService.getScriptProperties().getProperty('LW_CHANNEL_ID');
  if (!channelId) { Logger.log('Channel ID未設定'); return; }

  const kusaCount  = getKusaAlertCount();
  const waterCount = getWaterAlertCount();

  if (kusaCount === 0 && waterCount === 0) {
    Logger.log('アラートなし。通知スキップ。');
    return;
  }

  const hour = new Date().getHours();
  const timeLabel = hour < 10 ? '朝' : '昼';
  let msg = '【OSF 水管理アラート】' + timeLabel + '\n\n';
  if (kusaCount  > 0) msg += '🌿 草刈り要請：' + kusaCount  + '枚\n';
  if (waterCount > 0) msg += '💧 要確認（4日超）：' + waterCount + '枚\n';
  msg += '\n確認はこちら → https://osfwatermap.vercel.app';

  sendLWMessage(channelId, msg);
  Logger.log('通知送信完了：' + msg);
}

function getSheetName(prefix) {
  return prefix + '_' + new Date().getFullYear();
}

function getSheet(prefix, headers) {
  const ss = getSpreadsheet();
  const name = getSheetName(prefix);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function getMainSheet() {
  return getSheet('水管理記録', ['圃場名','状態','担当者','メモ','記録日時','備考']);
}

function getKusaSheet() {
  return getSheet('畦草記録', ['圃場名','状態','担当者','記録日時']);
}

function getMemoSheet() {
  return getSheet('メモ記録', ['圃場名','内容','担当者','記録日時','対応状態','対応者','対応日時','photo_id','resolve_photo_id']);
}


function getMizushiSheet() {
  return getSheet('水尻記録', ['圃場名','状態','担当者','記録日時']);
}

function getAnkyoMasterSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName('暗渠マスタ');
  if (!sheet) {
    sheet = ss.insertSheet('暗渠マスタ');
    sheet.appendRow(['圃場名','あり/なし','本数','サイズ内訳','特記事項','更新日時']);
  }
  return sheet;
}

function getAnkyoSheet() {
  return getSheet('暗渠記録', ['圃場名','状態','担当者','記録日時']);
}

// 写真保存用Driveフォルダを取得（なければ作成）
function getPhotoFolder() {
  const folderName = 'OSF水管理_写真';
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

// ==========================================
// [NEW] 設定シートの読み書き
// ==========================================
function getSettingsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName('設定');
  if (!sheet) {
    sheet = ss.insertSheet('設定');
    sheet.appendRow(['キー', '値']);
  }
  return sheet;
}

function readSettings() {
  const sheet = getSettingsSheet();
  const rows = sheet.getDataRange().getValues();
  const settings = {};
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    try { settings[rows[i][0]] = JSON.parse(rows[i][1]); }
    catch(e) { settings[rows[i][0]] = rows[i][1]; }
  }
  return settings;
}

function writeSettings(key, value) {
  const sheet = getSettingsSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(value));
      return;
    }
  }
  sheet.appendRow([key, JSON.stringify(value)]);
}

// ==========================================
// 読み込み処理 (GET)
// ==========================================
function doGet(e) {
  const mode = (e && e.parameter && e.parameter.mode) ? e.parameter.mode : 'normal';

  // 0. 全データ一括モード（通信最適化）
  if (mode === 'all') {
    const mainSheet = getMainSheet();
    const kusaSheet = getKusaSheet();
    const memoSheet = getMemoSheet();

    // 水管理：最新1件
    const mainRows = mainSheet.getDataRange().getValues();
    const latest = {};
    for (let i = 1; i < mainRows.length; i++) {
      if (!mainRows[i][0]) continue;
      const nm = mainRows[i][0];
      const time = mainRows[i][4];
      if (!latest[nm] || new Date(time).getTime() > new Date(latest[nm].time).getTime()) {
        latest[nm] = { status: mainRows[i][1], person: mainRows[i][2], memo: mainRows[i][3], time: time };
      }
    }

    // 水管理：履歴
    const history = mainRows.slice(1).map(r => [r[0], r[1], r[2], r[3], r[4]]);

    // 草刈り：最新が'要草刈り'のみ
    const kusaRows = kusaSheet.getDataRange().getValues();
    const kusaLatest = {};
    for (let i = 1; i < kusaRows.length; i++) {
      if (!kusaRows[i][0]) continue;
      kusaLatest[kusaRows[i][0]] = { status: kusaRows[i][1], person: kusaRows[i][2], time: kusaRows[i][3] };
    }
    const kusa = {};
    Object.keys(kusaLatest).forEach(nm => {
      if (kusaLatest[nm].status === '要草刈り') kusa[nm] = kusaLatest[nm];
    });

    // メモ：未対応の全件
    const memoRows = memoSheet.getDataRange().getValues();
    const memo = {};
    for (let i = 1; i < memoRows.length; i++) {
      if (!memoRows[i][0] || memoRows[i][4] !== '未対応') continue;
      const nm = memoRows[i][0];
      if (!memo[nm]) memo[nm] = [];
      memo[nm].push({ content: memoRows[i][1], person: memoRows[i][2], time: memoRows[i][3], photoId: memoRows[i][7]||'', resolvePhotoId: memoRows[i][8]||'' });
    }

    // メモ履歴：全件（photo_id・resolve_photo_id含む）
    const memoHist = memoRows.slice(1).map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]||'', r[8]||'']);

    // [NEW] 設定シートから水管理項目を返す
    const settings = readSettings();

    // 水尻・暗渠データ（try-catchで既存データを守る）
    let mizushi = {}, ankyoMasterData = {}, ankyoOp = {};
    try {
      const mizushiSh = getMizushiSheet();
      const mizushiRows = mizushiSh.getDataRange().getValues();
      for (let i = 1; i < mizushiRows.length; i++) {
        if (!mizushiRows[i][0]) continue;
        mizushi[mizushiRows[i][0]] = { status: mizushiRows[i][1], person: mizushiRows[i][2], time: mizushiRows[i][3] ? new Date(mizushiRows[i][3]).toISOString() : '' };
      }
    } catch(e) { Logger.log('水尻データ取得エラー: ' + e); }

    try {
      const ankyoMasterSh = getAnkyoMasterSheet();
      const ankyoMasterRows = ankyoMasterSh.getDataRange().getValues();
      for (let i = 1; i < ankyoMasterRows.length; i++) {
        if (!ankyoMasterRows[i][0]) continue;
        let sizes = [];
        try { sizes = JSON.parse(ankyoMasterRows[i][3]); } catch(e2) {}
        ankyoMasterData[ankyoMasterRows[i][0]] = {
          hasAnkyo: ankyoMasterRows[i][1],
          count: ankyoMasterRows[i][2],
          sizes,
          note: ankyoMasterRows[i][4],
          updatedAt: ankyoMasterRows[i][5] ? new Date(ankyoMasterRows[i][5]).toISOString() : ''
        };
      }
    } catch(e) { Logger.log('暗渠マスタ取得エラー: ' + e); }

    try {
      const ankyoSh = getAnkyoSheet();
      const ankyoRows = ankyoSh.getDataRange().getValues();
      for (let i = 1; i < ankyoRows.length; i++) {
        if (!ankyoRows[i][0]) continue;
        ankyoOp[ankyoRows[i][0]] = { status: ankyoRows[i][1], person: ankyoRows[i][2], time: ankyoRows[i][3] ? new Date(ankyoRows[i][3]).toISOString() : '' };
      }
    } catch(e) { Logger.log('暗渠操作記録取得エラー: ' + e); }

    // ===== 田植日マスタ =====
    var plantingDates = {};
    try {
      var plantingSheet = getSpreadsheet().getSheetByName('田植日マスタ_2026');
      if (plantingSheet) {
        var pRows = plantingSheet.getDataRange().getValues();
        for (var i = 1; i < pRows.length; i++) {
          var fid = pRows[i][0];
          var pdate = pRows[i][1];
          var ptype = pRows[i][2];
          if (fid) plantingDates[String(fid)] = { date: String(pdate), type: String(ptype) };
        }
      }
    } catch(e) { Logger.log('田植日マスタ取得エラー: ' + e); }

    const result = { latest, history, kusa, memo, memoHist, settings, mizushi, ankyoMaster: ankyoMasterData, ankyoOp, plantingDates };
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }

  // 1. 履歴モード
  if (mode === 'history') {
    const sheet = getMainSheet();
    const rows = sheet.getDataRange().getValues();
    const history = rows.slice(1).map(r => [r[0], r[1], r[2], r[3], r[4]]);
    return ContentService.createTextOutput(JSON.stringify(history)).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. 草刈りモード
  if (mode === 'kusa') {
    const sheet = getKusaSheet();
    const rows = sheet.getDataRange().getValues();
    const kusaLatest = {};
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      kusaLatest[rows[i][0]] = { status: rows[i][1], person: rows[i][2], time: rows[i][3] };
    }
    const result = {};
    Object.keys(kusaLatest).forEach(nm => {
      if (kusaLatest[nm].status === '要草刈り') result[nm] = kusaLatest[nm];
    });
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }

  // 3. メモモード
  if (mode === 'memo') {
    const sheet = getMemoSheet();
    const rows = sheet.getDataRange().getValues();
    const result = {};
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0] || rows[i][4] !== '未対応') continue;
      const nm = rows[i][0];
      if (!result[nm]) result[nm] = [];
      result[nm].push({ content: rows[i][1], person: rows[i][2], time: rows[i][3] });
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  }

  // 4. メモ履歴モード
  if (mode === 'memo_hist') {
    const sheet = getMemoSheet();
    const rows = sheet.getDataRange().getValues();
    const hist = rows.slice(1).map(r => [r[0], r[1], r[2], r[3], r[4], r[5], r[6]]);
    return ContentService.createTextOutput(JSON.stringify(hist)).setMimeType(ContentService.MimeType.JSON);
  }

  // 5. 通常モード
  const sheet = getMainSheet();
  const rows = sheet.getDataRange().getValues();
  const latest = {};
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const nm = rows[i][0];
    const time = rows[i][4];
    if (!latest[nm] || new Date(time).getTime() > new Date(latest[nm].time).getTime()) {
      latest[nm] = { status: rows[i][1], person: rows[i][2], memo: rows[i][3], time: time };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(latest)).setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// 保存処理 (POST) — LockServiceで排他制御
// ==========================================
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const data = JSON.parse(e.postData.contents);

  // 写真アップロード → Driveに保存してfileIdを返す
  if (data.action === 'photo_upload') {
    const folder = getPhotoFolder();
    const bytes = Utilities.base64Decode(data.base64);
    const blob = Utilities.newBlob(bytes, data.mimeType || 'image/jpeg', 'photo_' + Date.now() + '.jpg');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return ContentService.createTextOutput(JSON.stringify({ok: true, fileId: file.getId()})).setMimeType(ContentService.MimeType.JSON);
  }

  // 水尻単件記録
  if (data.action === 'mizushi_save') {
    const sh = getMizushiSheet();
    const time = data.time ? new Date(data.time).toISOString() : new Date().toISOString();
    sh.appendRow([data.name, data.status, data.person, time]);
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 水尻一括記録
  if (data.action === 'mizushi_bulk') {
    const sh = getMizushiSheet();
    const time = data.time ? new Date(data.time).toISOString() : new Date().toISOString();
    const rows = (data.names || []).map(nm => [nm, data.status, data.person, time]);
    if (rows.length > 0) {
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 暗渠マスタ登録・編集
  if (data.action === 'ankyo_master_save') {
    const sh = getAnkyoMasterSheet();
    const rows = sh.getDataRange().getValues();
    const now = new Date().toISOString();
    const sizesJson = JSON.stringify(data.sizes || []);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.name) {
        sh.getRange(i + 1, 2, 1, 5).setValues([[data.hasAnkyo, data.count || 0, sizesJson, data.note || '', now]]);
        return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
      }
    }
    sh.appendRow([data.name, data.hasAnkyo, data.count || 0, sizesJson, data.note || '', now]);
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 暗渠操作記録（はめた/外した）単件
  if (data.action === 'ankyo_operation_save') {
    const sh = getAnkyoSheet();
    const time = data.time ? new Date(data.time).toISOString() : new Date().toISOString();
    sh.appendRow([data.name, data.status, data.person, time]);
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 暗渠操作一括
  if (data.action === 'ankyo_operation_bulk') {
    const sh = getAnkyoSheet();
    const time = data.time ? new Date(data.time).toISOString() : new Date().toISOString();
    const rows = (data.names || []).map(nm => [nm, data.status, data.person, time]);
    if (rows.length > 0) {
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // [NEW] 管理者認証
  if (data.action === 'admin_auth') {
    const pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
    if (!pw) return ContentService.createTextOutput(JSON.stringify({ok: false, error: 'パスワード未設定'})).setMimeType(ContentService.MimeType.JSON);
    const ok = data.password === pw;
    return ContentService.createTextOutput(JSON.stringify({ok})).setMimeType(ContentService.MimeType.JSON);
  }

  // [NEW] 設定保存（パスワード再検証付き）
  if (data.action === 'save_settings') {
    const pw = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
    if (!pw || data.password !== pw) return ContentService.createTextOutput(JSON.stringify({ok: false, error: '認証エラー'})).setMimeType(ContentService.MimeType.JSON);
    writeSettings(data.key, data.value);
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 0. 一括保存
  if (data.action === 'save') {
    const recordTime = data.time ? new Date(data.time).toISOString() : new Date().toISOString();
    if (data.water) {
      const sheet = getMainSheet();
      sheet.appendRow([data.name, data.water.status, data.person, data.water.memo||'', new Date(data.water.time).toISOString(), '']);
    }
    if (data.kusa) {
      const sheet = getKusaSheet();
      sheet.appendRow([data.name, data.kusa, data.person, recordTime]);
    }
    if (data.memo) {
      const sheet = getMemoSheet();
      sheet.appendRow([data.name, data.memo.content, data.person, recordTime, '未対応', '', '', data.memo.photoId||'']);
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 0b. 修正処理
  if (data.action === 'edit') {
    const sheet = getMainSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] === data.name &&
          Math.abs(new Date(rows[i][4]).getTime() - new Date(data.originalTime).getTime()) < 1000) {
        sheet.getRange(i + 1, 2).setValue(data.status);
        sheet.getRange(i + 1, 3).setValue(data.person);
        sheet.getRange(i + 1, 4).setValue(data.memo || '');
        sheet.getRange(i + 1, 5).setValue(new Date(data.time).toISOString());
        sheet.getRange(i + 1, 6).setValue('修正');
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 1. 削除処理
  if (data.action === 'delete') {
    const sheet = getMainSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] === data.name &&
          Math.abs(new Date(rows[i][4]).getTime() - new Date(data.time).getTime()) < 1000) {
        sheet.deleteRow(i + 1);
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. 一括記録処理
  if (data.action === 'bulk') {
    const sheet = getMainSheet();
    const rows = data.records.map(r => [
      r.name, r.status, r.person, r.memo || '',
      new Date(r.time).toISOString(), ''
    ]);
    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 3. 草刈りアラートの記録（単件）
  if (data.action === 'kusa') {
    const sheet = getKusaSheet();
    sheet.appendRow([data.name, data.status, data.person, new Date().toISOString()]);
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 3b. 草刈りアラートの一括処理
  if (data.action === 'kusa_bulk') {
    const sheet = getKusaSheet();
    const time = data.time ? new Date(data.time).toISOString() : new Date().toISOString();
    const rows = (data.names || []).map(nm => [nm, data.status || '解除', data.person, time]);
    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 4. メモ追加（単件）
  if (data.action === 'memo') {
    const sheet = getMemoSheet();
    sheet.appendRow([data.name, data.content, data.person, new Date().toISOString(), '未対応', '', '', data.photoId||'']);
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 4b. メモ一括追加
  if (data.action === 'memo_bulk') {
    const sheet = getMemoSheet();
    const time = data.time || new Date().toISOString();
    const rows = (data.names || []).map(nm => [nm, data.content, data.person, time, '未対応', '', '']);
    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 5. メモ対応済み（単件）
  if (data.action === 'memo_resolve') {
    const sheet = getMemoSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] === data.name && rows[i][4] === '未対応' &&
          Math.abs(new Date(rows[i][3]).getTime() - new Date(data.memoTime).getTime()) < 1000) {
        sheet.getRange(i + 1, 5).setValue('対応済み');
        sheet.getRange(i + 1, 6).setValue(data.person || '');
        sheet.getRange(i + 1, 7).setValue(new Date().toISOString());
        if (data.resolvePhotoId) sheet.getRange(i + 1, 9).setValue(data.resolvePhotoId);
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 5-ex. 対応済みメモへの写真後付け追加
  if (data.action === 'memo_add_resolve_photo') {
    const sheet = getMemoSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] === data.name &&
          Math.abs(new Date(rows[i][3]).getTime() - new Date(data.memoTime).getTime()) < 1000) {
        sheet.getRange(i + 1, 9).setValue(data.photoId);
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 5b. メモ対応済み（一括）
  if (data.action === 'memo_resolve_bulk') {
    const sheet = getMemoSheet();
    const rows = sheet.getDataRange().getValues();
    const names = new Set(data.names || []);
    const resolvedTime = new Date().toISOString();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (names.has(rows[i][0]) && rows[i][4] === '未対応') {
        sheet.getRange(i + 1, 5).setValue('対応済み');
        sheet.getRange(i + 1, 6).setValue(data.person || '');
        sheet.getRange(i + 1, 7).setValue(resolvedTime);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 5c. 既存メモへの写真追加
  if (data.action === 'memo_add_photo') {
    const sheet = getMemoSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] === data.name && rows[i][4] === '未対応' &&
          Math.abs(new Date(rows[i][3]).getTime() - new Date(data.memoTime).getTime()) < 1000) {
        sheet.getRange(i + 1, 8).setValue(data.photoId);
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 5d. メモ編集
  if (data.action === 'memo_edit') {
    const sheet = getMemoSheet();
    const rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] === data.name && rows[i][4] === '未対応' &&
          Math.abs(new Date(rows[i][3]).getTime() - new Date(data.memoTime).getTime()) < 1000) {
        sheet.getRange(i + 1, 2).setValue(data.content);
        break;
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);
  }

  // 6. 通常の水管理記録
  const sheet = getMainSheet();
  sheet.appendRow([
    data.name, data.status, data.person, data.memo || '',
    data.time ? new Date(data.time).toISOString() : new Date().toISOString(),
    data.correction ? '修正' : ''
  ]);
  return ContentService.createTextOutput(JSON.stringify({ok: true})).setMimeType(ContentService.MimeType.JSON);

  } catch(f) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: f.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 重複削除ユーティリティ（メインシート用）
// ==========================================
function deleteDuplicateRecords() {
  const sheet = getMainSheet();
  const rows = sheet.getDataRange().getValues();
  const seen = new Set();
  const toDelete = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const name = rows[i][0];const status = rows[i][1];const time = rows[i][4];
    if (!name || !status) continue;
    const date = new Date(time).toLocaleDateString('ja');
    const key = name + '_' + status + '_' + date;
    if (seen.has(key)){toDelete.push(i + 1);}else{seen.add(key);}
  }
  toDelete.sort((a, b) => b - a);
  toDelete.forEach(row => sheet.deleteRow(row));
  Logger.log(toDelete.length + '行削除しました');
}