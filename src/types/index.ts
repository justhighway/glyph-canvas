// 앱 전반 도메인 타입

/**
 * 지원하는 언어 타입
 */
export type Language = 'ko' | 'ja' | 'en';

/**
 * 객체의 위치를 나타내는 사각형 영역 (0~1 사이의 비율값)
 */
export type BoundingBox = {
  x: number; // 가로 시작점 (left)
  y: number; // 세로 시작점 (top)
  w: number; // 가로 너비 (width)
  h: number; // 세로 높이 (height)
};

/**
 * AI가 이미지에서 찾아낸 개별 객체 정보
 */
export type SegmentationObject = {
  label: string; // COCO 데이터셋 기준 클래스명 (예: 'dog', 'person')
  score: number; // AI의 확신도 (0~1), 노이즈 걸러내기 용
  box: BoundingBox; // 대략적인 사각형 위치
  mask: Uint8ClampedArray; // 실제 객체의 정교한 모양 (원본 이미지 크기의 이진 데이터). mask[i] > 128이면 객체 픽셀
};

/**
 * 이미지 전체 분석 결과 보고서
 */
export type SegmentationResult = {
  objects: SegmentationObject[]; // 발견된 모든 객체들
  imageWidth: number; // 분석된 이미지의 원본 가로 폭
  imageHeight: number; // 분석된 이미지의 원본 세로 높이
};

/**
 * 분석 프로세스의 현재 단계
 */
export type AnalysisPhase = 'idle' | 'loading' | 'done' | 'error';
