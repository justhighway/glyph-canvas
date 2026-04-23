import {
  GLYPH_FONT_SIZE_MAX_PX,
  GLYPH_FONT_SIZE_MIN_PX,
  GLYPH_LINE_HEIGHT_RATIO,
  MASK_SAMPLE_STEP,
} from '@/constants/config';

import type { Point } from '@/types';

/**
 * Uint8ClampedArray 마스크에서 객체에 속하는 픽셀의 1차원 인덱스를 추출한다.
 * 전체 픽셀을 순회하면 수백만 번 반복이므로, MASK_SAMPLE_STEP마다 하나씩
 * 샘플링해 성능과 정확도를 균형있게 유지한다.
 *
 * @param mask - 픽셀별 마스크값 배열. mask[i] > 128이면 객체 픽셀.
 * @param imageWidth - 이미지 너비 (픽셀)
 * @param imageHeight - 이미지 높이 (픽셀)
 * @returns 마스크 내부 픽셀의 1차원 인덱스 배열
 */
export const sampleMaskPixelIndices = (
  mask: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
): number[] => {
  const pixelIndices: number[] = [];

  for (let y = 0; y < imageHeight; y += MASK_SAMPLE_STEP) {
    for (let x = 0; x < imageWidth; x += MASK_SAMPLE_STEP) {
      const index = y * imageWidth + x;
      if (mask[index] > 128) pixelIndices.push(index);
    }
  }

  return pixelIndices;
};

/**
 * 픽셀 인덱스 배열에서 bounding box(최소 외접 사각형)를 계산한다.
 * 글자 그리드 생성의 시작점으로 사용된다.
 *
 * @param pixelIndices - 마스크 내부 픽셀 인덱스 배열
 * @param imageWidth - 인덱스를 x,y 좌표로 변환하는 데 필요한 이미지 너비
 * @returns 마스크 영역을 감싸는 최소 사각형의 좌표
 */
export const calculateBoundingBoxFromPixelIndices = (
  pixelIndices: number[],
  imageWidth: number,
): { minX: number; minY: number; maxX: number; maxY: number } => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const index of pixelIndices) {
    const x = index % imageWidth;
    const y = Math.floor(index / imageWidth);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return { minX, minY, maxX, maxY };
};

/**
 * 영역 픽셀 수와 전체 이미지 면적을 비교해 적절한 글자 크기를 결정한다.
 * 영역 비율의 제곱근에 비례하도록 계산해 넓은 영역에서도 글자가
 * 지나치게 커지지 않고 밀도 있게 채워지도록 한다.
 *
 * @param regionPixelCount - 마스크 내부 픽셀 수
 * @param totalImageArea - 이미지 전체 픽셀 수 (width × height)
 * @returns GLYPH_FONT_SIZE_MIN_PX ~ GLYPH_FONT_SIZE_MAX_PX 범위로 클램핑된 글자 크기
 */
export const calculateOptimalFontSize = (
  regionPixelCount: number,
  totalImageArea: number,
): number => {
  const areaRatio = regionPixelCount / totalImageArea;
  // 제곱근 스케일: 영역 비율이 작은 detail parts에서 MIN 근방의 적당한 크기를 반환한다.
  // areaRatio=0.002(눈 크기)이면 ~MAX*0.045 → MIN으로 올림
  // areaRatio=0.05(코 크기)이면 ~MAX*0.22 → 약 8px → MIN으로 올림
  const fontSize = Math.round(GLYPH_FONT_SIZE_MAX_PX * Math.sqrt(areaRatio));

  return Math.min(
    Math.max(fontSize, GLYPH_FONT_SIZE_MIN_PX),
    GLYPH_FONT_SIZE_MAX_PX,
  );
};

/**
 * bounding box와 fontSize를 받아 글자를 배치할 좌표 배열을 생성한다.
 * 이후 마스크 필터링으로 마스크 외부 좌표를 걸러낸다.
 *
 * - 홀수 행은 x를 step * 0.5만큼 오른쪽으로 밀어 행마다 엇갈리게 배치한다.
 * - jitterFactor: 0이면 완벽 격자, 0.3이면 ±step*0.3 범위 랜덤 오프셋.
 *   좁은 마스크(눈·코·입)에서 큰 jitter는 포인트를 마스크 밖으로 밀어내므로
 *   jitterFactor를 줄여 유효 포인트 수를 확보한다.
 *
 * @param boundingBox - 그리드를 생성할 영역
 * @param fontSize - 글자 크기 (픽셀). 그리드 간격의 기준.
 * @param jitterFactor - jitter 강도. 기본 0.15. 넓은 영역은 0.25, 좁은 영역은 0.05.
 * @returns 엇갈림과 jitter가 적용된 좌표 배열
 */
export const buildGlyphGrid = (
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number },
  fontSize: number,
  jitterFactor: number = 0.15,
): Point[] => {
  const points: Point[] = [];
  const step = fontSize * GLYPH_LINE_HEIGHT_RATIO;
  const jitterRange = step * jitterFactor;

  let rowIndex = 0;
  for (let y = boundingBox.minY; y < boundingBox.maxY; y += step) {
    const rowOffset = rowIndex % 2 === 1 ? step * 0.5 : 0;

    for (let x = boundingBox.minX + rowOffset; x < boundingBox.maxX; x += step) {
      const jitterX = (Math.random() - 0.5) * 2 * jitterRange;
      const jitterY = (Math.random() - 0.5) * 2 * jitterRange;
      points.push({ x: x + jitterX, y: y + jitterY });
    }
    rowIndex++;
  }

  return points;
};

/**
 * 그리드 좌표 중 마스크 내부에 속하는 좌표만 필터링한다.
 * buildGlyphGrid가 bounding box 전체에 그리드를 생성하므로,
 * 실제 마스크 모양에 맞게 외부 좌표를 제거하는 단계가 필요하다.
 *
 * @param gridPoints - buildGlyphGrid가 생성한 전체 그리드 좌표
 * @param mask - 픽셀별 마스크값 배열
 * @param imageWidth - 좌표를 인덱스로 변환하는 데 필요한 이미지 너비
 * @returns 마스크 내부에 속하는 좌표만 필터링된 배열
 */
export const filterGridPointsInsideMask = (
  gridPoints: Point[],
  mask: Uint8ClampedArray,
  imageWidth: number,
): Point[] =>
  gridPoints.filter(({ x, y }) => {
    const index = Math.floor(y) * imageWidth + Math.floor(x);
    return mask[index] > 128;
  });
