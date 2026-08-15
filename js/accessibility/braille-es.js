(function() {
'use strict';

var BRAILLE_OFFSET = 0x2800;
var UPPERCASE_MARK = '\u2820';
var NUMBER_MARK = '\u283C';

var CHAR_TO_BRAILLE = {
'a':'\u2801','b':'\u2803','c':'\u2809','d':'\u2819','e':'\u2811',
'f':'\u280B','g':'\u281B','h':'\u2813','i':'\u280A','j':'\u281A',
'k':'\u2805','l':'\u2807','m':'\u280D','n':'\u281D','o':'\u2815',
'p':'\u280F','q':'\u281F','r':'\u2817','s':'\u280E','t':'\u281E',
'u':'\u2825','v':'\u2827','w':'\u283A','x':'\u2829','y':'\u2839','z':'\u2831',
'\u00E1':'\u2815','\u00E9':'\u2811','\u00ED':'\u280A',
'\u00F3':'\u2815','\u00FA':'\u2825','\u00FC':'\u2835',
'\u00F1':'\u283B'
};

var DIGIT_TO_BRAILLE = {
'0':'\u281A','1':'\u2801','2':'\u2803','3':'\u2809','4':'\u2819',
'5':'\u2811','6':'\u280B','7':'\u281B','8':'\u2813','9':'\u280A'
};

var DIGIT_BRAILLE_TO_CHAR = {};
(function() {
var keys = Object.keys(DIGIT_TO_BRAILLE);
for (var i = 0; i < keys.length; i++) {
DIGIT_BRAILLE_TO_CHAR[DIGIT_TO_BRAILLE[keys[i]]] = keys[i];
}
})();

var PUNCT_TO_BRAILLE = {
' ': '\u2800',
'.': '\u2832',
',': '\u2802',
';': '\u280C',
':': '\u2810',
'¡': '\u2816',
'!': '\u2816',
'¿': '\u2826',
'?': '\u2826',
'(': '\u2822',
')': '\u2812',
'-': '\u2824',
'_': '\u2808',
'\u201C': '\u283C',
'\u201D': '\u283C',
'"': '\u283C',
'\u2018': '\u2804',
'\u2019': '\u2804',
'\'': '\u2804',
'/': '\u2833',
'\\': '\u2833',
'\u2026': '\u2832',
'@': '\u2821',
'#': '\u283C',
'\u00AA': '\u2801',
'\u00BA': '\u2815',
'\u00B0': '\u283E'
};

var ALL_SUPPORTED = {};
(function() {
var i, keys;
keys = Object.keys(CHAR_TO_BRAILLE);
for (i = 0; i < keys.length; i++) { ALL_SUPPORTED[keys[i]] = true; }
keys = Object.keys(DIGIT_TO_BRAILLE);
for (i = 0; i < keys.length; i++) { ALL_SUPPORTED[keys[i]] = true; }
keys = Object.keys(PUNCT_TO_BRAILLE);
for (i = 0; i < keys.length; i++) { ALL_SUPPORTED[keys[i]] = true; }
})();

var BRAILLE_TO_CHAR = {};
(function() {
var i, keys, ch;
keys = Object.keys(PUNCT_TO_BRAILLE);
for (i = 0; i < keys.length; i++) { BRAILLE_TO_CHAR[PUNCT_TO_BRAILLE[keys[i]]] = keys[i]; }
keys = Object.keys(CHAR_TO_BRAILLE);
for (i = 0; i < keys.length; i++) {
ch = keys[i];
if (ch.length === 1 && ch.charCodeAt(0) > 127) {
BRAILLE_TO_CHAR[CHAR_TO_BRAILLE[ch]] = ch;
}
}
var basicLetters = 'abcdefghijklmnopqrstuvwxyz\u00F1';
for (i = 0; i < basicLetters.length; i++) {
ch = basicLetters[i];
if (CHAR_TO_BRAILLE[ch]) { BRAILLE_TO_CHAR[CHAR_TO_BRAILLE[ch]] = ch; }
}
})();

function isDigit(ch) {
return ch >= '0' && ch <= '9';
}

function isLowercase(ch) {
return (ch >= 'a' && ch <= 'z') || ch === '\u00F1';
}

function isUppercase(ch) {
return (ch >= 'A' && ch <= 'Z');
}

function isAccented(ch) {
var accented = '\u00E1\u00E9\u00ED\u00F3\u00FA\u00FC';
for (var i = 0; i < accented.length; i++) {
if (ch === accented[i]) return true;
}
return false;
}

function toBraille(text) {
if (typeof text !== 'string') {
throw new TypeError('Se esperaba una cadena de texto');
}
var result = '';
var inNumber = false;
var i, ch, lower, brailleChar;

for (i = 0; i < text.length; i++) {
ch = text[i];

if (ch === '\n') {
result += '\n';
inNumber = false;
continue;
}

if (ch === '\r') {
result += '\r';
inNumber = false;
continue;
}

if (ch === '\t') {
result += '\t';
inNumber = false;
continue;
}

if (isDigit(ch)) {
if (!inNumber) {
result += NUMBER_MARK;
inNumber = true;
}
result += DIGIT_TO_BRAILLE[ch];
continue;
}

if (isUppercase(ch)) {
if (inNumber) {
inNumber = false;
}
result += UPPERCASE_MARK;
lower = ch.toLowerCase();
if (CHAR_TO_BRAILLE[lower]) {
result += CHAR_TO_BRAILLE[lower];
} else if (isAccented(ch)) {
var base = getBaseChar(ch);
if (CHAR_TO_BRAILLE[base]) {
result += CHAR_TO_BRAILLE[base];
}
} else {
result += '\u2800';
}
continue;
}

if (isLowercase(ch)) {
if (inNumber) {
inNumber = false;
}
if (CHAR_TO_BRAILLE[ch]) {
result += CHAR_TO_BRAILLE[ch];
} else {
result += '\u2800';
}
continue;
}

if (isAccented(ch)) {
if (inNumber) {
inNumber = false;
}
var accBase = getBaseChar(ch);
result += UPPERCASE_MARK;
if (CHAR_TO_BRAILLE[accBase]) {
result += CHAR_TO_BRAILLE[accBase];
} else {
result += '\u2800';
}
continue;
}

if (inNumber) {
inNumber = false;
}

if (PUNCT_TO_BRAILLE[ch]) {
result += PUNCT_TO_BRAILLE[ch];
} else {
result += '\u2800';
}
}

return result;
}

function getBaseChar(ch) {
var map = {
'\u00E1': 'a', '\u00E9': 'e', '\u00ED': 'i',
'\u00F3': 'o', '\u00FA': 'u', '\u00FC': 'u',
'\u00C1': 'a', '\u00C9': 'e', '\u00CD': 'i',
'\u00D3': 'o', '\u00DA': 'u', '\u00DC': 'u',
'\u00D1': 'n'
};
return map[ch] || ch;
}

function fromBraille(braille) {
if (typeof braille !== 'string') {
throw new TypeError('Se esperaba una cadena de texto braille');
}
var result = '';
var uppercaseNext = false;
var numberMode = false;
var i, ch, code, offset, baseChar, digitChar;

for (i = 0; i < braille.length; i++) {
ch = braille[i];
code = ch.charCodeAt(0);

if (code === 0x0A || code === 0x0D || code === 0x09) {
result += ch;
uppercaseNext = false;
numberMode = false;
continue;
}

if (code < 0x2800 || code > 0x28FF) {
result += ch;
continue;
}

offset = code - 0x2800;

if (offset === 0x20) {
uppercaseNext = true;
numberMode = false;
continue;
}

if (offset === 0x3C) {
numberMode = true;
uppercaseNext = false;
continue;
}

if (numberMode) {
digitChar = DIGIT_BRAILLE_TO_CHAR[ch];
if (digitChar !== undefined) {
result += digitChar;
continue;
} else {
numberMode = false;
}
}

if (uppercaseNext) {
baseChar = BRAILLE_TO_CHAR[ch];
if (baseChar) {
if (baseChar.length === 1 && baseChar >= 'a' && baseChar <= 'z') {
result += baseChar.toUpperCase();
} else {
result += baseChar;
}
} else {
result += ch;
}
uppercaseNext = false;
continue;
}

baseChar = BRAILLE_TO_CHAR[ch];
if (baseChar) {
result += baseChar;
continue;
}

digitChar = DIGIT_BRAILLE_TO_CHAR[ch];
if (digitChar !== undefined) {
result += digitChar;
continue;
}

result += ch;
}

return result;
}

function isSupported(char) {
if (typeof char !== 'string' || char.length === 0) {
return false;
}
var ch = char.charAt(0);
if (ch === '\n' || ch === '\r' || ch === '\t') {
return true;
}
var code = ch.charCodeAt(0);
if (code >= 0x2800 && code <= 0x28FF) {
return true;
}
return ALL_SUPPORTED[ch] === true;
}

function getUnsupportedChars(text) {
if (typeof text !== 'string') {
throw new TypeError('Se esperaba una cadena de texto');
}
var unsupported = [];
var seen = {};
var i, ch;

for (i = 0; i < text.length; i++) {
ch = text[i];
if (ch === '\n' || ch === '\r' || ch === '\t') {
continue;
}
if (!ALL_SUPPORTED[ch] && !seen[ch]) {
unsupported.push(ch);
seen[ch] = true;
}
}

return unsupported;
}

window.BrailleES = {
toBraille: toBraille,
fromBraille: fromBraille,
isSupported: isSupported,
getUnsupportedChars: getUnsupportedChars,
BRAILLE_UNICODE_START: 0x2800,
UPPERCASE_MARK: UPPERCASE_MARK,
NUMBER_MARK: NUMBER_MARK
};

})();
