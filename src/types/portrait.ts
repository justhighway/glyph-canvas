/**
 ** MediaPipe가 인식할 수 있는 신체 부위 식별자
 ** `constants/body-part-labes.ts`의 레이블 및 조회 키로 사용됨
 */
export type BodyPartKey =
  | 'eye'
  | 'iris'
  | 'eyebrow'
  | 'nose'
  | 'mouth'
  | 'ear'
  | 'faceOval'
  | 'skin'
  | 'hair'
  | 'clothing';

/**
 ** 인물 모드에서 감지된 신체 부위 중 하나
 ** MediaPipe 출력을 `mediapipe-parser.ts`가 이 타입으로 변환함
 */
export type BodyPartDetection = {
  /** 신체 부위 식별자 (레이블 맵 조회 키) */
  bodyPartKey: BodyPartKey;
  /**
   ** 픽셀 단위 마스크 (1차원 배열)
   ** mask[y * maskWidth + x] > 128이면 해당 픽셀이 이 부위에 속함
   ** selfie segmenter는 256×256으로 고정 반환하므로 imageWidth와 다를 수 있다.
   */
  mask: Uint8ClampedArray;
  /** 마스크 배열의 실제 너비 (픽셀) */
  maskWidth: number;
  /** 마스크 배열의 실제 높이 (픽셀) */
  maskHeight: number;
};

/** 인물 모드 전체 분석 결과 */
export type PortraitAnalysisResult = {
  bodyPartDetections: BodyPartDetection[];
  imageWidth: number; // 분석된 원본 이미지의 가로 픽셀 수
  imageHeight: number; // 분석된 원본 이미지의 세로 픽셀 수
};
