/**
 * Cana Australasia – Visitor Induction & Sign-In
 * ------------------------------------------------
 * Google Apps Script web app, bound to the "Visitor Register" Google Sheet.
 *
 *   First-time setup : in the script editor choose the function "setup" and press Run
 *                      (it creates any missing tabs and formats the log).
 *   Deploy           : Deploy ▸ New deployment ▸ Web app
 *                      Execute as: Me   /   Who has access: Anyone
 *   Visitor page     : index.html hosted on your own web page / GitHub Pages, which talks to this
 *                      script as a JSON API (visitors never need a Google account). The web-app URL
 *                      itself also serves the page as a fallback, with  ?page=qr  for a poster.
 *
 * Everything visitors see (site name, rules, hosts, purposes, areas, messages) is edited
 * in the spreadsheet tabs – no code changes needed.
 */

var TZ = 'Asia/Bangkok';

var SHEET = {
  LOG: 'Visitor Log',
  HOSTS: 'Hosts',
  RULES: 'Site Rules',
  SETTINGS: 'Settings'
};

var LOG_HEADERS = [
  'Timestamp', 'Date', 'Time In', 'Visitor No', 'Full Name', 'Company', 'Phone', 'Email',
  'Purpose', 'Purpose Detail', 'Host', 'Areas', 'Vehicle Rego',
  'Visited another grow site (24h)', 'Unwell / open cuts', 'Rules Acknowledged',
  'Typed Signature', 'Signature Image', 'Time Out', 'Duration (min)', 'Status',
  'ID Sighted (staff)', 'Pass Returned (staff)', 'Notes (staff)', 'Host Notified'
];
var LOG_WIDTHS = [150, 95, 70, 90, 170, 160, 120, 200, 170, 180, 150, 200, 100, 120, 110, 100, 160, 220, 80, 90, 90, 90, 100, 220, 90];

// 1-based column numbers – must match the order of LOG_HEADERS
var C = {
  TIMESTAMP: 1, DATE: 2, TIME_IN: 3, VISITOR_NO: 4, NAME: 5, COMPANY: 6, PHONE: 7, EMAIL: 8,
  PURPOSE: 9, PURPOSE_DETAIL: 10, HOST: 11, AREAS: 12, REGO: 13,
  VISITED_GROW: 14, UNWELL: 15, RULES_ACK: 16,
  TYPED_SIG: 17, SIG_IMAGE: 18, TIME_OUT: 19, DURATION: 20, STATUS: 21,
  ID_SIGHTED: 22, PASS_RETURNED: 23, NOTES: 24, HOST_NOTIFIED: 25
};

var STATUS_ON_SITE = 'On site';
var STATUS_SIGNED_OUT = 'Signed out';

var DEFAULT_SETTINGS = [
  ['site_name', 'Cana Australasia', 'Company / site name shown at the top of the app and in emails'],
  ['app_title', 'Visitor Induction & Sign-In', 'Sub-heading shown under the site name'],
  ['welcome_message', 'Welcome. Before you enter the site, please complete this short induction and sign in. It takes about two minutes.', 'Text on the first screen'],
  ['purposes', 'Delivery or pick-up, Contractor or maintenance, Audit or inspection, Meeting, Interview, Other', 'Purpose-of-visit options, separated by commas. Keep "Other" last – it asks for a description'],
  ['areas', 'Office only, Cultivation, Drying / processing, Storage, Loading dock', 'Areas a visitor can select, separated by commas'],
  ['require_drawn_signature', 'YES', 'YES = visitors must sign with a finger on screen as well as typing their name. NO = typed name only'],
  ['require_visitor_email', 'NO', 'YES = visitors must give an email address. NO = the email field is optional'],
  ['notify_hosts', 'YES', 'YES = email the host (from the Hosts tab) when their visitor signs in'],
  ['notify_email', '', 'Optional. Extra email address(es), separated by commas, that receive every sign-in (e.g. reception or security)'],
  ['reception_message', 'Please take a seat in reception. Your host will come and collect you.', 'Shown on the confirmation screen after signing in'],
  ['assembly_point', 'Front car park', 'Emergency assembly point shown in the site rules step'],
  ['privacy_note', 'Your details are collected for site security, safety and regulatory records and are only accessible to Cana Australasia staff.', 'Small print at the bottom of every screen'],
  ['logo_url', '', 'Optional. Web address of a logo image to show at the top of the app'],
  ['theme_colour', '#1b5e3f', 'Main colour of the app (a hex colour such as #1b5e3f)'],
  ['next_visitor_number', '1', 'Managed by the app – the next visitor number to issue']
];

var DEFAULT_RULES = [
  'Sign in on arrival and sign out when you leave. Wear your visitor pass at all times and show photo ID if asked.',
  'Stay with your host at all times. Never enter any area unaccompanied or open doors for others.',
  'No photos, video or recordings anywhere on site, and do not post about the site on social media.',
  'Everything you see or hear on site is confidential.',
  'Wear the PPE you are given in all cultivation, processing and storage areas, and follow the gowning procedure.',
  'Do not touch plants, product, equipment or documents unless asked. Nothing leaves the site.',
  'Do not bring plant material, soil, seeds, food or drink into the facility. Tell your host if you have visited another growing site or handled plants in the last 24 hours.',
  'No weapons, alcohol or drugs on site. Bags and vehicles may be inspected. CCTV is in operation.',
  'Follow all signage and safety directions, and report any hazard or incident to your host immediately. In an emergency, go with your host to the assembly point.',
  'No one under 18 is permitted on site. Breaches of these rules will result in removal from the premises.'
];

var HOST_HEADERS = ['Name', 'Email', 'Mobile', 'Active (YES/NO)'];
var EXAMPLE_HOST = 'Example Host (replace me)';
// Seeded into the Hosts tab by setup() when it still only holds the example row – add emails in the sheet
var DEFAULT_HOSTS = [
  ['Hieu (Justin)', '', '', 'YES'],
  ['Ricky', '', '', 'YES'],
  ['Lalit', '', '', 'YES'],
  ['Hung (Becks)', '', '', 'YES'],
  ['Kevin', '', '', 'YES'],
  ['Johnny', '', '', 'YES']
];
var RULE_HEADERS = ['#', 'Rule'];
var SETTING_HEADERS = ['Setting', 'Value', 'What it does'];

// ---------------------------------------------------------------------------
// Web app entry point
// ---------------------------------------------------------------------------

function doGet(e) {
  var param = (e && e.parameter) || {};
  if (param.api === 'config') return json_({ ok: true, result: getConfig_() });
  var page = param.page === 'qr' ? 'qr' : 'app';
  var config = getConfig_();
  var t = HtmlService.createTemplateFromFile('Index');
  t.pageJson = JSON.stringify(page);
  t.appUrlJson = JSON.stringify(getAppUrl_());
  t.configJson = JSON.stringify(config).replace(/<\//g, '<\\/');
  return t.evaluate()
    .setTitle(config.settings.site_name + ' – ' + config.settings.app_title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * JSON API used by the visitor page when it is hosted outside Google (e.g. GitHub Pages).
 * The page sends  { action: 'config' | 'signIn' | 'signOut', data: {...} }  as a plain-text POST,
 * which never involves the visitor's Google account.
 */
function doPost(e) {
  var out;
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var body = JSON.parse(raw) || {};
    var action = String(body.action || '');
    if (action === 'config') out = { ok: true, result: getConfig_() };
    else if (action === 'signIn') out = { ok: true, result: signIn(body.data) };
    else if (action === 'signOut') out = { ok: true, result: signOut(body.data) };
    else out = { ok: false, error: 'Unknown action.' };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err).replace(/^(Error|Exception):\s*/i, '') };
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (err) {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Spreadsheet menu
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Visitor App')
    .addItem('Run setup', 'setup')
    .addItem('Show sign-in link & QR poster', 'showLinks')
    .addSeparator()
    .addItem('Sign out everyone still on site', 'signOutEveryone')
    .addItem('Install nightly auto sign-out (11 pm)', 'installNightlyTrigger')
    .addToUi();
}

function showLinks() {
  var ui = SpreadsheetApp.getUi();
  var url = getAppUrl_();
  if (!url) {
    ui.alert('The app has not been deployed yet.\n\nIn the script editor choose Deploy ▸ New deployment ▸ Web app (Execute as: Me, Who has access: Anyone).');
    return;
  }
  ui.alert('Visitor sign-in link',
    'Visitors open this link (put it behind the QR code):\n' + url +
    '\n\nPrintable QR poster:\n' + url + '?page=qr',
    ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// Setup – safe to run more than once
// ---------------------------------------------------------------------------

function setup() {
  var ss = ss_();
  try { ss.setSpreadsheetTimeZone(TZ); } catch (err) { /* ignore */ }

  var log = ss.getSheetByName(SHEET.LOG);
  if (!log) {
    log = ss.insertSheet(SHEET.LOG, 0);
  }
  ensureLogLayout_(log);
  styleHeader_(log, LOG_HEADERS.length);
  log.setFrozenRows(1);
  log.setFrozenColumns(5);
  log.getRange(2, C.TIMESTAMP, Math.max(1, log.getMaxRows() - 1), 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  LOG_WIDTHS.forEach(function (w, i) { log.setColumnWidth(i + 1, w); });

  var hosts = ss.getSheetByName(SHEET.HOSTS);
  if (!hosts) {
    hosts = ss.insertSheet(SHEET.HOSTS);
  }
  if (hosts.getLastRow() === 0) {
    hosts.getRange(1, 1, 1, HOST_HEADERS.length).setValues([HOST_HEADERS]);
  }
  // Seed the host list the first time, while the tab still only holds the example row
  var realHosts = readHosts_(ss).filter(function (h) { return h.name !== EXAMPLE_HOST; });
  if (!realHosts.length && DEFAULT_HOSTS.length) {
    if (hosts.getLastRow() > 1) hosts.deleteRows(2, hosts.getLastRow() - 1);
    hosts.getRange(2, 1, DEFAULT_HOSTS.length, HOST_HEADERS.length).setValues(DEFAULT_HOSTS);
  }
  styleHeader_(hosts, HOST_HEADERS.length);
  hosts.setFrozenRows(1);
  hosts.setColumnWidth(1, 220); hosts.setColumnWidth(2, 260); hosts.setColumnWidth(3, 140); hosts.setColumnWidth(4, 140);

  var rules = ss.getSheetByName(SHEET.RULES);
  if (!rules) {
    rules = ss.insertSheet(SHEET.RULES);
  }
  if (rules.getLastRow() === 0) {
    var ruleRows = [RULE_HEADERS].concat(DEFAULT_RULES.map(function (r, i) { return [i + 1, r]; }));
    rules.getRange(1, 1, ruleRows.length, 2).setValues(ruleRows);
  }
  styleHeader_(rules, RULE_HEADERS.length);
  rules.setFrozenRows(1);
  rules.setColumnWidth(1, 50); rules.setColumnWidth(2, 700);
  rules.getRange(2, 2, Math.max(1, rules.getMaxRows() - 1), 1).setWrap(true);

  var settings = ss.getSheetByName(SHEET.SETTINGS);
  if (!settings) {
    settings = ss.insertSheet(SHEET.SETTINGS);
  }
  if (settings.getLastRow() === 0) {
    settings.getRange(1, 1, DEFAULT_SETTINGS.length + 1, 3).setValues([SETTING_HEADERS].concat(DEFAULT_SETTINGS));
  } else {
    // add any settings that are missing (e.g. after an upgrade of the code)
    var existing = readSettings_(ss, true);
    DEFAULT_SETTINGS.forEach(function (row) {
      if (!existing.hasOwnProperty(row[0])) settings.appendRow(row);
    });
  }
  styleHeader_(settings, SETTING_HEADERS.length);
  settings.setFrozenRows(1);
  settings.setColumnWidth(1, 200); settings.setColumnWidth(2, 420); settings.setColumnWidth(3, 520);
  settings.getRange(2, 2, Math.max(1, settings.getMaxRows() - 1), 2).setWrap(true);

  // tidy away the empty default tab
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) {
    ss.deleteSheet(def);
  }
  Logger.log('Setup complete – tabs ready: ' + Object.keys(SHEET).map(function (k) { return SHEET[k]; }).join(', '));
}

function ensureSetup_(ss) {
  var missing = [SHEET.LOG, SHEET.HOSTS, SHEET.RULES, SHEET.SETTINGS].some(function (name) {
    return !ss.getSheetByName(name);
  });
  if (missing) setup();
}

/** Writes the header row, inserting the Email column into a log created before it existed. */
function ensureLogLayout_(log) {
  if (log.getLastRow() === 0) {
    log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
    return;
  }
  var header = log.getRange(1, 1, 1, Math.max(log.getLastColumn(), 1)).getValues()[0].map(String);
  if (header.indexOf('Email') === -1) {
    var phoneCol = header.indexOf('Phone') + 1;
    if (phoneCol > 0) log.insertColumnAfter(phoneCol);
    log.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
  }
}

function styleHeader_(sheet, cols) {
  sheet.getRange(1, 1, 1, cols)
    .setFontWeight('bold')
    .setBackground('#e6efe9')
    .setVerticalAlignment('middle');
}

// ---------------------------------------------------------------------------
// Configuration read from the spreadsheet
// ---------------------------------------------------------------------------

function getConfig_() {
  var ss = ss_();
  ensureSetup_(ss);
  var s = readSettings_(ss);
  var hosts = readHosts_(ss).filter(function (h) { return h.active; }).map(function (h) { return h.name; });
  return {
    settings: {
      site_name: s.site_name,
      app_title: s.app_title,
      welcome_message: s.welcome_message,
      purposes: splitList_(s.purposes),
      areas: splitList_(s.areas),
      require_drawn_signature: yes_(s.require_drawn_signature),
      require_visitor_email: yes_(s.require_visitor_email),
      reception_message: s.reception_message,
      assembly_point: s.assembly_point,
      privacy_note: s.privacy_note,
      logo_url: /^https:\/\//i.test(s.logo_url) ? s.logo_url : '',
      theme_colour: /^#[0-9a-f]{6}$/i.test(s.theme_colour) ? s.theme_colour : '#1b5e3f'
    },
    hosts: hosts,            // names only – emails never leave the server
    rules: readRules_(ss)
  };
}

function readSettings_(ss, rawOnly) {
  var out = {};
  if (!rawOnly) {
    DEFAULT_SETTINGS.forEach(function (row) { out[row[0]] = row[1]; });
  }
  var sheet = ss.getSheetByName(SHEET.SETTINGS);
  if (!sheet || sheet.getLastRow() < 2) return out;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  values.forEach(function (row) {
    var key = String(row[0]).trim();
    if (key) out[key] = String(row[1] === null || row[1] === undefined ? '' : row[1]).trim();
  });
  return out;
}

function setSetting_(ss, key, value) {
  var sheet = ss.getSheetByName(SHEET.SETTINGS);
  var last = sheet.getLastRow();
  if (last >= 2) {
    var keys = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }
  sheet.appendRow([key, value, '']);
}

function readHosts_(ss) {
  var sheet = ss.getSheetByName(SHEET.HOSTS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  return values.map(function (row) {
    var active = String(row[3]).trim().toUpperCase();
    return {
      name: String(row[0]).trim(),
      email: String(row[1]).trim(),
      mobile: String(row[2]).trim(),
      active: active === '' || active === 'YES' || active === 'Y' || active === 'TRUE'
    };
  }).filter(function (h) { return h.name; });
}

function readRules_(ss) {
  var sheet = ss.getSheetByName(SHEET.RULES);
  if (!sheet || sheet.getLastRow() < 2) return DEFAULT_RULES.slice();
  var values = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
  var rules = values.map(function (row) { return String(row[0]).trim(); }).filter(String);
  return rules.length ? rules : DEFAULT_RULES.slice();
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

function signIn(data) {
  var d = cleanSubmission_(data);
  var ss = ss_();
  ensureSetup_(ss);
  var settings = readSettings_(ss);
  var problems = validate_(d, yes_(settings.require_drawn_signature), yes_(settings.require_visitor_email));
  if (problems.length) throw new Error(problems.join(' '));

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var log = ss.getSheetByName(SHEET.LOG);
    ensureLogLayout_(log);
    var now = new Date();
    var visitorNo = nextVisitorNo_(ss, log);
    var sigUrl = d.signature ? saveSignature_(ss, d.signature, visitorNo, d.name) : '';

    var hostEntry = readHosts_(ss).filter(function (h) {
      return h.name.toLowerCase() === d.host.toLowerCase();
    })[0];
    var notified = yes_(settings.notify_hosts) ? notify_(settings, hostEntry, d, visitorNo, now) : { host: false, other: false };

    var row = [];
    for (var i = 0; i < LOG_HEADERS.length; i++) row.push('');
    row[C.TIMESTAMP - 1] = now;
    row[C.DATE - 1] = fmt_(now, 'dd/MM/yyyy');
    row[C.TIME_IN - 1] = fmt_(now, 'HH:mm');
    row[C.VISITOR_NO - 1] = visitorNo;
    row[C.NAME - 1] = d.name;
    row[C.COMPANY - 1] = d.company;
    row[C.PHONE - 1] = d.phone;
    row[C.EMAIL - 1] = d.email;
    row[C.PURPOSE - 1] = d.purpose;
    row[C.PURPOSE_DETAIL - 1] = d.purposeDetail;
    row[C.HOST - 1] = d.host;
    row[C.AREAS - 1] = d.areas.join(', ');
    row[C.REGO - 1] = d.rego;
    row[C.VISITED_GROW - 1] = d.visitedGrow;
    row[C.UNWELL - 1] = d.unwell;
    row[C.RULES_ACK - 1] = 'Yes – all ' + d.rulesCount + ' rules';
    row[C.TYPED_SIG - 1] = d.typedSignature;
    row[C.SIG_IMAGE - 1] = sigUrl;
    row[C.STATUS - 1] = STATUS_ON_SITE;
    row[C.HOST_NOTIFIED - 1] = notified.host ? 'Yes' : (notified.other ? 'Reception only' : 'No');
    log.appendRow(row);
    var r = log.getLastRow();
    log.getRange(r, C.ID_SIGHTED, 1, 2).insertCheckboxes();

    return {
      ok: true,
      visitorNo: visitorNo,
      name: d.name,
      company: d.company,
      host: d.host,
      hostNotified: notified.host,
      receptionNotified: notified.other,
      timeIn: fmt_(now, 'h:mm a'),
      date: fmt_(now, 'EEEE d MMMM yyyy'),
      receptionMessage: settings.reception_message
    };
  } finally {
    lock.releaseLock();
  }
}

function cleanSubmission_(data) {
  data = data || {};
  var areas = Array.isArray(data.areas) ? data.areas : [];
  return {
    name: text_(data.name, 120),
    company: text_(data.company, 120),
    phone: text_(data.phone, 40),
    email: text_(data.email, 120).toLowerCase(),
    purpose: text_(data.purpose, 80),
    purposeDetail: text_(data.purposeDetail, 500),
    host: text_(data.host, 120),
    areas: areas.map(function (a) { return text_(a, 80); }).filter(String).slice(0, 20),
    rego: text_(data.rego, 20).toUpperCase(),
    visitedGrow: text_(data.visitedGrow, 3),
    unwell: text_(data.unwell, 3),
    rulesAck: data.rulesAck === true,
    rulesCount: Number(data.rulesCount) || 0,
    typedSignature: text_(data.typedSignature, 120),
    signature: typeof data.signature === 'string' && data.signature.length < 400000 ? data.signature : ''
  };
}

/** Trims, limits length and removes leading characters Sheets would treat as a formula. */
function text_(v, max) {
  var s = (v === null || v === undefined) ? '' : String(v);
  var out = '';
  for (var i = 0; i < s.length; i++) {
    out += s.charCodeAt(i) < 32 ? ' ' : s.charAt(i); // tabs, newlines and other control characters become spaces
  }
  s = out.replace(/ {2,}/g, ' ').trim();
  while (s.length && '=+-@'.indexOf(s.charAt(0)) !== -1) s = s.slice(1); // never let Sheets see a leading formula character
  return s.length > max ? s.slice(0, max) : s;
}

function looksLikeEmail_(s) {
  var at = s.indexOf('@');
  return at > 0 && s.indexOf('.', at) > at + 1 && s.indexOf(' ') === -1 && s.charAt(s.length - 1) !== '.';
}

function validate_(d, requireDrawn, requireEmail) {
  var p = [];
  if (d.name.length < 2) p.push('Please enter your full name.');
  if (!d.company) p.push('Please enter your company (or "Private").');
  if (d.phone.replace(/\D/g, '').length < 6) p.push('Please enter a contact number.');
  if (requireEmail && !d.email) p.push('Please enter your email address.');
  if (d.email && !looksLikeEmail_(d.email)) p.push('Please check your email address.');
  if (!d.purpose) p.push('Please choose the purpose of your visit.');
  if (d.purpose.toLowerCase() === 'other' && !d.purposeDetail) p.push('Please describe the purpose of your visit.');
  if (!d.host) p.push('Please tell us who you are visiting.');
  if (!d.areas.length) p.push('Please select at least one area.');
  if (d.visitedGrow !== 'Yes' && d.visitedGrow !== 'No') p.push('Please answer the biosecurity question.');
  if (d.unwell !== 'Yes' && d.unwell !== 'No') p.push('Please answer the health question.');
  if (!d.rulesAck) p.push('Please acknowledge every site rule.');
  if (d.typedSignature.length < 2) p.push('Please type your full name as your signature.');
  if (requireDrawn && !/^data:image\/png;base64,/.test(d.signature)) p.push('Please sign in the signature box.');
  return p;
}

function nextVisitorNo_(ss, log) {
  var settings = readSettings_(ss);
  var n = parseInt(settings.next_visitor_number, 10);
  if (!(n > 0)) n = Math.max(1, log.getLastRow()); // rows minus header, plus one
  setSetting_(ss, 'next_visitor_number', n + 1);
  return 'V' + ('0000' + n).slice(-4);
}

function saveSignature_(ss, dataUrl, visitorNo, name) {
  try {
    var m = /^data:image\/png;base64,([A-Za-z0-9+\/=]+)$/.exec(dataUrl);
    if (!m) return '';
    var bytes = Utilities.base64Decode(m[1]);
    var fileName = visitorNo + ' ' + name.replace(/[^\w .-]+/g, '') + ' signature.png';
    var blob = Utilities.newBlob(bytes, 'image/png', fileName);
    var file = signatureFolder_(ss).createFile(blob);
    return file.getUrl();
  } catch (err) {
    return 'Signature could not be saved: ' + err.message;
  }
}

function signatureFolder_(ss) {
  var parent;
  try {
    var parents = DriveApp.getFileById(ss.getId()).getParents();
    parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  } catch (err) {
    parent = DriveApp.getRootFolder();
  }
  var it = parent.getFoldersByName('Visitor Signatures');
  return it.hasNext() ? it.next() : parent.createFolder('Visitor Signatures');
}

/** Emails the host and/or the extra notify_email addresses. Returns which of them were sent. */
function notify_(settings, hostEntry, d, visitorNo, now) {
  var recipients = [];
  var hostEmail = hostEntry && /@/.test(hostEntry.email) ? hostEntry.email : '';
  if (hostEmail) recipients.push(hostEmail);
  splitList_(settings.notify_email).forEach(function (e) { if (/@/.test(e)) recipients.push(e); });
  var result = { host: false, other: false };
  if (!recipients.length) return result;

  var flags = [];
  if (d.visitedGrow === 'Yes') flags.push('Has visited another growing site or handled plants in the last 24 hours');
  if (d.unwell === 'Yes') flags.push('Declared unwell or has open cuts');

  var lines = [
    'Your visitor has arrived at ' + settings.site_name + ' and is waiting in reception.',
    '',
    'Visitor no.: ' + visitorNo,
    'Name: ' + d.name,
    'Company: ' + d.company,
    'Phone: ' + d.phone,
    'Email: ' + (d.email || '–'),
    'Purpose: ' + d.purpose + (d.purposeDetail ? ' – ' + d.purposeDetail : ''),
    'Host: ' + d.host,
    'Areas requested: ' + d.areas.join(', '),
    'Vehicle: ' + (d.rego || '–'),
    'Signed in: ' + fmt_(now, 'h:mm a, EEEE d MMMM yyyy'),
    '',
    flags.length ? 'PLEASE NOTE before entering growing areas:\n- ' + flags.join('\n- ') : 'No biosecurity or health flags declared.',
    '',
    'Site rules acknowledged and signed in the induction app.'
  ];
  try {
    MailApp.sendEmail({
      to: recipients.join(','),
      subject: 'Visitor arrived: ' + d.name + ' (' + d.company + ') – for ' + d.host + ' [' + visitorNo + ']',
      body: lines.join('\n'),
      name: settings.site_name + ' Visitor App'
    });
    result.host = !!hostEmail;
    result.other = recipients.length > (hostEmail ? 1 : 0);
  } catch (err) {
    Logger.log('Email failed: ' + err.message);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------

function signOut(query) {
  var q = text_(query && query.value, 120);
  if (!q) throw new Error('Please enter your visitor number or full name.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var ss = ss_();
    var log = ss.getSheetByName(SHEET.LOG);
    var last = log ? log.getLastRow() : 0;
    if (last < 2) throw new Error(notFoundMessage_());
    var values = log.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues();

    var qNo = normaliseVisitorNo_(q);
    var qName = q.toLowerCase();
    var matches = [];
    values.forEach(function (row, i) {
      if (String(row[C.STATUS - 1]) !== STATUS_ON_SITE) return;
      var byNo = qNo && String(row[C.VISITOR_NO - 1]).toUpperCase() === qNo;
      var byName = String(row[C.NAME - 1]).trim().toLowerCase() === qName;
      if (byNo || byName) matches.push({ rowNum: i + 2, row: row, byNo: byNo });
    });

    if (!matches.length) throw new Error(notFoundMessage_());
    var exact = matches.filter(function (m) { return m.byNo; });
    if (exact.length) matches = exact;
    if (matches.length > 1) {
      var today = fmt_(new Date(), 'dd/MM/yyyy');
      var todays = matches.filter(function (m) { return String(m.row[C.DATE - 1]) === today; });
      if (todays.length === 1) matches = todays;
      else if (todays.length > 1) throw new Error('More than one visitor is signed in under that name today. Please use your visitor number instead (it looks like V0012).');
      else matches = [matches[matches.length - 1]]; // old open entries – close the most recent
    }

    var m = matches[0];
    var now = new Date();
    var inTime = m.row[C.TIMESTAMP - 1];
    inTime = inTime instanceof Date ? inTime : new Date(inTime);
    var mins = isNaN(inTime.getTime()) ? '' : Math.max(0, Math.round((now.getTime() - inTime.getTime()) / 60000));
    log.getRange(m.rowNum, C.TIME_OUT).setValue(fmt_(now, 'HH:mm'));
    log.getRange(m.rowNum, C.DURATION).setValue(mins);
    log.getRange(m.rowNum, C.STATUS).setValue(STATUS_SIGNED_OUT);

    return {
      ok: true,
      name: String(m.row[C.NAME - 1]),
      visitorNo: String(m.row[C.VISITOR_NO - 1]),
      timeOut: fmt_(now, 'h:mm a')
    };
  } finally {
    lock.releaseLock();
  }
}

function notFoundMessage_() {
  return "We couldn't find anyone signed in under that name or visitor number. Please check the spelling, or ask reception to sign you out.";
}

function normaliseVisitorNo_(q) {
  var m = /^v\s*0*(\d{1,6})$/i.exec(q.trim());
  return m ? 'V' + ('0000' + m[1]).slice(-4) : '';
}

/** Menu / trigger: closes every open entry (e.g. at the end of the day). */
function signOutEveryone() {
  var ss = ss_();
  var log = ss.getSheetByName(SHEET.LOG);
  var last = log ? log.getLastRow() : 0;
  var closed = 0;
  if (last >= 2) {
    var values = log.getRange(2, 1, last - 1, LOG_HEADERS.length).getValues();
    var now = new Date();
    values.forEach(function (row, i) {
      if (String(row[C.STATUS - 1]) !== STATUS_ON_SITE) return;
      var rowNum = i + 2;
      var inTime = row[C.TIMESTAMP - 1] instanceof Date ? row[C.TIMESTAMP - 1] : new Date(row[C.TIMESTAMP - 1]);
      var mins = isNaN(inTime.getTime()) ? '' : Math.max(0, Math.round((now.getTime() - inTime.getTime()) / 60000));
      log.getRange(rowNum, C.TIME_OUT).setValue(fmt_(now, 'HH:mm'));
      log.getRange(rowNum, C.DURATION).setValue(mins);
      log.getRange(rowNum, C.STATUS).setValue(STATUS_SIGNED_OUT);
      var note = String(row[C.NOTES - 1]);
      log.getRange(rowNum, C.NOTES).setValue((note ? note + ' | ' : '') + 'Auto sign-out ' + fmt_(now, 'dd/MM/yyyy HH:mm'));
      closed++;
    });
  }
  try {
    SpreadsheetApp.getUi().alert(closed + ' visitor(s) signed out.');
  } catch (err) { /* running from a trigger – no UI */ }
  return closed;
}

function installNightlyTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'signOutEveryone'; });
  if (!exists) {
    ScriptApp.newTrigger('signOutEveryone').timeBased().everyDays(1).atHour(23).inTimezone(TZ).create();
  }
  SpreadsheetApp.getUi().alert('Nightly auto sign-out is installed. Anyone still shown as "On site" is signed out at about 11 pm each night.');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function fmt_(date, pattern) {
  return Utilities.formatDate(date, TZ, pattern);
}

function yes_(v) {
  v = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
  return v === 'YES' || v === 'Y' || v === 'TRUE' || v === '1';
}

function splitList_(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(String);
}
