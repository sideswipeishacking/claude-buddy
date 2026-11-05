/* Clawd sprite engine.
 *
 * Turns the pixel poses from assets/poses.json (generated from the mascot pack)
 * plus a few procedural body maps into animated frames. A frame is a list of
 * coloured pixels with a ground anchor; the renderer rasterises and caches it.
 * Works in the renderer (window.Clawd) and in Node (require) for the tray icon.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Clawd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCALE = 4; // DIP per art pixel
  const ROLE = { PROP: 0, BODY: 1, EYE: 2, MOUTH: 3, LEG: 4, HAT: 5, EXTRA: 6 };
  const COL = { body: '#d97757', eye: '#2f2f38', mouth: '#fff1e6' };

  // ---------------------------------------------------------------- body maps
  // Front-facing Clawd in the pack's proportions: 14-wide head, 3-wide claws,
  // four 2-pixel legs. '#' body, 'L'/'R' left/right claw, 'l' leg.
  const MAPS = {
    base: { headTop: 0, rows: [
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      'LLL##############RRR',
      'LLL##############RRR',
      'LL ############## RR',
      '   l  l      l  l   ',
      '   l  l      l  l   ',
    ] },
    armsUp: { headTop: 3, rows: [
      'LL                RR',
      'LLL              RRR',
      'LLL              RRR',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   l  l      l  l   ',
      '   l  l      l  l   ',
    ] },
    squash: { headTop: 0, faceDy: -1, rows: [
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      'LLL##############RRR',
      'LLL##############RRR',
      'LL ############## RR',
      '  l  l        l  l  ',
    ] },
    lie: { headTop: 0, rows: [
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      'LLL##############RRR',
      'LLL##############RRR',
      'LL ############## RR',
    ] },
    // Sitting behind a little pixel keyboard while you type.
    typing: { headTop: 0, pal: { K: ['#2f2f38', 0], w: ['#c3beea', 0] }, rows: [
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      '   ##############   ',
      'LLL##############RRR',
      'LLL##############RRR',
      'LL ############## RR',
      ' KKKKKKKKKKKKKKKKKK ',
      ' KwKwKwKwKwKwKwKwKK ',
      ' KKwwwwwwwwwwwwwKKK ',
    ] },
    // The egg a new buddy hatches from (shading on the right, orange spots).
    egg: { headTop: 0, headL: 0, pal: { E: ['#fff1e6', 1], e: ['#ead2c0', 1], O: ['#e0855f', 1] }, rows: [
      '     EEEe     ',
      '   EEEEEEee   ',
      '  EEEEEEEEee  ',
      ' EEEEOEEEEEee ',
      ' EEEOOOEEEEee ',
      'EEEEEOEEEEOEee',
      'EEEEEEEEEOOOee',
      'EEEEEEEEEEOEee',
      'EEOEEEEEEEEEee',
      'EOOOEEEEEOEEee',
      'EEOEEEEEOOOEee',
      ' EEEEEEEEOEee ',
      ' EEEEEEEEEEee ',
      '  EEEEEEEEee  ',
      '   EEEEEEee   ',
      '     EEee     ',
    ] },
    // Flattened after a hard landing, X-eyed, with stars.
    flat: { headTop: 2, headL: 5, pal: { x: ['#2f2f38', 2], '*': ['#ffe12e', 0] }, rows: [
      '   *        *       *   ',
      '                        ',
      '     ##############     ',
      '  ####x#x######x#x####  ',
      ' ######x########x###### ',
      '######x#x######x#x######',
      ' ## ################ ## ',
    ] },
  };

  // Faces, in head coordinates (head is 14 wide; eyes sit in columns 3 and 10).
  const U_MOUTH = [[5, 5], [8, 5], [6, 6], [7, 6]];
  const FACES = {
    normal: { eyes: [[3, 3], [3, 4], [10, 3], [10, 4]], mouth: U_MOUTH },
    lookR: { eyes: [[4, 3], [4, 4], [11, 3], [11, 4]], mouth: U_MOUTH },
    happy: { eyes: [[3, 3], [2, 4], [4, 4], [10, 3], [9, 4], [11, 4]], mouth: [[5, 5], [6, 5], [7, 5], [8, 5], [6, 6], [7, 6]] },
    closed: { eyes: [[2, 4], [3, 4], [10, 4], [11, 4]], mouth: [[6, 6], [7, 6]] },
    surprised: { eyes: [[3, 2], [3, 3], [3, 4], [10, 2], [10, 3], [10, 4]], dark: [[6, 5], [7, 5], [6, 6], [7, 6]] },
    dizzy: { eyes: [[2, 2], [4, 2], [3, 3], [2, 4], [4, 4], [9, 2], [11, 2], [10, 3], [9, 4], [11, 4]], mouth: [[6, 6], [7, 6]] },
    sad: { eyes: [[2, 3], [4, 3], [3, 4], [9, 3], [11, 3], [10, 4]], dark: [[6, 6], [7, 6]] },
    none: {}, // the map draws its own face
  };

  // ---------------------------------------------------------------- hats
  // Drawn in the pack's style; offsets are relative to the head's top-left.
  // Wizard, hard hat, ninja hood and sprout are lifted from pack poses.
  const HATS = {
    wizard: { x0: 0, y0: -4, pal: { B: '#4b3fa0', S: '#ffe12e' }, rows: [
      '  BB          ',
      '   BBBBB      ',
      '  BBBSBBBB    ',
      ' BBBBBBBBBBBB ',
    ] },
    hardhat: { x0: 0, y0: -8, pal: { B: '#f4e84d', E: '#dbcc42', D: '#ba6852' }, rows: [
      '       BB       ',
      '   BBEBBBBEBB   ',
      '  BBBBEBBEBBBB  ',
      ' BBEBEBEEBEBEBB ',
      ' BBEBEBBBBEBEBB ',
      ' BBBBBBBBBBBBBB ',
      'BBBBBBBBBBBBBBBB',
      'DDDDDDDDDDDDDD  ',
    ] },
    ninja: { x0: 0, y0: -1, pal: { G: '#37d351', Y: '#ffea55' }, rows: [
      '               Y',
      'GGGGGGGGGGGGGGY ',
      'YYYYYYYYYYYYYY  ',
      'GGGGGGGGGGGGGGY ',
      'G            G Y',
      'G            G  ',
      'G            G  ',
    ] },
    sprout: { x0: 4, y0: -6, pal: { C: '#64e2a6', D: '#37b37a' }, rows: [
      '     C',
      '    CC',
      '    C ',
      'DD  C ',
      ' DDC  ',
      '  C   ',
    ] },
    crown: { x0: 3, y0: -4, pal: { Y: '#ffc431', R: '#ff6833', W: '#fff4b0' }, rows: [
      'Y  YY  Y',
      'YW YY WY',
      'YYYRRYYY',
      'YYYYYYYY',
    ] },
    headset: { x0: -1, y0: -3, pal: { P: '#6e31f4', C: '#3381f2' }, rows: [
      '   PPPPPPPPPP   ',
      '  P          P  ',
      ' P            P ',
      'CC            CC',
      'CC            CC',
      'CC            CC',
    ] },
    cap: { x0: 1, y0: -4, pal: { N: '#29418e', W: '#ffffff', L: '#3e6cff' }, rows: [
      '     W          ',
      '   NNNNNN       ',
      '  NNNNNNNNN     ',
      ' NNNNNNNNNNLLLLL',
    ] },
    bow: { x0: 9, y0: -3, pal: { P: '#ef509c', K: '#b8327a' }, rows: [
      'P   P',
      'PPKPP',
      'P   P',
    ] },
  };
  // More headwear in the same style. 'o' means "the buddy's own body colour".
  Object.assign(HATS, {
    tophat: { x0: 2, y0: -6, pal: { K: '#2f2f38', R: '#d6455d' }, rows: [
      '  KKKKKK  ', '  KKKKKK  ', '  KKKKKK  ', '  RRRRRR  ', '  KKKKKK  ', 'KKKKKKKKKK',
    ] },
    beanie: { x0: 0, y0: -5, pal: { B: '#3f6fd8', b: '#2c4fa8', W: '#ffffff' }, rows: [
      '      WW      ', '    BBBBBB    ', '  BBBBBBBBBB  ', ' BBBBBBBBBBBB ', 'bbbbbbbbbbbbbb',
    ] },
    cowboy: { x0: -1, y0: -5, pal: { B: '#8b5a3c', b: '#5a3a22' }, rows: [
      '      BBBB      ', '     BBBBBB     ', '     bbbbbb     ', 'B    BBBBBB    B', ' BBBBBBBBBBBBBB ',
    ] },
    chef: { x0: 2, y0: -6, pal: { W: '#ffffff', g: '#c9cdd4' }, rows: [
      ' ggg  ggg ', 'gWWWggWWWg', 'gWWWWWWWWg', ' gWWWWWWg ', ' gWWWWWWg ', ' gggggggg ',
    ] },
    party: { x0: 4, y0: -7, pal: { P: '#e46fa8', B: '#5aa9e6', Y: '#ffe12e' }, rows: [
      '  YY  ', '  PP  ', ' PPBP ', ' PBPP ', 'PPPBPP', 'PBPPPB', 'PPPPPP',
    ] },
    viking: { x0: -2, y0: -4, pal: { W: '#f1e6c8', S: '#9aa3ad' }, rows: [
      'W                W', 'WW    SSSSSS    WW', ' WW SSSSSSSSSS WW ', '  WSSSSSSSSSSSSW  ',
    ] },
    pirate: { x0: 0, y0: -4, pal: { K: '#2f2f38', W: '#ffffff', Y: '#ffc431' }, rows: [
      '    KKKKKK    ', '  KKKKWWKKKK  ', ' KKKKKKKKKKKK ', 'YKKKKKKKKKKKKY',
    ] },
    santa: { x0: 0, y0: -6, pal: { R: '#d6455d', W: '#ffffff' }, rows: [
      '      RRRR     ', '    RRRRRRR WW', '   RRRRRRRRRWW', '  RRRRRRRRRR   ', ' WWWWWWWWWWWW  ', 'WWWWWWWWWWWWWW',
    ] },
    propeller: { x0: 1, y0: -5, pal: { P: '#ffc431', K: '#2f2f38', R: '#d6455d', Y: '#ffe12e', B: '#3f6fd8' }, rows: [
      'PPPPP  PPPPP', '     KK     ', '   RRYYBB   ', '  RRRYYBBB  ', ' RRRRYYBBBB ',
    ] },
    halo: { x0: 2, y0: -5, pal: { Y: '#ffe12e' }, rows: [
      ' YYYYYYYY ', 'Y        Y', ' YYYYYYYY ',
    ] },
    horns: { x0: 0, y0: -3, pal: { R: '#d6455d' }, rows: [
      ' R          R ', ' RR        RR ', '  RR      RR  ',
    ] },
    bunny: { x0: 2, y0: -7, pal: { W: '#ffffff', P: '#f7a8c8' }, rows: [
      ' WW    WW ', 'WPPW  WPPW', 'WPPW  WPPW', 'WPPW  WPPW', 'WPPW  WPPW', ' WW    WW ', ' WW    WW ',
    ] },
    cat: { x0: 0, y0: -3, pal: { o: 'body', P: '#f7a8c8' }, rows: [
      '  o        o  ', ' oPo      oPo ', 'oPPPo    oPPPo',
    ] },
    gradcap: { x0: -1, y0: -4, pal: { K: '#2f2f38', Y: '#ffc431' }, rows: [
      'KKKKKKKKKKKKKKKK', '    KKKKKKKK  Y ', '    KKKKKKKK  Y ', '    KKKKKKKK  YY',
    ] },
    beret: { x0: 1, y0: -3, pal: { R: '#3b3743' }, rows: [
      '     RR     ', '  RRRRRRRRR ', ' RRRRRRRRRRRR',
    ] },
    fez: { x0: 4, y0: -5, pal: { R: '#c0392b', K: '#2f2f38' }, rows: [
      ' RRRR K', ' RRRR K', 'RRRRRRK', 'RRRRRR ', 'RRRRRR ',
    ] },
    tiara: { x0: 3, y0: -3, pal: { Y: '#ffc431', B: '#5aa9e6' }, rows: [
      '    B   ', ' Y YBY Y', 'YYYYYYYY',
    ] },
    mushroom: { x0: 1, y0: -5, pal: { R: '#d6455d', W: '#ffffff' }, rows: [
      '   RRRRRR   ', ' RRWRRRRWRR ', 'RRRRRRWRRRRR', 'RWRRRRRRRRWR', '    WWWW    ',
    ] },
    antenna: { x0: 2, y0: -5, pal: { G: '#37d351', K: '#2f2f38' }, rows: [
      'G        G', ' K      K ', '  K    K  ', '   K  K   ', '  KKKKKK  ',
    ] },
    bandana: { x0: 0, y0: 0, pal: { R: '#d6455d', W: '#ffffff' }, rows: [
      'RRRRRRRRRRRRRRR ', 'RWRRWRRWRRWRRRRR', '              RR', '               R',
    ] },
  });
  Object.assign(HATS, {
    // ---- more hats (round 7)
    witch: { x0: -1, y0: -9, pal: { K: '#2b2438', P: '#8a63d2' }, rows: [
      '       KK       ', '      KKK       ', '      KKKK      ', '     KKKKK      ', '     KKKKKK     ',
      '    KKKKKKK     ', '    PPPPPPPP    ', '   KKKKKKKKKK   ', 'KKKKKKKKKKKKKKKK'] },
    detective: { x0: 1, y0: -4, pal: { B: '#8b6b4a', b: '#6b4e32' }, rows: ['   BBBBBB   ', '  BbBBBBbB  ', ' BBBBBBBBBB ', 'BBbbbbbbbbBB'] },
    sombrero: { x0: -3, y0: -5, pal: { Y: '#e8c25a', R: '#d6455d', G: '#37d351' }, rows: [
      '      YYYYYYYY      ', '     YYYYYYYYYY     ', '     RGRGRGRGRG     ', '  YYYYYYYYYYYYYYYY  ', 'YYYYYYYYYYYYYYYYYYYY'] },
    knight: { x0: 1, y0: -6, pal: { R: '#d6455d', S: '#b9c3d3', s: '#8a95a8' }, rows: [
      '     RR     ', '    RRR     ', '   RR       ', '  SSSSSSSS  ', ' SSSSSSSSSS ', 'SsSsSsSsSsSs'] },
    jester: { x0: 0, y0: -6, pal: { Y: '#ffe12e', R: '#d6455d', P: '#4b3fa0' }, rows: [
      'Y            Y', ' RR        PP ', ' RRR      PPP ', '  RRRR  PPPP  ', '  RRRRRPPPPP  ', ' YYYYYYYYYYYY '] },
    flowercrown: { x0: 0, y0: -2, pal: { P: '#e46fa8', Y: '#ffe12e', W: '#ffffff', G: '#37d351' }, rows: [' PP YY WW PP ', 'GGGGGGGGGGGGG'] },
    police: { x0: 1, y0: -4, pal: { B: '#2d3f8c', Y: '#ffc431', K: '#1d1d26' }, rows: ['  BBBBBBBB  ', ' BBBBYYBBBB ', ' BBBBBBBBBB ', 'KKKKKKKKKKK '] },
    firefighter: { x0: 0, y0: -5, pal: { R: '#d6455d', Y: '#ffc431' }, rows: [
      '   RRRRRRRR   ', '  RRRRYYRRRR  ', '  RRRRYYRRRR  ', ' RRRRRRRRRRRR ', 'RRRRRRRRRRRRRR'] },
    unicorn: { x0: 5, y0: -6, pal: { Y: '#ffd86b', W: '#fff4d6', P: '#f7a8c8' }, rows: ['  Y ', ' YW ', ' WY ', 'YWY ', 'WYW ', 'PYWP'] },
    ufo: { x0: 2, y0: -8, pal: { G: '#9fe0b8', C: '#d9fff0', S: '#9aa6b8', Y: '#ffe12e' }, rows: [
      '   GGGG   ', '  GCCCCG  ', ' SSSSSSSS ', 'SYSSYSSYSS', ' SSSSSSSS ', '          ', '    YY    '] },
    raincloud: { x0: 1, y0: -9, pal: { W: '#c9d1d9', B: '#5aa9e6' }, rows: [
      '   WWWW     ', ' WWWWWWWW   ', 'WWWWWWWWWWW ', ' WWWWWWWWW  ', '  B   B   B ', ' B   B   B  ', '    B   B   '] },
    frog: { x0: 1, y0: -4, pal: { G: '#5fbf4a', W: '#ffffff', K: '#1d1d26' }, rows: [' GG    GG  ', 'GWKG  GWKG ', 'GGGGGGGGGGG', 'GGGGGGGGGGG'] },
    pumpkin: { x0: 2, y0: -6, pal: { O: '#f2994a', o: '#c96f22', G: '#37a34f' }, rows: [
      '    G     ', '  OOGOO   ', ' OOOOOOOO ', 'OOoOOOOoOO', 'OOoOOOOoOO', ' OOOOOOOO '] },
    eggshell: { x0: 1, y0: -4, pal: { W: '#fff6e8', w: '#e8dcc8' }, rows: ['   WWWWWW   ', '  WWWWWWWW  ', ' WWWWWWWWWw ', 'W w W wW w W'] },
    duck: { x0: 4, y0: -6, pal: { Y: '#ffe12e', K: '#1d1d26', O: '#f2994a' }, rows: ['  YY   ', ' YYKY  ', ' YYYYOO', 'YYYYY  ', 'YYYYYY ', ' YYYY  '] },
    laurel: { x0: 0, y0: -2, pal: { Y: '#e8c25a' }, rows: ['Y Y Y    Y Y Y', 'YYYYY    YYYYY'] },
    bucket: { x0: 0, y0: -4, pal: { B: '#7fa6c9', b: '#5f86a9' }, rows: ['   BBBBBBBB   ', '  BBBBBBBBBB  ', '  BbbbbbbbbB  ', 'BBBBBBBBBBBBBB'] },
    mohawk: { x0: 5, y0: -5, pal: { P: '#e46fa8', p: '#b04a80' }, rows: ['P  P', 'PPPP', 'pPPp', 'PPPP', 'PPPP'] },
  });

  const HAT_ORDER = ['wizard', 'hardhat', 'crown', 'sprout', 'ninja', 'headset', 'cap', 'bow', 'tophat', 'beanie', 'cowboy',
    'chef', 'party', 'viking', 'pirate', 'santa', 'propeller', 'halo', 'horns', 'bunny', 'cat', 'gradcap', 'beret', 'fez',
    'tiara', 'mushroom', 'antenna', 'bandana',
    'witch', 'detective', 'sombrero', 'knight', 'jester', 'flowercrown', 'police', 'firefighter', 'unicorn', 'ufo',
    'raincloud', 'frog', 'pumpkin', 'eggshell', 'duck', 'laurel', 'bucket', 'mohawk'];

  // Equipment: hand items sit at the right claw, face items on the eyes, neck
  // items under the face, back items behind the body. Offsets are relative to
  // that anchor (see wearPixels).
  const mirror = (left, gap) => left.map((r) => r + ' '.repeat(gap) + [...r].reverse().join(''));
  const ACCESSORIES = {
    hand: {
      wand: { x0: 0, y0: 1, pal: { Y: '#ffe12e', W: '#ffffff', K: '#3b2a20' }, rows: ['   Y ', '  YWY', '   Y ', '  K  ', ' K   ', 'K    '] },
      staff: { x0: 0, y0: -5, pal: { P: '#8a63d2', W: '#e9dcff', K: '#5a3a22' }, rows: [' PPP ', 'PPWPP', ' PPP ', '  K  ', '  K  ', '  K  ', '  K  ', '  K  ', '  K  ', '  K  ', '  K  ', '  K  ', '  K  ', '  K  ', '  K  ', '  K  '] },
      broom: { x0: 0, y0: -2, pal: { B: '#8b5a3c', R: '#d6455d', Y: '#e8b04b' }, rows: ['  B  ', '  B  ', '  B  ', '  B  ', '  B  ', '  B  ', '  B  ', '  B  ', '  B  ', '  B  ', ' RRR ', ' YYY ', 'YYYYY'] },
      sword: { x0: 0, y0: -2, pal: { W: '#ffffff', S: '#c9d1d9', G: '#ffc431', K: '#5a3a22' }, rows: [' W ', ' S ', ' S ', ' S ', ' S ', ' S ', 'GGG', ' K ', ' K '] },
      balloon: { x0: 0, y0: -9, pal: { R: '#e46fa8', W: '#ffffff', k: '#6b7a8f' }, rows: [' RRR ', 'RWRRR', 'RRRRR', 'RRRRR', ' RRR ', '  R  ', '  k  ', ' k   ', '  k  ', ' k   ', '  k  ', ' k   ', '  k  ', ' k   ', '  k  '] },
      flag: { x0: 0, y0: -4, pal: { K: '#3b2a20', O: '#d97757', W: '#ffffff' }, rows: [' KOOOO', ' KOWOO', ' KOOOO', ' K    ', ' K    ', ' K    ', ' K    ', ' K    ', ' K    ', ' K    ', ' K    '] },
      mug: { x0: -1, y0: 3, pal: { g: '#c9c9c9', W: '#ffffff', B: '#6b3e1f' }, rows: [' g g ', 'WBBW ', 'WWWWW', 'WWWW ', 'WWWW '] },
      flower: { x0: 0, y0: 0, pal: { P: '#e46fa8', Y: '#ffe12e', G: '#37d351' }, rows: [' PPP ', ' PYP ', ' PPP ', '  G  ', '  G  ', ' GG  ', '  G  '] },
      torch: { x0: 0, y0: -1, pal: { R: '#f2552a', Y: '#ffe12e', K: '#5a3a22' }, rows: ['  R  ', ' RYR ', ' YYY ', '  K  ', '  K  ', '  K  ', '  K  ', '  K  '] },
    },
    face: {
      glasses: { pal: { K: '#2f2f38' }, rows: ['KKKKK  KKKKK', 'K   KKKK   K', 'K   K  K   K', 'KKKKK  KKKKK'] },
      sunglasses: { pal: { K: '#1d1d26', W: '#ffffff' }, rows: ['KKKKK  KKKKK', 'KKKWKKKKKKWK', 'KKKKK  KKKKK'] },
      monocle: { pal: { Y: '#ffc431' }, rows: ['       YYYYY', '       Y   Y', '       Y   Y', '       YYYYY', '          Y ', '         Y  '] },
      mustache: { pal: { K: '#3b2a20' }, rows: ['', '', '', '   KKKKKK', '  KK    KK'] },
      mask: { x0: -1, pal: { K: '#2f2f38' }, rows: ['KKKKKKKKKKKKKK', 'KKK KKKKKK KKK', 'KKK KKKKKK KKK'] },
      blush: { pal: { P: '#f7a8c8' }, rows: ['', '', '', 'PP         PP'] },
    },
    neck: {
      bowtie: { x0: 4, pal: { R: '#d6455d', r: '#9e2f44' }, rows: ['RR  RR', 'RRrrRR', 'RR  RR'] },
      scarf: { x0: -1, pal: { S: '#3aa7a3', s: '#2a7f7c' }, rows: ['SSSSSSSSSSSSSSSS', 'ssssssssssssssss', '           SS   ', '           ss   '] },
      bell: { x0: 0, pal: { R: '#d6455d', Y: '#ffc431' }, rows: ['RRRRRRRRRRRRRR', '      YY      ', '      YY      '] },
      tie: { x0: 6, pal: { K: '#2f2f38', B: '#3f6fd8' }, rows: ['KK', 'BB', 'BB', 'B '] },
    },
    back: {
      cape: { x0: -2, y0: 2, pal: { C: '#d6455d', c: '#9e2f44' }, rows: ['  CCCCCCCCCCCCCC  ', ' CCCCCCCCCCCCCCCC ', ' CCCCCCCCCCCCCCCC ', 'CCCCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCC', 'cccccccccccccccccc'] },
      royal: { x0: -2, y0: 2, pal: { C: '#6b3fa0', Y: '#ffc431' }, rows: ['  CCCCCCCCCCCCCC  ', ' CCCCCCCCCCCCCCCC ', ' CCCCCCCCCCCCCCCC ', 'CCCCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCC', 'YYYYYYYYYYYYYYYYYY'] },
      angel: { x0: -6, y0: 0, pal: { W: '#ffffff', g: '#b9c3d3' }, rows: mirror(['   ggg', ' ggWWW', 'gWWWgW', 'gWWgW ', ' gWgW  ', '  g   '].map((r) => r.slice(0, 6)), 14) },
      bat: { x0: -6, y0: 0, pal: { K: '#4b3fa0' }, rows: mirror(['     K', '   KKK', ' KKKKK', 'KKKKKK', 'K K KK'], 14) },
      fairy: { x0: -6, y0: -1, pal: { B: '#9fe0f5', W: '#ffffff' }, rows: mirror(['  BB  ', ' BWBB ', 'BBBBBB', ' BBBB ', '  BBB ', ' BB   '], 14) },
    },
  };
  Object.assign(ACCESSORIES.hand, {
    umbrella: { x0: -2, y0: -8, pal: { R: '#3e6cff', W: '#ffffff', K: '#3b2a20' }, rows: ['  RRRRR  ', ' RRWRRWR ', 'RRRRRRRRR', '    K    ', '    K    ', '    K    ', '    K    ', '    K    ', '   KK    '] },
    lollipop: { x0: 0, y0: -2, pal: { P: '#ff3b99', W: '#ffffff' }, rows: [' PPP ', 'PWPPP', 'PPPWP', ' PPP ', '  W  ', '  W  ', '  W  '] },
    icecream: { x0: 0, y0: -1, pal: { P: '#f7a8c8', W: '#fff4e0', Y: '#e0b06b' }, rows: [' PP ', 'PPPP', 'WWWW', 'YYYY', ' YY ', ' YY '] },
    pizza: { x0: 0, y0: 1, pal: { B: '#b07a35', Y: '#e8b04b', R: '#d6455d' }, rows: ['BBBBB', 'YRYRY', ' YYY ', ' YRY ', '  Y  '] },
    magnifier: { x0: 0, y0: -1, pal: { K: '#3b3743', C: '#bfe6ff', B: '#8b5a3c' }, rows: [' KKK ', 'KCCCK', 'KCCCK', 'KCCCK', ' KKK ', '   BB', '    B'] },
    paintbrush: { x0: 0, y0: -3, pal: { R: '#3e6cff', W: '#c9d1d9', K: '#8b5a3c' }, rows: ['  R ', ' RR ', ' WW ', '  K ', '  K ', '  K ', '  K ', '  K '] },
    wrench: { x0: 0, y0: -1, pal: { S: '#9aa6b8' }, rows: ['S S', 'SSS', ' S ', ' S ', ' S ', ' S ', ' S '] },
    trophy: { x0: -1, y0: 0, pal: { Y: '#ffc431' }, rows: ['Y YYY Y', 'YYYYYYY', '  YYY  ', '   Y   ', '  YYY  '] },
    fishingrod: { x0: 0, y0: -6, pal: { K: '#8b5a3c', w: '#e0e0e0', F: '#5aa9e6' }, rows: ['    K ', '   K w', '  K  w', ' K   w', 'K    F'] },
  });
  Object.assign(ACCESSORIES.face, {
    eyepatch: { pal: { K: '#1d1d26' }, rows: ['KKKKKKKKKKKKK', '       KKKKK', '       KKKKK', '        KKK '] },
    heartglasses: { pal: { R: '#ff3b99', K: '#2f2f38' }, rows: ['RR RR  RR RR', 'RRRRRKKRRRRR', ' RRR    RRR ', '  R      R  '] },
    starglasses: { pal: { Y: '#ffe12e', K: '#2f2f38' }, rows: ['  Y      Y  ', 'YYYYY  YYYYY', ' YYY KK YYY ', 'Y   Y  Y   Y'] },
    roundglasses: { pal: { K: '#3b3743' }, rows: [' KKK    KKK ', 'K   KKKK   K', 'K   K  K   K', ' KKK    KKK '] },
    visor: { pal: { K: '#2f2f38', C: '#3fd0ff' }, rows: ['KKKKKKKKKKKK', 'KCCCCCCCCCCK', 'KCCCCCCCCCCK', 'KKKKKKKKKKKK'] },
    freckles: { pal: { B: '#b5653f' }, rows: ['', '', '', ' B B    B B', '  B      B '] },
    clownnose: { pal: { R: '#f2552a' }, rows: ['', '', '', '     RR', '     RR'] },
    beard: { pal: { B: '#8b5a3c' }, rows: ['', '', '', '', 'BB        BB', 'BBBBBBBBBBBB', ' BBBBBBBBBB '] },
  });
  Object.assign(ACCESSORIES.neck, {
    necklace: { x0: 1, pal: { Y: '#ffc431', R: '#3e6cff' }, rows: ['YYYYYYYYYYYY', '     YY     ', '     RR     '] },
    medal: { x0: 6, pal: { R: '#d6455d', B: '#3e6cff', Y: '#ffc431' }, rows: ['RB', 'RB', 'YY', 'YY'] },
    lei: { x0: 0, pal: { P: '#e46fa8', Y: '#ffe12e', W: '#ffffff' }, rows: ['PYPWPYPWPYPWPY', ' P W P Y P W  '] },
    spikes: { x0: 0, pal: { K: '#2f2f38', S: '#c9d1d9' }, rows: ['KKKKKKKKKKKKKK', 'S S S S S S S '] },
    camera: { x0: 4, pal: { K: '#2f2f38', C: '#5aa9e6' }, rows: ['K    K', ' K  K ', ' KKKK ', 'KKCCKK', 'KKKKKK'] },
  });
  Object.assign(ACCESSORIES.back, {
    backpack: { x0: -4, y0: 3, pal: { G: '#3aa76d', g: '#2a7f53' }, rows: ['  GG  ', ' GGGG ', 'GGGGGG', 'GgggGG', 'GGGGGG', 'GGGGGG'] },
    jetpack: { x0: -4, y0: 3, pal: { S: '#9aa6b8', R: '#f2552a', Y: '#ffe12e' }, rows: ['SSSS', 'SSSS', 'SSSS', 'SSSS', 'SSSS', 'RYRY', 'Y Y '] },
    dragon: { x0: -6, y0: -1, pal: { G: '#3aa76d', g: '#9fe0b8' }, rows: mirror(['    G ', '  GGG ', ' GgGG ', 'GGgGG ', 'G G G '], 14) },
    butterfly: { x0: -6, y0: 0, pal: { O: '#f2994a', Y: '#ffe12e', P: '#8a63d2' }, rows: mirror([' OO   ', 'OYOO  ', 'OOOO  ', ' OOO  ', 'OPO   ', ' O    '], 14) },
    quiver: { x0: 13, y0: -2, pal: { W: '#ffffff', Y: '#ffe12e', B: '#8b5a3c' }, rows: [' WY', ' WY', 'BBB', 'BBB', 'BBB', 'BBB'] },
  });

  const SLOTS = ['hand', 'face', 'neck', 'back'];
  const COLORS = {
    classic: '#d97757', coral: '#f07c6c', sunset: '#f2994a', gold: '#e8b04b', lime: '#8fcf5b', mint: '#4fc4a0',
    teal: '#3aa7a3', sky: '#5aa9e6', ocean: '#3f6fd8', grape: '#8a63d2', bubblegum: '#e46fa8', cherry: '#d6455d',
    cocoa: '#8b5a3c', slate: '#6b7a8f', snow: '#e9e4dc', shadow: '#3b3743',
  };
  Object.assign(COLORS, { neon: '#39ff5a', lavender: '#b9a3f0', peach: '#ffb48a', midnight: '#2a2f5a', rose: '#f28fb0' });
  const EYE_COLORS = { ink: '#2f2f38', navy: '#1e3a8a', forest: '#14532d', berry: '#701a75', white: '#ffffff' };

  // ---------------------------------------------------------------- bubbles & minis
  const BUBBLES = {
    '!': { pal: { Y: '#ffe12e', K: '#2f2f38' }, rows: [
      ' YYYYY ', 'YYYKYYY', 'YYYKYYY', 'YYYKYYY', 'YYYYYYY', 'YYYKYYY', ' YYYYY ', '  Y    ',
    ] },
    '?': { pal: { P: '#ff3b99', W: '#ffffff' }, rows: [
      ' PPPPP ', 'PPWWWPP', 'PPPPWPP', 'PPPWWPP', 'PPPWPPP', 'PPPPPPP', 'PPPWPPP', ' PPPPP ', '  P    ',
    ] },
    '✓': { pal: { G: '#37d351', W: '#ffffff' }, rows: [
      ' GGGGG ', 'GGGGGWG', 'GGGGWGG', 'GWGWGGG', 'GGWGGGG', ' GGGGG ', '  G    ',
    ] },
    // Context nearly full (about to compact): a red-orange % bubble.
    ctx: { pal: { O: '#ff5a2e', W: '#ffffff' }, rows: [
      ' OOOOOOO ', 'OWWOOOWOO', 'OWWOOWOOO', 'OOOOWOOOO', 'OOOWOOOOO', 'OOWOOWWOO', 'OWOOOWWOO', ' OOOOOOO ', '  O      ',
    ] },
  };

  // Loose items in the world (snacks, fetch balls), drawn at the item's centre.
  const ITEMS = {
    cookie: { pal: { C: '#c68a4b', c: '#6b3e1f' }, rows: [' CCC ', 'CcCCC', 'CCCcC', 'CcCCC', ' CCC '] },
    ball: { pal: { Y: '#d8f25a', W: '#ffffff', y: '#a9c23b' }, rows: [' YYY ', 'YWYYY', 'YYYYy', 'YYYyy', ' yyy '] },
    snowball: { pal: { W: '#ffffff', b: '#c9e4f7' }, rows: [' WWW ', 'WWWWW', 'WWWWb', 'WWWbb', ' bbb '] },
    parcel: { pal: { B: '#c9a27a', T: '#8b5a3c' }, rows: ['BBTBB', 'BBTBB', 'TTTTT', 'BBTBB', 'BBTBB'] },
    bug: { pal: { R: '#f06a5d', K: '#2f2f38', r: '#9e2f44' }, rows: ['K   K', ' RRR ', 'RKRKR', 'RrRrR', ' R R '] },
    flag: { pal: { K: '#3b2a20', O: '#d97757', o: '#f0a07f', W: '#ffffff' }, rows: [
      'KOOOOo ', 'KOOWOOo', 'KOOOOOo', 'KOOOo  ', 'K      ', 'K      ', 'K      ', 'K      ', 'K      ', 'KK     '] },
  };

  // Files a buddy eats: a document, a zip and a picture, 6x8 pixels.
  const FILE_ICONS = {
    file: { pal: { W: '#ffffff', g: '#c9cdd4', l: '#8a93a3', K: '#4a5160' }, rows: ['KKKK  ', 'KWWWgK', 'KWWWWK', 'KlllWK', 'KWWWWK', 'KlllWK', 'KWWWWK', 'KKKKKK'] },
    zip: { pal: { Y: '#f2c14e', y: '#c99a2e', K: '#4a3410', D: '#2f2f38' }, rows: ['KKKK  ', 'KYDYyK', 'KYYDYK', 'KYDYYK', 'KYYDYK', 'KYDDYK', 'KYYYYK', 'KKKKKK'] },
    image: { pal: { W: '#ffffff', B: '#8fd0ff', G: '#4fc4a0', Y: '#ffe12e', K: '#4a5160' }, rows: ['KKKK  ', 'KBBBWK', 'KBBYBK', 'KBBBBK', 'KBGBBK', 'KGGGBK', 'KGGGGK', 'KKKKKK'] },
  };
  const fileKind = (name) => (/\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i.test(name) ? 'zip' : /\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?)$/i.test(name) ? 'image' : 'file');

  /** A stack of files held above the head ('up') or at the mouth being bitten ('mouth'). */
  function carryPixels(pose, carry, f) {
    const out = [];
    const kinds = (carry.kinds || []).slice(-4);
    if (!kinds.length) return out;
    const cx = Math.round((pose.headL + pose.headR) / 2) - 3;
    const baseY = carry.pos === 'up' ? pose.headTop - 9 : pose.headTop + 3;
    kinds.forEach((kind, i) => {
      const icon = FILE_ICONS[kind] || FILE_ICONS.file;
      const top = i === kinds.length - 1;
      // Bites come off the top file from the upper right, one more per frame.
      const bites = carry.pos === 'mouth' && top ? Math.floor(f * 1.2) : 0;
      icon.rows.forEach((row, ry) => [...row].forEach((ch, rx) => {
        if (ch === ' ') return;
        if (bites && (rx + (7 - ry)) * 1.0 > 13 - bites * 1.6) return;
        out.push({ x: cx + rx + i, y: baseY + ry - i * 2, c: icon.pal[ch], r: ROLE.HAT });
      }));
    });
    if (carry.pos === 'mouth' && f % 2) out.push({ x: cx + 2 + (f % 3), y: baseY + 9 + (f % 2), c: '#c9cdd4', r: ROLE.HAT }); // crumbs
    return out;
  }
  const MINI = [
    [' ##### ', ' #e#e# ', '#######', '# # # #'],
    [' ##### ', ' #e#e# ', '#######', ' # # # '],
  ];

  // 3x5 pixel font for name tags.
  const FONT = (() => {
    const g = {
      A: '.#. #.# ### #.# #.#', B: '##. #.# ##. #.# ##.', C: '.## #.. #.. #.. .##', D: '##. #.# #.# #.# ##.',
      E: '### #.. ##. #.. ###', F: '### #.. ##. #.. #..', G: '.## #.. #.# #.# .##', H: '#.# #.# ### #.# #.#',
      I: '### .#. .#. .#. ###', J: '..# ..# ..# #.# .#.', K: '#.# #.# ##. #.# #.#', L: '#.. #.. #.. #.. ###',
      M: '#.# ### ### #.# #.#', N: '##. #.# #.# #.# #.#', O: '.#. #.# #.# #.# .#.', P: '##. #.# ##. #.. #..',
      Q: '.#. #.# #.# ##. .##', R: '##. #.# ##. #.# #.#', S: '.## #.. .#. ..# ##.', T: '### .#. .#. .#. .#.',
      U: '#.# #.# #.# #.# ###', V: '#.# #.# #.# #.# .#.', W: '#.# #.# ### ### #.#', X: '#.# #.# .#. #.# #.#',
      Y: '#.# #.# .#. .#. .#.', Z: '### ..# .#. #.. ###',
      0: '### #.# #.# #.# ###', 1: '.#. ##. .#. .#. ###', 2: '##. ..# .#. #.. ###', 3: '##. ..# .#. ..# ##.',
      4: '#.# #.# ### ..# ..#', 5: '### #.. ##. ..# ##.', 6: '.## #.. ### #.# ###', 7: '### ..# .#. .#. .#.',
      8: '### #.# ### #.# ###', 9: '### #.# ### ..# ##.',
      '-': '... ... ### ... ...', _: '... ... ... ... ###', '.': '... ... ... ... .#.', ' ': '... ... ... ... ...',
      '!': '.#. .#. .#. ... .#.', '?': '##. ..# .#. ... .#.',
      '%': '#.# ..# .#. #.. #.#', ':': '... .#. ... .#. ...', '/': '..# ..# .#. #.. #..', '>': '#.. .#. ..# .#. #..',
      ',': '... ... ... .#. #..', "'": '.#. .#. ... ... ...', '+': '... .#. ### .#. ...', '(': '.#. #.. #.. #.. .#.', ')': '.#. ..# ..# ..# .#.',
      '#': '#.# ### #.# ### #.#', '=': '... ### ... ### ...', '<': '..# .#. #.. .#. ..#', '*': '... #.# .#. #.# ...', '&': '.#. #.# .#. #.# .##',
      '"': '#.# #.# ... ... ...', '~': '... .## ### ##. ...', '@': '### #.# #.# #.. ###', '$': '.## ##. .#. .## ##.', ';': '... .#. ... .#. #..',
    };
    for (const k in g) g[k] = g[k].replace(/ /g, '');
    return g;
  })();

  // ---------------------------------------------------------------- animations
  // pose: a pack pose name, or map: + face: for the procedural body.
  // fx: list of [effect, options]. flip: may be mirrored when walking left.
  const A = {
    // locomotion & reactions (procedural body)
    idle: { map: 'base', face: 'normal', fps: 8, frames: 48, fx: [['bob', { every: 6 }], ['blink', { every: 24 }]] },
    look: { map: 'base', face: 'lookR', fps: 8, frames: 32, fx: [['bob', { every: 6 }], ['blink', { every: 16 }]], flip: true },
    walk: { map: 'base', face: 'lookR', fps: 9, frames: 4, fx: [['walk']], flip: true },
    run: { map: 'base', face: 'lookR', fps: 16, frames: 4, fx: [['walk']], flip: true },
    crouch: { map: 'squash', face: 'normal', fps: 1, frames: 1, flip: true },
    jump: { map: 'armsUp', face: 'happy', fps: 1, frames: 1, fx: [['legsTuck']], flip: true },
    fall: { map: 'armsUp', face: 'surprised', fps: 12, frames: 4, fx: [['walk']], flip: true },
    land: { map: 'squash', face: 'closed', fps: 1, frames: 1, flip: true },
    held: { map: 'armsUp', face: 'surprised', fps: 10, frames: 4, fx: [['walk'], ['shake']] },
    cheer: { map: 'armsUp', face: 'happy', fps: 12, frames: 8, fx: [['hop', { h: [0, 2, 4, 5, 4, 2, 0, 0] }]] },
    alert: { map: 'armsUp', face: 'normal', fps: 10, frames: 10, fx: [['hop', { h: [0, 1, 3, 4, 3, 1, 0, 0, 0, 0] }], ['blink', { every: 10 }]] },
    startled: { map: 'armsUp', face: 'surprised', fps: 12, frames: 6, fx: [['hop', { h: [0, 3, 5, 5, 3, 0] }]] },
    wave: { map: 'base', face: 'happy', fps: 5, frames: 2, fx: [['armWave']] },
    talk: { map: 'base', face: 'happy', fps: 6, frames: 4, fx: [['hop', { h: [0, 1, 0, 1] }]] },
    sick: { map: 'squash', face: 'dizzy', fps: 10, frames: 6, fx: [['shake']] },
    vomit: { map: 'squash', face: 'surprised', fps: 8, frames: 4, fx: [['shake', { every: 2 }]], flip: true },
    dizzyBase: { map: 'base', face: 'dizzy', fps: 8, frames: 4, fx: [['shake']] },
    sadBase: { map: 'base', face: 'sad', fps: 3, frames: 6, fx: [['bob', { every: 3 }]] },
    nap: { map: 'lie', face: 'closed', fps: 3, frames: 12, fx: [['bob', { every: 3, bodyOnly: true }], ['float', { range: 4 }]], overlay: 'sleeping-soundly', flip: true },
    poof: { map: 'base', face: 'happy', fps: 10, frames: 10, fx: [['fade'], ['hop', { h: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }]] },
    pancake: { map: 'flat', face: 'none', fps: 6, frames: 6, fx: [['twinkle', { period: 2 }], ['shake', { every: 3 }]] },
    eggIdle: { map: 'egg', face: 'none', fps: 3, frames: 4, hat: false, fx: [['shake', { every: 2 }]] },
    egg: { map: 'egg', face: 'none', fps: 4, frames: 6, hat: false, fx: [['cracks'], ['shake']] },
    snack: { map: 'base', face: 'happy', fps: 4, frames: 8, fx: [['cookie'], ['bob', { every: 2 }]] },
    // Eating files: hold the stack overhead, then munch the top one bite by bite.
    holdUp: { map: 'armsUp', face: 'happy', fps: 6, frames: 6, carry: 'up', fx: [['hop', { h: [0, 1, 2, 1, 0, 0] }]] },
    munchFile: { map: 'base', face: 'happy', fps: 5, frames: 8, carry: 'mouth', fx: [['bob', { every: 1 }]] },
    // Pac-Man style chomping (used to eat rows and icons in the file dialog).
    chomp: { map: 'base', face: 'lookR', fps: 12, frames: 4, fx: [['wedge'], ['walk', { every: 1 }]], flip: true },
    // Typing frames advance once per key press (the world sends the tap count).
    typing: { map: 'typing', face: 'normal', fps: 1, frames: 8, fx: [['tap'], ['keyFlash']] },
    typeErase: { map: 'typing', face: 'sad', fps: 10, frames: 4, fx: [['shakeArms']] },

    // thinking & planning
    thinking: { pose: 'thinking-pixel-bubble', fps: 4, frames: 12, fx: [['seq', { colors: ['#3d45d3'], hold: 1 }], ['bob', { every: 4 }], ['blink', { every: 12 }]], flip: true },
    thinkWalk: { pose: 'thinking-pixel-bubble', fps: 9, frames: 12, fx: [['seq', { colors: ['#3d45d3'], hold: 1, every: 3 }], ['walk']], flip: true },
    thinkCode: { pose: 'thinking-in-code', fps: 4, frames: 8, fx: [['pulse'], ['bob', { every: 4 }], ['blink', { every: 8 }]] },
    meditate: { pose: 'artboard-24cla', fps: 3, frames: 12, fx: [['twinkle', { period: 3 }], ['bob', { every: 3, bodyOnly: true }]] },
    idea: { pose: 'artboard-4cla', fps: 6, frames: 8, fx: [['flicker', { p: 0.25 }], ['hop', { h: [0, 0, 1, 2, 1, 0, 0, 0] }]] },
    eureka: { pose: 'idea-lightbulb-pixel', fps: 6, frames: 8, fx: [['twinkle', { period: 2 }]] },
    planning: { pose: 'professional-documentation-audit', fps: 4, frames: 8, fx: [['pulse', { colors: ['#37d351', '#39d353', '#3cd694'] }], ['bob', { every: 4 }]] },
    todo: { pose: 'artboard-2cla', fps: 4, frames: 10, fx: [['seq', { axis: 'y', hold: 3 }]] },

    // reading & searching
    reading: { pose: 'reading-data-document', fps: 4, frames: 8, fx: [['propBob'], ['bob', { every: 4 }]] },
    reviewing: { pose: 'reviewing-long-data-log', fps: 4, frames: 8, fx: [['swing'], ['blink', { every: 8 }]] },
    searching: { pose: 'examining-green-globe', fps: 4, frames: 12, fx: [['swing'], ['blink', { every: 12 }]] },
    scroll: { pose: 'holding-ancient-scroll', fps: 3, frames: 6, fx: [['propBob'], ['blink', { every: 6 }]] },
    web: { pose: 'tracking-multiple-locations', fps: 4, frames: 8, fx: [['jitter', { y: true }], ['blink', { every: 8 }]] },
    browsing: { pose: 'multi-window-workflow', fps: 3, frames: 8, fx: [['jitter', { y: true }]] },

    // making things
    coding: { pose: 'writing-software-code', fps: 8, frames: 8, fx: [['jitter'], ['twinkle', { period: 4 }], ['walk', { every: 2 }]] },
    building: { pose: 'building-colorful-blocks', ground: 'bottom', fps: 6, frames: 12, fx: [['seq', { hold: 5 }], ['blink', { every: 12 }]] },
    debugging: { pose: 'debugging-system-bugs', fps: 6, frames: 8, fx: [['jitter', { y: true }]] },
    bugs: { pose: 'artboard-4cla2', fps: 8, frames: 8, fx: [['jitter', { y: true }], ['shake', { every: 2 }]] },
    tools: { pose: 'repairing-with-tools', fps: 6, frames: 4, fx: [['jitter', { y: true }]] },
    testing: { pose: 'lab-science-testing', fps: 5, frames: 8, fx: [['rise', { colors: ['#31ef9a', '#37d351', '#ffffff'] }], ['propBob'], ['blink', { every: 8 }]] },
    lifting: { pose: 'lifting-heavy-barbell', fps: 4, frames: 4, fx: [['liftBob'], ['shake', { every: 2 }]] },
    loop: { pose: 'in-constant-loop', fps: 8, frames: 8, fx: [['chase']] },
    sync: { pose: 'refresh-sync-pixel', fps: 6, frames: 4, fx: [['chase']] },
    git: { pose: 'visualizing-tree-data', fps: 6, frames: 12, fx: [['seq', { axis: 'y', reverse: true, hold: 4 }]] },
    launch: { pose: 'rocket-launch-success', fps: 10, frames: 6, fx: [['jitter'], ['flicker', { p: 0.3 }]] },
    servers: { pose: 'managing-server-rack', fps: 4, frames: 6, fx: [['flicker', { p: 0.3 }]] },
    infra: { pose: 'infrastructure-server-stacks', fps: 4, frames: 6, fx: [['twinkle', { period: 3 }]] },
    terminal: { pose: 'system-monitoring-dashboard', fps: 6, frames: 8, fx: [['flicker', { p: 0.3 }], ['blink', { every: 8 }]] },
    monitor: { pose: 'server-stack-pixel', fps: 4, frames: 6, fx: [['flicker', { p: 0.25 }]] },
    compacting: { pose: 'data-blocks-pixel', fps: 4, frames: 8, fx: [['jitter', { y: true }]] },
    hourglass: { pose: 'artboard-4cla3', fps: 3, frames: 6, fx: [['flicker', { p: 0.3 }]] },

    // asking & permissions
    asking: { pose: 'it-depends-sign', fps: 3, frames: 6, fx: [['propBob'], ['blink', { every: 6 }]] },
    permission: { pose: 'secure-access-padlock', fps: 6, frames: 6, fx: [['jitter']] },
    shield: { pose: 'artboard-24cla3', fps: 4, frames: 6, fx: [['pulse']] },
    delegating: { pose: 'artboard-25cla', fps: 6, frames: 8, fx: [['extraHop']] },

    // trouble
    dizzy: { pose: 'dizzy-failed-state', fps: 8, frames: 8, fx: [['twinkle', { period: 2 }], ['shake', { every: 2 }]] },
    confused: { pose: 'confusion-spiral-pixel', fps: 6, frames: 6, fx: [['chase']] },
    errorState: { pose: 'error-state-pixel', fps: 4, frames: 6, fx: [['pulse']] },
    critical: { pose: 'marking-critical-error', fps: 6, frames: 6, fx: [['pulse'], ['twinkle', { period: 3 }]] },
    xblock: { pose: 'artboard-2cla2', fps: 6, frames: 6, fx: [['pulse'], ['hop', { h: [0, 1, 2, 1, 0, 0] }]] },
    angry: { pose: 'angry-at-laptop', fps: 10, frames: 8, fx: [['flicker', { p: 0.35 }], ['shake', { every: 2 }]] },
    rage: { pose: 'angry-powerful-lightning', fps: 12, frames: 8, fx: [['flicker', { p: 0.4 }], ['shake']] },
    fine: { pose: 'fine-under-pressure', fps: 8, frames: 8, fx: [['flicker', { p: 0.3 }], ['blink', { every: 8 }]] },
    crying: { pose: 'crying-sad-reaction', fps: 6, frames: 6, fx: [['drops']] },
    sad: { pose: 'broken-heart-sad', fps: 4, frames: 6, fx: [['drops', { colors: ['#50a8ff'] }], ['propBob']] },
    failed: { pose: 'failed-process-error', fps: 4, frames: 6, fx: [['pulse']] },
    alarm: { pose: 'system-error-alert', fps: 6, frames: 6, fx: [['flicker', { p: 0.35 }]] },
    disconnected: { pose: 'disconnected-plug-pixel', fps: 4, frames: 6, fx: [['jitter']] },
    grumpy: { pose: 'angry-pixel-coffee', fps: 6, frames: 8, fx: [['flicker', { p: 0.3, colors: ['#ffc033', '#ffe12e', '#fcfc56', '#f1ff6c'] }], ['rise', { colors: ['#ffffff', '#d3d3d3', '#c3beea'] }]] },

    // good news
    celebrate: { pose: 'happy-pixel-celebrating', fps: 10, frames: 8, fx: [['twinkle', { period: 2 }], ['hop', { h: [0, 2, 4, 5, 4, 2, 0, 0] }]] },
    success: { pose: 'success-achievement-milestone', fps: 6, frames: 6, fx: [['twinkle', { period: 2 }], ['bob', { every: 3 }]] },
    check: { pose: 'with-success-checkmark', fps: 6, frames: 8, fx: [['pulse'], ['hop', { h: [0, 1, 3, 4, 3, 1, 0, 0] }]] },
    api: { pose: 'api-success-pixel', fps: 4, frames: 6, fx: [['pulse']] },
    trending: { pose: 'trending-up-pixel', fps: 6, frames: 6, fx: [['rise']] },
    rocket: { pose: 'rocket-launch-success', fps: 10, frames: 6, fx: [['jitter'], ['flicker', { p: 0.3 }]] },
    confetti: { pose: 'artboard-3cla2', fps: 8, frames: 8, fx: [['twinkle', { period: 2 }], ['hop', { h: [0, 1, 3, 4, 3, 1, 0, 0] }]] },
    milestone: { pose: 'artboard-3cla3', fps: 6, frames: 6, fx: [['twinkle', { period: 2 }]] },
    welcome: { pose: 'welcome-pixel-banner', fps: 10, frames: 26, fx: [['seq', { hold: 6 }]] }, // 20 reveal steps, then the full banner held (2.6 s)
    hi: { pose: 'artboard-3cla', fps: 6, frames: 6, fx: [['hideClusters', { colors: ['#ff3b99'] }], ['propBob']] },
    ola: { pose: 'artboard-3cla', fps: 6, frames: 6, fx: [['hideClusters', { colors: ['#39ff5a'] }], ['propBob']] },
    love: { pose: 'love-cloud-pixel', fps: 4, frames: 6, fx: [['pulse', { colors: ['#ef509c', '#ff3b99', '#e03890'] }], ['bob', { every: 3 }]] },

    // idle fidgets
    sleeping: { pose: 'sleeping-soundly', fps: 3, frames: 12, fx: [['float', { range: 4 }], ['bob', { every: 3, bodyOnly: true }]] },
    pie: { pose: 'baking-steaming-pie', fps: 4, frames: 6, fx: [['rise', { colors: ['#ffffff', '#d3d3d3', '#c9c9c9', '#e0e0e0'] }], ['blink', { every: 6 }]] },
    leaf: { pose: 'holding-green-leaf', fps: 3, frames: 6, fx: [['swing'], ['blink', { every: 6 }]] },
    plant: { pose: 'planting-small-trees', fps: 3, frames: 6, fx: [['twinkle', { period: 3 }], ['blink', { every: 6 }]] },
    mushrooms: { pose: 'nature-growth-mushrooms', fps: 3, frames: 6, fx: [['propBob']] },
    grow: { pose: 'growing-pixel-nature', fps: 3, frames: 6, fx: [['twinkle', { period: 3 }], ['bob', { every: 3, bodyOnly: true }]] },
    wizard: { pose: 'artboard-2cla3', fps: 4, frames: 8, fx: [['twinkle', { period: 2 }], ['blink', { every: 8 }]] },
    ninja: { pose: 'stealth-ninja-security', fps: 8, frames: 4, fx: [['walk'], ['twinkle', { period: 2 }]], flip: true },
    zoom: { pose: 'fast-performance-trail', fps: 14, frames: 4, fx: [['walk'], ['jitter']], flip: true },
    spark: { pose: 'artboard-25cla3', fps: 8, frames: 4, fx: [['jitter'], ['walk']], flip: true },
    malware: { pose: 'malware-detection-window', fps: 3, frames: 6, fx: [['pulse']] },
  };

  // Which animations to play for each kind of work (one is picked at random).
  const ACTIVITY_ANIMS = {
    thinking: ['thinking', 'thinkCode'],
    deepThought: ['meditate', 'thinkCode'],
    planning: ['planning', 'todo', 'idea', 'eureka'],
    reading: ['reading', 'reviewing'],
    searching: ['searching'],
    scroll: ['scroll'],
    coding: ['coding'],
    building: ['building'],
    debugging: ['debugging', 'bugs'],
    testing: ['testing'],
    lifting: ['lifting', 'loop', 'sync'],
    git: ['git'],
    launch: ['launch'],
    servers: ['servers', 'infra', 'monitor'],
    terminal: ['terminal'],
    web: ['web'],
    browsing: ['browsing'],
    tools: ['tools'],
    // Sub-agents show up as real helper Clawds, so the buddy itself just plans.
    delegating: ['todo', 'planning'],
    asking: ['asking'],
    permission: ['permission'],
    compacting: ['compacting', 'fine'],
    waiting: ['hourglass'],
    error1: ['dizzy', 'errorState', 'confused'],
    error2: ['angry', 'critical', 'xblock', 'bugs'],
    error3: ['rage', 'fine', 'alarm'],
    crashed: ['crying', 'disconnected', 'failed', 'sad'],
    celebrate: ['celebrate', 'success', 'check', 'trending', 'confetti', 'api', 'rocket', 'milestone'],
    fidget: ['pie', 'leaf', 'plant', 'mushrooms', 'grow', 'wizard', 'meditate', 'grumpy'],
  };

  // ---------------------------------------------------------------- pose loading
  let palette = [];
  const poses = {};

  function clusterize(pose) {
    // 8-connected components among props, and separately among "extra" body bits.
    const groups = [[ROLE.PROP], [ROLE.EXTRA]];
    const at = new Map(pose.pixels.map((p) => [p.x + ',' + p.y, p]));
    pose.clusters = [];
    for (const roles of groups) {
      for (const p of pose.pixels) {
        if (!roles.includes(p.r) || p.k !== undefined) continue;
        const k = pose.clusters.length;
        const cl = { k, n: 0, sx: 0, sy: 0, colors: new Set(), role: p.r };
        const stack = [p];
        p.k = k;
        while (stack.length) {
          const q = stack.pop();
          cl.n++; cl.sx += q.x; cl.sy += q.y; cl.colors.add(q.c);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const n = at.get(q.x + dx + ',' + (q.y + dy));
            if (n && n.k === undefined && roles.includes(n.r)) { n.k = k; stack.push(n); }
          }
        }
        cl.cx = cl.sx / cl.n; cl.cy = cl.sy / cl.n;
        pose.clusters.push(cl);
      }
    }
    // Angular order around the body centre, for "chase" effects.
    const bx = (pose.body[0] + pose.body[2]) / 2, by = (pose.body[1] + pose.body[3]) / 2;
    const props = pose.clusters.filter((c) => c.role === ROLE.PROP);
    props.sort((a, b) => Math.atan2(a.cy - by, a.cx - bx) - Math.atan2(b.cy - by, b.cx - bx));
    props.forEach((c, i) => { c.ang = i; });
    pose.propCount = props.length;
  }

  function finishPose(pose) {
    const legs = pose.pixels.filter((p) => p.r === ROLE.LEG);
    pose.legBottom = legs.length ? Math.max(...legs.map((p) => p.y)) : -1;
    const eyes = pose.pixels.filter((p) => p.r === ROLE.EYE);
    pose.eyeBottom = eyes.length ? Math.max(...eyes.map((p) => p.y)) : -1;
    clusterize(pose);
    pose.hatOk = pose.headR - pose.headL >= 12;
    pose.hatFit = {};
    // Eye anchors for face accessories: the top pixel of each eye, split at the head's middle.
    const mid = (pose.headL + pose.headR) / 2;
    const side = (list) => list.length ? { x: Math.round(list.reduce((s, p) => s + p.x, 0) / list.length), y: Math.min(...list.map((p) => p.y)) } : null;
    const faceEyes = eyes.filter((p) => p.y <= pose.headTop + 7);
    pose.eyes = { l: side(faceEyes.filter((p) => p.x < mid)), r: side(faceEyes.filter((p) => p.x >= mid)) };
    pose.neckY = pose.eyeBottom >= 0 ? pose.eyeBottom + 2 : pose.headTop + 6;
    return pose;
  }

  function loadPoses(json) {
    palette = json.palette;
    for (const [name, m] of Object.entries(json.poses)) {
      const pixels = [];
      for (let i = 0; i < m.px.length; i += 4) pixels.push({ x: m.px[i], y: m.px[i + 1], c: palette[m.px[i + 2]], r: m.px[i + 3] });
      poses[name] = finishPose({ name, w: m.w, h: m.h, ax: m.ax, ay: m.ay, headTop: m.headTop, headL: m.headL, headR: m.headR, body: m.body, pixels });
    }
  }

  function mapPose(mapName, faceName) {
    const key = mapName + ':' + faceName;
    if (poses[key]) return poses[key];
    const m = MAPS[mapName];
    const headL = m.headL ?? 3;
    const pixels = [];
    m.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === ' ') return;
      if (m.pal && m.pal[ch]) {
        const [c, r] = m.pal[ch];
        // Props go first so the body and claws draw over them.
        if (r === ROLE.PROP) pixels.unshift({ x, y, c, r }); else pixels.push({ x, y, c, r });
        return;
      }
      const p = { x, y, c: COL.body, r: ch === 'l' ? ROLE.LEG : ROLE.BODY };
      if (ch === 'L') p.tag = 'armL';
      if (ch === 'R') p.tag = 'armR';
      pixels.push(p);
    }));
    const at = new Map(pixels.map((p) => [p.x + ',' + p.y, p]));
    const face = FACES[faceName] || FACES.normal;
    const hx = headL, hy = m.headTop + (m.faceDy || 0);
    const paint = (list, c, r) => (list || []).forEach(([fx, fy]) => {
      const p = at.get(hx + fx + ',' + (hy + fy));
      if (p) { p.c = c; p.r = r; }
    });
    paint(face.mouth, COL.mouth, ROLE.MOUTH);
    paint(face.dark, COL.eye, ROLE.EYE);
    paint(face.eyes, COL.eye, ROLE.EYE);
    const w = m.rows[0].length, h = m.rows.length;
    poses[key] = finishPose({ name: key, w, h, ax: headL + 6.5, ay: h, headTop: m.headTop, headL, headR: headL + 14, body: [0, 0, w, h], pixels });
    return poses[key];
  }

  function poseFor(def) {
    return def.map ? mapPose(def.map, def.face) : poses[def.pose];
  }

  // ---------------------------------------------------------------- effects
  const hash = (f, x, y) => (((f * 73856093) ^ (x * 19349663) ^ (y * 83492791)) >>> 0) % 1000 / 1000;
  const isProp = (p) => p.r === ROLE.PROP;
  const colorSel = (o) => (o && o.colors ? (p) => o.colors.includes(p.c) : isProp);
  const small = (P, p, max) => p.k === undefined || !P.clusters[p.k] || P.clusters[p.k].n <= max;

  const FX = {
    bob(px, f, n, P, o = {}) {
      const d = Math.floor(f / (o.every || 4)) % 2 ? (o.amp || 1) : 0;
      for (const p of px) if (p.r !== ROLE.LEG && !(o.bodyOnly && p.r === ROLE.PROP)) p.dy += d;
    },
    hop(px, f, n, P, o) { const h = o.h[f % o.h.length]; for (const p of px) p.dy -= h; },
    shake(px, f, n, P, o = {}) {
      const step = Math.floor(f / (o.every || 1));
      const d = [0, 1, 0, -1][step % 4] * (o.amp || 1);
      for (const p of px) p.dx += d;
    },
    walk(px, f, n, P, o = {}) {
      const step = Math.floor(f / (o.every || 1)) % 4;
      const legDx = [-1, 0, 1, 0][step], bodyDy = [1, 0, 1, 0][step];
      for (const p of px) {
        if (p.r === ROLE.LEG) { if (p.y === P.legBottom) p.dx += legDx; }
        else if (p.r !== ROLE.PROP) p.dy += bodyDy;
      }
    },
    legsTuck(px, f, n, P) { for (const p of px) if (p.r === ROLE.LEG && p.y === P.legBottom) p.hide = true; },
    blink(px, f, n, P, o = {}) {
      if (f % (o.every || 16) >= (o.len || 1)) return;
      for (const p of px) if (p.r === ROLE.EYE && p.y < P.eyeBottom) p.c = COL.body;
    },
    twinkle(px, f, n, P, o = {}) {
      // Only sparkle-sized clusters twinkle; big props (a bulb, a laptop) stay put.
      const period = o.period || 3;
      for (const p of px) if (isProp(p) && small(P, p, 12) && (f + p.k) % period === 0) p.hide = true;
    },
    chase(px, f, n, P) {
      const m = Math.max(1, P.propCount);
      for (const p of px) if (isProp(p)) { const ang = P.clusters[p.k].ang; if (ang % m !== f % m) p.a *= 0.3; }
    },
    seq(px, f, n, P, o = {}) {
      const sel = px.filter(colorSel(o));
      const key = o.axis === 'y' ? (p) => p.y : (p) => p.x;
      const values = [...new Set(sel.map(key))].sort((a, b) => (o.reverse ? b - a : a - b));
      const steps = values.length, hold = o.hold || 2;
      const shown = Math.min(steps, Math.floor(f / (o.every || 1)) % (steps + hold));
      const visible = new Set(values.slice(0, Math.max(1, Math.ceil((shown / steps) * steps))));
      for (const p of sel) if (!visible.has(key(p))) p.hide = true;
    },
    float(px, f, n, P, o = {}) {
      const range = o.range || 3;
      for (const p of px) {
        if (!isProp(p)) continue;
        const off = (f + p.k * 2) % range;
        p.dy -= off;
        if (off === range - 1) p.a *= 0.5;
      }
    },
    rise(px, f, n, P, o = {}) {
      const sel = colorSel(o);
      for (const p of px) if (sel(p)) { const off = (f + p.x) % 3; p.dy -= off; if (off === 2) p.a *= 0.5; }
    },
    drops(px, f, n, P, o = {}) {
      const sel = colorSel(o);
      for (const p of px) if (sel(p)) { const off = (f + p.x) % 3; p.dy += off; if (off === 2) p.a *= 0.6; }
    },
    jitter(px, f, n, P, o = {}) {
      for (const p of px) {
        if (!isProp(p)) continue;
        const d = [0, 1, 0, -1][(f + p.k) % 4] * (o.amp || 1);
        if (o.y) p.dy += d; else p.dx += d;
      }
    },
    propBob(px, f, n, P, o = {}) { const d = f % 2 ? -(o.amp || 1) : 0; for (const p of px) if (isProp(p)) p.dy += d; },
    swing(px, f, n, P) { const d = [0, 1, 1, 0, -1, -1][f % 6]; for (const p of px) if (isProp(p)) p.dx += d; },
    flicker(px, f, n, P, o = {}) {
      const pr = o.p || 0.35;
      const sel = o.colors ? colorSel(o) : (p) => isProp(p) && small(P, p, 24);
      for (const p of px) if (sel(p) && hash(f, p.x, p.y) < pr) p.hide = true;
    },
    pulse(px, f, n, P, o = {}) { if (f % 2) return; const sel = colorSel(o); for (const p of px) if (sel(p)) p.a *= 0.55; },
    liftBob(px, f, n, P) {
      const d = f % 2;
      for (const p of px) if (p.y < P.headTop && p.r !== ROLE.LEG) p.dy += d;
    },
    extraHop(px, f, n, P) {
      for (const p of px) if (p.r === ROLE.EXTRA && (f + p.k) % 2) p.dy -= 1;
    },
    armWave(px, f) {
      for (const p of px) if (p.tag === 'armR') { p.dy -= 4; p.dx += f % 2; }
    },
    // One claw presses down per key, alternating sides.
    tap(px, f) {
      const left = f % 2 === 0;
      for (const p of px) {
        if (p.tag === 'armL') p.dy += left ? 1 : -1;
        if (p.tag === 'armR') p.dy += left ? -1 : 1;
      }
    },
    keyFlash(px, f) {
      const keys = px.filter((p) => p.r === ROLE.PROP && p.c === '#c3beea').sort((a, b) => a.y - b.y || a.x - b.x);
      if (keys.length) keys[(f * 5) % keys.length].c = '#ffe12e';
    },
    shakeArms(px, f) {
      const d = [0, 1, 0, -1][f % 4];
      for (const p of px) if (p.tag) p.dx += d;
    },
    // A Pac-Man mouth opening and closing on the right side of the body.
    wedge(px, f, n, P) {
      const open = [0.95, 0.5, 0.05, 0.5][f % 4];
      const ax = P.headL + 6.5, ay = P.headTop + 5;
      for (const p of px) {
        if (p.r === ROLE.LEG || p.r === ROLE.PROP) continue;
        const dx = p.x + 0.5 - ax, dy = p.y + 0.5 - ay;
        if (dx > 0 && Math.abs(dy) <= dx * open) p.hide = true;
      }
    },
    // The egg cracks a little more each frame.
    cracks(px, f) {
      const path = [[1, 7], [2, 8], [3, 7], [4, 8], [5, 7], [6, 8], [7, 7], [8, 8], [9, 7], [10, 8], [11, 7], [12, 8], [6, 6], [7, 5], [6, 4], [7, 3]];
      for (const [x, y] of path.slice(0, 3 + f * 3)) px.push({ x, y, c: COL.eye, r: ROLE.PROP, dx: 0, dy: 0, a: 1, hide: false });
    },
    // A cookie held at the mouth that gets smaller with each bite, dropping crumbs.
    cookie(px, f, n, P) {
      const cx = P.headL + 6, cy = P.headTop + 4;
      const disc = [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [1, 3], [2, 3], [3, 3]];
      const bitten = Math.min(disc.length, Math.floor(f / 2) * 4);
      disc.slice(0, disc.length - bitten).forEach(([x, y], i) => px.push({ x: cx + x - 2, y: cy + y, c: i % 5 === 2 ? '#6b3e1f' : '#c68a4b', r: ROLE.PROP, dx: 0, dy: 0, a: 1, hide: false }));
      if (f % 2) px.push({ x: cx - 1 + (f % 3), y: cy + 5 + (f % 2), c: '#c68a4b', r: ROLE.PROP, dx: 0, dy: 0, a: 1, hide: false });
    },
    hideClusters(px, f, n, P, o) {
      const hidden = new Set(P.clusters.filter((c) => o.colors.some((col) => c.colors.has(col))).map((c) => c.k));
      for (const p of px) if (p.k !== undefined && hidden.has(p.k)) p.hide = true;
    },
    fade(px, f, n) { const a = 1 - f / Math.max(1, n - 1); for (const p of px) p.a *= a; },
  };

  // ---------------------------------------------------------------- frames
  function stamp(item, ox, oy, bodyColor) {
    const out = [];
    item.rows.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch === ' ' || !item.pal[ch]) return;
      out.push({ x: ox + rx, y: oy + ry, c: item.pal[ch] === 'body' ? bodyColor : item.pal[ch], r: ROLE.HAT });
    }));
    return out;
  }

  // Worn things sit in front of small overlaps but give way to a prop they
  // would cover (a lightbulb or banner on the head, a laptop at the side).
  function fits(pose, key, pixels) {
    if (pose.hatFit[key] === undefined) {
      const near = new Set();
      for (const h of pixels) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) near.add(h.x + dx + ',' + (h.y + dy));
      const hits = pose.pixels.filter((p) => (p.r === ROLE.PROP || p.r === ROLE.EXTRA) && near.has(p.x + ',' + p.y)).length;
      pose.hatFit[key] = hits <= 4;
    }
    return pose.hatFit[key];
  }

  /** Hat and equipment pixels for a pose: { back: [...], front: [...] }. */
  function wearPixels(pose, look, def) {
    const out = { back: [], front: [] };
    if (!pose.hatOk) return out;
    const body = look.body || COL.body;
    const hat = def.hat !== false && HATS[look.hat];
    if (hat) {
      const px = stamp(hat, pose.headL + hat.x0, pose.headTop + hat.y0, body);
      if (fits(pose, 'hat:' + look.hat, px)) out.front.push(...px);
    }
    if (def.hat === false) return out; // eggs and other non-Clawd shapes
    for (const slot of SLOTS) {
      const item = look[slot] && ACCESSORIES[slot][look[slot]];
      if (!item) continue;
      let ox, oy;
      if (slot === 'hand') { ox = pose.headR + item.x0; oy = pose.headTop + item.y0; }
      else if (slot === 'neck') { ox = pose.headL + item.x0; oy = pose.neckY; }
      else if (slot === 'back') { ox = pose.headL + item.x0; oy = pose.headTop + item.y0; }
      else {
        // Face items line up with the eyes and need both of them about 7 apart.
        const { l, r } = pose.eyes;
        if (!l || !r || Math.abs(r.x - l.x - 7) > 1) continue;
        ox = l.x - 2 + (item.x0 || 0); oy = l.y - 1;
      }
      const px = stamp(item, ox, oy, body);
      if (slot === 'back') out.back.push(...px);
      else if (fits(pose, slot + ':' + look[slot], px)) out.front.push(...px);
    }
    return out;
  }

  const normLook = (look) => (!look ? {} : typeof look === 'string' ? { hat: look } : look);

  function overlayPixels(pose, otherName) {
    const other = poses[otherName];
    if (!other) return [];
    const dx = pose.headL - other.headL, dy = pose.headTop - other.headTop;
    return other.pixels.filter(isProp).map((p) => ({ x: p.x + dx, y: p.y + dy, c: p.c, r: ROLE.PROP, k: p.k }));
  }

  /**
   * Build frame `f` of animation `name`. `look` is a hat name or
   * { hat, hand, face, neck, back, body, eye }. Returns pixels relative to the ground anchor.
   */
  function frame(name, f, look, flip) {
    const def = A[name] || A.idle;
    const pose = poseFor(def);
    if (!pose) return frame('idle', f, look, flip);
    const L = normLook(look);
    const n = def.frames || 1;
    f = ((f % n) + n) % n;
    let src = pose.pixels;
    if (def.overlay) {
      // Borrow props (e.g. floating Zzz) from another pose; reuse its cluster table.
      const extra = overlayPixels(pose, def.overlay);
      src = src.concat(extra);
      pose.clusters = pose.clusters.length ? pose.clusters : poses[def.overlay].clusters;
      pose.propCount = Math.max(pose.propCount, poses[def.overlay].propCount);
    }
    const wear = wearPixels(pose, L, def);
    src = wear.back.concat(src, wear.front);
    if (def.carry && L.carry) src = src.concat(carryPixels(pose, { ...L.carry, pos: def.carry }, f));
    const px = src.map((p) => ({ x: p.x, y: p.y, c: p.c, r: p.r, k: p.k, tag: p.tag, dx: 0, dy: 0, a: 1, hide: false }));
    for (const [fxName, opts] of def.fx || []) FX[fxName](px, f, n, pose, opts);

    // Pixel (x, y) covers [x, x+1). The anchor sits at the horizontal centre of
    // the head (ax is a pixel-centre index, hence +0.5) on the feet's bottom edge.
    // Poses that stand on their props (a pile of blocks) put the ground at the very bottom.
    const cx = pose.ax + 0.5, ay = def.ground === 'bottom' ? pose.h : pose.ay;
    const span = (l, r) => (flip ? [cx - r, cx - l] : [l - cx, r - cx]);
    const bodyColor = L.body && L.body !== COL.body ? L.body : null;
    const eyeColor = L.eye && L.eye !== COL.eye ? L.eye : null;
    const out = [];
    for (const p of px) {
      if (p.hide || p.a <= 0.02) continue;
      const x = span(p.x + p.dx, p.x + p.dx + 1)[0];
      let c = p.c;
      if (bodyColor && c === COL.body && p.r !== ROLE.HAT) c = bodyColor;
      else if (eyeColor && p.r === ROLE.EYE && c === COL.eye) c = eyeColor;
      out.push({ x, y: p.y + p.dy - ay, c, a: p.a });
    }
    const [hx0, hx1] = span(pose.body[0], pose.body[2]);
    const [headL, headR] = span(pose.headL, pose.headR);
    return {
      pixels: out, // x/y = top-left of each art pixel, relative to the anchor
      hit: { x0: hx0, x1: hx1, y0: pose.body[1] - ay, y1: Math.max(0, pose.body[3] - ay) },
      head: { l: headL, r: headR, top: pose.headTop - ay },
    };
  }

  function bubble(kind) {
    const b = BUBBLES[kind];
    if (!b) return null;
    const out = [];
    b.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') out.push({ x, y, c: b.pal[ch], a: 1 }); }));
    return { pixels: out, w: b.rows[0].length, h: b.rows.length };
  }

  // ---------------------------------------------------------------- the Overlord
  // An original "mechanical eye-core": an armoured sphere of plates around one
  // big glowing eye, with fins, chasing orange rim lights and cables below.
  // Drawn procedurally so the iris can look around, the lids blink and the
  // cables sway. Coordinates are art pixels around the sphere's centre.
  const OV_CYAN = { K: '#12141a', d: '#232833', m: '#343b4a', l: '#4a5468', h: '#7b88a3', C: '#3fd0ff', c: '#9eeaff', W: '#effbff', P: '#081018', O: '#d97757', o: '#ffd2b8', T: '#556074' };
  const OV = OV_CYAN;
  // Furious: a red eye and red lights (while banishing everyone over the usage limit).
  const OV_RED = { ...OV_CYAN, C: '#ff3b30', c: '#ff9e8f', W: '#fff1ec', P: '#1a0606', O: '#ff3b30', o: '#ffd0c4' };
  function overlord({ t = 0, lookX = 0, lookY = 0, blink = 0, R = 11, fins = true, cables = true, lights = true, red = false } = {}) {
    const OV = red ? OV_RED : OV_CYAN;
    const px = [];
    const put = (x, y, c, a = 1) => px.push({ x, y, c, a });
    if (cables) {
      for (let i = 0; i < 5; i++) {
        const bx = -8 + i * 4, len = 7 + (i % 2) * 3;
        for (let j = 0; j < len; j++) {
          const sway = Math.round(Math.sin(t / 500 + i * 1.3 + j * 0.45) * (j / len) * 2.4);
          put(bx + sway, R - 2 + j, j === len - 1 ? OV.C : j === len - 2 ? OV.l : OV.T);
        }
      }
    }
    if (fins) {
      for (const s of [-1, 1]) for (let j = 0; j < 7; j++) {
        const x = s > 0 ? R + Math.floor(j / 2) : -R - 1 - Math.floor(j / 2);
        put(x, -7 + j, j < 2 ? OV.h : OV.l);
        put(x + s, -7 + j, OV.K);
      }
    }
    for (let y = -R; y < R; y++) for (let x = -R; x < R; x++) {
      const fx = x + 0.5, fy = y + 0.5, d = Math.hypot(fx, fy);
      if (d > R) continue;
      let c;
      if (d > R - 1) c = OV.K;
      else {
        const light = (-fx * 0.55 - fy * 0.8) / R;
        c = light > 0.42 ? OV.h : light > 0.08 ? OV.l : light > -0.38 ? OV.m : OV.d;
        const ang = Math.atan2(fy, fx) / (Math.PI / 4);
        const seam = Math.abs(ang - Math.round(ang)) < 0.09 && d > 7.5;
        if (seam || Math.abs(d - 7.7) < 0.5) c = OV.K;
      }
      put(x, y, c);
    }
    const er = Math.min(6.6, R - 3.4);
    for (let y = -7; y < 7; y++) for (let x = -7; x < 7; x++) {
      const fx = x + 0.5, fy = y + 0.5, d = Math.hypot(fx, fy);
      if (d > er) continue;
      if (Math.abs(fy) > er * (1 - blink)) { put(x, y, Math.abs(fy) > er * (1 - blink) + 1 ? OV.l : OV.K); continue; } // eyelids
      let c = OV.P;
      const di = Math.hypot(fx - lookX * 2.2, fy - lookY * 1.6);
      if (di < 4.4) c = di > 3.4 ? OV.C : di > 1.7 ? OV.c : OV.P;
      if (d > er - 0.9) c = OV.K;
      put(x, y, c);
    }
    if (blink < 0.5) put(Math.round(-1.5 + lookX * 2.2), Math.round(-2.5 + lookY * 1.6), OV.W);
    if (lights) {
      for (let i = 0; i < 8; i++) {
        const a = i * (Math.PI / 4) + Math.PI / 8;
        const on = Math.floor(t / 160) % 8 === i;
        put(Math.round(Math.cos(a) * (R - 2.6) - 0.5), Math.round(Math.sin(a) * (R - 2.6) - 0.5), on ? OV.o : OV.O);
      }
    }
    return { pixels: px };
  }

  // The skyscraper: every buddy has a floor. Sizes in art pixels (the renderer scales them).
  // BODY is the building itself; the glass elevator shaft (SHAFT_X, SHAFT_W wide) hangs on its right side.
  // (2.2: about 2.4x as wide as before, so the rooms have space for real furniture.)
  const TOWER = {
    W: 92, BODY: 84, FLOOR: 16, LOBBY: 14, ROOF: 10, PEEK: 9, WIN_X: 5, WIN_Y: 2, WIN_W: 74, WIN_H: 11,
    SHAFT_X: 84, SHAFT_W: 8, SWITCH_X: 1, DOOR_X: 4, DOOR_W: 8, DOOR_H: 11, ANT_X: 8, BTN_X: 72, MAX_ITEMS: 10,
  };
  const FLOOR_ROWS = 2; // the bottom rows of a room are its floor

  // Room decor. Items have a layer: 'floor' (stands on the floor), 'wall' (hangs; y is adjustable) or
  // 'rug' (lies on the floor). Rows use the same palette-letter format as hats.
  const ROOM = {
    walls: {
      cream: '#f6e3b4', mint: '#cdeccf', rose: '#f4c7cf', sky: '#c9e4f7', lilac: '#dccdf3', sand: '#ecd9b8',
      peach: '#f8cfb0', sage: '#b9d3b0', slate: '#9aa6b8', night: '#3b4466', brick: '#c9765b', white: '#f4f1ea',
    },
    floors: { wood: '#a8794f', oak: '#c49a6c', walnut: '#6b4a2e', tiles: '#d9d4c7', stone: '#8d857e', carpet: '#7a5c9c', moss: '#5f8f4a' },
    curtains: { red: '#d6455d', blue: '#3e6cff', green: '#3aa76d', gold: '#e8b04b', lace: '#f2f2f2', purple: '#8a63d2' },
    items: {
      // ---- furniture
      bed: { layer: 'floor', pal: { W: '#8b5a3c', P: '#5aa9e6', p: '#ffffff', B: '#6b4a2e' }, rows: ['W         ', 'WppPPPPPPP', 'WPPPPPPPPP', 'BBBBBBBBBB', 'B        B'] },
      bunkbed: { layer: 'floor', pal: { W: '#8b5a3c', P: '#e46fa8', G: '#3aa76d', p: '#ffffff' }, rows: ['W       W', 'WppPPPPPW', 'WWWWWWWWW', 'W       W', 'WppGGGGGW', 'WWWWWWWWW', 'W       W'] },
      desk: { layer: 'floor', pal: { K: '#2f2f38', C: '#3fd0ff', B: '#8b5a3c' }, rows: ['  KKKK  ', '  KCCK  ', '   KK   ', 'BBBBBBBB', 'B      B', 'B      B'] },
      gamingdesk: { layer: 'floor', pal: { K: '#2f2f38', C: '#3fd0ff', P: '#e46fa8', R: '#d6455d' }, rows: [' KKKK KKKK ', ' KCCK KPPK ', '  KK   KK  ', 'RRRRRRRRRRR', 'K         K', 'K         K'] },
      chair: { layer: 'floor', pal: { B: '#8b5a3c' }, rows: ['B   ', 'B   ', 'BBBB', 'B  B'] },
      table: { layer: 'floor', pal: { B: '#8b5a3c', W: '#ffffff', R: '#d6455d' }, rows: ['  R W  ', 'BBBBBBB', ' B   B ', ' B   B '] },
      couch: { layer: 'floor', pal: { R: '#d6455d', r: '#9e2f44' }, rows: [' RRRRRRRR ', 'RRRRRRRRRR', 'RrrrrrrrrR', 'R        R'] },
      armchair: { layer: 'floor', pal: { G: '#3aa76d', g: '#2a7f53' }, rows: [' GGGG ', 'GGGGGG', 'GggggG', 'G    G'] },
      beanbag: { layer: 'floor', pal: { P: '#e46fa8', p: '#b04a80' }, rows: ['  PPPP  ', ' PPPPPP ', 'PPPPPPPP', 'pppppppp'] },
      bookshelf: { layer: 'floor', pal: { B: '#8b5a3c', R: '#d6455d', G: '#3aa76d', Y: '#ffc431', U: '#3e6cff' }, rows: ['BBBBBBB', 'BRGYURB', 'BBBBBBB', 'BYURGYB', 'BBBBBBB', 'BGRUYRB', 'BBBBBBB', 'B     B'] },
      dresser: { layer: 'floor', pal: { B: '#b07a4a', Y: '#ffc431' }, rows: ['BBBBBB', 'BYBBYB', 'BBBBBB', 'BYBBYB', 'BBBBBB', 'B    B'] },
      fridge: { layer: 'floor', pal: { W: '#e9eef2', g: '#8a95a8', s: '#c9d1d9' }, rows: ['WWWWW', 'WWWWg', 'WWWWW', 'sssss', 'WWWWW', 'WWWWg', 'WWWWW', 'WWWWW'] },
      tv: { layer: 'floor', pal: { K: '#2f2f38', C: '#3fd0ff', B: '#8b5a3c' }, rows: ['KKKKKKKK', 'KCCCCCCK', 'KCCCCCCK', 'KKKKKKKK', '   KK   ', 'BBBBBBBB', 'B      B'] },
      arcade: { layer: 'floor', pal: { K: '#4b3fa0', C: '#3fd0ff', R: '#d6455d', Y: '#ffe12e' }, rows: ['KKKKK', 'KCCCK', 'KCCCK', 'KKKKK', 'KRYKK', 'KKKKK', 'KKKKK', 'KKKKK'] },
      piano: { layer: 'floor', pal: { K: '#2f2f38', W: '#ffffff' }, rows: ['KKKKKKKKK', 'KKKKKKKKK', 'WKWKWWKWK', 'WWWWWWWWW', 'K       K', 'K       K'] },
      guitar: { layer: 'floor', pal: { K: '#3b2a20', R: '#d6455d', r: '#9e2f44' }, rows: ['  K', '  K', ' K ', 'RRR', 'RrR', 'RRR', ' R '] },
      server: { layer: 'floor', pal: { K: '#2f2f38', G: '#37d351', Y: '#ffe12e' }, rows: ['KKKK', 'KGKK', 'KKKK', 'KGYK', 'KKKK', 'KGKK', 'KKKK', 'K  K'] },
      aquarium: { layer: 'floor', pal: { K: '#3b3743', C: '#9fe0f5', O: '#f2994a', G: '#37a34f', B: '#8b5a3c' }, rows: ['KKKKKKK', 'KCCCCCK', 'KCCOCCK', 'KGCCCOK', 'KKKKKKK', 'B     B', 'B     B'] },
      cattree: { layer: 'floor', pal: { P: '#c9a27a', T: '#8b5a3c', K: '#3b3743' }, rows: ['K K ', 'PPP ', ' T  ', 'PPPP', ' T  ', ' T  ', 'TTTT'] },
      floorlamp: { layer: 'floor', pal: { Y: '#ffe08a', K: '#3b3743' }, rows: ['YYYY', ' K  ', ' K  ', ' K  ', ' K  ', ' K  ', ' K  ', 'KKK '] },
      // ---- little things
      plant: { layer: 'floor', small: true, pal: { G: '#37a34f', T: '#c96f22' }, rows: ['  G  ', ' GGG ', 'GG GG', ' GGG ', '  G  ', ' TTT ', ' TTT '] },
      cactus: { layer: 'floor', small: true, pal: { G: '#4fbf6a', T: '#c96f22' }, rows: [' G ', 'GGG', ' G ', 'TTT'] },
      flower: { layer: 'floor', small: true, pal: { P: '#e46fa8', G: '#37a34f', T: '#c96f22' }, rows: ['P P', ' G ', 'TTT'] },
      cat: { layer: 'floor', small: true, pal: { K: '#3b3743' }, rows: ['K K ', 'KKK ', 'KKKK'] },
      fishbowl: { layer: 'floor', small: true, pal: { C: '#9fe0f5', O: '#f2994a' }, rows: [' CC ', 'COCC', ' CC '] },
      lamp: { layer: 'floor', small: true, pal: { Y: '#ffe08a', K: '#3b3743' }, rows: ['YYY', ' K ', ' K ', 'KKK'] },
      trophy: { layer: 'floor', small: true, pal: { Y: '#ffc431' }, rows: ['Y Y', 'YYY', ' Y ', 'YYY'] },
      // ---- on the wall
      painting: { layer: 'wall', y: 1, pal: { K: '#8b5a3c', S: '#9ad7f0', G: '#37a34f', Y: '#ffe12e' }, rows: ['KKKKKKK', 'KSSSSYK', 'KSGSSSK', 'KGGGSGK', 'KKKKKKK'] },
      poster: { layer: 'wall', y: 1, pal: { O: '#d97757', K: '#2f2f38', W: '#fff1e6' }, rows: ['OOOOO', 'OKOKO', 'OOOOO', 'OOWOO', 'O O O'] },
      clock: { layer: 'wall', y: 1, pal: { K: '#3b3743', W: '#fff6e8' }, rows: [' KKK ', 'KWKWK', 'KWKKK', 'KWWWK', ' KKK '] },
      shelf: { layer: 'wall', y: 3, pal: { B: '#8b5a3c', R: '#d6455d', G: '#3aa76d', Y: '#ffc431', U: '#3e6cff' }, rows: ['RGY U', 'RGYUU', 'BBBBB'] },
      neon: { layer: 'wall', y: 1, pal: { C: '#3fd0ff' }, rows: ['  C  CC  ', ' C   C C ', 'C   C   C', ' C C   C ', '  CC  C  '] },
      diploma: { layer: 'wall', y: 1, pal: { W: '#fff6e8', K: '#8d857e', R: '#d6455d' }, rows: ['WWWWW', 'WKKKW', 'WWWRW', 'WWWWW'] },
      mirror: { layer: 'wall', y: 1, pal: { S: '#bfe6ff', W: '#ffffff', K: '#8b5a3c' }, rows: [' KKK ', 'KSWSK', 'KSSWK', 'KSSSK', ' KKK '] },
      pennant: { layer: 'wall', y: 1, pal: { R: '#d97757', W: '#ffffff' }, rows: ['RRRRRRR', ' RWRWR ', '  RRR  ', '   R   '] },
      window: { layer: 'wall', y: 1, pal: { K: '#8b5a3c', S: '#9ad7f0', W: '#ffffff' }, rows: ['KKKKKKK', 'KSSKSWK', 'KSSKSSK', 'KKKKKKK', 'KSSKSSK', 'KKKKKKK'] },
      fairylights: { layer: 'wall', y: 0, pal: { k: '#5a5450', Y: '#ffe12e', R: '#ff3b99', C: '#3fd0ff', G: '#37d351' }, rows: ['kkkkkkkkkkkkkkk', ' Y  R  C  G  Y '] },
      // ---- on the floor
      rug: { layer: 'rug', pal: { R: '#d6455d', r: '#9e2f44' }, rows: ['RRRRRRRRRRRRRR', 'rRrRrRrRrRrRrR'] },
      bluerug: { layer: 'rug', pal: { B: '#3e6cff', W: '#c9e4f7' }, rows: [' BBBBBBBBBBBB ', 'BWBWBWBWBWBWBW'] },
      mat: { layer: 'rug', pal: { G: '#3aa76d' }, rows: ['GGGGGGGG'] },
    },
  };
  const ITEM_GROUPS = {
    furniture: ['bed', 'bunkbed', 'desk', 'gamingdesk', 'chair', 'table', 'couch', 'armchair', 'beanbag', 'bookshelf', 'dresser', 'fridge', 'tv', 'arcade', 'piano', 'guitar', 'server', 'aquarium', 'cattree', 'floorlamp'],
    little: ['plant', 'cactus', 'flower', 'cat', 'fishbowl', 'lamp', 'trophy'],
    wall: ['painting', 'poster', 'clock', 'shelf', 'neon', 'diploma', 'mirror', 'pennant', 'window', 'fairylights'],
    rugs: ['rug', 'bluerug', 'mat'],
  };
  const itemSize = (def) => ({ w: Math.max(...def.rows.map((r) => r.length)), h: def.rows.length });
  const DEFAULT_ROOM = { wall: 'cream', floor: 'wood', curtains: null, items: [{ k: 'plant', x: 3 }, { k: 'painting', x: 33, y: 1 }, { k: 'rug', x: 24 }, { k: 'bed', x: 62 }] };

  /**
   * A room's decor in the current format: { wall, floor, curtains, items: [{ k, x, y? }] } with every
   * item clamped inside the room. Rooms saved by 2.1 (one `furniture` and one `sill` thing) are converted.
   */
  function normalizeRoom(room) {
    const r = room || {};
    const W = TOWER.WIN_W, H = TOWER.WIN_H;
    let items;
    if (Array.isArray(r.items)) items = r.items;
    else if (room && ('furniture' in r || 'sill' in r || 'wall' in r)) {
      items = [];
      if (r.sill && ROOM.items[r.sill]) items.push({ k: r.sill, x: 3 });
      const f = r.furniture === undefined ? 'bed' : r.furniture;
      if (f && ROOM.items[f]) items.push({ k: f, x: W - itemSize(ROOM.items[f]).w - 2 });
    } else items = DEFAULT_ROOM.items;
    const out = [];
    for (const it of items) {
      const def = it && ROOM.items[it.k];
      if (!def || out.length >= TOWER.MAX_ITEMS) continue;
      const { w, h } = itemSize(def);
      const x = Math.max(0, Math.min(W - w, Math.round(Number(it.x) || 0)));
      const o = { k: it.k, x };
      if (def.layer === 'wall') o.y = Math.max(0, Math.min(H - FLOOR_ROWS - h - 1, Math.round(Number(it.y ?? def.y) || 0)));
      else if (def.small && it.y !== undefined && it.y !== null) o.y = Math.max(0, Math.min(H - FLOOR_ROWS - h, Math.round(Number(it.y) || 0))); // on top of something
      out.push(o);
    }
    return {
      wall: ROOM.walls[r.wall] ? r.wall : DEFAULT_ROOM.wall,
      floor: ROOM.floors[r.floor] ? r.floor : DEFAULT_ROOM.floor,
      curtains: ROOM.curtains[r.curtains] ? r.curtains : null,
      items: out,
    };
  }

  /** Where each item sits in the room: [{ i, k, x, y, w, h, layer }] (also used for dragging in the Workshop). */
  function roomLayout(room) {
    const r = normalizeRoom(room), H = TOWER.WIN_H;
    return r.items.map((it, i) => {
      const def = ROOM.items[it.k], { w, h } = itemSize(def);
      const y = def.layer === 'wall' ? it.y : def.layer === 'rug' ? H - h : it.y ?? H - FLOOR_ROWS - h;
      return { i, k: it.k, x: it.x, y, w, h, layer: def.layer };
    });
  }

  /** A room seen through its window (TOWER.WIN_W × WIN_H), lit (home) or dark (out at work). */
  function roomPixels(room, lit) {
    const r = normalizeRoom(room);
    const W = TOWER.WIN_W, H = TOWER.WIN_H, out = [];
    const put = (x, y, c, a = 1) => { if (x >= 0 && y >= 0 && x < W && y < H) out.push({ x, y, c, a }); };
    const wall = lit ? ROOM.walls[r.wall] : '#1b2333';
    const floor = lit ? ROOM.floors[r.floor] : '#141a26';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, y >= H - FLOOR_ROWS ? floor : wall);
    if (lit) for (let x = 0; x < W; x++) put(x, H - FLOOR_ROWS - 1, '#000000', 0.08); // skirting shadow
    else for (let i = 0; i < 6; i++) { put(3 + i, 1 + i, '#2c3a52'); put(5 + i, 1 + i, '#2c3a52'); put(41 + i, 1 + i, '#2c3a52'); } // moonlit glass
    const layout = roomLayout(r);
    const draw = (b) => ROOM.items[b.k].rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const c = ROOM.items[b.k].pal[ch];
      if (ch !== ' ' && c) put(b.x + x, b.y + y, c, lit ? 1 : 0.35);
    }));
    for (const layer of ['rug', 'wall', 'floor']) layout.filter((b) => b.layer === layer).forEach(draw);
    const cur = r.curtains && ROOM.curtains[r.curtains];
    if (cur) for (let y = 0; y < H - FLOOR_ROWS; y++) for (const x of [0, 1, 2, W - 3, W - 2, W - 1]) put(x, y, cur, (lit ? 1 : 0.5) * (x === 2 || x === W - 3 ? 0.7 : 1));
    return out;
  }

  /** One item on its own (Workshop tiles). */
  function roomItemPixels(k) {
    const def = ROOM.items[k];
    if (!def) return [];
    const out = [];
    def.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ' && def.pal[ch]) out.push({ x, y, c: def.pal[ch], a: 1 }); }));
    return out;
  }

  function item(kind) {
    const it = ITEMS[kind];
    if (!it) return null;
    const out = [];
    it.rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') out.push({ x: x - 2.5, y: y - 2.5, c: it.pal[ch], a: 1 }); }));
    return { pixels: out };
  }

  // The Overlord's drones (two rotor frames), drawn at their centre.
  const DRONE = [
    ['GGG     GGG', ' K       K ', ' KKKKKKKKK ', '  KKCCCKK  ', '   K   K   '],
    [' G       G ', ' K       K ', ' KKKKKKKKK ', '  KKCCCKK  ', '   K   K   '],
  ];
  function drone(f) {
    const pal = { G: '#c9d1d9', K: '#3b3743', C: '#3fd0ff' }, rows = DRONE[f % 2], out = [];
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') out.push({ x: x - 5.5, y: y - 2.5, c: pal[ch], a: 1 }); }));
    return { pixels: out };
  }

  function mini(f, body) {
    const rows = MINI[f % 2], out = [];
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ' ') out.push({ x: x - 3, y: y - rows.length, c: ch === 'e' ? COL.eye : body || COL.body, a: 1 });
    }));
    return { pixels: out };
  }

  function text(str) {
    const out = [];
    [...str.toUpperCase()].forEach((ch, i) => {
      const g = FONT[ch] || FONT['?'];
      for (let j = 0; j < 15; j++) if (g[j] === '#') out.push({ x: i * 4 + (j % 3), y: Math.floor(j / 3) });
    });
    return { pixels: out, w: Math.max(0, str.length * 4 - 1), h: 5 };
  }

  return {
    SCALE, ROLE, COL, ANIMS: A, ACTIVITY_ANIMS, HATS, HAT_ORDER, ACCESSORIES, SLOTS, COLORS, EYE_COLORS, FONT, OV, TOWER, ROOM, ITEM_GROUPS, DEFAULT_ROOM, roomPixels, roomLayout, roomItemPixels, normalizeRoom,
    loadPoses, frame, bubble, mini, item, text, overlord, fileKind, drone,
    frameCount: (name) => (A[name] || A.idle).frames || 1,
    fps: (name) => (A[name] || A.idle).fps || 6,
    canFlip: (name) => !!(A[name] || A.idle).flip,
    hasPose: (name) => !!(A[name] && (A[name].map || poses[A[name].pose])),
  };
});
