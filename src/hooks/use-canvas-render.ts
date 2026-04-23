'use client';

import type { AnalysisPhase, AnalysisResult, Language, Point } from '@/types';
import type { BodyPartDetection, BodyPartKey } from '@/types/portrait';
import { GLYPH_DETAIL_FONT_SIZE_PX, GLYPH_FONT_SIZE_MIN_PX, GLYPH_LARGE_AREA_FONT_SIZE_PX } from '@/constants/config';
import {
  buildGlyphGridForBox,
  calculateFontSizeForBox,
  convertBoundingBoxToPixels,
} from '@/lib/box-text-placer';
import {
  calculateAverageRgbFromPixelIndices,
  deriveContrastingGlyphColor,
  rgbToCssColor,
} from '@/lib/canvas';
import { useCallback, useState } from 'react';

import type { RefObject } from 'react';
import type { SceneDetection } from '@/types/scene';
import { getBodyPartLabel } from '@/lib/body-part-label';

// ─── 내부 유틸 함수 ──────────────────────────────────────────────────────────

/**
 * 이미지 File을 HTMLImageElement로 변환한다.
 */
const fileToImageElement = (imageFile: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(imageFile);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('이미지를 로드하는 데 실패했습니다.'));
    };
    img.src = objectUrl;
  });

/**
 * 이미지의 픽셀 데이터를 오프스크린 Canvas에서 읽어 반환한다.
 * 화면 Canvas와 별도 오프스크린에서 읽는 이유:
 * 화면 Canvas는 흰 배경을 깔고 글자만 그리므로, 원본 이미지 픽셀은
 * 화면 Canvas에 존재하지 않는다. 글자 색상 계산을 위해 원본 픽셀이
 * 필요하므로 별도 오프스크린에서 읽어야 한다.
 *
 * @param img - 픽셀을 읽을 HTMLImageElement
 * @returns 이미지 전체 픽셀 데이터
 */
const readImagePixelData = (img: HTMLImageElement): ImageData => {
  const offscreen = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
  const context = offscreen.getContext('2d')!;
  context.drawImage(img, 0, 0);
  return context.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
};

/**
 * Canvas를 이미지 원본 크기로 초기화하고 흰색으로 채운다.
 */
const prepareWhiteCanvas = (
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): void => {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
};

/**
 * 256×256 selfie segmenter 마스크를 원본 이미지 해상도로 업스케일한다.
 * Face Mesh 마스크는 원본 해상도 기준이므로, 좌표계를 통일해야
 * 머리카락·얼굴·목 사이 경계가 맞아떨어진다.
 * nearest-neighbor 방식으로 각 원본 픽셀의 마스크값을 256×256에서 조회한다.
 *
 * @param mask - 256×256 크기의 원본 마스크
 * @param maskWidth - 마스크 너비 (256)
 * @param maskHeight - 마스크 높이 (256)
 * @param targetWidth - 업스케일 목표 너비 (원본 이미지 너비)
 * @param targetHeight - 업스케일 목표 높이 (원본 이미지 높이)
 * @returns targetWidth × targetHeight 크기의 업스케일된 마스크
 */
const upscaleMask = (
  mask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray => {
  // 마스크가 이미 원본 해상도면 그대로 반환한다 (Face Mesh 마스크)
  if (maskWidth === targetWidth && maskHeight === targetHeight) return mask;

  const upscaled = new Uint8ClampedArray(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(Math.floor((x / targetWidth) * maskWidth), maskWidth - 1);
      const srcY = Math.min(Math.floor((y / targetHeight) * maskHeight), maskHeight - 1);
      upscaled[y * targetWidth + x] = mask[srcY * maskWidth + srcX];
    }
  }
  return upscaled;
};

/**
 * 이미지 좌표 (x, y) 위치를 중심으로 주변 3×3 픽셀의 평균 색상을 반환한다.
 * 단일 픽셀 샘플링 대비 노이즈가 줄고 색상이 더 안정적이다.
 *
 * 3D감을 살리기 위해 주변보다 어두운 픽셀(그림자 영역)은 더 어둡게,
 * 밝은 픽셀(하이라이트)은 약간 눌러 흰 배경에서도 읽히도록 보정한다.
 *
 * @param imageData - 원본 이미지 픽셀 데이터
 * @param x - 샘플링 중심 x 좌표
 * @param y - 샘플링 중심 y 좌표
 * @param imageWidth - 이미지 너비
 * @param imageHeight - 이미지 높이
 */
const samplePixelColor = (
  imageData: ImageData,
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
): string => {
  const cx = Math.min(Math.max(Math.round(x), 0), imageWidth - 1);
  const cy = Math.min(Math.max(Math.round(y), 0), imageHeight - 1);

  // 3×3 이웃 픽셀을 선형 공간에서 평균해 노이즈를 줄인다
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sampleCount = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const sx = Math.min(Math.max(cx + dx, 0), imageWidth - 1);
      const sy = Math.min(Math.max(cy + dy, 0), imageHeight - 1);
      const byteOffset = (sy * imageWidth + sx) * 4;
      // sRGB → linear 변환 후 합산 (감마 보정 평균)
      const normalized_r = imageData.data[byteOffset] / 255;
      const normalized_g = imageData.data[byteOffset + 1] / 255;
      const normalized_b = imageData.data[byteOffset + 2] / 255;
      sumR += normalized_r <= 0.04045 ? normalized_r / 12.92 : Math.pow((normalized_r + 0.055) / 1.055, 2.4);
      sumG += normalized_g <= 0.04045 ? normalized_g / 12.92 : Math.pow((normalized_g + 0.055) / 1.055, 2.4);
      sumB += normalized_b <= 0.04045 ? normalized_b / 12.92 : Math.pow((normalized_b + 0.055) / 1.055, 2.4);
      sampleCount++;
    }
  }

  // linear → sRGB 재변환
  const toSrgb = (linear: number): number => {
    const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
    return Math.round(Math.min(Math.max(encoded * 255, 0), 255));
  };

  let r = toSrgb(sumR / sampleCount);
  let g = toSrgb(sumG / sampleCount);
  let b = toSrgb(sumB / sampleCount);

  // sRGB 가중 밝기로 명암 판단
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

  if (luminance > 180) {
    // 흰자·피부 하이라이트처럼 밝은 픽셀은 흰 배경과 구별되지 않는다.
    // 원본 색상 비율을 유지하면서 luminance를 최대 160으로 clamp한다.
    const clampScale = 160 / luminance;
    r = Math.round(r * clampScale);
    g = Math.round(g * clampScale);
    b = Math.round(b * clampScale);
  } else if (luminance < 80) {
    // 동공·눈꺼풀 음영처럼 어두운 픽셀은 흰 배경 위에서 보이지 않는다.
    // 원본 색상 비율을 유지하면서 luminance를 최소 80으로 boost한다.
    const boostScale = 80 / Math.max(luminance, 1);
    r = Math.min(255, Math.round(r * boostScale));
    g = Math.min(255, Math.round(g * boostScale));
    b = Math.min(255, Math.round(b * boostScale));
  }

  return `rgb(${r},${g},${b})`;
};

/**
 * Canvas의 지정 좌표 배열에 글자를 배치한다.
 * 글자마다 해당 좌표의 원본 이미지 픽셀 색을 개별 샘플링해 색상을 결정하므로
 * 빛·그림자·색조 변화가 글자 그림에 그대로 반영되어 3D감이 살아난다.
 *
 * sizeVariance: 0이면 모든 글자가 동일 크기. 0.2이면 ±20% 범위에서 랜덤 크기.
 * 같은 부위 안에서도 글자마다 크기가 달라져 손으로 쓴 느낌이 생긴다.
 */
const drawGlyphsAtPoints = (
  context: CanvasRenderingContext2D,
  glyphPoints: Point[],
  label: string,
  fontSize: number,
  imageData: ImageData,
  imageWidth: number,
  imageHeight: number,
  sizeVariance: number = 0.2,
): void => {
  for (const { x, y } of glyphPoints) {
    const variance = 1 + (Math.random() - 0.5) * 2 * sizeVariance;
    const actualSize = Math.max(Math.round(fontSize * variance), 6);
    context.font = `bold ${actualSize}px sans-serif`;
    context.fillStyle = samplePixelColor(imageData, x, y, imageWidth, imageHeight);
    context.fillText(label, x, y);
  }
};

/**
 * 인물 모드 렌더링 순서.
 * 넓은 영역을 먼저, 세밀한 영역을 나중에 그려야
 * 눈·눈썹·코·입이 얼굴 글자 위에 표시된다.
 */
const RENDER_ORDER: BodyPartKey[] = [
  'hair', 'clothing', 'skin', 'faceOval', 'ear', 'nose', 'mouth', 'eyebrow', 'eye', 'iris',
];

/**
 * 부위별 fontSize 스케일 인자. detailBaseFontSize에 곱해 최종 크기를 결정한다.
 * 눈·눈썹처럼 좁은 영역은 1.0 이하로 낮춰야 step이 작아져 촘촘하게 채워진다.
 */
const FONT_SIZE_SCALE_BY_PART: Partial<Record<BodyPartKey, number>> = {
  iris: 0.5,
  eye: 0.7,
  eyebrow: 0.8,
  nose: 1.0,
  mouth: 1.0,
  ear: 1.2,
};

/**
 * 넓은 배경 영역 (faceOval을 제외한 나머지 큰 영역)
 * 고정 글자 크기를 사용해 밀도를 강제한다.
 */
const LARGE_AREA_PARTS = new Set<BodyPartKey>(['clothing', 'hair', 'skin']);

/**
 * 세밀 부위 (Face Mesh 랜드마크로 생성된 작은 마스크).
 * faceOval과 겹치는 문제를 막기 위해:
 * 1. faceOval 렌더링 시 이 부위들의 마스크 픽셀을 먼저 제거한다.
 * 2. 이 부위 자체는 더 작은 step으로 촘촘하게 채운다.
 */
const DETAIL_PARTS = new Set<BodyPartKey>(['eye', 'iris', 'eyebrow', 'nose', 'mouth']);

/**
 * 인물 모드 렌더링: 각 신체 부위 마스크 영역 안에 해당 부위 이름을 채운다.
 *
 * faceOval(selfie segmenter ch3)은 눈/코/입 위치도 덮는다.
 * RENDER_ORDER대로 detail parts를 나중에 그려도 같은 격자 위치를 공유하면
 * '얼굴' 글자 사이에 '눈' 글자가 비집고 들어가지 못한다.
 * → faceOval 마스크에서 detail parts 픽셀을 AND NOT으로 제거한 뒤 그린다.
 * → detail parts는 고정 작은 step으로 촘촘하게 채워 확실히 덮는다.
 *
 * @param canvas - 렌더링 대상 Canvas
 * @param imageData - 원본 이미지 픽셀 데이터 (글자 색상 샘플링용)
 * @param bodyPartDetections - 신체 부위별 마스크 배열
 * @param imageWidth - 이미지 너비 (픽셀)
 * @param imageHeight - 이미지 높이 (픽셀)
 * @param language - 표시할 언어
 */
/**
 * 마스크 내부 픽셀을 step 간격으로 직접 순회해 글자 배치 좌표를 반환한다.
 * bounding box 기반 격자와 달리 마스크 경계에 픽셀 단위로 밀착되므로
 * 눈·코·입처럼 좁고 불규칙한 영역도 빈 공간 없이 채울 수 있다.
 *
 * edgeBoostMap이 주어지면 색상 경계 픽셀 근처에 글자를 추가로 배치해
 * 명암/색상이 급격히 변하는 경계선이 더 선명하게 표현된다.
 *
 * @param mask - 픽셀별 마스크값 (>128이면 내부)
 * @param imageWidth - 이미지 너비
 * @param imageHeight - 이미지 높이
 * @param step - 격자 간격 (픽셀)
 * @param jitterFactor - 랜덤 오프셋 강도 (0=정격자)
 * @param edgeBoostMap - 선택적. 경계 강도 맵 (값이 클수록 경계). step/2 간격 추가 배치에 사용.
 * @param edgeThreshold - edgeBoostMap에서 경계로 판단하는 최소값
 */
const buildGlyphGridFromMask = (
  mask: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  step: number,
  jitterFactor: number,
  edgeBoostMap?: Float32Array,
  edgeThreshold?: number,
): Point[] => {
  const points: Point[] = [];
  const jitterRange = step * jitterFactor;
  const halfStep = step * 0.5;
  let rowIndex = 0;

  for (let y = 0; y < imageHeight; y += step) {
    const rowOffset = rowIndex % 2 === 1 ? halfStep : 0;
    for (let x = rowOffset; x < imageWidth; x += step) {
      const ix = Math.min(Math.floor(x), imageWidth - 1);
      const iy = Math.min(Math.floor(y), imageHeight - 1);
      const pixelIndex = iy * imageWidth + ix;
      if (mask[pixelIndex] > 128) {
        const jx = (Math.random() - 0.5) * 2 * jitterRange;
        const jy = (Math.random() - 0.5) * 2 * jitterRange;
        points.push({ x: x + jx, y: y + jy });

        if (edgeBoostMap && edgeThreshold !== undefined && edgeBoostMap[pixelIndex] > edgeThreshold) {
          points.push({ x: x + halfStep + jx * 0.5, y: y + jy * 0.5 });
        }
      }
    }
    rowIndex++;
  }

  return points;
};

/**
 * 이미지 픽셀 데이터에서 색상 경계 강도 맵을 계산한다.
 * 각 픽셀에서 우측·하단 이웃과의 색상 차이(sRGB 유클리드 거리)를 구한다.
 * 값이 클수록 색상이 급격히 바뀌는 경계 영역이다.
 *
 * 경계 영역에 글자를 추가 배치하면 명암/색상 전환이 더 선명하게 그려져
 * 입체감과 영역 구분이 향상된다.
 */
const computeEdgeBoostMap = (imageData: ImageData): Float32Array => {
  const { data, width, height } = imageData;
  const edgeMap = new Float32Array(width * height);

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const right = ((y * width) + (x + 1)) * 4;
      const down = (((y + 1) * width) + x) * 4;

      const dr = data[i] - data[right];
      const dg = data[i + 1] - data[right + 1];
      const db = data[i + 2] - data[right + 2];
      const ddr = data[i] - data[down];
      const ddg = data[i + 1] - data[down + 1];
      const ddb = data[i + 2] - data[down + 2];

      // 가로·세로 방향 색상 차이를 합산해 경계 강도를 구한다.
      edgeMap[y * width + x] = Math.sqrt(dr * dr + dg * dg + db * db)
        + Math.sqrt(ddr * ddr + ddg * ddg + ddb * ddb);
    }
  }

  return edgeMap;
};

const renderPortraitGlyphs = (
  canvas: HTMLCanvasElement,
  imageData: ImageData,
  bodyPartDetections: BodyPartDetection[],
  imageWidth: number,
  imageHeight: number,
  language: Language,
): void => {
  const context = canvas.getContext('2d');
  if (!context) return;

  // 이미지 단변을 기준으로 폰트 크기를 비례 스케일한다.
  const shortSide = Math.min(imageWidth, imageHeight);
  const resolutionScale = shortSide / 1000;

  const largeAreaFontSize = Math.max(Math.round(GLYPH_LARGE_AREA_FONT_SIZE_PX * resolutionScale), GLYPH_FONT_SIZE_MIN_PX);
  const detailFontSize = Math.max(Math.round(GLYPH_DETAIL_FONT_SIZE_PX * resolutionScale), GLYPH_FONT_SIZE_MIN_PX);

  // 색상 경계 강도 맵: 경계 픽셀에 글자를 추가 배치해 입체감을 높인다.
  const edgeBoostMap = computeEdgeBoostMap(imageData);
  // 경계 판단 임계값: 각 채널 차이가 약 25/255 수준 이상이면 경계로 간주한다.
  const EDGE_THRESHOLD = 50;

  // 모든 마스크를 원본 해상도로 업스케일해 맵으로 캐싱한다.
  const upscaledMasks = new Map<BodyPartKey, Uint8ClampedArray>();
  for (const { bodyPartKey, mask, maskWidth, maskHeight } of bodyPartDetections) {
    upscaledMasks.set(bodyPartKey, upscaleMask(mask, maskWidth, maskHeight, imageWidth, imageHeight));
  }

  const orderedDetections = [...bodyPartDetections].sort(
    (a, b) => RENDER_ORDER.indexOf(a.bodyPartKey) - RENDER_ORDER.indexOf(b.bodyPartKey),
  );

  const faceOvalMask = upscaledMasks.get('faceOval') ?? null;
  const hairMask = upscaledMasks.get('hair') ?? null;
  const skinMask = upscaledMasks.get('skin') ?? null;
  const irisMask = upscaledMasks.get('iris') ?? null;

  // faceOval 렌더 시 눈·눈썹·코·입·iris 영역에 '얼굴'이 그려지는 것을 막기 위해
  // detail parts 마스크를 OR 합산한 union 마스크를 미리 계산해둔다.
  const detailUnionMask = new Uint8ClampedArray(imageWidth * imageHeight);
  for (const detailKey of DETAIL_PARTS) {
    const detailMask = upscaledMasks.get(detailKey);
    if (!detailMask) continue;
    for (let i = 0; i < detailUnionMask.length; i++) {
      if (detailMask[i] > 128) detailUnionMask[i] = 255;
    }
  }

  for (const { bodyPartKey } of orderedDetections) {
    const upscaledMask = upscaledMasks.get(bodyPartKey);
    if (!upscaledMask) continue;

    let workingMask = upscaledMask;

    if (bodyPartKey === 'faceOval') {
      // detail parts(눈·눈썹·코·입·iris)가 차지하는 픽셀을 faceOval에서 제거한다.
      workingMask = new Uint8ClampedArray(upscaledMask.length);
      for (let i = 0; i < upscaledMask.length; i++) {
        workingMask[i] = upscaledMask[i] > 128 && detailUnionMask[i] === 0 ? 255 : 0;
      }
    } else if (bodyPartKey === 'eye') {
      // eye 마스크에서 iris(동공·홍채) 픽셀을 제거해 흰자 영역만 남긴다.
      // iris는 RENDER_ORDER에서 eye 다음에 그려져 동공을 덮는다.
      workingMask = new Uint8ClampedArray(upscaledMask.length);
      for (let i = 0; i < upscaledMask.length; i++) {
        workingMask[i] = upscaledMask[i] > 128 && (irisMask === null || irisMask[i] === 0) ? 255 : 0;
      }
    } else if (bodyPartKey === 'ear') {
      // ch3 전체에서 얼굴(faceOval)·머리(hair)·목(skin)을 제거해 귀 측면만 남긴다.
      workingMask = new Uint8ClampedArray(upscaledMask.length);
      for (let i = 0; i < upscaledMask.length; i++) {
        const isEar = upscaledMask[i] > 128;
        const isFace = faceOvalMask ? faceOvalMask[i] > 128 : false;
        const isHair = hairMask ? hairMask[i] > 128 : false;
        const isSkin = skinMask ? skinMask[i] > 128 : false;
        workingMask[i] = isEar && !isFace && !isHair && !isSkin ? 255 : 0;
      }
    }

    let fontSize: number;
    let step: number;
    let jitterFactor: number;
    let sizeVariance: number;

    if (DETAIL_PARTS.has(bodyPartKey)) {
      const fontSizeScale = FONT_SIZE_SCALE_BY_PART[bodyPartKey] ?? 1.0;
      fontSize = Math.max(Math.round(detailFontSize * fontSizeScale), GLYPH_FONT_SIZE_MIN_PX);
      step = Math.max(Math.round(fontSize * 0.5), 4);
      jitterFactor = 0.0;
      sizeVariance = 0.1;
    } else if (bodyPartKey === 'faceOval') {
      fontSize = largeAreaFontSize;
      step = Math.max(Math.round(fontSize * 0.8), 4);
      jitterFactor = 0.15;
      sizeVariance = 0.2;
    } else if (LARGE_AREA_PARTS.has(bodyPartKey)) {
      fontSize = largeAreaFontSize;
      step = Math.max(Math.round(fontSize * 0.75), 4);
      jitterFactor = 0.15;
      sizeVariance = 0.2;
    } else {
      // ear
      fontSize = Math.max(Math.round(largeAreaFontSize * 0.85), GLYPH_FONT_SIZE_MIN_PX);
      step = Math.max(Math.round(fontSize * 0.85), 4);
      jitterFactor = 0.12;
      sizeVariance = 0.18;
    }

    // 경계 부스트는 넓은 영역(faceOval, skin, hair, clothing)에만 적용한다.
    // detail parts는 이미 step이 작아 경계 추가 배치가 불필요하다.
    const useEdgeBoost = !DETAIL_PARTS.has(bodyPartKey);
    const glyphPoints = buildGlyphGridFromMask(
      workingMask, imageWidth, imageHeight, step, jitterFactor,
      useEdgeBoost ? edgeBoostMap : undefined,
      useEdgeBoost ? EDGE_THRESHOLD : undefined,
    );

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[render] ${bodyPartKey}: workingMask non-zero=${Array.from(workingMask).filter(v => v > 128).length}, glyphPoints=${glyphPoints.length}, fontSize=${fontSize}, step=${step}`);
    }

    if (glyphPoints.length === 0) continue;

    const label = getBodyPartLabel(bodyPartKey, language);
    drawGlyphsAtPoints(context, glyphPoints, label, fontSize, imageData, imageWidth, imageHeight, sizeVariance);
  }
};

/**
 * 풍경 모드 렌더링: 각 감지 객체의 bounding box 영역 안에 객체 이름을 채운다.
 *
 * @param canvas - 렌더링 대상 Canvas
 * @param imageData - Canvas 현재 픽셀 데이터 (배경 색상 계산용)
 * @param sceneDetections - 감지된 객체 목록
 * @param imageWidth - 이미지 너비 (픽셀)
 * @param imageHeight - 이미지 높이 (픽셀)
 */
const renderSceneGlyphs = (
  canvas: HTMLCanvasElement,
  imageData: ImageData,
  sceneDetections: SceneDetection[],
  imageWidth: number,
  imageHeight: number,
): void => {
  const context = canvas.getContext('2d');
  if (!context) return;

  const totalImageArea = imageWidth * imageHeight;

  for (const { labelKo, boundingBox } of sceneDetections) {
    const boxPx = convertBoundingBoxToPixels(boundingBox, imageWidth, imageHeight);
    const fontSize = calculateFontSizeForBox(boxPx.width, boxPx.height, totalImageArea);
    const gridPoints = buildGlyphGridForBox(boxPx, fontSize);
    if (gridPoints.length === 0) continue;

    const centerPixelIndex =
      Math.floor(boxPx.y + boxPx.height / 2) * imageWidth +
      Math.floor(boxPx.x + boxPx.width / 2);
    const averageRgb = calculateAverageRgbFromPixelIndices(imageData, [centerPixelIndex]);
    const glyphColor = deriveContrastingGlyphColor(averageRgb);
    const cssColor = rgbToCssColor(glyphColor);

    context.font = `bold ${fontSize}px sans-serif`;
    context.fillStyle = cssColor;
    for (const { x, y } of gridPoints) {
      context.fillText(labelKo, x, y);
    }
  }
};

// ─── 훅 ─────────────────────────────────────────────────────────────────────

type UseCanvasRenderReturn = {
  phase: AnalysisPhase;
  errorMessage: string | null;
  renderGlyphs: (
    canvasRef: RefObject<HTMLCanvasElement | null>,
    imageFile: File,
    analysisResult: AnalysisResult,
    language: Language,
  ) => Promise<void>;
};

/**
 * 분석 결과를 Canvas에 글자로 렌더링하는 훅.
 * AnalysisResult의 mode 값에 따라 인물/풍경 렌더링 전략을 자동으로 선택한다.
 */
export function useCanvasRender(): UseCanvasRenderReturn {
  const [phase, setPhase] = useState<AnalysisPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const renderGlyphs = useCallback(
    async (
      canvasRef: RefObject<HTMLCanvasElement | null>,
      imageFile: File,
      analysisResult: AnalysisResult,
      language: Language,
    ): Promise<void> => {
      const canvas = canvasRef.current;
      if (!canvas) {
        setErrorMessage('Canvas 엘리먼트를 찾을 수 없습니다.');
        setPhase('error');
        return;
      }

      setPhase('loading');
      setErrorMessage(null);

      try {
        const img = await fileToImageElement(imageFile);
        const imageData = readImagePixelData(img);
        prepareWhiteCanvas(canvas, img.naturalWidth, img.naturalHeight);

        if (analysisResult.mode === 'portrait') {
          const { bodyPartDetections, imageWidth, imageHeight } = analysisResult.data;
          renderPortraitGlyphs(canvas, imageData, bodyPartDetections, imageWidth, imageHeight, language);
        } else {
          const { sceneDetections, imageWidth, imageHeight } = analysisResult.data;
          renderSceneGlyphs(canvas, imageData, sceneDetections, imageWidth, imageHeight);
        }

        setPhase('done');
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '렌더링 중 알 수 없는 오류가 발생했습니다.';
        setErrorMessage(message);
        setPhase('error');
      }
    },
    [],
  );

  return { phase, errorMessage, renderGlyphs };
}
