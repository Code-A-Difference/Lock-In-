import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseMicUsers } = require('../meetings.js');

const BASE = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const entry = (key, stop) => `${BASE}\\${key}\r\n    LastUsedTimeStop    REG_QWORD    ${stop}\r\n\r\n`;

test('apps using the microphone now are named; finished ones are not', () => {
  const out = entry('MSTeams_8wekyb3d8bbwe', '0x0')
    + entry('NonPackaged\\C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe', '0x0')
    + entry('NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe', '0x1dd516684a00b8e')
    + entry('5319275A.WhatsAppDesktop_cv1g1gvanyjgm', '0x0');
  assert.deepEqual(parseMicUsers(out).sort(), ['Microsoft Teams', 'Zoom']);
});

test('LOCK IN! itself and recorders are ignored; browsers count as a call', () => {
  const out = entry('NonPackaged\\C:#Users#me#AppData#Local#Programs#lockin-desktop#LOCK IN!.exe', '0x0')
    + entry('Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe', '0x0')
    + entry('NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe', '0x0');
  assert.deepEqual(parseMicUsers(out), ['your browser (Google Meet or another call)']);
});

test('empty or odd output is no calls', () => {
  assert.deepEqual(parseMicUsers(''), []);
  assert.deepEqual(parseMicUsers('ERROR: The system was unable to find the specified registry key'), []);
});
