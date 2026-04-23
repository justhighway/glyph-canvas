import { Language } from '@/types';

export const DEFAULT_LANGUAGE: Language = 'ko';

export const DEFAULT_ANALYSIS_MODE = 'portrait' as const;

/**
 * 이미지 업로드 최대 허용 크기 (Byte) - 10MB
 */
export const MAX_IMAGE_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * 업로드 허용 이미지 MIME 타입 세트
 */
export const ALLOWED_IMAGE_MIME_TYPE_SET = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * 글자 간격 비율. 1.0이면 글자 크기와 동일한 간격.
 * 0.85로 낮춰 글자가 빽빽하게 채워지도록 한다.
 */
export const GLYPH_LINE_HEIGHT_RATIO = 0.85;

/**
 * 글자 크기 범위 (픽셀). 해상도 스케일 적용 전 기준값.
 */
export const GLYPH_FONT_SIZE_MIN_PX = 10;
export const GLYPH_FONT_SIZE_MAX_PX = 40;

/**
 * 넓은 영역(머리, 얼굴, 옷, 몸) 기준 글자 크기 (픽셀, 1000px 해상도 기준).
 * 실제 크기는 이미지 단변에 비례해 자동 스케일된다.
 */
export const GLYPH_LARGE_AREA_FONT_SIZE_PX = 22;

/**
 * detail parts(눈·코·입·눈썹) 기준 글자 크기 (픽셀, 1000px 해상도 기준).
 */
export const GLYPH_DETAIL_FONT_SIZE_PX = 16;

/**
 * 마스크 픽셀 샘플링 간격 (픽셀).
 * 값이 클수록 빠르지만 정밀도가 낮아진다.
 */
export const MASK_SAMPLE_STEP = 4;

/**
 * MediaPipe Selfie Segmentation에서 전경(사람)으로 판단하는 최소 확률값.
 * 낮출수록 더 많은 픽셀이 포함되어 옷·몸통 인식률이 올라간다.
 */
export const SELFIE_SEGMENTATION_THRESHOLD = 0.35;
