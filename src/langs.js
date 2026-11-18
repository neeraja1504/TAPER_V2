/* Supported native languages and how the translated PDF is typeset for each.
 * Font files come from the Noto project on jsDelivr. They are bundled into every translated
 * LaTeX project under taper-fonts/, so the downloaded .zip compiles anywhere with XeLaTeX. */

const CJK = "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF";
const NF = "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io@main/fonts";
const NOTO_SERIF = ["Regular", "Bold", "Italic", "BoldItalic"].map(w => ({
  file: `NotoSerif-${w}.ttf`, url: `${NF}/NotoSerif/hinted/ttf/NotoSerif-${w}.ttf` }));

export const LANGS = {
  vi: { name: "Vietnamese", self: "Tiếng Việt", tag: "vi", script: "latin-ext", fonts: NOTO_SERIF },
  es: { name: "Spanish", self: "Español", tag: "es", script: "latin", fonts: [] },
  zh: { name: "Chinese (Simplified)", self: "中文", tag: "zh", script: "cjk",
        fonts: [{ file: "NotoSansSC-Regular.otf", url: `${CJK}/SC/NotoSansSC-Regular.otf` }] },
  hi: { name: "Hindi", self: "हिन्दी", tag: "hi", script: "deva",
        fonts: ["Regular", "Bold"].map(w => ({ file: `NotoSerifDevanagari-${w}.ttf`, url: `${NF}/NotoSerifDevanagari/hinted/ttf/NotoSerifDevanagari-${w}.ttf` })) },
  ko: { name: "Korean", self: "한국어", tag: "ko", script: "cjk", cjkSpace: true,
        fonts: [{ file: "NotoSansKR-Regular.otf", url: `${CJK}/KR/NotoSansKR-Regular.otf` }] },
  ja: { name: "Japanese", self: "日本語", tag: "ja", script: "cjk",
        fonts: [{ file: "NotoSansJP-Regular.otf", url: `${CJK}/JP/NotoSansJP-Regular.otf` }] },
  pt: { name: "Portuguese", self: "Português", tag: "pt", script: "latin", fonts: [] },
  fr: { name: "French", self: "Français", tag: "fr", script: "latin", fonts: [] },
  ru: { name: "Russian", self: "Русский", tag: "ru", script: "latin-ext", fonts: NOTO_SERIF }
};

export const langLabel = code => LANGS[code] ? `${LANGS[code].name} · ${LANGS[code].self}` : code;
