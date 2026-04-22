/**
 ** MediaPipe가 인식할 수 있는 신체 부위 식별자
 ** `constants/body-part-labes.ts`의 레이블 및 조회 키로 사용됨
 */
export type BodyPartKey =
  | 'eye'
  | 'eyebrow'
  | 'nose'
  | 'mouth'
  | 'ear'
  | 'faceOval'
  | 'skin'
  | 'hair';

/**
 ** 인물 모드에서 감지된 신체 부위 중 하나
 ** MediaPipe 출력을 `mediapipe-parser.ts`가 이 타입으로 변환함
 */
export type BodyPartDetection = {
  /** 신체 부위 식별자 (레이블 맵 조회 키) */
  bodyPartKey: BodyPartKey;
  /**
   ** 픽셀 단위 마스크 (원본 이미지와 동일한 크기의 1차원 배열)
   ** mask[y * imageWidth + x] > 128이면 해당 픽셀이 이 부위에 속함
   */
  mask: Uint8ClampedArray;
};

/** 인물 모드 전체 분석 결과 */
export type PortraitAnalysisResult = {
  bodyPartDetections: BodyPartDetection[];
  imageWidth: number; // 분석된 원본 이미지의 가로 픽셀 수
  imageHeight: number; // 분석된 원본 이미지의 세로 픽셀 수
};
