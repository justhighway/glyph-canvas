import type { BoundingBox, Point } from '@/types';
import {
  GLYPH_FONT_SIZE_MAX_PX,
  GLYPH_FONT_SIZE_MIN_PX,
  GLYPH_LINE_HEIGHT_RATIO,
} from '@/constants/config';

/**
 * 0~1 비율 BoundingBox를 실제 픽셀 좌표로 변환한다.
 * Gemini는 좌표를 비율값으로 반환하므로, Canvas에 그리려면
 * 실제 이미지 크기를 곱해서 픽셀 좌표로 변환해야 한다.
 *
 * @param boundingBox - 0~1 비율 좌표
 * @param imageWidth - 실제 이미지 너비 (픽셀)
 * @param imageHeight - 실제 이미지 높이 (픽셀)
 * @returns 픽셀 단위 좌표로 변환된 bounding box
 */
export const convertBoundingBoxToPixels = (
  boundingBox: BoundingBox,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; width: number; height: number } => ({
  x: boundingBox.x * imageWidth,
  y: boundingBox.y * imageHeight,
  width: boundingBox.width * imageWidth,
  height: boundingBox.height * imageHeight,
});

/**
 * bounding box 면적을 기반으로 글자 크기를 결정한다.
 *
 * @param boxWidthPx - 박스 너비 (픽셀)
 * @param boxHeightPx - 박스 높이 (픽셀)
 * @param totalImageArea - 이미지 전체 픽셀 수 (width × height)
 * @returns 클램핑된 글자 크기
 */
export const calculateFontSizeForBox = (
  boxWidthPx: number,
  boxHeightPx: number,
  totalImageArea: number,
): number => {
  const areaRatio = (boxWidthPx * boxHeightPx) / totalImageArea;

  let fontSize: number;
  if (areaRatio < 0.05) fontSize = 8;
  else if (areaRatio < 0.15) fontSize = 14;
  else if (areaRatio < 0.3) fontSize = 22;
  else fontSize = 32;

  return Math.min(
    Math.max(fontSize, GLYPH_FONT_SIZE_MIN_PX),
    GLYPH_FONT_SIZE_MAX_PX,
  );
};

/**
 * 픽셀 좌표 bounding box 안에 글자를 배치할 그리드 좌표 배열을 생성한다.
 *
 * @param boxPx - 픽셀 단위 bounding box
 * @param fontSize - 글자 크기 (픽셀)
 * @returns 글자를 배치할 좌표 배열
 */
export const buildGlyphGridForBox = (
  boxPx: { x: number; y: number; width: number; height: number },
  fontSize: number,
): Point[] => {
  const points: Point[] = [];
  const step = fontSize * GLYPH_LINE_HEIGHT_RATIO;

  for (let y = boxPx.y; y < boxPx.y + boxPx.height; y += step) {
    for (let x = boxPx.x; x < boxPx.x + boxPx.width; x += step) {
      points.push({ x, y });
    }
  }

  return points;
};
