import robotoVfs from 'pdfmake/build/vfs_fonts';
import notoEmojiUrl from './fonts/NotoEmoji-wght.ttf?inline';
import { PDF_LIMITS, pdfFail } from './pdf-contract';

/** Generated intersection of the exact four Roboto cmap tables in PDF_FONT_MANIFEST. */
export const PDF_ROBOTO_RANGES: readonly (readonly [number, number])[] = Object.freeze(
  [
    [0, 0],
    [2, 2],
    [13, 13],
    [32, 126],
    [160, 383],
    [399, 399],
    [402, 402],
    [416, 417],
    [431, 432],
    [496, 496],
    [506, 511],
    [536, 539],
    [567, 567],
    [601, 601],
    [700, 700],
    [710, 711],
    [713, 713],
    [728, 733],
    [755, 755],
    [768, 769],
    [771, 771],
    [777, 777],
    [783, 783],
    [803, 803],
    [900, 906],
    [908, 908],
    [910, 929],
    [931, 974],
    [977, 978],
    [982, 982],
    [1024, 1158],
    [1160, 1299],
    [7680, 7681],
    [7742, 7743],
    [7808, 7813],
    [7838, 7838],
    [7840, 7929],
    [8013, 8013],
    [8192, 8203],
    [8208, 8209],
    [8211, 8213],
    [8215, 8222],
    [8224, 8226],
    [8229, 8231],
    [8240, 8240],
    [8242, 8243],
    [8249, 8250],
    [8252, 8252],
    [8260, 8260],
    [8304, 8304],
    [8308, 8334],
    [8355, 8356],
    [8358, 8364],
    [8369, 8369],
    [8377, 8378],
    [8380, 8381],
    [8385, 8385],
    [8453, 8453],
    [8467, 8467],
    [8470, 8470],
    [8482, 8482],
    [8486, 8486],
    [8494, 8494],
    [8539, 8542],
    [8706, 8706],
    [8710, 8710],
    [8719, 8719],
    [8721, 8722],
    [8730, 8730],
    [8734, 8734],
    [8747, 8747],
    [8776, 8776],
    [8800, 8800],
    [8804, 8805],
    [9632, 9632],
    [9674, 9675],
    [9679, 9679],
    [60929, 60930],
    [63171, 63171],
    [64257, 64260],
    [65279, 65279],
    [65532, 65533],
  ].map(pair => Object.freeze(pair as [number, number]))
);

export const PDF_EMOJI_RANGES: readonly (readonly [number, number])[] = Object.freeze(
  [
    [0, 0],
    [13, 13],
    [32, 32],
    [35, 35],
    [42, 42],
    [48, 57],
    [169, 169],
    [174, 174],
    [8205, 8205],
    [8252, 8252],
    [8265, 8265],
    [8419, 8419],
    [8482, 8482],
    [8505, 8505],
    [8596, 8601],
    [8617, 8618],
    [8986, 8987],
    [9000, 9000],
    [9167, 9167],
    [9193, 9203],
    [9208, 9210],
    [9410, 9410],
    [9642, 9643],
    [9654, 9654],
    [9664, 9664],
    [9723, 9726],
    [9728, 9732],
    [9742, 9742],
    [9745, 9745],
    [9748, 9749],
    [9752, 9752],
    [9757, 9757],
    [9760, 9760],
    [9762, 9763],
    [9766, 9766],
    [9770, 9770],
    [9774, 9775],
    [9784, 9786],
    [9792, 9792],
    [9794, 9794],
    [9800, 9811],
    [9823, 9824],
    [9827, 9827],
    [9829, 9830],
    [9832, 9832],
    [9851, 9851],
    [9854, 9855],
    [9874, 9879],
    [9881, 9881],
    [9883, 9884],
    [9888, 9889],
    [9895, 9895],
    [9898, 9899],
    [9904, 9905],
    [9917, 9918],
    [9924, 9925],
    [9928, 9928],
    [9934, 9935],
    [9937, 9937],
    [9939, 9940],
    [9961, 9962],
    [9968, 9973],
    [9975, 9978],
    [9981, 9981],
    [9986, 9986],
    [9989, 9989],
    [9992, 9997],
    [9999, 9999],
    [10002, 10002],
    [10004, 10004],
    [10006, 10006],
    [10013, 10013],
    [10017, 10017],
    [10024, 10024],
    [10035, 10036],
    [10052, 10052],
    [10055, 10055],
    [10060, 10060],
    [10062, 10062],
    [10067, 10069],
    [10071, 10071],
    [10083, 10084],
    [10133, 10135],
    [10145, 10145],
    [10160, 10160],
    [10175, 10175],
    [10548, 10549],
    [11013, 11015],
    [11035, 11036],
    [11088, 11088],
    [11093, 11093],
    [12336, 12336],
    [12349, 12349],
    [12951, 12951],
    [12953, 12953],
    [65038, 65039],
    [126980, 126980],
    [127183, 127183],
    [127344, 127345],
    [127358, 127359],
    [127374, 127374],
    [127377, 127386],
    [127462, 127487],
    [127489, 127490],
    [127514, 127514],
    [127535, 127535],
    [127538, 127546],
    [127568, 127569],
    [127744, 127777],
    [127780, 127891],
    [127894, 127895],
    [127897, 127899],
    [127902, 127984],
    [127987, 127989],
    [127991, 128253],
    [128255, 128317],
    [128329, 128334],
    [128336, 128359],
    [128367, 128368],
    [128371, 128378],
    [128391, 128391],
    [128394, 128397],
    [128400, 128400],
    [128405, 128406],
    [128420, 128421],
    [128424, 128424],
    [128433, 128434],
    [128444, 128444],
    [128450, 128452],
    [128465, 128467],
    [128476, 128478],
    [128481, 128481],
    [128483, 128483],
    [128488, 128488],
    [128495, 128495],
    [128499, 128499],
    [128506, 128591],
    [128640, 128709],
    [128715, 128722],
    [128725, 128727],
    [128732, 128741],
    [128745, 128745],
    [128747, 128748],
    [128752, 128752],
    [128755, 128764],
    [128992, 129003],
    [129008, 129008],
    [129292, 129338],
    [129340, 129349],
    [129351, 129535],
    [129648, 129660],
    [129664, 129672],
    [129680, 129725],
    [129727, 129733],
    [129742, 129755],
    [129760, 129768],
    [129776, 129784],
    [917552, 917561],
    [917601, 917626],
    [917631, 917631],
    [1041637, 1041646],
    [1042476, 1042476],
    [1042478, 1042487],
  ].map(pair => Object.freeze(pair as [number, number]))
);

function hasGlyph(ranges: readonly (readonly [number, number])[], codePoint: number): boolean {
  let low = 0,
    high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const [start, end] = ranges[middle];
    if (codePoint < start) high = middle - 1;
    else if (codePoint > end) low = middle + 1;
    else return true;
  }
  return false;
}
export const pdfHasGlyph = (cp: number): boolean => hasGlyph(PDF_ROBOTO_RANGES, cp);
export const pdfHasEmojiGlyph = (cp: number): boolean => hasGlyph(PDF_EMOJI_RANGES, cp);
const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
const isControl = (cp: number) => cp === 9 || cp === 10 || cp === 13;
const isEmojiJoiner = (cp: number) => cp === 0x200d || cp === 0xfe0e || cp === 0xfe0f;
export interface PdfFontRun {
  text: string;
  font: 'Roboto' | 'NotoEmoji';
  emojiClusters: number;
  atomic?: true;
}
function clusterFont(cps: readonly number[]): PdfFontRun['font'] {
  if (
    cps.some(
      cp =>
        (cp < 32 && !isControl(cp)) ||
        cp === 0x7f ||
        cp === 0xfffe ||
        cp === 0xffff ||
        (cp >= 0xd800 && cp <= 0xdfff)
    )
  )
    pdfFail('pdf-html-invalid');
  if (cps.every(cp => isControl(cp) || pdfHasGlyph(cp))) return 'Roboto';
  const emoji =
    cps.some(cp => !isEmojiJoiner(cp) && cp !== 32 && pdfHasEmojiGlyph(cp)) &&
    cps.every(cp => isEmojiJoiner(cp) || pdfHasEmojiGlyph(cp));
  if (!emoji) pdfFail('pdf-font-unsupported');
  return 'NotoEmoji';
}
export function routePdfText(
  text: string,
  maxAtomic: number = PDF_LIMITS.maxAtomicGraphemeCodePoints
): PdfFontRun[] {
  const runs: PdfFontRun[] = [];
  for (const { segment } of graphemes.segment(text)) {
    const cps = [...segment].map(character => character.codePointAt(0)!);
    if (cps.length > maxAtomic) pdfFail('pdf-layout-overflow');
    const font = clusterFont(cps);
    const emoji = font === 'NotoEmoji';
    const atomic = emoji || (cps.length > 1 && !cps.every(isControl));
    const last = runs[runs.length - 1];
    if (last?.font === font && font === 'Roboto' && !atomic && !last.atomic) {
      last.text += segment;
    } else
      runs.push({
        text: segment,
        font,
        emojiClusters: emoji ? 1 : 0,
        ...(atomic ? { atomic: true as const } : {}),
      });
  }
  return runs;
}

/** No silent missing-glyph fallback. Line controls are represented by layout, not font glyphs. */
export function requirePdfGlyphs(
  text: string,
  maxAtomic: number = PDF_LIMITS.maxAtomicGraphemeCodePoints
): number {
  routePdfText(text, maxAtomic);
  return [...text].length;
}

const emojiBase64 = /^data:[^,]*;base64,([A-Za-z0-9+/=]+)$/.exec(notoEmojiUrl)?.[1];
if (!emojiBase64) pdfFail('pdf-pack-failed');
export const PDF_FONT_VFS = Object.freeze({ ...robotoVfs, 'NotoEmoji.ttf': emojiBase64 });
