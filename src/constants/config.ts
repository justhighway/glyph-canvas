import { Language } from '@/types';

export const DEFAULT_LANGUAGE: Language = 'ko';

export const DEFAULT_ANALYSIS_MODE = 'portrait' as const;

/**
 * 이미지 업로드 최대 허용 크기 (Byte) - 10MB
 */
export const MAX_IMAGE_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * 업로드 허용 이미지 MIME 타입 목록
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/**
 * * Canvas에 글자를 채울 때 줄 간격 비율
 */
export const GLYPH_LINE_HEIGHT_RATIO = 1.1;

/**
 * * 글자 크기 탐색 범위 (픽셀)
 * * 영역에 맞는 최적 글자 크기를 이 범위 안에서 결정
 */
export const GYLPH_FONT_SIZE_MIN_PX = 4;
/**
 * * 글자 크기 탐색 범위 (픽셀)
 * * 영역에 맞는 최적 글자 크기를 이 범위 안에서 결정
 */
export const GLYPH_FONT_SIZE_MAX_PX = 40;

/**
 * * 마스크 픽셀 샘플링 간격
 * * 설정 값(픽셀)마다 하나씩 샘플링. 값이 클수록 빠르지만 정밀도가 낮아짐
 */
export const MASK_SAMPLE_STEP = 4;

/**
 * * MediaPipe Selife Segmentation에서 전경(사람)으로 판단하는 최소 확률값
 * * 0.5(50%) 이상 확률로 사람 픽셀이라고 판단한 경우에만 마스크에 포함
 */
export const SELFIE_SEGMENTATION_THRESHOLD = 0.5;
