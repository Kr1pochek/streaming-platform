const DEFAULT_PLAYER_PALETTE = Object.freeze({
  panel: "rgb(66, 62, 94)",
  panelEdge: "rgb(58, 55, 84)",
  surfaceStart: "rgb(50, 48, 74)",
  surfaceEnd: "rgb(38, 37, 58)",
  ambient: "rgba(126, 121, 180, 0.34)",
  ambientStrong: "rgba(94, 88, 148, 0.24)",
  border: "rgba(199, 196, 231, 0.18)",
  progressTrack: "rgba(223, 220, 246, 0.16)",
  progressFill: "rgba(235, 233, 252, 0.92)",
  progressThumb: "rgba(247, 246, 255, 0.96)",
});

const paletteCache = new Map();
let colorParserContext = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundChannel(value) {
  return clamp(Math.round(value), 0, 255);
}

function getColorParserContext() {
  if (colorParserContext || typeof document === "undefined") {
    return colorParserContext;
  }

  const canvas = document.createElement("canvas");
  colorParserContext = canvas.getContext("2d");
  return colorParserContext;
}

function parseHexColor(value) {
  const hex = String(value ?? "").trim().replace("#", "");
  if (![3, 4, 6, 8].includes(hex.length)) {
    return null;
  }

  const normalized =
    hex.length <= 4
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex;

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function parseRgbColor(value) {
  const match = String(value ?? "")
    .trim()
    .match(/^rgba?\(([^)]+)\)$/i);
  if (!match) {
    return null;
  }

  const [r = 0, g = 0, b = 0] = match[1]
    .split(",")
    .slice(0, 3)
    .map((part) => Number.parseFloat(part));

  if (![r, g, b].every(Number.isFinite)) {
    return null;
  }

  return {
    r: roundChannel(r),
    g: roundChannel(g),
    b: roundChannel(b),
  };
}

function parseResolvedColor(value) {
  if (!value) {
    return null;
  }

  if (value.startsWith("#")) {
    return parseHexColor(value);
  }

  return parseRgbColor(value);
}

function parseCssColor(value) {
  const context = getColorParserContext();
  if (!context) {
    return null;
  }

  const fallback = context.fillStyle;
  context.fillStyle = "#000000";

  try {
    context.fillStyle = String(value ?? "").trim();
  } catch {
    context.fillStyle = fallback;
    return null;
  }

  const resolved = context.fillStyle;
  context.fillStyle = fallback;
  return parseResolvedColor(resolved);
}

function mixRgb(a, b, ratio) {
  return {
    r: roundChannel(a.r + (b.r - a.r) * ratio),
    g: roundChannel(a.g + (b.g - a.g) * ratio),
    b: roundChannel(a.b + (b.b - a.b) * ratio),
  };
}

function rgbToCss(rgb) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function rgbaToCss(rgb, alpha) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function averageRgb(colors) {
  if (!colors.length) {
    return null;
  }

  const totals = colors.reduce(
    (accumulator, color) => ({
      r: accumulator.r + color.r,
      g: accumulator.g + color.g,
      b: accumulator.b + color.b,
    }),
    { r: 0, g: 0, b: 0 }
  );

  return {
    r: roundChannel(totals.r / colors.length),
    g: roundChannel(totals.g / colors.length),
    b: roundChannel(totals.b / colors.length),
  };
}

function rgbToHsl(rgb) {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }

  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue = 0;
  switch (max) {
    case r:
      hue = (g - b) / delta + (g < b ? 6 : 0);
      break;
    case g:
      hue = (b - r) / delta + 2;
      break;
    default:
      hue = (r - g) / delta + 4;
      break;
  }

  return {
    h: hue / 6,
    s: saturation,
    l: lightness,
  };
}

function pickAccentColor(colors, fallbackColor) {
  if (!colors.length) {
    return fallbackColor;
  }

  let bestColor = colors[0];
  let bestScore = -Infinity;

  for (const color of colors) {
    const { s, l } = rgbToHsl(color);
    const contrastBias = 1 - Math.abs(l - 0.46);
    const score = s * 1.1 + contrastBias * 0.75;
    if (score > bestScore) {
      bestScore = score;
      bestColor = color;
    }
  }

  return bestColor;
}

function extractGradientColors(cover) {
  const matches = String(cover ?? "").match(/#[\da-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) ?? [];
  return matches.map(parseCssColor).filter(Boolean);
}

function extractCoverUrl(cover) {
  const match = String(cover ?? "").match(/url\((['"]?)(.*?)\1\)/i);
  return match?.[2]?.trim() ?? "";
}

function derivePalette(baseColor, accentColor = baseColor) {
  const white = { r: 255, g: 255, b: 255 };
  const neutralDeep = { r: 25, g: 25, b: 38 };
  const neutralSurface = { r: 39, g: 40, b: 58 };

  const surfaceStart = mixRgb(baseColor, neutralSurface, 0.58);
  const surfaceEnd = mixRgb(baseColor, neutralDeep, 0.74);
  const panel = mixRgb(accentColor, surfaceStart, 0.42);
  const panelEdge = mixRgb(panel, surfaceEnd, 0.28);
  const ambientCore = mixRgb(accentColor, white, 0.12);
  const border = mixRgb(baseColor, white, 0.2);
  const progressTrack = mixRgb(baseColor, white, 0.32);
  const progressFill = mixRgb(baseColor, white, 0.76);
  const progressThumb = mixRgb(baseColor, white, 0.86);

  return {
    panel: rgbToCss(panel),
    panelEdge: rgbToCss(panelEdge),
    surfaceStart: rgbToCss(surfaceStart),
    surfaceEnd: rgbToCss(surfaceEnd),
    ambient: rgbaToCss(ambientCore, 0.34),
    ambientStrong: rgbaToCss(accentColor, 0.22),
    border: rgbaToCss(border, 0.18),
    progressTrack: rgbaToCss(progressTrack, 0.18),
    progressFill: rgbaToCss(progressFill, 0.92),
    progressThumb: rgbaToCss(progressThumb, 0.96),
  };
}

function createPaletteFromGradient(cover) {
  const gradientColors = extractGradientColors(cover);
  if (!gradientColors.length) {
    return null;
  }

  const baseColor = averageRgb(gradientColors);
  if (!baseColor) {
    return null;
  }

  return derivePalette(baseColor, pickAccentColor(gradientColors, baseColor));
}

function sampleImageColors(image) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return [];
  }

  const maxDimension = 24;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * scale));

  canvas.width = width;
  canvas.height = height;
  context.drawImage(image, 0, 0, width, height);

  let data;
  try {
    data = context.getImageData(0, 0, width, height).data;
  } catch {
    return [];
  }

  const colors = [];
  for (let index = 0; index < data.length; index += 16) {
    const alpha = data[index + 3];
    if (alpha < 120) {
      continue;
    }

    colors.push({
      r: data[index],
      g: data[index + 1],
      b: data[index + 2],
    });
  }

  return colors;
}

function createPaletteFromImageUrl(url) {
  return new Promise((resolve) => {
    if (typeof Image === "undefined" || !url) {
      resolve(null);
      return;
    }

    const image = new Image();
    if (!url.startsWith("data:")) {
      image.crossOrigin = "anonymous";
    }

    image.decoding = "async";
    image.onload = () => {
      const sampledColors = sampleImageColors(image);
      const baseColor = averageRgb(sampledColors);
      if (!baseColor) {
        resolve(null);
        return;
      }

      resolve(derivePalette(baseColor, pickAccentColor(sampledColors, baseColor)));
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export async function resolvePlayerPalette(cover) {
  const key = String(cover ?? "").trim();
  if (!key) {
    return DEFAULT_PLAYER_PALETTE;
  }

  const cached = paletteCache.get(key);
  if (cached) {
    return cached;
  }

  const gradientPalette = createPaletteFromGradient(key);
  if (gradientPalette) {
    paletteCache.set(key, gradientPalette);
    return gradientPalette;
  }

  const url = extractCoverUrl(key);
  if (!url) {
    paletteCache.set(key, DEFAULT_PLAYER_PALETTE);
    return DEFAULT_PLAYER_PALETTE;
  }

  const imagePalette = await createPaletteFromImageUrl(url);
  const resolvedPalette = imagePalette ?? DEFAULT_PLAYER_PALETTE;
  paletteCache.set(key, resolvedPalette);
  return resolvedPalette;
}

export { DEFAULT_PLAYER_PALETTE };
